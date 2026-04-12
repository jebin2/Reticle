import { useState, useEffect, useRef } from "react";
import { Cloud } from "lucide-react";
import { type TrainingRun } from "../lib/types";
import { getRPC } from "../lib/rpc";
import CustomSelect from "../components/CustomSelect";
import LogPanel from "../components/LogPanel";
import { pageHeader, primaryBtn } from "../lib/styleUtils";
import { parsePushLog, type PushPhase } from "../lib/pushLog";
import { parseLogLine } from "../lib/logParser";

interface Props {
  runs: TrainingRun[];
}

function HubLogLine({ line }: { line: string }) {
  const ev = parseLogLine(line);
  if (ev) {
    if (ev.type === "progress") return <div style={{ color: "var(--text-muted)", marginBottom: 2 }}>{ev.text as string}</div>;
    if (ev.type === "stderr")   return <div style={{ color: "#F59E0B", marginBottom: 1, opacity: 0.85 }}>{ev.text as string}</div>;
    if (ev.type === "done")     return <div style={{ color: "#22C55E", marginTop: 4, fontWeight: 700 }}>published - {ev.url as string}</div>;
    if (ev.type === "error")    return <div style={{ color: "#EF4444", marginTop: 4 }}>error: {ev.message as string}</div>;
  }
  return <div style={{ color: "var(--text-muted)", marginBottom: 1 }}>{line}</div>;
}

export default function PushHub({ runs }: Props) {
  const doneRuns = runs.filter(r => r.status === "done");

  const [selectedRunId, setSelectedRunId] = useState<string | null>(doneRuns[0]?.id ?? null);
  const [repoId,   setRepoId]   = useState("");
  const [token,    setToken]    = useState("");
  const [phase,    setPhase]    = useState<PushPhase | "idle">("idle");
  const [rawLines, setRawLines] = useState<string[]>([]);
  const [doneUrl,  setDoneUrl]  = useState<string | undefined>();

  const jobIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!selectedRunId && doneRuns.length > 0) setSelectedRunId(doneRuns[0].id);
  }, [runs]);

  // Poll log while pushing; parsePushLog tracks phase/url while React renders lines.
  useEffect(() => {
    if (phase !== "pushing") return;
    const interval = setInterval(async () => {
      const id = jobIdRef.current;
      if (!id) return;
      try {
        const { lines } = await getRPC().request.readHubLog({ jobId: id });
        setRawLines(lines);
        const { phase: p, url } = parsePushLog(lines);
        if (p !== "pushing") { setPhase(p); setDoneUrl(url); }
      } catch {}
    }, 1000);
    return () => clearInterval(interval);
  }, [phase]);

  async function handlePush() {
    const run = doneRuns.find(r => r.id === selectedRunId);
    if (!run) return;
    setPhase("pushing");
    setRawLines([]);
    setDoneUrl(undefined);
    jobIdRef.current = null;

    try {
      const res = await getRPC().request.startHubPush({ outputPath: run.outputPath, repoId: repoId.trim(), token: token.trim(), runName: run.name });
      jobIdRef.current = res.jobId;
    } catch (err) {
      setPhase("error");
      // Inject a synthetic error line so the log panel shows it.
      setRawLines([JSON.stringify({ type: "error", message: String(err) })]);
    }
  }

  const selectedRun = doneRuns.find(r => r.id === selectedRunId) ?? null;
  const canPush = !!selectedRun && repoId.trim().length > 0 && token.trim().length > 0 && phase !== "pushing";

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", background: "var(--bg)", overflow: "hidden" }}>

      <div style={pageHeader}>
        <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", letterSpacing: "-0.3px" }}>Hub</span>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "32px 40px" }}>
        <div style={{ maxWidth: 680, margin: "0 auto" }}>

          {/* Title */}
          <div style={{ marginBottom: 32 }}>
            <div style={{ fontSize: 10, fontFamily: "monospace", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.12em", color: "var(--accent)", marginBottom: 8 }}>
              Publish
            </div>
            <h2 style={{ fontSize: 28, fontWeight: 800, color: "var(--text)", letterSpacing: "-0.5px", marginBottom: 8 }}>
              Push to Hugging Face Hub
            </h2>
            <p style={{ fontSize: 14, color: "var(--text-muted)", lineHeight: 1.6 }}>
              Upload your trained model weights to the Hugging Face Hub for sharing and deployment.
            </p>
          </div>

          {/* Model selector */}
          <div style={{ marginBottom: 24 }}>
            <label style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-muted)", display: "block", marginBottom: 8 }}>
              Source Model
            </label>
            {doneRuns.length === 0 ? (
              <div style={{ padding: "12px 16px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 13, color: "var(--text-muted)" }}>
                No trained models yet — complete a training run first.
              </div>
            ) : (
              <CustomSelect
                value={selectedRunId ?? ""}
                options={doneRuns.map(r => ({ value: r.id, label: r.name + (r.mAP != null ? `  —  mAP ${r.mAP.toFixed(3)}` : "") }))}
                onChange={setSelectedRunId}
                mono
              />
            )}
          </div>

          {/* Push form */}
          <div style={{
            background: "var(--surface)", border: "1px solid var(--border)",
            borderRadius: 12, padding: "24px 28px", marginBottom: 24,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
              <div style={{
                width: 40, height: 40, borderRadius: 8,
                background: "var(--bg)", border: "1px solid var(--border)",
                display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
              }}>
                <Cloud size={20} color="var(--accent)" />
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>Hugging Face Hub</div>
                <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Publish model weights publicly or privately</div>
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-muted)", display: "block", marginBottom: 6 }}>
                  Repository ID
                </label>
                <input
                  value={repoId}
                  onChange={e => setRepoId(e.target.value)}
                  placeholder="username/model-name"
                  disabled={phase === "pushing"}
                  style={{
                    width: "100%", padding: "9px 12px", borderRadius: 7,
                    border: "1px solid var(--border)", background: "var(--bg)",
                    color: "var(--text)", fontSize: 13, fontFamily: "monospace",
                    outline: "none", boxSizing: "border-box",
                    opacity: phase === "pushing" ? 0.5 : 1,
                  }}
                />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-muted)", display: "block", marginBottom: 6 }}>
                  Access Token
                </label>
                <input
                  type="password"
                  value={token}
                  onChange={e => setToken(e.target.value)}
                  placeholder="hf_..."
                  disabled={phase === "pushing"}
                  style={{
                    width: "100%", padding: "9px 12px", borderRadius: 7,
                    border: "1px solid var(--border)", background: "var(--bg)",
                    color: "var(--text)", fontSize: 13, fontFamily: "monospace",
                    outline: "none", boxSizing: "border-box",
                    opacity: phase === "pushing" ? 0.5 : 1,
                  }}
                />
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 5 }}>
                  Write-access token from huggingface.co/settings/tokens
                </div>
              </div>
            </div>

            <div style={{ marginTop: 20, display: "flex", alignItems: "center", gap: 12 }}>
              <button
                onClick={handlePush}
                disabled={!canPush}
                style={{ ...primaryBtn, opacity: canPush ? 1 : 0.5, cursor: canPush ? "pointer" : "not-allowed" }}
              >
                <Cloud size={14} />
                {phase === "pushing" ? "Pushing..." : "Push to Hub"}
              </button>
              {phase === "done" && (
                <span style={{ fontSize: 13, color: "#22C55E", fontWeight: 500 }}>Published successfully</span>
              )}
              {phase === "error" && (
                <span style={{ fontSize: 13, color: "#EF4444", fontWeight: 500 }}>Push failed - see log below</span>
              )}
            </div>
          </div>

          {/* Push log panel */}
          {rawLines.length > 0 && (
            <LogPanel
              lines={rawLines}
              renderLine={(line, i) => <HubLogLine key={i} line={line} />}
              height={300}
            />
          )}

          {/* Success banner with URL */}
          {phase === "done" && doneUrl && (
            <div style={{
              marginTop: 16, padding: "14px 18px",
              background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.25)",
              borderRadius: 8,
            }}>
              <div style={{ fontSize: 13, color: "#22C55E", fontWeight: 600, marginBottom: 4 }}>Model published</div>
              <div style={{ fontSize: 12, fontFamily: "monospace", color: "var(--text-muted)", wordBreak: "break-all" }}>
                {doneUrl}
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
