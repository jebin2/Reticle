import { useState, lazy, Suspense } from "react";
import Sidebar from "./components/Sidebar";
import ErrorBoundary from "./components/ErrorBoundary";
import { ToastProvider } from "./lib/useToast";
import { type NavPage, type Asset } from "./lib/types";
import Overview from "./pages/Overview";
import { useStudioState } from "./lib/useStudioState";

// Lazy-load non-initial pages so they don't bloat the startup bundle.
const Assets    = lazy(() => import("./pages/Assets"));
const Annotate  = lazy(() => import("./pages/Annotate"));
const Train     = lazy(() => import("./pages/Train"));
const Inference = lazy(() => import("./pages/Inference"));
const Export    = lazy(() => import("./pages/Export"));
const PushHub   = lazy(() => import("./pages/PushHub"));

function Content() {
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

  function handleAssetUpdate(updated: Asset) {
    setAssets(prev => prev.map(a => a.id === updated.id ? updated : a));
    setActiveAsset(null);
  }

  return (
    <>
      <Sidebar activePage={activePage} onNavigate={navigate} />
      <main style={{ flex: 1, overflow: "hidden", display: "flex" }}>
        <ErrorBoundary key={activePage} page={activePage}>
          <Suspense fallback={null}>
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
          </Suspense>
        </ErrorBoundary>
      </main>
    </>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <div style={{ display: "flex", height: "100vh", width: "100vw", overflow: "hidden" }}>
        <Content />
      </div>
    </ToastProvider>
  );
}
