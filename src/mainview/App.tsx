import { useState } from "react";
import Sidebar from "./components/Sidebar";
import { type NavPage, type Asset } from "./lib/types";
import Overview   from "./pages/Overview";
import Assets     from "./pages/Assets";
import Annotate   from "./pages/Annotate";
import Train      from "./pages/Train";
import Inference  from "./pages/Inference";
import Export     from "./pages/Export";

export default function App() {
  const [activePage, setActivePage] = useState<NavPage>("overview");
  const [activeAsset, setActiveAsset] = useState<Asset | null>(null);

  function navigate(page: NavPage) {
    setActivePage(page);
    setActiveAsset(null);
  }

  function openAsset(asset: Asset) {
    setActivePage("assets");
    setActiveAsset(asset);
  }

  return (
    <div style={{ display: "flex", height: "100vh", width: "100vw", overflow: "hidden" }}>
      <Sidebar activePage={activePage} onNavigate={navigate} />

      <main style={{ flex: 1, overflow: "hidden", display: "flex" }}>
        {activePage === "overview"  && <Overview onNavigate={navigate} />}
        {activePage === "assets"    && !activeAsset && <Assets onOpenAsset={openAsset} />}
        {activePage === "assets"    && activeAsset  && <Annotate asset={activeAsset} onBack={() => setActiveAsset(null)} />}
        {activePage === "train"     && <Train />}
        {activePage === "inference" && <Inference />}
        {activePage === "export"    && <Export />}
      </main>
    </div>
  );
}
