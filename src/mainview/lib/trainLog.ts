import { parseLogLine } from "./logParser";

export type LogProgress = {
  epoch: number; epochs: number;
  loss: number | null;
  lossBox: number | null; lossCls: number | null; lossDfl: number | null;
  mAP: number | null; precision: number | null; recall: number | null;
  ramMB: number | null; gpuMB: number | null;
  earlyStop: boolean;
};
export type LogDone  = { mAP50: number; mAP50_95: number; weightsPath: string };
export type LogError = { message: string };

export type CopyProgress = { done: number; total: number };

export function parseLog(lines: string[]): {
  progress?: LogProgress; done?: LogDone; error?: LogError;
  datasetSize?: number; earlyStopTriggered?: boolean;
  copyProgress?: CopyProgress;
} {
  let progress: LogProgress | undefined;
  let done: LogDone | undefined;
  let error: LogError | undefined;
  let datasetSize: number | undefined;
  let earlyStopTriggered = false;
  let copyProgress: CopyProgress | undefined;

  for (const line of lines) {
    const ev = parseLogLine(line);
    if (!ev) continue;
    if (ev.type === "dataset_copy_start") {
      copyProgress = { done: 0, total: ev.total };
    }
    if (ev.type === "dataset_copy_progress") {
      copyProgress = { done: ev.done, total: ev.total };
    }
    if (ev.type === "progress") {
      if (ev.earlyStop) earlyStopTriggered = true;
      progress = {
        epoch: ev.epoch as number, epochs: ev.epochs as number,
        loss:      (ev.loss      as number)  ?? null,
        lossBox:   (ev.lossBox   as number)  ?? null,
        lossCls:   (ev.lossCls   as number)  ?? null,
        lossDfl:   (ev.lossDfl   as number)  ?? null,
        mAP:       (ev.mAP       as number)  ?? null,
        precision: (ev.precision as number)  ?? null,
        recall:    (ev.recall    as number)  ?? null,
        ramMB:     (ev.ramMB     as number)  ?? null,
        gpuMB:     (ev.gpuMB     as number)  ?? null,
        earlyStop: !!ev.earlyStop,
      };
    }
    if (ev.type === "dataset") datasetSize = ev.imageCount;
    if (ev.type === "done")    done    = { mAP50: ev.mAP50 ?? 0, mAP50_95: ev.mAP50_95 ?? 0, weightsPath: ev.weightsPath ?? "" };
    if (ev.type === "error")   error   = { message: ev.message };
  }

  return { progress, done, error, datasetSize, earlyStopTriggered, copyProgress };
}
