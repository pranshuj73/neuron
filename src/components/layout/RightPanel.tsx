import { invoke } from "@tauri-apps/api/core";
import { marked } from "marked";
import { useEffect, useRef, useState } from "react";
import type { GraphPayload, Insights, NoteNode } from "../../types/graph";
import { HubsPanel } from "../panels/HubsPanel";
import { OrphansPanel } from "../panels/OrphansPanel";
import { SuggestionsPanel } from "../panels/SuggestionsPanel";

type Tab = "detail" | "hubs" | "orphans" | "suggestions";

interface RelatedNode {
  node: NoteNode;
  similarity: number;
  edgeType: string;
}

interface Props {
  selectedNode: NoteNode | null;
  insights: Insights | null;
  graphData: GraphPayload | null;
  onNodeSelect: (node: NoteNode) => void;
  isExpanded: boolean;
  onToggleExpand: () => void;
}

const RELATED_BLOCK_RE = /\n\n---\n\nrelated:\n(?:\+ \[\[.+\]\]\n?)*$/;

function getRelated(selected: NoteNode, graphData: GraphPayload): RelatedNode[] {
  const nodeMap = new Map(graphData.nodes.map((n) => [n.id, n]));
  const seen = new Set<string>();
  const results: RelatedNode[] = [];

  for (const edge of graphData.edges) {
    const sourceId = typeof edge.source === "string" ? edge.source : (edge.source as NoteNode).id;
    const targetId = typeof edge.target === "string" ? edge.target : (edge.target as NoteNode).id;

    let otherId: string | null = null;
    if (sourceId === selected.id) otherId = targetId;
    else if (targetId === selected.id) otherId = sourceId;
    if (!otherId || seen.has(otherId)) continue;

    const other = nodeMap.get(otherId);
    if (!other) continue;

    seen.add(otherId);
    results.push({ node: other, similarity: edge.similarity ?? 1, edgeType: edge.edgeType });
  }

  return results.sort((a, b) => b.similarity - a.similarity);
}

export function RightPanel({ selectedNode, insights, graphData, onNodeSelect, isExpanded, onToggleExpand }: Props) {
  const [tab, setTab] = useState<Tab>("hubs");
  const [noteContent, setNoteContent] = useState<string | null>(null);
  const [, setRawContent] = useState<string>("");
  const [linksWritten, setLinksWritten] = useState(false);
  const [writingLinks, setWritingLinks] = useState(false);
  // Persist related panel open/closed across note changes
  const relatedOpenRef = useRef(false);
  const [relatedOpen, setRelatedOpenState] = useState(false);

  function setRelatedOpen(v: boolean) {
    relatedOpenRef.current = v;
    setRelatedOpenState(v);
  }

  function loadContent(filePath: string) {
    invoke<string>("read_note_content", { filePath })
      .then((raw) => {
        setRawContent(raw);
        setLinksWritten(RELATED_BLOCK_RE.test(raw));
        setNoteContent(marked.parse(raw) as string);
      })
      .catch(() => { setRawContent(""); setNoteContent(null); });
  }

  useEffect(() => {
    if (selectedNode) {
      setTab("detail");
      setNoteContent(null);
      setRawContent("");
      setLinksWritten(false);
      // Restore the previous open/closed state rather than resetting
      setRelatedOpenState(relatedOpenRef.current);
      loadContent(selectedNode.filePath);
    }
  }, [selectedNode?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const related = selectedNode && graphData ? getRelated(selectedNode, graphData) : [];

  async function handleWriteLinks() {
    if (!selectedNode) return;
    setWritingLinks(true);
    try {
      const links = related
        .filter((r) => r.edgeType === "semantic")
        .map((r) => r.node.title);
      const written = await invoke<boolean>("write_note_links", {
        filePath: selectedNode.filePath,
        links,
      });
      setLinksWritten(written);
      loadContent(selectedNode.filePath);
    } catch (e) {
      console.error("write_note_links failed:", e);
    } finally {
      setWritingLinks(false);
    }
  }

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

  const semanticRelatedCount = related.filter((r) => r.edgeType === "semantic").length;

  return (
    <aside className="right-panel">
      <div className="tab-bar">
        <button
          className="panel-expand-btn"
          onClick={onToggleExpand}
          title={isExpanded ? "Collapse panel" : "Expand panel"}
        >
          {isExpanded ? "→" : "←"}
        </button>
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
            <div className="note-detail-actions">
              <span className="note-detail-status">
                {selectedNode.embeddedAt ? "Embedded" : "Not embedded"}
              </span>
              {semanticRelatedCount > 0 && (
                <button
                  className={`btn-ghost btn-sm ${linksWritten ? "btn-active" : ""}`}
                  onClick={handleWriteLinks}
                  disabled={writingLinks}
                  title={linksWritten ? "Remove similarity links from file" : "Append similarity links to file"}
                >
                  {writingLinks ? "…" : linksWritten ? "Unlink" : "Write links"}
                </button>
              )}
            </div>
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

      {tab === "detail" && selectedNode && related.length > 0 && (
        <div className={`related-panel ${relatedOpen ? "open" : ""}`}>
          <button className="related-panel-header" onClick={() => setRelatedOpen(!relatedOpen)}>
            <span>Related · {related.length}</span>
            <span className="related-panel-chevron">{relatedOpen ? "▾" : "▴"}</span>
          </button>
          {relatedOpen && (
            <div className="related-panel-list">
              {related.map(({ node, similarity, edgeType }) => (
                <button
                  key={node.id}
                  className="related-node-row"
                  onClick={() => onNodeSelect(node)}
                >
                  <span className="related-node-title">{node.title}</span>
                  <span className="related-node-meta">
                    {edgeType === "semantic"
                      ? `${(similarity * 100).toFixed(0)}%`
                      : edgeType.replace("explicit_", "")}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
