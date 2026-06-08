import type { NoteNode } from "../../types/graph";

interface Props {
  hubs: NoteNode[];
  onSelect: (node: NoteNode) => void;
}

export function HubsPanel({ hubs, onSelect }: Props) {
  if (hubs.length === 0) {
    return <p className="panel-empty">No hub notes yet. Embed your notes first.</p>;
  }
  return (
    <ul className="panel-list">
      {hubs.map((n) => (
        <li key={n.id} className="panel-list-item" onClick={() => onSelect(n)}>
          <span className="panel-item-title">{n.title}</span>
          {n.tags.length > 0 && (
            <span className="panel-item-tags">{n.tags.slice(0, 3).join(", ")}</span>
          )}
        </li>
      ))}
    </ul>
  );
}
