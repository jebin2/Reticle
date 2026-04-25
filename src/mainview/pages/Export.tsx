import { useState, useEffect, useMemo } from "react";
import { Package, GitMerge, Smartphone, Monitor, Cpu, Terminal, X, Loader, CheckCircle, AlertCircle, Download } from "lucide-react";
import { getRPC, getBridgeUrl, getBridgeConfig } from "../lib/rpc";
import { TrainingRun } from "../lib/types";
import PageLayout from "../components/PageLayout";
import Modal from "../components/Modal";
import CustomSelect from "../components/CustomSelect";
import LogPanel from "../components/LogPanel";
import { parseLogLine } from "../lib/logParser";
import { downloadBlobFile } from "../lib/downloadUtils";
import { useLogPoller } from "../lib/useLogPoller";
import { iconTile, mutedText, outlineBtn, sectionHeading, surfaceCard } from "../lib/styleUtils";

// ── format definitions ────────────────────────────────────────────────────────

interface FormatDef {
  id:    string;
  label: string;
  desc:  string;
  note?: string;
  Icon:  React.ElementType;
}

const ALL_FORMATS: FormatDef[] = [
  { id: "pt",       label: "PyTorch (.pt)",      desc: "Full precision floating point weights. Best for fine-tuning and retraining.",                                  Icon: Package    },
  { id: "onnx",     label: "ONNX (.onnx)",        desc: "Universal interoperability format. Highly optimized for CPU inference.",                                       Icon: GitMerge   },
  { id: "tflite",   label: "TFLite (.tflite)",    desc: "Mobile deployment. Quantized to INT8 for edge devices.",          note: "First export installs deps (~50 MB)", Icon: Smartphone },
  { id: "coreml",   label: "CoreML",               desc: "Optimized for Apple Neural Engine (ANE). macOS/iOS only.",                                                    Icon: Monitor    },
  { id: "openvino", label: "OpenVINO",            desc: "Intel hardware acceleration. Optimized for Intel CPUs and GPUs.", note: "First export installs deps (~30 MB)", Icon: Cpu        },
];

// ── types ─────────────────────────────────────────────────────────────────────

type DownloadOp =
  | { id: string; label: string; kind: "format"; outputPath: string; format: string; runName: string }
  | { id: "cli";  label: string; kind: "cli";    outputPath: string; runName: string };

interface DownloadModal {
  open:       boolean;
  formatId:   string;
  runId:      string;
  label:      string;
  status:     "loading" | "done" | "error";
  filename:   string;
  error:      string;
  outputPath: string;
  lines:      string[];
  kind:       "format" | "cli";
}

interface Props {
  runs: TrainingRun[];
}

const MODAL_CLOSED: DownloadModal = {
  open: false, formatId: "", runId: "", label: "", status: "loading",
  filename: "", error: "", outputPath: "", lines: [], kind: "format",
};

// ── component ─────────────────────────────────────────────────────────────────

export default function Export({ runs }: Props) {
  const doneRuns = runs.filter(r => r.status === "done");

  const [selectedRunId, setSelectedRunId] = useState<string | null>(doneRuns[0]?.id ?? null);
  const [dlModal,       setDlModal]       = useState<DownloadModal>(MODAL_CLOSED);
  const [isWindows,     setIsWindows]     = useState(false);
  const formats = useMemo(() => ALL_FORMATS.filter(f => f.id !== "coreml" || !isWindows), [isWindows]);

  useEffect(() => {
    if (!selectedRunId && doneRuns.length > 0) setSelectedRunId(doneRuns[0].id);
  }, [runs]);

  useEffect(() => {
    const cfg = getBridgeConfig();
    if (cfg) setIsWindows(cfg.isWindows);
  }, []);

  const selectedRun = doneRuns.find(r => r.id === selectedRunId) ?? null;

  function closeDlModal(currentModal: DownloadModal) {
    if (currentModal.status === "loading" && currentModal.runId) {
      getRPC().request.cancelExport({ runId: currentModal.runId }).catch(() => {});
    }
    setDlModal(MODAL_CLOSED);
  }

  useLogPoller(
    dlModal.open && dlModal.status === "loading" && dlModal.kind === "format",
    () => getRPC().request.readExportLog({ outputPath: dlModal.outputPath, runId: dlModal.runId }).then(r => r.lines),
    lines => {
      for (const raw of lines) {
        try {
          const ev = JSON.parse(raw);
          if (ev.type === "done") {
            downloadBlobFile(getBridgeUrl(ev.filePath), ev.filename)
              .then(() => setDlModal(prev => ({ ...prev, status: "done", filename: ev.filename })))
              .catch((e: unknown) => setDlModal(prev => ({ ...prev, status: "error", error: String(e) })));
            return;
          }
          if (ev.type === "error") {
            setDlModal(prev => ({ ...prev, status: "error", error: ev.message }));
            return;
          }
        } catch {}
      }
      setDlModal(prev => ({ ...prev, lines }));
    },
  );

  async function handleDownload(op: DownloadOp) {
    const runId = crypto.randomUUID();
    if (op.kind === "cli") {
      setDlModal({ open: true, formatId: op.id, runId, label: op.label, status: "loading", filename: "", error: "", outputPath: op.outputPath, lines: [], kind: "cli" });
      try {
        const res = await getRPC().request.buildAndDownloadCLI({ outputPath: op.outputPath, runName: op.runName, runId });
        if (res.error) {
          setDlModal(prev => ({ ...prev, status: "error", error: res.error! }));
        } else {
          setDlModal(prev => ({ ...prev, status: "done", filename: res.filename }));
        }
      } catch (e) {
        setDlModal(prev => ({ ...prev, status: "error", error: String(e) }));
      }
    } else {
      setDlModal({ open: true, formatId: op.id, runId, label: op.label, status: "loading", filename: "", error: "", outputPath: op.outputPath, lines: [], kind: "format" });
      const { error } = await getRPC().request.startExport({ outputPath: op.outputPath, format: op.format, runName: op.runName, runId });
      if (error) setDlModal(prev => ({ ...prev, status: "error", error }));
      // polling via useEffect above
    }
  }

  return (
    <PageLayout title="Export">
      {dlModal.open && (
        <DownloadModalOverlay
          label={dlModal.label}
          status={dlModal.status}
          filename={dlModal.filename}
          error={dlModal.error}
          lines={dlModal.lines}
          onClose={() => closeDlModal(dlModal)}
        />
      )}

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
              <CustomSelect
                value={selectedRunId ?? ""}
                options={doneRuns.map(r => ({ value: r.id, label: r.name + (r.mAP != null ? `  —  mAP ${r.mAP.toFixed(3)}` : "") }))}
                onChange={setSelectedRunId}
                mono
              />
            )}
          </div>

          {/* ── Section 1: Format Export ── */}
          <SectionHeading label="Model Format Export" />
          <div style={{ marginBottom: 40, display: "flex", flexDirection: "column", gap: 0 }}>
            {formats.map((fmt, i) => (
              <FormatRow
                key={fmt.id}
                fmt={fmt}
                disabled={!selectedRun || (dlModal.open && dlModal.formatId === fmt.id)}
                isLast={i === formats.length - 1}
                onDownload={() => handleDownload({ id: fmt.id, label: fmt.label, kind: "format", outputPath: selectedRun!.outputPath, format: fmt.id, runName: selectedRun!.name })}
              />
            ))}
          </div>

          {/* ── Section 2: CLI Bundle ── */}
          <SectionHeading label="Standalone CLI Bundle" />
          <div style={{ ...surfaceCard, borderRadius: 12, padding: "24px 28px", marginBottom: 40 }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 20 }}>
              <div style={{ ...iconTile, width: 48, height: 48, borderRadius: 10 }}>
                <Terminal size={22} color="var(--accent)" />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", marginBottom: 4 }}>
                  Standalone CLI Executable
                </div>
                <p style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6, marginBottom: 16 }}>
                  Compiles a single self-contained binary (via Bun) that embeds the model and inference script.
                  Download it, make it executable, and run it from any terminal — no Python or Nab needed.
                  On first run it auto-creates a venv and installs ultralytics; subsequent runs are instant.
                </p>

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>
                  {["Bun runtime", "model.pt", "cli.py", "auto-venv"].map(item => (
                    <span key={item} style={{
                      padding: "3px 10px", borderRadius: 6,
                      background: "var(--bg)", border: "1px solid var(--border)",
                      fontSize: 11, fontFamily: "monospace", color: "var(--text-muted)",
                    }}>{item}</span>
                  ))}
                </div>

                <div style={{
                  background: "#0A0A0A", borderRadius: 8, padding: "12px 16px",
                  fontFamily: "monospace", fontSize: 12, color: "#A3E635",
                  marginBottom: 20, border: "1px solid #2E2E2E",
                }}>
                  <span style={{ color: "#6B7280" }}>$ </span>
                  <span>{selectedRun ? `${selectedRun.name.replace(/[^a-zA-Z0-9_-]/g, "_")}-cli` : "model-cli"} photo.jpg</span>
                  <br />
                  <span style={{ color: "#6B7280" }}>$ </span>
                  <span>{selectedRun ? `${selectedRun.name.replace(/[^a-zA-Z0-9_-]/g, "_")}-cli` : "model-cli"} photo.jpg --conf 0.7 --output_path out.json</span>
                </div>

                <DownloadButton
                  disabled={!selectedRun || (dlModal.open && dlModal.formatId === "cli")}
                  onClick={() => handleDownload({ id: "cli", label: "CLI Executable", kind: "cli", outputPath: selectedRun!.outputPath, runName: selectedRun!.name })}
                />
              </div>
            </div>
          </div>

          {/* ── Footer stats ── */}
          {selectedRun && (
            <div style={{ ...surfaceCard, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 0, overflow: "hidden" }}>
              {[
                { label: "Source Model", value: selectedRun.name },
                { label: "Base",         value: selectedRun.baseModel },
                { label: "mAP @ .5",     value: selectedRun.mAP != null ? selectedRun.mAP.toFixed(3) : "—" },
              ].map(({ label, value }, i) => (
                <div key={label} style={{ padding: "16px 20px", borderRight: i < 2 ? "1px solid var(--border)" : "none" }}>
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
    </PageLayout>
  );
}

// ── sub-components ────────────────────────────────────────────────────────────

function SectionHeading({ label }: { label: string }) {
  return (
    <div style={{
      ...sectionHeading, marginBottom: 12, paddingBottom: 10,
      borderBottom: "1px solid var(--border)",
    }}>
      {label}
    </div>
  );
}

function DownloadButton({ disabled, onClick }: { disabled: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title="Download"
      style={{
        width: 32, height: 32, borderRadius: 6,
        ...outlineBtn,
        padding: 0,
        gap: 0,
        background: disabled ? "var(--border)" : "var(--bg)",
        color: disabled ? "var(--text-muted)" : "var(--accent)",
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      <Download size={15} />
    </button>
  );
}

function FormatRow({ fmt, disabled, isLast, onDownload }: {
  fmt:        FormatDef;
  disabled:   boolean;
  isLast:     boolean;
  onDownload: () => void;
}) {
  const { Icon } = fmt;

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 20,
      padding: "20px 24px",
      background: surfaceCard.background,
      borderTop: "1px solid var(--border)",
      borderLeft: "1px solid var(--border)",
      borderRight: "1px solid var(--border)",
      borderBottom: isLast ? "1px solid var(--border)" : "none",
      borderRadius: isLast ? "0 0 10px 10px" : "0",
    }}>
      <div style={iconTile}>
        <Icon size={20} color="var(--accent)" />
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 3 }}>
          {fmt.label}
        </div>
        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
          {fmt.desc}
        </div>
        {fmt.note && (
          <div style={{ fontSize: 11, color: "var(--accent)", marginTop: 3 }}>
            {fmt.note}
          </div>
        )}
      </div>

      <div style={{ flexShrink: 0 }}>
        <DownloadButton disabled={disabled} onClick={onDownload} />
      </div>
    </div>
  );
}

function ExportLogLine({ line }: { line: string }) {
  const ev = parseLogLine(line);
  if (ev) {
    if (ev.type === "stderr")  return <div style={{ color: "#F59E0B", marginBottom: 1, opacity: 0.85 }}>{ev.text as string}</div>;
    if (ev.type === "error")   return <div style={{ color: "#EF4444", marginTop: 4 }}>{ev.message as string}</div>;
  }
  return null;
}

function DownloadModalOverlay({ label, status, filename, error, lines, onClose }: {
  label:    string;
  status:   "loading" | "done" | "error";
  filename: string;
  error:    string;
  lines:    string[];
  onClose:  () => void;
}) {
  return (
    <Modal width={420} zIndex={1000} onClose={onClose}>
      <div style={{
        position: "relative",
        padding: "16px 20px 12px",
        minWidth: 300,
        textAlign: "center",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 14,
      }}>
        <button
          onClick={onClose}
          style={{
            position: "absolute", top: 12, right: 12,
            display: "flex", alignItems: "center", justifyContent: "center",
            width: 28, height: 28, borderRadius: 6,
            border: "1px solid var(--border)", background: "var(--bg)",
            color: "var(--text-muted)", cursor: "pointer",
          }}
        >
          <X size={14} />
        </button>

        {status === "loading" && (
          <>
            <div style={{ animation: "spin 1s linear infinite", display: "flex" }}>
              <Loader size={32} color="var(--accent)" />
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>Exporting…</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{label}</div>
            {lines.length > 0 && (
              <div style={{ width: "100%" }}>
                <LogPanel
                  lines={lines}
                  renderLine={(line, i) => <ExportLogLine key={i} line={line} />}
                  height={120}
                />
              </div>
            )}
          </>
        )}

        {status === "done" && (
          <>
            <CheckCircle size={32} color="#22C55E" />
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>Downloaded</div>
            <div style={{ fontSize: 13, fontFamily: "monospace", fontWeight: 600, color: "var(--text)", wordBreak: "break-all" }}>
              {filename}
            </div>
            <div style={mutedText}>Saved to your Downloads folder</div>
          </>
        )}

        {status === "error" && (
          <>
            <AlertCircle size={32} color="#EF4444" />
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>Download failed</div>
            <div style={{ fontSize: 12, color: "#EF4444", maxWidth: 300, wordBreak: "break-word" }}>{error}</div>
          </>
        )}
      </div>
    </Modal>
  );
}
