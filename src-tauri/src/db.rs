use anyhow::{Context, Result};
use rusqlite::{params, Connection, OptionalExtension};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

pub struct NoteRecord {
    pub id: String,
    pub file_path: String,
    pub title: String,
    pub body: String,
    pub tags: String,
    pub headings: String,
    pub embedded_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
}

pub struct ExplicitLink {
    pub source_id: String,
    pub target_id: String,
    pub link_type: String,
    pub raw_target: String,
}

pub fn now_unix() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

pub fn init(app_data_dir: &Path) -> Result<Connection> {
    std::fs::create_dir_all(app_data_dir)?;
    let db_path = app_data_dir.join("neuron.db");
    let conn = Connection::open(&db_path)
        .with_context(|| format!("Failed to open SQLite at {}", db_path.display()))?;

    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;

    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS notes (
            id          TEXT PRIMARY KEY,
            file_path   TEXT NOT NULL UNIQUE,
            title       TEXT NOT NULL,
            body        TEXT NOT NULL,
            tags        TEXT NOT NULL DEFAULT '[]',
            headings    TEXT NOT NULL DEFAULT '[]',
            embedded_at INTEGER,
            created_at  INTEGER NOT NULL,
            updated_at  INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS explicit_links (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            source_id  TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
            target_id  TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
            link_type  TEXT NOT NULL CHECK(link_type IN ('wiki', 'markdown')),
            raw_target TEXT NOT NULL,
            UNIQUE(source_id, target_id, link_type)
        );

        CREATE TABLE IF NOT EXISTS settings (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        ",
    )?;

    // Insert defaults (ignore if already exist)
    let defaults = [
        ("embedding_provider", "local"),
        ("hf_api_key", ""),
        ("hf_model", "sentence-transformers/all-MiniLM-L6-v2"),
        ("ollama_url", "http://localhost:11434"),
        ("ollama_model", "nomic-embed-text"),
        ("similarity_threshold", "0.75"),
        ("vault_path", ""),
        ("qdrant_url", "http://localhost:6333"),
        ("vector_size", "768"),
    ];
    for (key, value) in &defaults {
        conn.execute(
            "INSERT OR IGNORE INTO settings (key, value) VALUES (?1, ?2)",
            params![key, value],
        )?;
    }

    Ok(conn)
}

pub fn upsert_note(conn: &Connection, note: &NoteRecord) -> Result<()> {
    conn.execute(
        "INSERT INTO notes (id, file_path, title, body, tags, headings, embedded_at, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT(file_path) DO UPDATE SET
             title = excluded.title,
             body = excluded.body,
             tags = excluded.tags,
             headings = excluded.headings,
             embedded_at = CASE WHEN notes.updated_at != excluded.updated_at THEN NULL ELSE notes.embedded_at END,
             updated_at = excluded.updated_at",
        params![
            note.id,
            note.file_path,
            note.title,
            note.body,
            note.tags,
            note.headings,
            note.embedded_at,
            note.created_at,
            note.updated_at,
        ],
    )?;
    Ok(())
}

pub fn get_all_notes(conn: &Connection) -> Result<Vec<NoteRecord>> {
    let mut stmt = conn.prepare(
        "SELECT id, file_path, title, body, tags, headings, embedded_at, created_at, updated_at FROM notes",
    )?;
    let notes = stmt
        .query_map([], |row| {
            Ok(NoteRecord {
                id: row.get(0)?,
                file_path: row.get(1)?,
                title: row.get(2)?,
                body: row.get(3)?,
                tags: row.get(4)?,
                headings: row.get(5)?,
                embedded_at: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(notes)
}

pub fn get_unembedded_notes(conn: &Connection) -> Result<Vec<NoteRecord>> {
    let mut stmt = conn.prepare(
        "SELECT id, file_path, title, body, tags, headings, embedded_at, created_at, updated_at
         FROM notes WHERE embedded_at IS NULL",
    )?;
    let notes = stmt
        .query_map([], |row| {
            Ok(NoteRecord {
                id: row.get(0)?,
                file_path: row.get(1)?,
                title: row.get(2)?,
                body: row.get(3)?,
                tags: row.get(4)?,
                headings: row.get(5)?,
                embedded_at: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(notes)
}

pub fn mark_note_embedded(conn: &Connection, id: &str, timestamp: i64) -> Result<()> {
    conn.execute(
        "UPDATE notes SET embedded_at = ?1 WHERE id = ?2",
        params![timestamp, id],
    )?;
    Ok(())
}

pub fn delete_note(conn: &Connection, file_path: &str) -> Result<()> {
    conn.execute("DELETE FROM notes WHERE file_path = ?1", params![file_path])?;
    Ok(())
}

pub fn get_all_file_paths(conn: &Connection) -> Result<Vec<(String, String)>> {
    let mut stmt = conn.prepare("SELECT id, file_path FROM notes")?;
    let rows = stmt
        .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

pub fn upsert_explicit_link(conn: &Connection, link: &ExplicitLink) -> Result<()> {
    conn.execute(
        "INSERT OR IGNORE INTO explicit_links (source_id, target_id, link_type, raw_target)
         VALUES (?1, ?2, ?3, ?4)",
        params![link.source_id, link.target_id, link.link_type, link.raw_target],
    )?;
    Ok(())
}

pub fn delete_explicit_links_for_note(conn: &Connection, source_id: &str) -> Result<()> {
    conn.execute(
        "DELETE FROM explicit_links WHERE source_id = ?1",
        params![source_id],
    )?;
    Ok(())
}

pub fn get_all_explicit_links(conn: &Connection) -> Result<Vec<ExplicitLink>> {
    let mut stmt = conn.prepare(
        "SELECT source_id, target_id, link_type, raw_target FROM explicit_links",
    )?;
    let links = stmt
        .query_map([], |row| {
            Ok(ExplicitLink {
                source_id: row.get(0)?,
                target_id: row.get(1)?,
                link_type: row.get(2)?,
                raw_target: row.get(3)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(links)
}

pub fn get_setting(conn: &Connection, key: &str) -> Result<Option<String>> {
    let mut stmt = conn.prepare("SELECT value FROM settings WHERE key = ?1")?;
    let result = stmt.query_row(params![key], |row| row.get(0)).optional()?;
    Ok(result)
}

pub fn set_setting(conn: &Connection, key: &str, value: &str) -> Result<()> {
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )?;
    Ok(())
}

pub fn clear_embedded_at(conn: &Connection) -> Result<()> {
    conn.execute("UPDATE notes SET embedded_at = NULL", [])?;
    Ok(())
}

pub fn search_notes_fts(conn: &Connection, query: &str) -> Result<Vec<NoteRecord>> {
    let pattern = format!("%{}%", query.to_lowercase());
    let mut stmt = conn.prepare(
        "SELECT id, file_path, title, body, tags, headings, embedded_at, created_at, updated_at
         FROM notes
         WHERE lower(title) LIKE ?1 OR lower(body) LIKE ?1
         LIMIT 50",
    )?;
    let notes = stmt
        .query_map(params![pattern], |row| {
            Ok(NoteRecord {
                id: row.get(0)?,
                file_path: row.get(1)?,
                title: row.get(2)?,
                body: row.get(3)?,
                tags: row.get(4)?,
                headings: row.get(5)?,
                embedded_at: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(notes)
}
