import { invoke } from "@tauri-apps/api/core";
import type { EmbedProgress, EmbedResult, NoteNode, ScanResult } from "../../types/graph";

interface Props {
  vaultPath: string;
  noteCount: number;
  embeddedCount: number;
  isScanning: boolean;
  isEmbedding: boolean;
  embedProgress: EmbedProgress | null;
  onVaultPicked: (path: string) => void;
  onScanComplete: (result: ScanResult) => void;
  onEmbedComplete: (result: EmbedResult) => void;
  onGraphRefresh: () => void;
  onShowSettings: () => void;
  showSemantic: boolean;
  onToggleSemantic: () => void;
  searchResults: NoteNode[];
  onSearch: (query: string) => void;
  onSearchNodeSelect: (node: NoteNode) => void;
}

export function Sidebar({
  vaultPath,
  noteCount,
  embeddedCount,
  isScanning,
  isEmbedding,
  embedProgress,
  onVaultPicked,
  onScanComplete,
  onEmbedComplete,
  onGraphRefresh,
  onShowSettings,
  showSemantic,
  onToggleSemantic,
  searchResults,
  onSearch,
  onSearchNodeSelect,
}: Props) {
  async function pickVault() {
    const path = await invoke<string | null>("pick_vault_folder");
    if (path) onVaultPicked(path);
  }

  async function scanVault() {
    if (!vaultPath) return;
    const result = await invoke<ScanResult>("scan_vault", { vaultPath });
    onScanComplete(result);
  }

  async function embedNotes() {
    const force = noteCount > 0 && embeddedCount === noteCount;
    const result = await invoke<EmbedResult>("embed_notes", { force });
    onEmbedComplete(result);
  }

  const isIndeterminate = !!(
    embedProgress && embedProgress.total <= 1 && embedProgress.done === 0
  );
  const embedPercent =
    embedProgress && embedProgress.total > 1
      ? Math.round((embedProgress.done / embedProgress.total) * 100)
      : 0;

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <span className="app-name">neuron</span>
        <div style={{ display: "flex", gap: 4 }}>
          <button
            className={`btn-ghost icon-btn${showSemantic ? "" : " btn-active"}`}
            onClick={onToggleSemantic}
            title={showSemantic ? "Hide semantic links" : "Show semantic links"}
          >
            ⋯
          </button>
          <button className="btn-ghost icon-btn" onClick={onShowSettings} title="Settings">
            ⚙
          </button>
        </div>
      </div>

      <div className="sidebar-section">
        <button className="btn-primary" onClick={pickVault}>
          Open Vault
        </button>
        {vaultPath && (
          <p className="vault-path" title={vaultPath}>
            {vaultPath.split("/").slice(-2).join("/")}
          </p>
        )}
        {vaultPath && (
          <div className="vault-stats">
            <span>{noteCount} notes</span>
            <span className="sep">·</span>
            <span>{embeddedCount} embedded</span>
          </div>
        )}
      </div>

      {vaultPath && (
        <div className="sidebar-section">
          <div className="btn-row">
            <button
              className="btn-secondary"
              onClick={scanVault}
              disabled={isScanning || isEmbedding}
            >
              {isScanning ? "Scanning…" : "Scan"}
            </button>
            <button
              className="btn-secondary"
              onClick={embedNotes}
              disabled={isEmbedding || isScanning}
            >
              {isEmbedding ? "Embedding…" : noteCount > 0 && embeddedCount === noteCount ? "Re-embed" : "Embed"}
            </button>
          </div>

          {isEmbedding && embedProgress && (
            <div className="embed-progress">
              <div
                className={`embed-progress-bar${isIndeterminate ? " indeterminate" : ""}`}
                style={isIndeterminate ? undefined : { width: `${embedPercent}%` }}
              />
              <span className="embed-progress-label">
                {isIndeterminate
                  ? embedProgress.currentTitle
                  : `${embedPercent}% — ${embedProgress.currentTitle}`}
              </span>
            </div>
          )}

          <button
            className="btn-ghost"
            onClick={onGraphRefresh}
            disabled={isScanning || isEmbedding}
          >
            Refresh Graph
          </button>
        </div>
      )}

      <div className="sidebar-section sidebar-search">
        <input
          type="text"
          className="search-input"
          placeholder="Search notes…"
          onChange={(e) => onSearch(e.target.value)}
        />
        {searchResults.length > 0 && (
          <ul className="search-results">
            {searchResults.map((n) => (
              <li
                key={n.id}
                className="search-result-item"
                onClick={() => onSearchNodeSelect(n)}
              >
                <span className="search-result-title">{n.title}</span>
                {n.tags.length > 0 && (
                  <span className="search-result-tags">{n.tags.join(", ")}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="sidebar-legend">
        <div className="legend-item">
          <span className="legend-line solid" />
          <span>Explicit link</span>
        </div>
        <div className="legend-item">
          <span className="legend-line dashed" />
          <span>Semantic link</span>
        </div>
      </div>
    </aside>
  );
}
