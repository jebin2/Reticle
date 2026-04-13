import { useState, useRef, useEffect } from "react";
import { type TrainingRun, type Asset } from "./types";
import { getRPC } from "./rpc";
import { parseLog, type LogProgress } from "./trainLog";

export function useTrainingRuns(
  runs: TrainingRun[],
  onRunsChange: (runs: TrainingRun[]) => void,
  assets: Asset[],
) {
  const [runProgress, setRunProgress] = useState<Record<string, LogProgress>>({});

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

  async function startRun(run: TrainingRun, fresh: boolean) {
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

  async function pauseRun(run: TrainingRun) {
    try {
      await getRPC().request.stopTraining({ runId: run.id });
      onRunsChange(runs.map(r => r.id === run.id ? { ...r, status: "paused" as const, updatedAt: "just now" } : r));
    } catch (err) { console.error("Failed to pause training:", err); }
  }

  async function stopRun(run: TrainingRun) {
    try {
      await getRPC().request.stopTraining({ runId: run.id, clearCheckpoint: true, outputPath: run.outputPath });
      onRunsChange(runs.map(r => r.id === run.id ? { ...r, status: "idle" as const, updatedAt: "just now" } : r));
      setRunProgress(prev => { const next = { ...prev }; delete next[run.id]; return next; });
    } catch (err) { console.error("Failed to stop training:", err); }
  }

  return { runProgress, startRun, pauseRun, stopRun };
}
