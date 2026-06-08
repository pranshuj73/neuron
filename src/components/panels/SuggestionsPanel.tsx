import type { MissingLink } from "../../types/graph";

interface Props {
  suggestions: MissingLink[];
}

export function SuggestionsPanel({ suggestions }: Props) {
  if (suggestions.length === 0) {
    return <p className="panel-empty">No missing links detected.</p>;
  }
  return (
    <ul className="panel-list">
      {suggestions.map((s, i) => (
        <li key={i} className="panel-list-item suggestion-item">
          <div className="suggestion-pair">
            <span className="panel-item-title">{s.source.title}</span>
            <span className="suggestion-arrow">↔</span>
            <span className="panel-item-title">{s.target.title}</span>
          </div>
          <span className="suggestion-score">
            {(s.similarity * 100).toFixed(0)}% similar
          </span>
        </li>
      ))}
    </ul>
  );
}
