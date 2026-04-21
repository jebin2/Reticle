import { useEffect, useMemo, useState } from "react";
import { getRPC } from "../lib/rpc";
import { useLogPoller } from "../lib/useLogPoller";
import { parseLog, type LogProgress } from "../lib/trainLog";
import { parseLogLine } from "../lib/logParser";
import { type TrainingRun } from "../lib/types";
import { type DatasetUpdateMeta } from "./DatasetUpdateModal";

type CurvePoint = { epoch: number; loss: number };
type CurveCoords = { x: number; y: number };

export function useRunDetailState(run: TrainingRun, progress?: LogProgress) {
  const [lines, setLines] = useState<string[]>([]);
  const [runMeta, setRunMeta] = useState<DatasetUpdateMeta | null>(null);

  useLogPoller(
    true,
    () => getRPC().request.readTrainingLog({ outputPath: run.outputPath }).then(r => r.lines),
    setLines,
  );

  useEffect(() => {
    getRPC().request.readRunMeta({ outputPath: run.outputPath }).then(setRunMeta).catch(() => {});
  }, [run.id, run.status, run.outputPath]);

  const peakRamMB = useMemo(() => getPeakUsage(lines, "ramMB"), [lines]);
  const peakGpuMB = useMemo(() => getPeakUsage(lines, "gpuMB"), [lines]);

  const { done, datasetSize, earlyStopTriggered, copyProgress } = useMemo(
    () => parseLog(lines),
    [lines],
  );

  const curveState = useMemo(() => buildCurveState(lines, run.status), [lines, run.status]);

  const pct = run.status === "done" ? 100 : progress ? Math.round((progress.epoch / progress.epochs) * 100) : 0;
  const totalEpochs = progress?.epochs ?? run.epochs;
  const currentEpoch = progress?.epoch ?? (run.status === "done" ? run.epochs : 0);
  const mAP50 = done?.mAP50 ?? run.mAP ?? progress?.mAP ?? null;
  const mAP5095 = done?.mAP50_95 ?? null;
  const editable = run.status === "idle" || run.status === "paused";

  return {
    lines,
    runMeta,
    setRunMeta,
    peakRamMB,
    peakGpuMB,
    done,
    datasetSize,
    earlyStopTriggered,
    copyProgress,
    curves: curveState.curves,
    liveDots: curveState.liveDots,
    pct,
    totalEpochs,
    currentEpoch,
    mAP50,
    mAP5095,
    editable,
  };
}

export function getPeakUsage(lines: string[], metric: "ramMB" | "gpuMB"): number | null {
  let peak = 0;
  for (const line of lines) {
    const event = parseLogLine(line);
    if (event?.type === "progress" && event[metric] != null) {
      peak = Math.max(peak, event[metric] as number);
    }
  }
  return peak || null;
}

function buildCurveState(lines: string[], status: TrainingRun["status"]) {
  const box: CurvePoint[] = [];
  const cls: CurvePoint[] = [];
  const dfl: CurvePoint[] = [];

  for (const line of lines) {
    const event = parseLogLine(line);
    if (!event || event.type !== "progress") continue;
    if (event.lossBox != null) box.push({ epoch: event.epoch as number, loss: event.lossBox as number });
    if (event.lossCls != null) cls.push({ epoch: event.epoch as number, loss: event.lossCls as number });
    if (event.lossDfl != null) dfl.push({ epoch: event.epoch as number, loss: event.lossDfl as number });
  }

  const allPoints = [...box, ...cls, ...dfl];
  if (allPoints.length < 2) {
    return { curves: null, liveDots: null };
  }

  const maxEpoch = Math.max(...allPoints.map(point => point.epoch));
  const allLosses = allPoints.map(point => point.loss);
  const minLoss = Math.min(...allLosses);
  const lossRange = (Math.max(...allLosses) - minLoss) || 1;

  const toCoords = (point: CurvePoint): CurveCoords => ({
    x: (point.epoch / maxEpoch) * 800,
    y: 200 - ((point.loss - minLoss) / lossRange) * 160 - 20,
  });

  const toPolyline = (points: CurvePoint[]) =>
    points.length < 2
      ? ""
      : points.map(point => {
          const { x, y } = toCoords(point);
          return `${x.toFixed(1)},${y.toFixed(1)}`;
        }).join(" ");

  const lastPoint = (points: CurvePoint[]) => (points.length > 0 ? toCoords(points[points.length - 1]) : null);

  return {
    curves: {
      box: toPolyline(box),
      cls: toPolyline(cls),
      dfl: toPolyline(dfl),
    },
    liveDots: status === "training"
      ? {
          box: lastPoint(box),
          cls: lastPoint(cls),
          dfl: lastPoint(dfl),
        }
      : null,
  };
}
