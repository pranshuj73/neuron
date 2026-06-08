import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";
import { GraphCanvas } from "./components/graph/GraphCanvas";
import { GraphControls } from "./components/graph/GraphControls";
import { Sidebar } from "./components/layout/Sidebar";
import { RightPanel } from "./components/layout/RightPanel";
import { SettingsModal } from "./components/settings/SettingsModal";
import { useEmbedProgress } from "./hooks/useEmbedProgress";
import { useGraph } from "./hooks/useGraph";
import { usePanelResize } from "./hooks/usePanelResize";
import { useSettings } from "./hooks/useSettings";
import type {
  AppSettings,
  EmbedResult,
  Insights,
  NoteNode,
  ScanResult,
  SystemStatus,
} from "./types/graph";

export default function App() {
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    invoke<SystemStatus>("get_system_status").then(setSystemStatus).catch(() =>
      setSystemStatus({ dockerAvailable: false, qdrantOk: false })
    );
  }, []);

  // Poll until Qdrant is ready after Docker starts the container
  useEffect(() => {
    if (!systemStatus?.dockerAvailable || systemStatus.qdrantOk) return;
    const id = setInterval(() => {
      invoke<SystemStatus>("get_system_status").then((s) => {
        setSystemStatus(s);
        if (s.qdrantOk) clearInterval(id);
      });
    }, 2000);
    return () => clearInterval(id);
  }, [systemStatus?.dockerAvailable, systemStatus?.qdrantOk]);

  async function handleRetry() {
    setRetrying(true);
    try {
      const status = await invoke<SystemStatus>("start_qdrant_docker");
      setSystemStatus(status);
    } catch {
      const status = await invoke<SystemStatus>("get_system_status").catch(() => ({
        dockerAvailable: false,
        qdrantOk: false,
      }));
      setSystemStatus(status);
    } finally {
      setRetrying(false);
    }
  }

  if (!systemStatus) {
    return <div className="setup-screen"><p className="setup-checking">Starting up…</p></div>;
  }

  if (!systemStatus.dockerAvailable) {
    return (
      <div className="setup-screen">
        <div className="setup-card">
          <div className="setup-icon">🐳</div>
          <h1 className="setup-title">Docker required</h1>
          <p className="setup-body">
            Neuron uses Docker to run Qdrant, its vector database.
            Install Docker Desktop, make sure it's running, then click Retry.
          </p>
          <p className="setup-hint">
            Download from <strong>docker.com/products/docker-desktop</strong>
          </p>
          <button className="btn-primary setup-btn" onClick={handleRetry} disabled={retrying}>
            {retrying ? "Checking…" : "Retry"}
          </button>
        </div>
      </div>
    );
  }

  if (!systemStatus.qdrantOk) {
    return (
      <div className="setup-screen">
        <div className="setup-card">
          <div className="setup-icon">⏳</div>
          <h1 className="setup-title">Starting Qdrant…</h1>
          <p className="setup-body">
            Pulling and starting the Qdrant container. This may take a moment on first run.
          </p>
          <button className="btn-primary setup-btn" onClick={handleRetry} disabled={retrying}>
            {retrying ? "Starting…" : "Retry"}
          </button>
        </div>
      </div>
    );
  }

  return <AppInner />;
}

function AppInner() {
  const { settings, save: saveSettings, loading: settingsLoading } = useSettings();
  const { data: graphData, loading: graphLoading, reload: reloadGraph } = useGraph();
  const embedProgress = useEmbedProgress();

  const rightResize = usePanelResize({
    cssVar: "--right-w",
    defaultPx: Math.round(window.innerWidth * 0.35),
    minPx: 200,
    maxPx: Math.round(window.innerWidth * 0.35),
    side: "right",
  });

  const [selectedNode, setSelectedNode] = useState<NoteNode | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [isEmbedding, setIsEmbedding] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [insights, setInsights] = useState<Insights | null>(null);
  const [searchResults, setSearchResults] = useState<NoteNode[]>([]);
  const [localThreshold, setLocalThreshold] = useState(0.60);
  const [spread, setSpread] = useState(100);
  const [nodeSize, setNodeSize] = useState(1.0);
  const [areaLabel, setAreaLabel] = useState<string[]>([]);
  const [rightExpanded, setRightExpanded] = useState(false);

  // Sync threshold from settings once loaded
  useEffect(() => {
    if (!settingsLoading) {
      setLocalThreshold(settings.similarityThreshold);
    }
  }, [settingsLoading, settings.similarityThreshold]);

  // Auto-load graph if vault was previously set
  useEffect(() => {
    if (!settingsLoading && settings.vaultPath) {
      reloadGraph();
    }
  }, [settingsLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load insights whenever graph changes
  useEffect(() => {
    if (graphData && graphData.nodes.length > 0) {
      invoke<Insights>("get_insights")
        .then(setInsights)
        .catch(console.error);
    }
  }, [graphData]);

  // Track embedding state via progress events
  useEffect(() => {
    if (embedProgress) {
      setIsEmbedding(embedProgress.done < embedProgress.total);
    }
  }, [embedProgress]);

  const handleVaultPicked = useCallback((path: string) => {
    saveSettings({ ...settings, vaultPath: path });
  }, [settings, saveSettings]);

  const handleScanComplete = useCallback((_result: ScanResult) => {
    setIsScanning(false);
    reloadGraph();
  }, [reloadGraph]);

  const handleEmbedComplete = useCallback((_result: EmbedResult) => {
    setIsEmbedding(false);
    reloadGraph();
  }, [reloadGraph]);

  const embeddedCount = graphData?.nodes.filter((n) => n.embeddedAt !== null).length ?? 0;
  const noteCount = graphData?.nodes.length ?? 0;
  const visibleEdgeCount = graphData?.edges.filter(
    (e) => e.edgeType !== "semantic" || (e.similarity ?? 0) >= localThreshold
  ).length ?? 0;

  async function handleSearch(query: string) {
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }
    try {
      const results = await invoke<NoteNode[]>("search_notes", { query });
      setSearchResults(results);
    } catch {
      setSearchResults([]);
    }
  }

  function handleSearchNodeSelect(node: NoteNode) {
    setSelectedNode(node);
    setSearchResults([]);
  }

  async function handleSaveSettings(updated: AppSettings) {
    await saveSettings(updated);
    setLocalThreshold(updated.similarityThreshold);
  }

  return (
    <div className={`app-root${rightExpanded ? " right-expanded" : ""}`}>
      <Sidebar
        vaultPath={settings.vaultPath}
        noteCount={noteCount}
        embeddedCount={embeddedCount}
        isScanning={isScanning}
        isEmbedding={isEmbedding}
        embedProgress={embedProgress}
        onVaultPicked={handleVaultPicked}
        onScanComplete={handleScanComplete}
        onEmbedComplete={handleEmbedComplete}
        onGraphRefresh={reloadGraph}
        onShowSettings={() => setShowSettings(true)}
        searchResults={searchResults}
        onSearch={handleSearch}
        onSearchNodeSelect={handleSearchNodeSelect}
      />

      <div className="graph-area">
        <GraphControls
          similarityThreshold={localThreshold}
          onThresholdChange={setLocalThreshold}
          spread={spread}
          onSpreadChange={setSpread}
          nodeSize={nodeSize}
          onNodeSizeChange={setNodeSize}
          nodeCount={noteCount}
          edgeCount={visibleEdgeCount}
        />

        <div className="graph-canvas-area">
          {graphLoading && <div className="graph-empty"><p>Loading graph…</p></div>}

          {!graphLoading && (!graphData || graphData.nodes.length === 0) && (
            <div className="graph-empty">
              <p>Open a vault folder and scan your notes to get started.</p>
            </div>
          )}

          {!graphLoading && graphData && graphData.nodes.length > 0 && (
            <GraphCanvas
              graphData={graphData}
              selectedNode={selectedNode}
              onNodeClick={setSelectedNode}
              similarityThreshold={localThreshold}
              spread={spread}
              nodeSize={nodeSize}
              onAreaLabel={setAreaLabel}
            />
          )}
        </div>

        <div className="graph-statusbar">
          {areaLabel.length > 0 && <span>✦ {areaLabel.join(", ")}</span>}
        </div>
      </div>

      <div className="resize-handle" onMouseDown={rightResize.onMouseDown} />

      <RightPanel
        selectedNode={selectedNode}
        insights={insights}
        graphData={graphData}
        onNodeSelect={setSelectedNode}
        isExpanded={rightExpanded}
        onToggleExpand={() => setRightExpanded((v) => !v)}
      />

      {showSettings && (
        <SettingsModal
          settings={settings}
          onSave={handleSaveSettings}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}
