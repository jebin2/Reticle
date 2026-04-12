// Parser for push_to_hub.py JSON-line output.
// Returns only the state needed by PushHub.tsx — phase and URL.

import { parseLogLine } from "./logParser";

export type PushPhase = "pushing" | "done" | "error";

export function parsePushLog(rawLines: string[]): { phase: PushPhase; url?: string } {
  let phase: PushPhase = "pushing";
  let url: string | undefined;

  for (const raw of rawLines) {
    const ev = parseLogLine(raw);
    if (!ev) continue;
    if (ev.type === "done")  { phase = "done";  url = ev.url as string; }
    if (ev.type === "error") { phase = "error"; }
  }

  return { phase, url };
}
