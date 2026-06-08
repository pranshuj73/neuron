import { invoke } from "@tauri-apps/api/core";
import { marked } from "marked";
import { useEffect, useState } from "react";
import type { Insights, NoteNode } from "../../types/graph";
import { HubsPanel } from "../panels/HubsPanel";
import { OrphansPanel } from "../panels/OrphansPanel";
import { SuggestionsPanel } from "../panels/SuggestionsPanel";

type Tab = "detail" | "hubs" | "orphans" | "suggestions";

interface Props {
  selectedNode: NoteNode | null;
  insights: Insights | null;
  onNodeSelect: (node: NoteNode) => void;
}

export function RightPanel({ selectedNode, insights, onNodeSelect }: Props) {
  const [tab, setTab] = useState<Tab>("hubs");
  const [noteContent, setNoteContent] = useState<string | null>(null);

  useEffect(() => {
    if (selectedNode) {
      setTab("detail");
      setNoteContent(null);
      invoke<string>("read_note_content", { filePath: selectedNode.filePath })
        .then((content) => setNoteContent(marked.parse(content) as string))
        .catch(() => setNoteContent(null));
    }
  }, [selectedNode?.id]);

  function TabButton({ id, label }: { id: Tab; label: string }) {
    return (
      <button
        className={`tab-btn ${tab === id ? "active" : ""}`}
        onClick={() => setTab(id)}
      >
        {label}
      </button>
    );
  }

  return (
    <aside className="right-panel">
      <div className="tab-bar">
        {selectedNode && <TabButton id="detail" label="Note" />}
        <TabButton id="hubs" label="Hubs" />
        <TabButton id="orphans" label="Orphans" />
        <TabButton id="suggestions" label="Suggestions" />
      </div>

      <div className="panel-content">
        {tab === "detail" && selectedNode && (
          <div className="note-detail">
            <h3 className="note-detail-title">{selectedNode.title}</h3>
            {selectedNode.tags.length > 0 && (
              <div className="note-detail-tags">
                {selectedNode.tags.map((t) => (
                  <span key={t} className="tag-chip">{t}</span>
                ))}
              </div>
            )}
            <p className="note-detail-path">{selectedNode.filePath}</p>
            <p className="note-detail-status">
              {selectedNode.embeddedAt ? "Embedded" : "Not embedded"}
            </p>
            {noteContent && (
              <div
                className="note-preview"
                dangerouslySetInnerHTML={{ __html: noteContent }}
              />
            )}
          </div>
        )}

        {tab === "hubs" && (
          <HubsPanel
            hubs={insights?.hubs ?? []}
            onSelect={(n) => { onNodeSelect(n); setTab("detail"); }}
          />
        )}

        {tab === "orphans" && (
          <OrphansPanel
            orphans={insights?.orphans ?? []}
            onSelect={(n) => { onNodeSelect(n); setTab("detail"); }}
          />
        )}

        {tab === "suggestions" && (
          <SuggestionsPanel suggestions={insights?.suggestions ?? []} />
        )}
      </div>
    </aside>
  );
}
