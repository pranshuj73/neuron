import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ForceGraph2D from "react-force-graph-2d";
import type { FGLink, FGNode, GraphPayload, NoteNode } from "../../types/graph";

const HOVER_RADIUS_PX = 100;
const LABEL_COOLDOWN_MS = 120;

// Node size is always in screen-pixels (divided by globalScale to get world units).
// This keeps nodes a constant visible size regardless of zoom.
const NODE_MIN_PX = 2;
const NODE_MAX_PX = 7;

interface Props {
  graphData: GraphPayload;
  selectedNode: NoteNode | null;
  onNodeClick: (node: NoteNode) => void;
  similarityThreshold: number;
  spread: number;
  onAreaLabel: (words: string[]) => void;
}

const STOP = new Set([
  "a","an","the","and","or","but","of","to","in","is","it","its","be","was","are","were",
  "that","this","these","those","for","on","with","as","at","by","from","up","about","into",
  "have","has","had","do","does","did","will","would","could","should","may","might","shall",
  "what","when","where","why","how","who","whom","which","whose",
  "he","she","they","we","i","you","me","him","her","us","them","my","your","his","their","our",
  "not","no","so","if","then","than","just","also","more","out","can","get","one","two","three",
]);

function topKeywords(nodes: NoteNode[], n: number): string[] {
  const counts = new Map<string, number>();
  for (const node of nodes) {
    const words = node.keywords;
    for (const kw of words) {
      counts.set(kw, (counts.get(kw) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([w]) => w);
}

export function GraphCanvas({ graphData, selectedNode, onNodeClick, similarityThreshold, spread, onAreaLabel }: Props) {
  const fgRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const labelTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [dims, setDims] = useState({ width: 800, height: 600 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setDims({ width, height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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

  // Track simulation stop count per graph load so we can do two passes:
  // pass 1 (default forces settle) → apply custom forces + reheat → pass 2 → zoomToFit
  const stopCount = useRef(0);
  useEffect(() => { stopCount.current = 0; }, [fgData]);

  // When spread changes while the graph is already laid out, just apply + reheat once
  const spreadRef = useRef(spread);
  useEffect(() => {
    spreadRef.current = spread;
    if (!fgRef.current) return;
    fgRef.current.d3Force("link")?.distance(spread);
    fgRef.current.d3Force("charge")?.strength(-spread * 0.8);
    fgRef.current.d3ReheatSimulation();
    stopCount.current = 1; // next stop → zoomToFit
  }, [spread]); // eslint-disable-line

  const handleEngineStop = useCallback(() => {
    if (!fgRef.current) return;
    stopCount.current += 1;
    if (stopCount.current === 1) {
      // First stop used default d3 forces. Now apply spread and reheat.
      fgRef.current.d3Force("link")?.distance(spreadRef.current);
      fgRef.current.d3Force("charge")?.strength(-spreadRef.current * 0.8);
      fgRef.current.d3ReheatSimulation();
    } else {
      fgRef.current.zoomToFit(400, 40);
    }
  }, []);

  // mousemove bubbles from canvas → container div, so we listen on the
  // stable container ref — no canvas querySelector needed, no orphaned listeners.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    function onMove(e: MouseEvent) {
      if (!fgRef.current) return;
      if (labelTimer.current) clearTimeout(labelTimer.current);
      labelTimer.current = setTimeout(() => {
        if (!fgRef.current) return;
        const rect = container.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;
        const { x: gx, y: gy } = fgRef.current.screen2GraphCoords(sx, sy);
        const zoom = fgRef.current.zoom() || 1;
        const worldRadius = HOVER_RADIUS_PX / zoom;

        const nearby = (fgData.nodes as FGNode[]).filter((n) => {
          const dx = (n.x ?? 0) - gx;
          const dy = (n.y ?? 0) - gy;
          return Math.sqrt(dx * dx + dy * dy) < worldRadius;
        });

        if (nearby.length >= 2) {
          onAreaLabel(topKeywords(nearby as NoteNode[], 5));
        } else {
          onAreaLabel([]);
        }
      }, LABEL_COOLDOWN_MS);
    }

    function onLeave() {
      if (labelTimer.current) clearTimeout(labelTimer.current);
      onAreaLabel([]);
    }

    container.addEventListener("mousemove", onMove);
    container.addEventListener("mouseleave", onLeave);
    return () => {
      container.removeEventListener("mousemove", onMove);
      container.removeEventListener("mouseleave", onLeave);
    };
  }, [fgData.nodes, onAreaLabel]);

  const handleNodeClick = useCallback(
    (node: object) => {
      const n = node as FGNode;
      onNodeClick({
        id: n.id,
        title: n.title,
        filePath: n.filePath,
        tags: n.tags,
        embeddedAt: n.embeddedAt,
        keywords: n.keywords as string[] ?? [],
      });
    },
    [onNodeClick]
  );

  const nodeCanvasObject = useCallback(
    (node: object, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const n = node as FGNode;
      const degree = degreeMap.get(n.id) ?? 0;
      const degreeRatio = maxDegree > 0 ? degree / maxDegree : 0;
      const isHub = degreeRatio > 0.6;
      const isSelected = selectedNode?.id === n.id;
      const isEmbedded = n.embeddedAt !== null;

      // Base size in screen-pixels; add a small bonus when zoomed in (capped at +4px).
      const basePx = NODE_MIN_PX + degreeRatio * (NODE_MAX_PX - NODE_MIN_PX);
      const screenPx = basePx + Math.min(Math.max(0, globalScale - 1) * 1.5, 4);
      const radius = screenPx / globalScale;

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

      // Show label when node appears large enough on screen, or always for hubs/selected
      if (isSelected || globalScale > 3) {
        const labelPx = Math.max(9, screenPx * 1.2);
        ctx.font = `${labelPx / globalScale}px Inter, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillStyle = isSelected ? "#ffd700" : "#a9b1d6";
        const label = n.title.length > 20 ? n.title.slice(0, 18) + "…" : n.title;
        ctx.fillText(label, n.x ?? 0, (n.y ?? 0) + radius + 2 / globalScale);
      }
    },
    [degreeMap, maxDegree, selectedNode]
  );

  const linkCanvasObject = useCallback(
    (link: object, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const l = link as FGLink;
      const source = l.source as FGNode;
      const target = l.target as FGNode;

      if (!source?.x || !target?.x) return;

      ctx.beginPath();
      ctx.moveTo(source.x, source.y ?? 0);
      ctx.lineTo(target.x, target.y ?? 0);

      if (l.edgeType === "semantic") {
        // Opacity scales with similarity; boost by similarity so strong links punch through
        const sim = l.similarity ?? 0;
        const opacity = 0.3 + sim * 0.6;
        ctx.strokeStyle = `rgba(168, 197, 218, ${opacity})`;
        ctx.setLineDash([4 / globalScale, 3 / globalScale]);
        ctx.lineWidth = (0.5 + sim * 0.8) / globalScale;
      } else {
        ctx.strokeStyle = "rgba(108, 145, 194, 0.85)";
        ctx.setLineDash([]);
        ctx.lineWidth = 1.5 / globalScale;
      }

      ctx.stroke();
      ctx.setLineDash([]);
    },
    []
  );

  return (
    <div ref={containerRef} style={{ width: "100%", flex: 1, minHeight: 0, background: "#0f0f0f" }}>
      <ForceGraph2D
        ref={fgRef}
        width={dims.width}
        height={dims.height}
        graphData={fgData}
        nodeId="id"
        backgroundColor="#0f0f0f"
        nodeCanvasObject={nodeCanvasObject}
        nodeCanvasObjectMode={() => "replace"}
        linkCanvasObject={linkCanvasObject}
        linkCanvasObjectMode={() => "replace"}
        onNodeClick={handleNodeClick}
        onEngineStop={handleEngineStop}
        cooldownTicks={150}
        d3AlphaDecay={0.04}
        d3VelocityDecay={0.4}
        enableNodeDrag
        enableZoomInteraction
        minZoom={0.05}
        maxZoom={10}
      />
    </div>
  );
}
