import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import type { EmbedProgress } from "../types/graph";

export function useEmbedProgress() {
  const [progress, setProgress] = useState<EmbedProgress | null>(null);

  useEffect(() => {
    const unlisten = listen<EmbedProgress>("embed:progress", (event) => {
      setProgress(event.payload);
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  return progress;
}
