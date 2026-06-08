mod commands;
mod db;
mod embedder;
mod graph;
mod keywords;
mod parser;
mod qdrant;
mod scanner;
mod sidecar;

use rusqlite::Connection;
use std::sync::{Arc, Mutex};
use tauri::Manager;

pub struct AppState {
    pub db: Arc<Mutex<Connection>>,
    pub local_embedder: Arc<Mutex<Option<fastembed::TextEmbedding>>>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .expect("Failed to resolve app data directory");

            let conn = db::init(&data_dir).expect("Failed to initialize SQLite database");

            app.manage(AppState {
                db: Arc::new(Mutex::new(conn)),
                local_embedder: Arc::new(Mutex::new(None)),
            });

            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if sidecar::is_docker_available().await {
                    if let Err(e) = sidecar::start_qdrant().await {
                        eprintln!("Qdrant failed to start: {e}");
                    }
                }
                drop(app_handle);
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::pick_vault_folder,
            commands::scan_vault,
            commands::embed_notes,
            commands::get_graph,
            commands::search_notes,
            commands::get_settings,
            commands::save_settings,
            commands::get_insights,
            commands::get_system_status,
            commands::start_qdrant_docker,
            commands::read_note_content,
            commands::write_note_links,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
