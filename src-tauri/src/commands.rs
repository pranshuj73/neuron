use crate::db::{self};
use crate::graph::{GraphPayload, Insights, NoteNode};
use crate::scanner::ScanResult;
use crate::AppState;
use serde::{Deserialize, Serialize};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use tauri::{AppHandle, Emitter, State};
use tokio::task::spawn_blocking;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub embedding_provider: String,
    pub hf_api_key: String,
    pub hf_model: String,
    pub ollama_url: String,
    pub ollama_model: String,
    pub similarity_threshold: f64,
    pub vault_path: String,
    pub qdrant_url: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EmbedResult {
    pub embedded: usize,
    pub failed: usize,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EmbedProgress {
    pub done: usize,
    pub total: usize,
    pub current_title: String,
}

#[tauri::command]
pub async fn pick_vault_folder(app: AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let path = app
        .dialog()
        .file()
        .set_title("Select Vault Folder")
        .blocking_pick_folder();
    Ok(path.map(|p| p.to_string()))
}

#[tauri::command]
pub async fn scan_vault(
    state: State<'_, AppState>,
    vault_path: String,
) -> Result<ScanResult, String> {
    // Save vault_path to settings
    {
        let db = state.db.clone();
        let vp = vault_path.clone();
        spawn_blocking(move || {
            let conn = db.lock().unwrap();
            db::set_setting(&conn, "vault_path", &vp)
        })
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;
    }

    crate::scanner::scan_vault(vault_path, state.db.clone())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn embed_notes(
    app: AppHandle,
    state: State<'_, AppState>,
    force: bool,
) -> Result<EmbedResult, String> {
    let settings = load_settings(&state).await?;
    let qdrant_url = settings.qdrant_url.clone();

    // Always use fastembed — emit progress while model loads/downloads
    let not_in_memory = state.local_embedder.lock().unwrap().is_none();

    let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
    let model_cache_dir = std::path::PathBuf::from(&home).join(".neuron").join("model_cache");
    std::fs::create_dir_all(&model_cache_dir).ok();

    // If any model subdirectory exists, the files are cached on disk
    let cached_on_disk = std::fs::read_dir(&model_cache_dir)
        .map(|mut d| d.next().is_some())
        .unwrap_or(false);
    let needs_download = not_in_memory && !cached_on_disk;

    let done_flag = Arc::new(AtomicBool::new(false));
    let done_bg = done_flag.clone();
    let app_bg = app.clone();
    tokio::spawn(async move {
        let mut secs = 0u32;
        while !done_bg.load(Ordering::Relaxed) {
            let title = if needs_download {
                format!("Downloading model… {}s (first run only)", secs)
            } else {
                format!("Loading model… {}s", secs)
            };
            let _ = app_bg.emit("embed:progress", EmbedProgress {
                done: 0,
                total: 1,
                current_title: title,
            });
            tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
            secs += 1;
        }
    });

    let embedder_arc = state.local_embedder.clone();
    let vector_size: u64 = spawn_blocking(move || -> Result<u64, String> {
        let mut guard = embedder_arc.lock().unwrap();
        if guard.is_none() {
            let model = fastembed::TextEmbedding::try_new(
                fastembed::TextInitOptions::new(fastembed::EmbeddingModel::EmbeddingGemma300M)
                    .with_cache_dir(model_cache_dir),
            )
            .map_err(|e| format!("Failed to load EmbeddingGemma: {e}"))?;
            *guard = Some(model);
        }
        let probe = guard.as_mut().unwrap()
            .embed(vec!["probe"], None)
            .map_err(|e| e.to_string())?;
        Ok(probe[0].len() as u64)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e: String| e)?;

    done_flag.store(true, Ordering::Relaxed);

    let vault_id = std::path::Path::new(&settings.vault_path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("default")
        .to_string();

    crate::qdrant::ensure_collection(&qdrant_url, vector_size)
        .await
        .map_err(|e| e.to_string())?;

    {
        let db = state.db.clone();
        let vs = vector_size.to_string();
        spawn_blocking(move || {
            let conn = db.lock().unwrap();
            db::set_setting(&conn, "vector_size", &vs)
        })
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;
    }

    if force {
        let db = state.db.clone();
        spawn_blocking(move || {
            let conn = db.lock().unwrap();
            db::clear_embedded_at(&conn)
        })
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;
    }

    let unembedded = {
        let db = state.db.clone();
        spawn_blocking(move || {
            let conn = db.lock().unwrap();
            db::get_unembedded_notes(&conn)
        })
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?
    };

    let total = unembedded.len();
    let mut embedded_count = 0usize;
    let mut failed_count = 0usize;

    for (i, note) in unembedded.iter().enumerate() {
        let _ = app.emit(
            "embed:progress",
            EmbedProgress { done: i, total, current_title: note.title.clone() },
        );

        let tags: Vec<String> = serde_json::from_str(&note.tags).unwrap_or_default();
        let text = crate::embedder::prepare_text(&note.title, &tags, &note.body);

        let embedder_arc = state.local_embedder.clone();
        let vector_result: Result<Vec<f32>, String> = spawn_blocking(move || {
            let mut guard = embedder_arc.lock().unwrap();
            let mut results = guard.as_mut().unwrap()
                .embed(vec![text], None)
                .map_err(|e| e.to_string())?;
            Ok(results.pop().unwrap_or_default())
        })
        .await
        .map_err(|e| e.to_string())?;

        match vector_result {
            Ok(vector) => {
                if let Err(e) = crate::qdrant::upsert_point(
                    &qdrant_url, &note.id, vector, &note.title, &note.file_path, &vault_id,
                )
                .await
                {
                    eprintln!("Qdrant upsert failed for {}: {e}", note.title);
                    failed_count += 1;
                    continue;
                }

                let db = state.db.clone();
                let note_id = note.id.clone();
                let now = db::now_unix();
                if let Err(e) = spawn_blocking(move || {
                    let conn = db.lock().unwrap();
                    db::mark_note_embedded(&conn, &note_id, now)
                })
                .await
                .map_err(|e| e.to_string())
                .and_then(|r| r.map_err(|e| e.to_string()))
                {
                    eprintln!("DB update failed for {}: {e}", note.title);
                }
                embedded_count += 1;
            }
            Err(e) => {
                eprintln!("Embedding failed for {}: {e}", note.title);
                failed_count += 1;
            }
        }
    }

    let _ = app.emit(
        "embed:progress",
        EmbedProgress { done: total, total, current_title: String::new() },
    );

    Ok(EmbedResult { embedded: embedded_count, failed: failed_count })
}

#[tauri::command]
pub async fn get_graph(state: State<'_, AppState>) -> Result<GraphPayload, String> {
    let settings = load_settings(&state).await?;
    let vault_id = std::path::Path::new(&settings.vault_path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("default")
        .to_string();
    crate::graph::build_graph(
        state.db.clone(),
        settings.qdrant_url,
        settings.similarity_threshold as f32,
        vault_id,
    )
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn search_notes(
    state: State<'_, AppState>,
    query: String,
) -> Result<Vec<NoteNode>, String> {
    let db = state.db.clone();
    let results = spawn_blocking(move || {
        let conn = db.lock().unwrap();
        db::search_notes_fts(&conn, &query)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())?;

    Ok(results
        .into_iter()
        .map(|n| NoteNode {
            id: n.id,
            title: n.title,
            file_path: n.file_path,
            tags: serde_json::from_str(&n.tags).unwrap_or_default(),
            embedded_at: n.embedded_at,
            keywords: serde_json::from_str(&n.keywords).unwrap_or_default(),
        })
        .collect())
}

#[tauri::command]
pub async fn get_settings(state: State<'_, AppState>) -> Result<AppSettings, String> {
    load_settings(&state).await
}

#[tauri::command]
pub async fn save_settings(
    state: State<'_, AppState>,
    settings: AppSettings,
) -> Result<(), String> {
    let db = state.db.clone();
    spawn_blocking(move || {
        let conn = db.lock().unwrap();
        db::set_setting(&conn, "embedding_provider", &settings.embedding_provider)?;
        db::set_setting(&conn, "hf_api_key", &settings.hf_api_key)?;
        db::set_setting(&conn, "hf_model", &settings.hf_model)?;
        db::set_setting(&conn, "ollama_url", &settings.ollama_url)?;
        db::set_setting(&conn, "ollama_model", &settings.ollama_model)?;
        db::set_setting(
            &conn,
            "similarity_threshold",
            &settings.similarity_threshold.to_string(),
        )?;
        db::set_setting(&conn, "vault_path", &settings.vault_path)?;
        db::set_setting(&conn, "qdrant_url", &settings.qdrant_url)?;
        Ok::<(), anyhow::Error>(())
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e: anyhow::Error| e.to_string())
}

#[tauri::command]
pub async fn get_insights(state: State<'_, AppState>) -> Result<Insights, String> {
    let settings = load_settings(&state).await?;
    let vault_id = std::path::Path::new(&settings.vault_path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("default")
        .to_string();
    crate::graph::compute_insights(
        state.db.clone(),
        settings.qdrant_url,
        settings.similarity_threshold as f32,
        vault_id,
    )
    .await
    .map_err(|e| e.to_string())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemStatus {
    pub docker_available: bool,
    pub qdrant_ok: bool,
}

#[tauri::command]
pub async fn read_note_content(file_path: String) -> Result<String, String> {
    tokio::fs::read_to_string(&file_path)
        .await
        .map_err(|e| format!("Failed to read file: {e}"))
}

// Returns true if links were written, false if an existing block was removed.
#[tauri::command]
pub async fn write_note_links(file_path: String, links: Vec<String>) -> Result<bool, String> {
    use regex::Regex;

    let content = tokio::fs::read_to_string(&file_path)
        .await
        .map_err(|e| format!("Failed to read file: {e}"))?;

    // Match an existing neuron-generated block from the separator to EOF
    let re = Regex::new(r"\n\n---\n\nrelated:\n(?:\+ \[\[.+\]\]\n?)*$")
        .map_err(|e| e.to_string())?;

    if re.is_match(&content) {
        let new_content = re.replace(&content, "").to_string();
        tokio::fs::write(&file_path, new_content)
            .await
            .map_err(|e| format!("Failed to write file: {e}"))?;
        return Ok(false);
    }

    let entries: String = links.iter().map(|l| format!("+ [[{l}]]\n")).collect();
    let block = format!("\n\n---\n\nrelated:\n{entries}");
    let new_content = format!("{}{}", content.trim_end_matches('\n'), block);
    tokio::fs::write(&file_path, new_content)
        .await
        .map_err(|e| format!("Failed to write file: {e}"))?;
    Ok(true)
}

#[tauri::command]
pub async fn get_system_status() -> Result<SystemStatus, String> {
    let docker_available = crate::sidecar::is_docker_available().await;
    let qdrant_ok = crate::qdrant::health_check("http://localhost:6333").await;
    Ok(SystemStatus {
        docker_available,
        qdrant_ok,
    })
}

#[tauri::command]
pub async fn start_qdrant_docker() -> Result<SystemStatus, String> {
    let docker_available = crate::sidecar::is_docker_available().await;
    if !docker_available {
        return Ok(SystemStatus {
            docker_available: false,
            qdrant_ok: false,
        });
    }
    if let Err(e) = crate::sidecar::start_qdrant().await {
        return Err(format!("Failed to start Qdrant: {e}"));
    }
    Ok(SystemStatus {
        docker_available: true,
        qdrant_ok: crate::qdrant::health_check("http://localhost:6333").await,
    })
}

async fn load_settings(state: &State<'_, AppState>) -> Result<AppSettings, String> {
    let db = state.db.clone();
    spawn_blocking(move || {
        let conn = db.lock().unwrap();
        let get = |key: &str| {
            db::get_setting(&conn, key)
                .unwrap_or(None)
                .unwrap_or_default()
        };
        Ok::<AppSettings, String>(AppSettings {
            embedding_provider: get("embedding_provider"),
            hf_api_key: get("hf_api_key"),
            hf_model: get("hf_model"),
            ollama_url: get("ollama_url"),
            ollama_model: get("ollama_model"),
            similarity_threshold: get("similarity_threshold").parse().unwrap_or(0.75),
            vault_path: get("vault_path"),
            qdrant_url: get("qdrant_url"),
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

