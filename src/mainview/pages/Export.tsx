import { useState, useEffect } from "react";
import {
  Package, GitMerge, Smartphone, Monitor, Cpu,
  Terminal, FolderOpen, CheckCircle, Loader, AlertCircle,
} from "lucide-react";
import { type TrainingRun } from "../lib/types";
import { getRPC } from "../lib/rpc";

// ── format definitions ────────────────────────────────────────────────────────

interface FormatDef {
  id:    string;
  label: string;
  ext:   string;
  desc:  string;
  Icon:  React.ElementType;
}

const FORMATS: FormatDef[] = [
  { id: "pt",       label: "PyTorch (.pt)",       ext: ".pt",        desc: "Full precision floating point weights. Best for fine-tuning and retraining.", Icon: Package   },
  { id: "onnx",     label: "ONNX (.onnx)",         ext: ".onnx",      desc: "Universal interoperability format. Highly optimized for CPU inference.",       Icon: GitMerge  },
  { id: "tflite",   label: "TFLite (.tflite)",     ext: ".tflite",    desc: "Mobile deployment. Quantized to INT8 for edge devices.",                       Icon: Smartphone },
  { id: "coreml",   label: "CoreML (.mlpackage)",  ext: ".mlpackage", desc: "Optimized for Apple Neural Engine (ANE). macOS/iOS only.",                    Icon: Monitor   },
  { id: "openvino", label: "OpenVINO",             ext: "/",          desc: "Intel hardware acceleration. Optimized for Intel CPUs and GPUs.",              Icon: Cpu       },
];

// ── types ─────────────────────────────────────────────────────────────────────

type ExportState = "idle" | "exporting" | "done" | "error";

interface FormatResult {
  state:       ExportState;
  exportedPath: string;
  fileSize:    number;
  error:       string;
}

interface Props {
  runs: TrainingRun[];
}

// ── helpers ───────────────────────────────────────────────────────────────────

function fmtBytes(bytes: number): string {
  if (bytes === 0) return "—";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── component ─────────────────────────────────────────────────────────────────

export default function Export({ runs }: Props) {
  const doneRuns = runs.filter(r => r.status === "done");

  const [selectedRunId,  setSelectedRunId]  = useState<string | null>(doneRuns[0]?.id ?? null);
  const [formatResults,  setFormatResults]  = useState<Record<string, FormatResult>>({});
  const [cliBundleDir,   setCliBundleDir]   = useState("");
  const [cliState,       setCliState]       = useState<ExportState>("idle");
  const [cliBundlePath,  setCliBundlePath]  = useState("");
  const [cliError,       setCliError]       = useState("");

  // Auto-select first done run.
  useEffect(() => {
    if (!selectedRunId && doneRuns.length > 0) setSelectedRunId(doneRuns[0].id);
  }, [runs]);

  const selectedRun = doneRuns.find(r => r.id === selectedRunId) ?? null;

  function handleSelectRun(id: string) {
    setSelectedRunId(id);
    setFormatResults({});
    setCliState("idle");
    setCliBundlePath("");
    setCliError("");
  }

  async function handleExportFormat(format: FormatDef) {
    if (!selectedRun) return;
    setFormatResults(prev => ({
      ...prev,
      [format.id]: { state: "exporting", exportedPath: "", fileSize: 0, error: "" },
    }));
    try {
      const res = await getRPC().request.exportModel({ outputPath: selectedRun.outputPath, format: format.id });
      if (res.error) {
        setFormatResults(prev => ({ ...prev, [format.id]: { state: "error", exportedPath: "", fileSize: 0, error: res.error! } }));
      } else {
        setFormatResults(prev => ({ ...prev, [format.id]: { state: "done", exportedPath: res.exportedPath, fileSize: res.fileSize, error: "" } }));
      }
    } catch (e) {
      setFormatResults(prev => ({ ...prev, [format.id]: { state: "error", exportedPath: "", fileSize: 0, error: String(e) } }));
    }
  }

  async function handleReveal(path: string) {
    await getRPC().request.revealInFilesystem({ path });
  }

  async function handlePickCLIDir() {
    const res = await getRPC().request.openFolderPathDialog({});
    if (!res.canceled) setCliBundleDir(res.path);
  }

  async function handleExportCLI() {
    if (!selectedRun || !cliBundleDir) return;
    setCliState("exporting");
    setCliError("");
    try {
      const res = await getRPC().request.exportCLI({
        outputPath: selectedRun.outputPath,
        runName:    selectedRun.name,
        destDir:    cliBundleDir,
      });
      if (res.error) { setCliState("error"); setCliError(res.error); }
      else           { setCliState("done");  setCliBundlePath(res.bundlePath); }
    } catch (e) {
      setCliState("error"); setCliError(String(e));
    }
  }

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", background: "var(--bg)", overflow: "hidden" }}>

      {/* ── Header ── */}
      <div style={{ height: 56, padding: "0 28px", display: "flex", alignItems: "center", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", letterSpacing: "-0.3px" }}>Export</span>
      </div>

      {/* ── Scrollable content ── */}
      <div style={{ flex: 1, overflowY: "auto", padding: "32px 40px" }}>
        <div style={{ maxWidth: 780, margin: "0 auto" }}>

          {/* Page title */}
          <div style={{ marginBottom: 32 }}>
            <div style={{ fontSize: 10, fontFamily: "monospace", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.12em", color: "var(--accent)", marginBottom: 8 }}>
              Ready for Deployment
            </div>
            <h2 style={{ fontSize: 28, fontWeight: 800, color: "var(--text)", letterSpacing: "-0.5px", marginBottom: 8 }}>
              Export Model Artifacts
            </h2>
            <p style={{ fontSize: 14, color: "var(--text-muted)", lineHeight: 1.6 }}>
              Select the source model and export to your target format, or bundle a standalone CLI that runs anywhere from terminal.
            </p>
          </div>

          {/* Model selector */}
          <div style={{ marginBottom: 32 }}>
            <label style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-muted)", display: "block", marginBottom: 8 }}>
              Source Model
            </label>
            {doneRuns.length === 0 ? (
              <div style={{ padding: "12px 16px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 13, color: "var(--text-muted)" }}>
                No trained models yet — complete a training run first.
              </div>
            ) : (
              <select
                value={selectedRunId ?? ""}
                onChange={e => handleSelectRun(e.target.value)}
                style={{
                  width: "100%", padding: "10px 14px", borderRadius: 8,
                  border: "1px solid var(--border)", background: "var(--surface)",
                  color: "var(--text)", fontSize: 13, fontFamily: "monospace",
                  cursor: "pointer", outline: "none",
                }}
              >
                {doneRuns.map(r => (
                  <option key={r.id} value={r.id}>
                    {r.name}{r.mAP != null ? `  —  mAP ${r.mAP.toFixed(3)}` : ""}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* ── Section 1: Format Export ── */}
          <SectionHeading label="Model Format Export" />
          <div style={{ marginBottom: 40, display: "flex", flexDirection: "column", gap: 0 }}>
            {FORMATS.map((fmt, i) => {
              const result = formatResults[fmt.id];
              const state  = result?.state ?? "idle";
              const isLast = i === FORMATS.length - 1;
              return (
                <FormatRow
                  key={fmt.id}
                  fmt={fmt}
                  state={state}
                  result={result}
                  disabled={!selectedRun}
                  isLast={isLast}
                  onExport={() => handleExportFormat(fmt)}
                  onReveal={() => result?.exportedPath && handleReveal(result.exportedPath)}
                />
              );
            })}
          </div>

          {/* ── Section 2: CLI Bundle ── */}
          <SectionHeading label="Standalone CLI Bundle" />
          <div style={{
            background: "var(--surface)", border: "1px solid var(--border)",
            borderRadius: 12, padding: "24px 28px", marginBottom: 40,
          }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 20 }}>
              <div style={{
                width: 48, height: 48, borderRadius: 10, background: "var(--bg)",
                border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
              }}>
                <Terminal size={22} color="var(--accent)" />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", marginBottom: 4 }}>
                  Standalone CLI Executable
                </div>
                <p style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6, marginBottom: 16 }}>
                  Compiles a single self-contained binary (via Bun) that embeds the model and inference script.
                  Download it, make it executable, and run it from any terminal — no Python or YOLOStudio needed.
                  On first run it auto-creates a venv and installs ultralytics; subsequent runs are instant.
                </p>

                {/* What's included */}
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>
                  {["Bun runtime", "model.pt", "cli.py", "auto-venv"].map(item => (
                    <span key={item} style={{
                      padding: "3px 10px", borderRadius: 6,
                      background: "var(--bg)", border: "1px solid var(--border)",
                      fontSize: 11, fontFamily: "monospace", color: "var(--text-muted)",
                    }}>{item}</span>
                  ))}
                </div>

                {/* Usage preview */}
                <div style={{
                  background: "#0A0A0A", borderRadius: 8, padding: "12px 16px",
                  fontFamily: "monospace", fontSize: 12, color: "#A3E635",
                  marginBottom: 20, border: "1px solid #2E2E2E",
                }}>
                  <span style={{ color: "#6B7280" }}>$ </span>
                  <span>{selectedRun ? `${selectedRun.name.replace(/[^a-zA-Z0-9_-]/g, "_")}-detect` : "detect"} photo.jpg</span>
                  <br />
                  <span style={{ color: "#6B7280" }}>$ </span>
                  <span>{selectedRun ? `${selectedRun.name.replace(/[^a-zA-Z0-9_-]/g, "_")}-detect` : "detect"} photo.jpg --conf 0.7 --output results/</span>
                </div>

                {/* Output folder picker */}
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 16 }}>
                  <div
                    onClick={handlePickCLIDir}
                    style={{
                      flex: 1, padding: "8px 12px", borderRadius: 6,
                      border: "1px solid var(--border)", background: "var(--bg)",
                      fontSize: 12, fontFamily: "monospace", color: cliBundleDir ? "var(--text)" : "var(--text-muted)",
                      cursor: "pointer", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}
                  >
                    {cliBundleDir || "Choose output folder…"}
                  </div>
                  <button
                    onClick={handlePickCLIDir}
                    style={{
                      display: "flex", alignItems: "center", gap: 6,
                      padding: "8px 12px", borderRadius: 6,
                      border: "1px solid var(--border)", background: "var(--bg)",
                      color: "var(--text-muted)", fontSize: 12, cursor: "pointer", fontFamily: "inherit", flexShrink: 0,
                    }}
                  >
                    <FolderOpen size={14} /> Browse
                  </button>
                </div>

                {/* Action row */}
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <button
                    onClick={handleExportCLI}
                    disabled={!selectedRun || !cliBundleDir || cliState === "exporting"}
                    style={{
                      display: "flex", alignItems: "center", gap: 7,
                      padding: "8px 20px", borderRadius: 7, border: "none",
                      background: (!selectedRun || !cliBundleDir || cliState === "exporting") ? "var(--border)" : "var(--accent)",
                      color: (!selectedRun || !cliBundleDir || cliState === "exporting") ? "var(--text-muted)" : "#fff",
                      fontSize: 13, fontWeight: 600, cursor: (!selectedRun || !cliBundleDir || cliState === "exporting") ? "not-allowed" : "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    {cliState === "exporting"
                      ? <><Loader size={14} /> Compiling…</>
                      : <><Terminal size={14} /> Build CLI Executable</>
                    }
                  </button>

                  {cliState === "done" && (
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <CheckCircle size={16} color="#22C55E" />
                      <button
                        onClick={() => handleReveal(cliBundlePath)}
                        style={{ fontSize: 12, color: "var(--accent)", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", textDecoration: "underline", padding: 0 }}
                      >
                        Open Folder
                      </button>
                    </div>
                  )}
                  {cliState === "error" && (
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <AlertCircle size={14} color="#EF4444" />
                      <span style={{ fontSize: 12, color: "#EF4444" }}>{cliError}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* ── Footer stats ── */}
          {selectedRun && (
            <div style={{
              display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 0,
              background: "var(--surface)", border: "1px solid var(--border)",
              borderRadius: 10, overflow: "hidden",
            }}>
              {[
                { label: "Source Model",  value: selectedRun.name },
                { label: "Base",          value: selectedRun.baseModel },
                { label: "mAP @ .5",      value: selectedRun.mAP != null ? selectedRun.mAP.toFixed(3) : "—" },
              ].map(({ label, value }, i) => (
                <div key={label} style={{
                  padding: "16px 20px",
                  borderRight: i < 2 ? "1px solid var(--border)" : "none",
                }}>
                  <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--text-muted)", marginBottom: 6 }}>
                    {label}
                  </div>
                  <div style={{ fontSize: 13, fontFamily: "monospace", color: "var(--text)" }}>{value}</div>
                </div>
              ))}
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

// ── sub-components ────────────────────────────────────────────────────────────

function SectionHeading({ label }: { label: string }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em",
      color: "var(--text-muted)", marginBottom: 12, paddingBottom: 10,
      borderBottom: "1px solid var(--border)",
    }}>
      {label}
    </div>
  );
}

function FormatRow({ fmt, state, result, disabled, isLast, onExport, onReveal }: {
  fmt:      FormatDef;
  state:    ExportState;
  result?:  FormatResult;
  disabled: boolean;
  isLast:   boolean;
  onExport: () => void;
  onReveal: () => void;
}) {
  const { Icon } = fmt;

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 20,
      padding: "20px 24px",
      background: "var(--surface)",
      borderTop: "1px solid var(--border)",
      borderLeft: "1px solid var(--border)",
      borderRight: "1px solid var(--border)",
      borderBottom: isLast ? "1px solid var(--border)" : "none",
      borderRadius: isLast ? "0 0 10px 10px" : "0",
    }}>
      {/* Icon */}
      <div style={{
        width: 44, height: 44, borderRadius: 8, flexShrink: 0,
        background: state === "done" ? "#22C55E18" : "var(--bg)",
        border: `1px solid ${state === "done" ? "#22C55E33" : "var(--border)"}`,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <Icon size={20} color={state === "done" ? "#22C55E" : "var(--accent)"} />
      </div>

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 3 }}>
          {fmt.label}
        </div>
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: result?.exportedPath ? 6 : 0 }}>
          {fmt.desc}
        </div>
        {result?.exportedPath && (
          <div style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "2px 8px", borderRadius: 4,
            background: "var(--bg)", border: "1px solid var(--border)",
            fontSize: 10, fontFamily: "monospace", color: "var(--text-muted)",
          }}>
            {fmtBytes(result.fileSize)}
          </div>
        )}
        {state === "error" && result?.error && (
          <div style={{ fontSize: 11, color: "#EF4444", marginTop: 4 }}>{result.error}</div>
        )}
      </div>

      {/* Action */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
        {state === "done" ? (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <CheckCircle size={15} color="#22C55E" />
              <span style={{ fontSize: 12, color: "#22C55E", fontWeight: 600 }}>Ready</span>
            </div>
            <button
              onClick={onReveal}
              style={{ fontSize: 12, color: "var(--accent)", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", textDecoration: "underline", padding: 0 }}
            >
              Open Folder
            </button>
          </>
        ) : state === "exporting" ? (
          <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--text-muted)", fontSize: 12 }}>
            <Loader size={14} />
            <span>Exporting…</span>
          </div>
        ) : (
          <button
            onClick={onExport}
            disabled={disabled}
            style={{
              padding: "6px 18px", borderRadius: 6, border: "none",
              background: disabled ? "var(--border)" : "var(--accent)",
              color: disabled ? "var(--text-muted)" : "#fff",
              fontSize: 12, fontWeight: 600,
              cursor: disabled ? "not-allowed" : "pointer", fontFamily: "inherit",
            }}
          >
            {fmt.id === "pt" ? "Reveal" : "Export"}
          </button>
        )}
      </div>
    </div>
  );
}
