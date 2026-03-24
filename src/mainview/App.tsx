import { useState, useEffect, useRef } from "react";
import Sidebar from "./components/Sidebar";
import { type NavPage, type Asset, type TrainingRun } from "./lib/types";
import { getRPC } from "./lib/rpc";
import Overview  from "./pages/Overview";
import Assets    from "./pages/Assets";
import Annotate  from "./pages/Annotate";
import Train     from "./pages/Train";
import Inference from "./pages/Inference";
import Export    from "./pages/Export";

export default function App() {
  const [activePage, setActivePage]   = useState<NavPage>("overview");
  const [activeAsset, setActiveAsset] = useState<Asset | null>(null);
  const [assets, setAssets]           = useState<Asset[]>([]);
  const [runs, setRuns]               = useState<TrainingRun[]>([]);

  // Track whether initial load is complete so we don't save before loading.
  const loaded = useRef(false);

  // Load persisted studio data on startup.
  useEffect(() => {
    getRPC().request.loadStudio({}).then(data => {
      setAssets(data.assets);
      setRuns(data.runs);
      loaded.current = true;
    }).catch(err => {
      console.error("Failed to load studio data:", err);
      loaded.current = true;
    });
  }, []);

  // Auto-save whenever assets or runs change (after initial load).
  useEffect(() => {
    if (!loaded.current) return;
    getRPC().request.saveStudio({ assets, runs }).catch(err => {
      console.error("Failed to save studio data:", err);
    });
  }, [assets, runs]);

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
      </main>
    </div>
  );
}
