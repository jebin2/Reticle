import { useState } from "react";
import { Plus } from "lucide-react";
import { RunCard, type RunAction } from "../components/RunCard";
import RunDetailView from "../components/RunDetailView";
import NewRunModal from "../components/NewRunModal";
import DeleteConfirmModal from "../components/DeleteConfirmModal";
import { type TrainingRun, type Asset } from "../lib/types";
import { useTrainingRuns } from "../lib/useTrainingRuns";
import { accentHover, pageHeader, primaryBtn, newItemCard } from "../lib/styleUtils";

interface Props {
  assets: Asset[];
  runs: TrainingRun[];
  onRunsChange: (runs: TrainingRun[]) => void;
}

export default function Train({ assets, runs, onRunsChange }: Props) {
  const [showModal, setShowModal]       = useState(false);
  const [detailRun, setDetailRun]       = useState<TrainingRun | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TrainingRun | null>(null);

  const { runProgress, startRun, pauseRun, stopRun } = useTrainingRuns(runs, onRunsChange, assets);

  if (detailRun) {
    const liveRun = runs.find(r => r.id === detailRun.id) ?? detailRun;
    return (
      <RunDetailView
        run={liveRun}
        progress={runProgress[detailRun.id]}
        onClose={() => setDetailRun(null)}
        onUpdate={patch => onRunsChange(runs.map(r => r.id === liveRun.id ? { ...r, ...patch } : r))}
        onStartFresh={() => startRun(liveRun, true)}
        onResume={() => startRun(liveRun, false)}
        onPause={() => pauseRun(liveRun)}
        onStop={() => stopRun(liveRun)}
      />
    );
  }

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: "var(--bg)" }}>

      <div style={pageHeader}>
        <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", letterSpacing: "-0.3px" }}>Train</span>
        <button
          onClick={() => setShowModal(true)}
          style={primaryBtn}
        >
          <Plus size={14} /> New Run
        </button>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "24px 28px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 16 }}>

          {runs.map(run => (
            <RunCard
              key={run.id} run={run} assets={assets} progress={runProgress[run.id]}
              onAction={(action: RunAction) => {
                if (action === "view")            setDetailRun(run);
                else if (action === "start-fresh") startRun(run, true);
                else if (action === "resume")      startRun(run, false);
                else if (action === "pause")       pauseRun(run);
                else if (action === "stop")        stopRun(run);
                else if (action === "delete")      setDeleteTarget(run);
              }}
            />
          ))}

          <button
            onClick={() => setShowModal(true)}
            style={newItemCard}
            {...accentHover}
          >
            <div style={{ width: 36, height: 36, borderRadius: "50%", border: "1.5px dashed currentColor", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Plus size={16} />
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 3 }}>New Training Run</div>
              <div style={{ fontSize: 12, opacity: 0.7 }}>Select assets and configure training</div>
            </div>
          </button>

        </div>
      </div>

      {showModal && (
        <NewRunModal assets={assets} runs={runs} onClose={() => setShowModal(false)} onCreate={run => { onRunsChange([...runs, run]); setShowModal(false); setDetailRun(run); }} />
      )}

      {deleteTarget && (
        <DeleteConfirmModal
          title="Delete Training Run"
          description={`"${deleteTarget.name}" will be removed from Nab. This cannot be undone.`}
          folderPath={deleteTarget.outputPath}
          folderLabel={deleteTarget.outputPath}
          onConfirm={() => { onRunsChange(runs.filter(r => r.id !== deleteTarget.id)); setDeleteTarget(null); }}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
