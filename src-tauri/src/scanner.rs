use crate::db::{self, ExplicitLink, NoteRecord};
use anyhow::Result;
use rusqlite::Connection;
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use std::time::UNIX_EPOCH;
use uuid::Uuid;
use walkdir::WalkDir;

#[derive(Debug, Serialize, Clone)]
pub struct ScanResult {
    pub new: usize,
    pub updated: usize,
    pub deleted: usize,
}

pub async fn scan_vault(vault_path: String, db: Arc<Mutex<Connection>>) -> Result<ScanResult> {
    // Collect .md files with their mtimes
    let md_files: Vec<(String, i64)> = WalkDir::new(&vault_path)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.file_type().is_file()
                && e.path()
                    .extension()
                    .map(|ext| ext.eq_ignore_ascii_case("md"))
                    .unwrap_or(false)
        })
        .filter_map(|e| {
            let path = e.path().to_string_lossy().to_string();
            let mtime = e
                .metadata()
                .ok()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_secs() as i64)
                .unwrap_or(0);
            Some((path, mtime))
        })
        .collect();

    let discovered_paths: HashSet<String> = md_files.iter().map(|(p, _)| p.clone()).collect();

    // Get existing notes from DB
    let existing = tokio::task::spawn_blocking({
        let db = db.clone();
        move || {
            let conn = db.lock().unwrap();
            db::get_all_file_paths(&conn)
        }
    })
    .await??;

    let existing_map: HashMap<String, String> =
        existing.into_iter().map(|(id, path)| (path, id)).collect();

    let mut new_count = 0usize;
    let mut updated_count = 0usize;

    // Process files: parse and upsert changed/new notes
    // Also collect wiki_links and md_links per note id for link resolution
    let mut note_links: HashMap<String, (Vec<String>, Vec<String>)> = HashMap::new();

    for (file_path, mtime) in &md_files {
        // Check if the file needs processing
        let existing_id = existing_map.get(file_path).cloned();

        let content = match std::fs::read_to_string(file_path) {
            Ok(c) => c,
            Err(_) => continue,
        };

        let parsed = crate::parser::parse(std::path::Path::new(file_path), &content);

        let now = db::now_unix();
        let note_id = existing_id.clone().unwrap_or_else(|| Uuid::new_v4().to_string());

        let keywords = crate::keywords::extract_keywords(&parsed.title, &parsed.body, 20);
        let keywords_json = serde_json::to_string(&keywords).unwrap_or_else(|_| "[]".to_string());

        let record = NoteRecord {
            id: note_id.clone(),
            file_path: file_path.clone(),
            title: parsed.title,
            body: parsed.body,
            tags: serde_json::to_string(&parsed.tags).unwrap_or_else(|_| "[]".to_string()),
            headings: serde_json::to_string(&parsed.headings)
                .unwrap_or_else(|_| "[]".to_string()),
            keywords: keywords_json,
            embedded_at: None,
            created_at: now,
            updated_at: *mtime,
        };

        if existing_id.is_none() {
            new_count += 1;
        } else {
            updated_count += 1;
        }

        note_links.insert(note_id, (parsed.wiki_links, parsed.md_links));

        let db_clone = db.clone();
        let record_owned = record;
        tokio::task::spawn_blocking(move || {
            let conn = db_clone.lock().unwrap();
            db::upsert_note(&conn, &record_owned)
        })
        .await??;
    }

    // Delete notes no longer on disk
    let mut deleted_count = 0usize;
    for (path, _id) in &existing_map {
        if !discovered_paths.contains(path.as_str()) {
            deleted_count += 1;
            let db_clone = db.clone();
            let path_owned = path.clone();
            tokio::task::spawn_blocking(move || {
                let conn = db_clone.lock().unwrap();
                db::delete_note(&conn, &path_owned)
            })
            .await??;
        }
    }

    // Resolve and upsert explicit links
    // Build path-stem → note_id and title → note_id lookup maps
    let all_notes = tokio::task::spawn_blocking({
        let db = db.clone();
        move || {
            let conn = db.lock().unwrap();
            db::get_all_file_paths(&conn)
        }
    })
    .await??;

    // id → (file_path)
    let id_to_path: HashMap<String, String> =
        all_notes.iter().map(|(id, p)| (id.clone(), p.clone())).collect();

    // stem → id (for wiki-link resolution)
    let stem_to_id: HashMap<String, String> = all_notes
        .iter()
        .filter_map(|(id, path)| {
            std::path::Path::new(path)
                .file_stem()
                .and_then(|s| s.to_str())
                .map(|stem| (stem.to_lowercase(), id.clone()))
        })
        .collect();

    // path → id
    let path_to_id: HashMap<String, String> =
        all_notes.iter().map(|(id, p)| (p.clone(), id.clone())).collect();

    for (source_id, (wiki_links, md_links)) in note_links {
        // Clear existing links for this note first
        let db_clone = db.clone();
        let sid = source_id.clone();
        tokio::task::spawn_blocking(move || {
            let conn = db_clone.lock().unwrap();
            db::delete_explicit_links_for_note(&conn, &sid)
        })
        .await??;

        // Resolve wiki links
        for raw in &wiki_links {
            let target_stem = std::path::Path::new(raw)
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or(raw)
                .to_lowercase();
            if let Some(target_id) = stem_to_id.get(&target_stem) {
                if target_id != &source_id {
                    let link = ExplicitLink {
                        source_id: source_id.clone(),
                        target_id: target_id.clone(),
                        link_type: "wiki".to_string(),
                        raw_target: raw.clone(),
                    };
                    let db_clone = db.clone();
                    tokio::task::spawn_blocking(move || {
                        let conn = db_clone.lock().unwrap();
                        db::upsert_explicit_link(&conn, &link)
                    })
                    .await??;
                }
            }
        }

        // Resolve markdown links
        let source_path = id_to_path.get(&source_id).cloned().unwrap_or_default();
        let source_dir = std::path::Path::new(&source_path)
            .parent()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default();

        for raw in &md_links {
            // Try absolute path first, then relative to source dir
            let candidate_paths = vec![
                raw.clone(),
                format!("{}/{}", source_dir, raw),
            ];
            for candidate in candidate_paths {
                let canonical = std::fs::canonicalize(&candidate)
                    .map(|p| p.to_string_lossy().to_string())
                    .unwrap_or(candidate);
                if let Some(target_id) = path_to_id.get(&canonical) {
                    if target_id != &source_id {
                        let link = ExplicitLink {
                            source_id: source_id.clone(),
                            target_id: target_id.clone(),
                            link_type: "markdown".to_string(),
                            raw_target: raw.clone(),
                        };
                        let db_clone = db.clone();
                        tokio::task::spawn_blocking(move || {
                            let conn = db_clone.lock().unwrap();
                            db::upsert_explicit_link(&conn, &link)
                        })
                        .await??;
                        break;
                    }
                }
            }
        }
    }

    Ok(ScanResult {
        new: new_count,
        updated: updated_count,
        deleted: deleted_count,
    })
}
