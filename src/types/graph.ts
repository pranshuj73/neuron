export interface NoteNode {
  id: string;
  title: string;
  filePath: string;
  tags: string[];
  embeddedAt: number | null;
  keywords: string[];
}

export type EdgeType = "explicit_wiki" | "explicit_markdown" | "semantic";

export interface GraphEdge {
  source: string;
  target: string;
  edgeType: EdgeType;
  similarity?: number;
}

export interface GraphPayload {
  nodes: NoteNode[];
  edges: GraphEdge[];
}

export interface AppSettings {
  embeddingProvider: "local" | "huggingface" | "ollama";
  hfApiKey: string;
  hfModel: string;
  ollamaUrl: string;
  ollamaModel: string;
  similarityThreshold: number;
  vaultPath: string;
  qdrantUrl: string;
}

export interface SystemStatus {
  dockerAvailable: boolean;
  qdrantOk: boolean;
}

export interface ScanResult {
  new: number;
  updated: number;
  deleted: number;
}

export interface EmbedResult {
  embedded: number;
  failed: number;
}

export interface EmbedProgress {
  done: number;
  total: number;
  currentTitle: string;
}

export interface MissingLink {
  source: NoteNode;
  target: NoteNode;
  similarity: number;
}

export interface Insights {
  hubs: NoteNode[];
  orphans: NoteNode[];
  suggestions: MissingLink[];
}

// ForceGraph2D internal node (has x, y added by simulation)
export interface FGNode extends NoteNode {
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number;
  fy?: number;
  [key: string]: unknown;
}

// ForceGraph2D link format
export interface FGLink {
  source: string | FGNode;
  target: string | FGNode;
  edgeType: EdgeType;
  similarity?: number;
  [key: string]: unknown;
}
