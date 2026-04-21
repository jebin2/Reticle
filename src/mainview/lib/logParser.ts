/**
 * Shared primitive for parsing newline-delimited JSON log output produced
 * by Nab's Python scripts.
 *
 * Each log line is a JSON object with a "type" discriminant.
 * Malformed lines (plain text, partial writes) must be silently ignored
 * because the Python scripts interleave progress events with occasional
 * non-JSON stderr text.
 */

export type LogEvent =
  | {
      type: "progress";
      // training metrics
      epoch?: number; epochs?: number;
      loss?: number; lossBox?: number; lossCls?: number; lossDfl?: number;
      mAP?: number; precision?: number; recall?: number;
      ramMB?: number; gpuMB?: number;
      earlyStop?: boolean;
      // hub push — pip install progress line
      text?: string;
    }
  | {
      type: "done";
      // training
      mAP50?: number; mAP50_95?: number; weightsPath?: string;
      // hub push
      url?: string;
      // export
      filePath?: string; filename?: string;
    }
  | { type: "error";   message: string }
  | { type: "stderr";  text: string }
  | { type: "dataset"; imageCount: number }
  | { type: "dataset_copy_start";    total: number }
  | { type: "dataset_copy_progress"; done: number; total: number };

/**
 * Parse a single log line. Returns the parsed event when the line is valid
 * JSON with a string "type" field, null otherwise.
 */
export function parseLogLine(line: string): LogEvent | null {
  try {
    const ev = JSON.parse(line);
    if (ev && typeof ev === "object" && typeof ev.type === "string") return ev as LogEvent;
  } catch {}
  return null;
}
