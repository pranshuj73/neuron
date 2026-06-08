import { useState } from "react";
import type { AppSettings } from "../../types/graph";

interface Props {
  settings: AppSettings;
  onSave: (settings: AppSettings) => Promise<void>;
  onClose: () => void;
}

export function SettingsModal({ settings, onSave, onClose }: Props) {
  const [local, setLocal] = useState<AppSettings>({ ...settings });
  const [saving, setSaving] = useState(false);

  function set<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    setLocal((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    setSaving(true);
    try {
      await onSave(local);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Settings</h2>
          <button className="btn-ghost" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">
          <section className="settings-section">
            <h3>Embeddings</h3>
            <p className="field-label">EmbeddingGemma 300M — runs fully locally, downloads ~300 MB on first use.</p>
          </section>

          <section className="settings-section">
            <h3>Graph</h3>
            <label className="field-label">
              Similarity Threshold: {(local.similarityThreshold * 100).toFixed(0)}%
            </label>
            <input
              type="range"
              min={0.4}
              max={0.99}
              step={0.01}
              value={local.similarityThreshold}
              onChange={(e) => set("similarityThreshold", parseFloat(e.target.value))}
            />
            <label className="field-label">Qdrant URL</label>
            <input
              type="text"
              className="text-input"
              value={local.qdrantUrl}
              onChange={(e) => set("qdrantUrl", e.target.value)}
            />
          </section>
        </div>

        <div className="modal-footer">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
