import { useState } from "react";
import Sidebar, { type NavPage } from "./components/Sidebar";
import NewProjectModal from "./components/NewProjectModal";
import Dashboard from "./pages/Dashboard";
import Annotate from "./pages/Annotate";

export default function App() {
  const [activePage, setActivePage] = useState<NavPage>("projects");
  const [showNewProject, setShowNewProject] = useState(false);

  function handleCreateProject(name: string) {
    // TODO: persist project via Bun IPC
    console.log("Create project:", { name });
    setShowNewProject(false);
  }

  return (
    <div style={{ display: "flex", height: "100vh", width: "100vw", overflow: "hidden" }}>
      <Sidebar
        activePage={activePage}
        onNavigate={setActivePage}
        onNewProject={() => setShowNewProject(true)}
      />

      <main style={{ flex: 1, overflow: "hidden", display: "flex" }}>
        {activePage === "projects"  && <Dashboard onNewProject={() => setShowNewProject(true)} />}
        {activePage === "annotate"  && <Annotate />}
        {(activePage === "train" || activePage === "inference" || activePage === "export") && (
          <div style={{
            flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
            color: "var(--text-muted)", fontSize: 14,
          }}>
            {activePage.charAt(0).toUpperCase() + activePage.slice(1)} — coming soon
          </div>
        )}
      </main>

      {showNewProject && (
        <NewProjectModal
          onClose={() => setShowNewProject(false)}
          onCreate={handleCreateProject}
        />
      )}
    </div>
  );
}
