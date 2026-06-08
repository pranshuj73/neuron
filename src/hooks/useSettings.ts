import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";
import type { AppSettings } from "../types/graph";

const DEFAULT_SETTINGS: AppSettings = {
  embeddingProvider: "huggingface",
  hfApiKey: "",
  hfModel: "sentence-transformers/all-MiniLM-L6-v2",
  ollamaUrl: "http://localhost:11434",
  ollamaModel: "nomic-embed-text",
  similarityThreshold: 0.60,
  vaultPath: "",
  qdrantUrl: "http://localhost:6333",
};

export function useSettings() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    invoke<AppSettings>("get_settings")
      .then(setSettings)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const save = useCallback(async (updated: AppSettings) => {
    await invoke("save_settings", { settings: updated });
    setSettings(updated);
  }, []);

  return { settings, save, loading };
}
