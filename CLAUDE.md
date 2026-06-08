# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

**Neuron** is a desktop application (Tauri 2 + React 19 + TypeScript) that ingests Markdown files, embeds their contents via HuggingFace Inference API or Ollama, stores them in Qdrant (vector DB) and SQLite, and visualizes semantic relationships between notes as an interactive force-directed graph.

The product is a **semantic knowledge graph**, not a note-taking app. The core value is the graph.

## Commands

Use `bun` as the package manager.

```bash
# Start the full desktop app (Tauri + React frontend with HMR)
bun run tauri dev

# Build the desktop app for production
bun run tauri build

# Frontend-only dev server (no Tauri, browser only — useful for UI work)
bun run dev

# Type-check and build the frontend
bun run build   # runs tsc && vite build

# Rust backend checks
cd src-tauri && cargo check
cd src-tauri && cargo build
cd src-tauri && cargo test
```

The Vite dev server runs on port **1420** (strict — will fail if occupied).

## Architecture

Tauri 2 app with two layers communicating via Tauri commands (`invoke` on the frontend, `#[tauri::command]` on the backend).

```
src/                          React frontend (TypeScript)
  App.tsx                     Root layout: 3-pane grid (Sidebar | Graph | RightPanel)
  styles.css                  Global dark theme CSS (CSS custom properties, no Tailwind)
  types/graph.ts              All shared TypeScript interfaces
  hooks/                      useGraph, useSettings, useEmbedProgress
  components/
    graph/GraphCanvas.tsx     ForceGraph2D wrapper — custom node/link canvas rendering
    graph/GraphControls.tsx   Threshold slider + stats bar above the graph
    layout/Sidebar.tsx        Left panel: vault open/scan/embed, search
    layout/RightPanel.tsx     Right panel: tabbed Note/Hubs/Orphans/Suggestions
    panels/                   HubsPanel, OrphansPanel, SuggestionsPanel
    settings/SettingsModal.tsx Embedding provider config + similarity threshold

src-tauri/src/
  lib.rs                      Module declarations, AppState, run() with setup/invoke_handler
  main.rs                     Entry point (calls neuron_lib::run())
  commands.rs                 All #[tauri::command] functions
  db.rs                       SQLite init + CRUD (notes, explicit_links, settings tables)
  parser.rs                   Markdown parsing: gray_matter (frontmatter) + pulldown-cmark
  scanner.rs                  Vault walkdir, upsert notes, resolve explicit links
  embedder.rs                 HF Inference API + Ollama HTTP clients
  qdrant.rs                   Qdrant REST client (raw reqwest, no SDK)
  sidecar.rs                  Qdrant process lifecycle: spawn, health-check, kill
  graph.rs                    Graph construction: explicit edges + semantic edges via Qdrant search

src-tauri/binaries/
  qdrant-x86_64-unknown-linux-gnu   Qdrant binary (Tauri sidecar)
```

## Data Flow

1. User picks a vault folder → `scan_vault` command (walkdir → parser → SQLite)
2. User clicks "Embed Notes" → `embed_notes` command (SQLite → embedder → Qdrant upsert), emits `embed:progress` events
3. User/auto loads graph → `get_graph` command (SQLite notes + explicit links + Qdrant similarity search) → ForceGraph2D renders
4. `get_insights` command computes hubs, orphans, and missing-link suggestions from the graph

## Tauri Commands

All async, return `Result<T, String>`:

| Command | Description |
|---------|-------------|
| `pick_vault_folder` | Opens system folder picker dialog |
| `scan_vault(vaultPath)` | Scans .md files, parses, upserts to SQLite |
| `embed_notes` | Embeds unembedded notes, upserts to Qdrant |
| `get_graph` | Returns `{ nodes, edges }` for visualization |
| `search_notes(query)` | SQLite LIKE search on title + body |
| `get_settings` / `save_settings` | R/W settings table in SQLite |
| `get_insights` | Returns `{ hubs, orphans, suggestions }` |

## Storage

- **SQLite**: `~/.local/share/com.prnsh.neuron/neuron.db` — notes, explicit_links, settings tables
- **Qdrant**: `~/.local/share/com.prnsh.neuron/qdrant_storage/` — vector collection `"notes"` (384-dim cosine for HF all-MiniLM-L6-v2, 768-dim for Ollama nomic-embed-text)
- **Qdrant config**: `~/.local/share/com.prnsh.neuron/qdrant_config.yaml` (written on first launch)

## Key Design Decisions

- **One embedding per note** (no chunking). Chunk-level embeddings are a future concern.
- **Hybrid graph**: semantic edges (dashed lines, opacity ∝ similarity) + explicit edges (solid lines) on the same canvas.
- **MVP scope**: Markdown only. No PDFs, no RAG, no LLM chat. The graph must be compelling on its own.
- **No UMAP in MVP**: react-force-graph's built-in force simulation is used. UMAP is a future enhancement.
- **Qdrant as sidecar**: bundled binary started/stopped by Tauri. If Qdrant is already running on port 6333, the app uses it and does not manage its lifecycle.
- **`ForceGraph2D` imported from `react-force-graph`** (not `react-force-graph-2d` which has no types).
- **Tauri 2 trait imports**: `tauri::Emitter` required for `app.emit()`, `tauri::Manager` required for `app.path()`.
- **rusqlite `.optional()`** requires `use rusqlite::OptionalExtension`.
- **Model switching** (HF ↔ Ollama) changes vector dimensions (384 ↔ 768). The app detects the mismatch on `embed_notes` and recreates the Qdrant collection, clearing all `embedded_at` timestamps so notes get re-embedded.
