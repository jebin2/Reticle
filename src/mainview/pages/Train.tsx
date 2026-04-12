import { useState, useEffect, useRef } from "react";
import { Plus } from "lucide-react";
import { RunCard, type RunAction } from "../components/RunCard";
import RunDetailView from "../components/RunDetailView";
import NewRunModal from "../components/NewRunModal";
import DeleteConfirmModal from "../components/DeleteConfirmModal";
import { type TrainingRun, type Asset } from "../lib/types";
import { getRPC } from "../lib/rpc";
import { parseLog, type LogProgress } from "../lib/trainLog";
import { accentHover, pageHeader, primaryBtn, newItemCard } from "../lib/styleUtils";

interface Props {
  assets: Asset[];
  runs: TrainingRun[];
  onRunsChange: (runs: TrainingRun[]) => void;
}

export default function Train({ assets, runs, onRunsChange }: Props) {
  const [showModal, setShowModal]       = useState(false);
  const [detailRun, setDetailRun]       = useState<TrainingRun | null>(null);
  const [runProgress, setRunProgress]   = useState<Record<string, LogProgress>>({});
  const [deleteTarget, setDeleteTarget] = useState<TrainingRun | null>(null);

  // Stable refs so polling closure always sees latest values.
  const runsRef         = useRef(runs);
  const onRunsChangeRef = useRef(onRunsChange);
  runsRef.current         = runs;
  onRunsChangeRef.current = onRunsChange;

  // Poll log files for every active run once per second.
  useEffect(() => {
    const activeIds = runs
      .filter(r => r.status === "installing" || r.status === "training")
      .map(r => r.id).join(",");
    if (!activeIds) return;

    async function poll() {
      for (const run of runsRef.current.filter(r => r.status === "installing" || r.status === "training")) {
        try {
          const { lines } = await getRPC().request.readTrainingLog({ outputPath: run.outputPath });
          const { progress, done, error } = parseLog(lines);
          if (done) {
            onRunsChangeRef.current(runsRef.current.map(r =>
              r.id === run.id ? { ...r, status: "done" as const, mAP: done.mAP50, updatedAt: "just now" } : r
            ));
          } else if (error) {
            onRunsChangeRef.current(runsRef.current.map(r =>
              r.id === run.id ? { ...r, status: "failed" as const, updatedAt: "just now" } : r
            ));
          } else if (progress) {
            setRunProgress(prev => ({ ...prev, [run.id]: progress }));
          }
        } catch {}
      }
    }

    poll();
    const interval = setInterval(poll, 1000);
    return () => clearInterval(interval);
  }, [runs.filter(r => r.status === "installing" || r.status === "training").map(r => r.id).join(",")]);

  async function handleStart(run: TrainingRun, fresh: boolean) {
    onRunsChange(runs.map(r => r.id === run.id ? { ...r, status: "installing" as const, mAP: undefined, updatedAt: "just now" } : r));
    if (fresh) setRunProgress(prev => { const next = { ...prev }; delete next[run.id]; return next; });
    const runAssets = assets.filter(a => run.assetIds.includes(a.id));
    try {
      await getRPC().request.startTraining({
        id: run.id, name: run.name, assetPaths: runAssets.map(a => a.storagePath),
        classMap: run.classMap, baseModel: run.baseModel, epochs: run.epochs,
        batchSize: run.batchSize, imgsz: run.imgsz, device: run.device,
        outputPath: run.outputPath, fresh,
      });
      onRunsChange(runsRef.current.map(r => r.id === run.id ? { ...r, status: "training" as const } : r));
    } catch (err) {
      console.error("Failed to start training:", err);
      onRunsChange(runsRef.current.map(r =>
        r.id === run.id && (r.status === "installing" || r.status === "training")
          ? { ...r, status: "failed" as const, updatedAt: "just now" } : r
      ));
    }
  }

  async function handlePause(run: TrainingRun) {
    try {
      await getRPC().request.stopTraining({ runId: run.id });
      onRunsChange(runs.map(r => r.id === run.id ? { ...r, status: "paused" as const, updatedAt: "just now" } : r));
    } catch (err) { console.error("Failed to pause training:", err); }
  }

  async function handleStop(run: TrainingRun) {
    try {
      await getRPC().request.stopTraining({ runId: run.id, clearCheckpoint: true, outputPath: run.outputPath });
      onRunsChange(runs.map(r => r.id === run.id ? { ...r, status: "idle" as const, updatedAt: "just now" } : r));
      setRunProgress(prev => { const next = { ...prev }; delete next[run.id]; return next; });
    } catch (err) { console.error("Failed to stop training:", err); }
  }

  if (detailRun) {
    const liveRun = runs.find(r => r.id === detailRun.id) ?? detailRun;
    return (
      <RunDetailView
        run={liveRun}
        progress={runProgress[detailRun.id]}
        onClose={() => setDetailRun(null)}
        onUpdate={patch => onRunsChange(runs.map(r => r.id === liveRun.id ? { ...r, ...patch } : r))}
        onStartFresh={() => handleStart(liveRun, true)}
        onResume={() => handleStart(liveRun, false)}
        onPause={() => handlePause(liveRun)}
        onStop={() => handleStop(liveRun)}
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
                if (action === "view")        setDetailRun(run);
                else if (action === "start-fresh") handleStart(run, true);
                else if (action === "resume") handleStart(run, false);
                else if (action === "pause")  handlePause(run);
                else if (action === "stop")   handleStop(run);
                else if (action === "delete") setDeleteTarget(run);
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
          description={`"${deleteTarget.name}" will be removed from Reticle. This cannot be undone.`}
          folderPath={deleteTarget.outputPath}
          folderLabel={deleteTarget.outputPath}
          onConfirm={() => { onRunsChange(runs.filter(r => r.id !== deleteTarget.id)); setDeleteTarget(null); }}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
