/**
 * Shared primitive for parsing newline-delimited JSON log output produced
 * by Reticle's Python scripts.
 *
 * Each log line is a JSON object with a "type" discriminant.
 * Malformed lines (plain text, partial writes) must be silently ignored
 * because the Python scripts interleave progress events with occasional
 * non-JSON stderr text.
 */

export type LogEvent = Record<string, unknown> & { type: string };

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
