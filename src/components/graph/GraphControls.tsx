interface Props {
  similarityThreshold: number;
  onThresholdChange: (value: number) => void;
  nodeSize: number;
  onNodeSizeChange: (value: number) => void;
  nodeCount: number;
  edgeCount: number;
}

export function GraphControls({
  similarityThreshold,
  onThresholdChange,
  nodeSize,
  onNodeSizeChange,
  nodeCount,
  edgeCount,
}: Props) {
  return (
    <div className="graph-controls">
      <div className="graph-controls-stats">
        <span>{nodeCount} notes</span>
        <span className="sep">·</span>
        <span>{edgeCount} edges</span>
      </div>
      <div className="graph-controls-threshold">
        <label>Similarity: {(similarityThreshold * 100).toFixed(0)}%</label>
        <input
          type="range"
          min={0.4}
          max={0.99}
          step={0.01}
          value={similarityThreshold}
          onChange={(e) => onThresholdChange(parseFloat(e.target.value))}
        />
      </div>
      <div className="graph-controls-right">
        <div className="graph-controls-threshold">
          <label>Size: {nodeSize.toFixed(1)}×</label>
          <input
            type="range"
            min={0.3}
            max={2.5}
            step={0.1}
            value={nodeSize}
            onChange={(e) => onNodeSizeChange(parseFloat(e.target.value))}
          />
        </div>
      </div>
    </div>
  );
}
