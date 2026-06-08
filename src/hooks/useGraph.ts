import { invoke } from "@tauri-apps/api/core";
import { useCallback, useState } from "react";
import type { GraphPayload } from "../types/graph";

export function useGraph() {
  const [data, setData] = useState<GraphPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = await invoke<GraphPayload>("get_graph");
      setData(payload);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  return { data, loading, error, reload };
}
