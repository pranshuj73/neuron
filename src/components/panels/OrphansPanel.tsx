import type { NoteNode } from "../../types/graph";

interface Props {
  orphans: NoteNode[];
  onSelect: (node: NoteNode) => void;
}

export function OrphansPanel({ orphans, onSelect }: Props) {
  if (orphans.length === 0) {
    return <p className="panel-empty">No isolated notes.</p>;
  }
  return (
    <ul className="panel-list">
      {orphans.map((n) => (
        <li key={n.id} className="panel-list-item" onClick={() => onSelect(n)}>
          <span className="panel-item-title">{n.title}</span>
        </li>
      ))}
    </ul>
  );
}
