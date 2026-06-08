declare module "react-force-graph-2d" {
  import { Component, MutableRefObject } from "react";

  export interface NodeObject {
    id?: string | number;
    x?: number;
    y?: number;
    vx?: number;
    vy?: number;
    fx?: number;
    fy?: number;
    [key: string]: unknown;
  }

  export interface LinkObject {
    source?: string | number | NodeObject;
    target?: string | number | NodeObject;
    [key: string]: unknown;
  }

  export interface GraphData {
    nodes: NodeObject[];
    links: LinkObject[];
  }

  export interface ForceGraph2DProps {
    ref?: MutableRefObject<ForceGraph2DInstance | null>;
    graphData?: GraphData;
    nodeId?: string;
    backgroundColor?: string;
    nodeCanvasObject?: (node: NodeObject, ctx: CanvasRenderingContext2D, globalScale: number) => void;
    nodeCanvasObjectMode?: (node: NodeObject) => string;
    linkCanvasObject?: (link: LinkObject, ctx: CanvasRenderingContext2D, globalScale: number) => void;
    linkCanvasObjectMode?: (link: LinkObject) => string;
    onNodeClick?: (node: NodeObject, event: MouseEvent) => void;
    onNodeHover?: (node: NodeObject | null, prevNode: NodeObject | null) => void;
    cooldownTicks?: number;
    d3AlphaDecay?: number;
    d3VelocityDecay?: number;
    enableNodeDrag?: boolean;
    enableZoomInteraction?: boolean;
    minZoom?: number;
    maxZoom?: number;
    width?: number;
    height?: number;
  }

  export interface ForceGraph2DInstance {
    zoomToFit: (durationMs?: number, padding?: number) => void;
    zoom: (k?: number, durationMs?: number) => number;
    centerAt: (x?: number, y?: number, durationMs?: number) => void;
    d3Force: (forceName: string, force?: unknown) => unknown;
    d3ReheatSimulation: () => void;
    pauseAnimation: () => void;
    resumeAnimation: () => void;
  }

  export default class ForceGraph2D extends Component<ForceGraph2DProps> {}
}
