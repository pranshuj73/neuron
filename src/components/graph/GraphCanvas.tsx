import { useCallback, useEffect, useMemo, useRef } from "react";
import ForceGraph2D from "react-force-graph-2d";
import type { FGLink, FGNode, GraphPayload, NoteNode } from "../../types/graph";

interface Props {
  graphData: GraphPayload;
  selectedNode: NoteNode | null;
  onNodeClick: (node: NoteNode) => void;
  similarityThreshold: number;
  nodeSize: number;
}

export function GraphCanvas({ graphData, selectedNode, onNodeClick, similarityThreshold, nodeSize }: Props) {
  const fgRef = useRef<any>(null);

  // Compute degree map for node sizing
  const degreeMap = useMemo(() => {
    const map = new Map<string, number>();
    graphData.nodes.forEach((n) => map.set(n.id, 0));
    graphData.edges.forEach((e) => {
      map.set(e.source as string, (map.get(e.source as string) ?? 0) + 1);
      map.set(e.target as string, (map.get(e.target as string) ?? 0) + 1);
    });
    return map;
  }, [graphData]);

  const maxDegree = useMemo(() => Math.max(1, ...degreeMap.values()), [degreeMap]);

  const fgData = useMemo(
    () => ({
      nodes: graphData.nodes.map((n) => ({ ...n })) as FGNode[],
      links: graphData.edges
        .filter((e) => e.edgeType !== "semantic" || (e.similarity ?? 0) >= similarityThreshold)
        .map((e) => ({ ...e })) as FGLink[],
    }),
    [graphData, similarityThreshold]
  );

  // Zoom to fit on data change
  useEffect(() => {
    const timer = setTimeout(() => {
      fgRef.current?.zoomToFit(400, 40);
    }, 500);
    return () => clearTimeout(timer);
  }, [graphData]);

  const handleNodeClick = useCallback(
    (node: object) => {
      const n = node as FGNode;
      onNodeClick({
        id: n.id,
        title: n.title,
        filePath: n.filePath,
        tags: n.tags,
        embeddedAt: n.embeddedAt,
      });
    },
    [onNodeClick]
  );

  const nodeCanvasObject = useCallback(
    (node: object, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const n = node as FGNode;
      const degree = degreeMap.get(n.id) ?? 0;
      const isHub = degree > maxDegree * 0.6;
      const isSelected = selectedNode?.id === n.id;
      const isEmbedded = n.embeddedAt !== null;

      const radius = nodeSize * (3 + (degree / maxDegree) * 8);

      ctx.beginPath();
      ctx.arc(n.x ?? 0, n.y ?? 0, radius, 0, 2 * Math.PI);

      if (isSelected) {
        ctx.fillStyle = "#f0a500";
      } else if (isHub) {
        ctx.fillStyle = "#7aa2f7";
      } else if (isEmbedded) {
        ctx.fillStyle = "#4a6fa5";
      } else {
        ctx.fillStyle = "#2d4a6b";
      }
      ctx.fill();

      if (isSelected) {
        ctx.strokeStyle = "#ffd700";
        ctx.lineWidth = 2 / globalScale;
        ctx.stroke();
      }

      const labelSize = 3;
      if (globalScale > 1.5 || isSelected || isHub) {
        ctx.font = `${labelSize}px Inter, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillStyle = isSelected ? "#ffd700" : "#a9b1d6";
        const label = n.title.length > 20 ? n.title.slice(0, 18) + "…" : n.title;
        ctx.fillText(label, n.x ?? 0, (n.y ?? 0) + radius + 1);
      }
    },
    [degreeMap, maxDegree, selectedNode]
  );

  const linkCanvasObject = useCallback(
    (link: object, ctx: CanvasRenderingContext2D) => {
      const l = link as FGLink;
      const source = l.source as FGNode;
      const target = l.target as FGNode;

      if (!source?.x || !target?.x) return;

      ctx.beginPath();
      ctx.moveTo(source.x, source.y ?? 0);
      ctx.lineTo(target.x, target.y ?? 0);

      if (l.edgeType === "semantic") {
        const opacity = 0.2 + (l.similarity ?? 0) * 0.5;
        ctx.strokeStyle = `rgba(168, 197, 218, ${opacity})`;
        ctx.setLineDash([3, 2]);
        ctx.lineWidth = 0.5;
      } else {
        ctx.strokeStyle = "rgba(108, 145, 194, 0.7)";
        ctx.setLineDash([]);
        ctx.lineWidth = 1;
      }

      ctx.stroke();
      ctx.setLineDash([]);
    },
    []
  );

  return (
    <div style={{ width: "100%", height: "100%", background: "#0f0f0f", flex: 1 }}>
      <ForceGraph2D
        ref={fgRef}
        graphData={fgData}
        nodeId="id"
        backgroundColor="#0f0f0f"
        nodeCanvasObject={nodeCanvasObject}
        nodeCanvasObjectMode={() => "replace"}
        linkCanvasObject={linkCanvasObject}
        linkCanvasObjectMode={() => "replace"}
        onNodeClick={handleNodeClick}
        cooldownTicks={100}
        d3AlphaDecay={0.02}
        d3VelocityDecay={0.4}
        enableNodeDrag
        enableZoomInteraction
        minZoom={0.1}
        maxZoom={10}
      />
    </div>
  );
}
