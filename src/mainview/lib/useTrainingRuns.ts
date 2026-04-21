import { useState, useRef, useEffect, useMemo } from "react";
import { type TrainingRun, type Asset } from "./types";
import { getRPC } from "./rpc";
import { parseLog, type LogProgress } from "./trainLog";

export function useTrainingRuns(
  runs: TrainingRun[],
  onRunsChange: (runs: TrainingRun[]) => void,
  assets: Asset[],
) {
  const [runProgress, setRunProgress] = useState<Record<string, LogProgress>>({});
  const activeRunIds = useMemo(
    () => runs
      .filter(run => run.status === "installing" || run.status === "training")
      .map(run => run.id)
      .join(","),
    [runs],
  );

  // Stable refs so polling closure always sees latest values.
  const runsRef         = useRef(runs);
  const onRunsChangeRef = useRef(onRunsChange);
  runsRef.current         = runs;
  onRunsChangeRef.current = onRunsChange;

  function updateRun(runId: string, patch: Partial<TrainingRun>, eligibleStatuses?: TrainingRun["status"][]) {
    onRunsChangeRef.current(
      runsRef.current.map(run => {
        if (run.id !== runId) return run;
        if (eligibleStatuses && !eligibleStatuses.includes(run.status)) return run;
        return { ...run, ...patch };
      }),
    );
  }

  // Poll log files for every active run once per second.
  useEffect(() => {
    if (!activeRunIds) return;

    let cancelled = false;

    async function poll() {
      for (const run of runsRef.current.filter(r => r.status === "installing" || r.status === "training")) {
        try {
          const { lines } = await getRPC().request.readTrainingLog({ outputPath: run.outputPath });
          if (cancelled) return;
          const { progress, done, error } = parseLog(lines);
          if (done) {
            updateRun(run.id, { status: "done", mAP: done.mAP50, updatedAt: "just now" }, ["installing", "training"]);
          } else if (error) {
            updateRun(run.id, { status: "failed", updatedAt: "just now" }, ["installing", "training"]);
          } else if (progress) {
            setRunProgress(prev => ({ ...prev, [run.id]: progress }));
          }
        } catch {}
      }
    }

    poll();
    const interval = setInterval(poll, 1000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [activeRunIds]);

  async function startRun(run: TrainingRun, fresh: boolean) {
    // Guard: prevent starting if already installing or training.
    if (run.status === "installing" || run.status === "training") return;
    updateRun(run.id, { status: "installing", mAP: undefined, updatedAt: "just now" });
    if (fresh) setRunProgress(prev => { const next = { ...prev }; delete next[run.id]; return next; });
    const runAssets = assets.filter(a => run.assetIds.includes(a.id));
    try {
      const result = await getRPC().request.startTraining({
        id: run.id, name: run.name, assetPaths: runAssets.map(a => a.storagePath),
        classMap: run.classMap, baseModel: run.baseModel, epochs: run.epochs,
        batchSize: run.batchSize, imgsz: run.imgsz, device: run.device,
        outputPath: run.outputPath, fresh,
      });
      updateRun(
        run.id,
        result.started ? { status: "training" } : { status: "failed", updatedAt: "just now" },
        ["installing"],
      );
    } catch (err) {
      console.error("Failed to start training:", err);
      updateRun(run.id, { status: "failed", updatedAt: "just now" }, ["installing", "training"]);
    }
  }

  async function pauseRun(run: TrainingRun) {
    try {
      await getRPC().request.stopTraining({ runId: run.id });
      updateRun(run.id, { status: "paused", updatedAt: "just now" });
    } catch (err) { console.error("Failed to pause training:", err); }
  }

  async function stopRun(run: TrainingRun) {
    try {
      await getRPC().request.stopTraining({ runId: run.id, clearCheckpoint: true, outputPath: run.outputPath });
      updateRun(run.id, { status: "idle", updatedAt: "just now" });
      setRunProgress(prev => { const next = { ...prev }; delete next[run.id]; return next; });
    } catch (err) { console.error("Failed to stop training:", err); }
  }

  return { runProgress, startRun, pauseRun, stopRun };
}
