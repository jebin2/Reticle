import { useState } from "react";
import Sidebar from "./components/Sidebar";
import ErrorBoundary from "./components/ErrorBoundary";
import { type NavPage, type Asset } from "./lib/types";
import Overview  from "./pages/Overview";
import Assets    from "./pages/Assets";
import Annotate  from "./pages/Annotate";
import Train     from "./pages/Train";
import Inference from "./pages/Inference";
import Export    from "./pages/Export";
import PushHub   from "./pages/PushHub";
import { useStudioState } from "./lib/useStudioState";

export default function App() {
  const [activePage, setActivePage]   = useState<NavPage>("overview");
  const [activeAsset, setActiveAsset] = useState<Asset | null>(null);
  const { assets, setAssets, runs, setRuns } = useStudioState();

  function navigate(page: NavPage) {
    setActivePage(page);
    setActiveAsset(null);
  }

  function openAsset(asset: Asset) {
    setActivePage("assets");
    setActiveAsset(asset);
  }

  // Called by Annotate on back — syncs updated counts/classes back into the asset list.
  function handleAssetUpdate(updated: Asset) {
    setAssets(prev => prev.map(a => a.id === updated.id ? updated : a));
    setActiveAsset(null);
  }

  return (
    <div style={{ display: "flex", height: "100vh", width: "100vw", overflow: "hidden" }}>
      <Sidebar activePage={activePage} onNavigate={navigate} />

      <main style={{ flex: 1, overflow: "hidden", display: "flex" }}>
        <ErrorBoundary key={activePage} page={activePage}>
          {activePage === "overview"  && <Overview assets={assets} runs={runs} onNavigate={navigate} />}
          {activePage === "assets"    && !activeAsset && (
            <Assets
              assets={assets}
              runs={runs}
              onAssetsChange={setAssets}
              onOpenAsset={openAsset}
            />
          )}
          {activePage === "assets"    && activeAsset && (
            <Annotate
              asset={activeAsset}
              onAssetUpdate={handleAssetUpdate}
              onBack={() => setActiveAsset(null)}
            />
          )}
          {activePage === "train"     && <Train assets={assets} runs={runs} onRunsChange={setRuns} />}
          {activePage === "inference" && <Inference runs={runs} />}
          {activePage === "export"    && <Export runs={runs} />}
          {activePage === "hub"       && <PushHub runs={runs} />}
        </ErrorBoundary>
      </main>
    </div>
  );
}
