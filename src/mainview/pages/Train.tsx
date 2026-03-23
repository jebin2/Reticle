import { useState, useEffect, useRef } from "react";
import { Plus, FolderOpen, Cpu, Play, Square, AlertCircle } from "lucide-react";
import { type TrainingRun, type Asset } from "../lib/types";
import { RUN_STATUS_LABELS, RUN_STATUS_COLORS, BASE_MODELS, DEVICES, CLASS_COLORS } from "../lib/constants";
import { getRPC } from "../lib/rpc";

interface Props {
  assets: Asset[];
  runs: TrainingRun[];
  onRunsChange: (runs: TrainingRun[]) => void;
}

// ── log parsing ────────────────────────────────────────────────────────────────

type LogProgress = { epoch: number; epochs: number; loss: number | null; mAP: number | null };
type LogDone     = { mAP50: number; mAP50_95: number; weightsPath: string };
type LogError    = { message: string };

function parseLog(lines: string[]): { progress?: LogProgress; done?: LogDone; error?: LogError } {
  let progress: LogProgress | undefined;
  let done: LogDone | undefined;
  let error: LogError | undefined;

  for (const line of lines) {
    try {
      const ev = JSON.parse(line);
      if (ev.type === "progress") progress = { epoch: ev.epoch, epochs: ev.epochs, loss: ev.loss ?? null, mAP: ev.mAP ?? null };
      if (ev.type === "done")    done    = { mAP50: ev.mAP50, mAP50_95: ev.mAP50_95, weightsPath: ev.weightsPath };
      if (ev.type === "error")   error   = { message: ev.message };
    } catch {}
  }

  return { progress, done, error };
}

// ── component ─────────────────────────────────────────────────────────────────

export default function Train({ assets, runs, onRunsChange }: Props) {
  const [showModal, setShowModal]         = useState(false);
  const [runProgress, setRunProgress]     = useState<Record<string, LogProgress>>({});

  // Keep a stable ref so the polling interval always sees the latest runs/callback.
  const runsRef          = useRef(runs);
  const onRunsChangeRef  = useRef(onRunsChange);
  runsRef.current        = runs;
  onRunsChangeRef.current = onRunsChange;

  // Poll log files for every training run once per second.
  useEffect(() => {
    const trainingIds = runs
      .filter(r => r.status === "training")
      .map(r => r.id)
      .join(",");

    if (!trainingIds) return;

    async function poll() {
      for (const run of runsRef.current.filter(r => r.status === "training")) {
        try {
          const { lines } = await getRPC().request.readTrainingLog({ outputPath: run.outputPath });
          const { progress, done, error } = parseLog(lines);

          if (done) {
            onRunsChangeRef.current(runsRef.current.map(r =>
              r.id === run.id
                ? { ...r, status: "done" as const, mAP: done.mAP50, updatedAt: "just now" }
                : r
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
  }, [runs.filter(r => r.status === "training").map(r => r.id).join(",")]);

  function handleCreate(run: TrainingRun) {
    onRunsChange([...runs, run]);
    setShowModal(false);
  }

  async function handleStart(run: TrainingRun) {
    const runAssets = assets.filter(a => run.assetIds.includes(a.id));
    try {
      const { started } = await getRPC().request.startTraining({
        id:         run.id,
        name:       run.name,
        assetPaths: runAssets.map(a => a.storagePath),
        classMap:   run.classMap,
        baseModel:  run.baseModel,
        epochs:     run.epochs,
        batchSize:  run.batchSize,
        imgsz:      run.imgsz,
        device:     run.device,
        outputPath: run.outputPath,
      });
      if (started) {
        onRunsChange(runs.map(r =>
          r.id === run.id ? { ...r, status: "training" as const, updatedAt: "just now" } : r
        ));
      }
    } catch (err) {
      console.error("Failed to start training:", err);
    }
  }

  async function handleStop(run: TrainingRun) {
    try {
      await getRPC().request.stopTraining({ runId: run.id });
      onRunsChange(runs.map(r =>
        r.id === run.id ? { ...r, status: "idle" as const, updatedAt: "just now" } : r
      ));
      setRunProgress(prev => { const next = { ...prev }; delete next[run.id]; return next; });
    } catch (err) {
      console.error("Failed to stop training:", err);
    }
  }

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: "var(--bg)" }}>

      {/* Header */}
      <div style={{ padding: "24px 28px 20px", borderBottom: "1px solid var(--border)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--text)", letterSpacing: "-0.4px", marginBottom: 3 }}>
              Train
            </h1>
            <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
              Configure and launch YOLO26 training runs from your assets.
            </p>
          </div>
          <button
            onClick={() => setShowModal(true)}
            style={{
              display: "flex", alignItems: "center", gap: 7,
              padding: "8px 14px", borderRadius: 7, border: "none",
              background: "var(--accent)", color: "#fff",
              fontSize: 13, fontWeight: 500, cursor: "pointer", fontFamily: "inherit",
            }}
          >
            <Plus size={14} /> New Run
          </button>
        </div>
      </div>

      {/* Grid */}
      <div style={{ flex: 1, overflowY: "auto", padding: "24px 28px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 16 }}>

          {runs.map(run => (
            <RunCard
              key={run.id}
              run={run}
              assets={assets}
              progress={runProgress[run.id]}
              onStart={() => handleStart(run)}
              onStop={() => handleStop(run)}
              onDelete={() => onRunsChange(runs.filter(r => r.id !== run.id))}
            />
          ))}

          <button
            onClick={() => setShowModal(true)}
            style={{
              background: "var(--surface)", border: "1px dashed var(--border)",
              borderRadius: 8, minHeight: 220, cursor: "pointer",
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
              gap: 10, color: "var(--text-muted)", transition: "border-color 0.15s, color 0.15s",
              fontFamily: "inherit",
            }}
            onMouseEnter={e => { const el = e.currentTarget as HTMLButtonElement; el.style.borderColor = "var(--accent)"; el.style.color = "var(--accent)"; }}
            onMouseLeave={e => { const el = e.currentTarget as HTMLButtonElement; el.style.borderColor = "var(--border)";  el.style.color = "var(--text-muted)"; }}
          >
            <div style={{ width: 36, height: 36, borderRadius: "50%", border: "1.5px dashed currentColor", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Plus size={16} />
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 3 }}>New Training Run</div>
              <div style={{ fontSize: 12, opacity: 0.7 }}>Select assets and configure training</div>
            </div>
          </button>

        </div>
      </div>

      {showModal && (
        <NewRunModal assets={assets} onClose={() => setShowModal(false)} onCreate={handleCreate} />
      )}
    </div>
  );
}

// ── RunCard ────────────────────────────────────────────────────────────────────

interface RunCardProps {
  run: TrainingRun;
  assets: Asset[];
  progress?: LogProgress;
  onStart: () => void;
  onStop: () => void;
  onDelete: () => void;
}

function RunCard({ run, assets, progress, onStart, onStop, onDelete }: RunCardProps) {
  const statusColor = RUN_STATUS_COLORS[run.status];
  const statusLabel = RUN_STATUS_LABELS[run.status];
  const runAssets   = assets.filter(a => run.assetIds.includes(a.id));
  const pct         = progress ? Math.round((progress.epoch / progress.epochs) * 100) : 0;

  return (
    <div style={{
      background: "var(--surface)", border: "1px solid var(--border)",
      borderRadius: 8, overflow: "hidden",
      transition: "border-color 0.15s",
    }}
      onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.borderColor = "#444"; }}
      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = "var(--border)"; }}
    >
      {/* Status band / progress bar */}
      {run.status === "training" && progress ? (
        <div style={{ height: 6, background: "var(--border)", position: "relative" }}>
          <div style={{
            position: "absolute", left: 0, top: 0, height: "100%",
            width: `${pct}%`, background: statusColor,
            transition: "width 0.5s ease",
          }} />
        </div>
      ) : (
        <div style={{ height: 6, background: statusColor, opacity: run.status === "idle" ? 0.35 : 1 }} />
      )}

      <div style={{ padding: "14px 14px 12px" }}>
        {/* Run name + actions */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 10 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", letterSpacing: "-0.2px", fontFamily: "monospace", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {run.name}
          </h3>
          <div style={{ display: "flex", gap: 4, marginLeft: 8, flexShrink: 0 }}>
            {run.status === "idle" && (
              <ActionBtn Icon={Play} color="var(--accent)" title="Start training" onClick={onStart} />
            )}
            {run.status === "training" && (
              <ActionBtn Icon={Square} color="#EF4444" title="Stop training" onClick={onStop} />
            )}
            {(run.status === "idle" || run.status === "done" || run.status === "failed") && (
              <ActionBtn Icon={AlertCircle} color="var(--text-muted)" title="Delete run" onClick={onDelete} danger />
            )}
          </div>
        </div>

        {/* Status + model */}
        <div style={{ display: "flex", gap: 8, marginBottom: 10, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{
            padding: "2px 7px", borderRadius: 4, fontSize: 11, fontWeight: 600,
            background: statusColor + "22", border: `1px solid ${statusColor}55`, color: statusColor,
            letterSpacing: "0.04em", textTransform: "uppercase", flexShrink: 0,
          }}>
            {statusLabel}
          </span>
          <span style={{ fontSize: 12, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
            <Cpu size={11} /> {run.baseModel}
          </span>
          <span style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "monospace", flexShrink: 0 }}>
            {run.epochs}ep · {run.batchSize === -1 ? "auto" : `b${run.batchSize}`} · {run.imgsz}px
          </span>
          {run.mAP != null && (
            <span style={{ fontSize: 12, color: "var(--text)", fontFamily: "monospace", marginLeft: "auto" }}>
              mAP {run.mAP.toFixed(3)}
            </span>
          )}
        </div>

        {/* Live progress (training only) */}
        {run.status === "training" && progress && (
          <div style={{
            marginBottom: 10, padding: "8px 10px", borderRadius: 6,
            background: "var(--bg)", border: "1px solid var(--border)",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                Epoch {progress.epoch} / {progress.epochs}
              </span>
              <span style={{ fontSize: 11, fontWeight: 600, color: "var(--accent)", fontFamily: "monospace" }}>
                {pct}%
              </span>
            </div>
            <div style={{ display: "flex", gap: 16 }}>
              {progress.loss != null && (
                <span style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "monospace" }}>
                  loss <span style={{ color: "var(--text)" }}>{progress.loss.toFixed(4)}</span>
                </span>
              )}
              {progress.mAP != null && (
                <span style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "monospace" }}>
                  mAP <span style={{ color: "var(--accent)" }}>{progress.mAP.toFixed(4)}</span>
                </span>
              )}
            </div>
          </div>
        )}

        {/* Assets */}
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
            Assets
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {runAssets.map((a, i) => (
              <span key={a.id} style={{
                fontSize: 11, padding: "2px 7px", borderRadius: 4,
                background: CLASS_COLORS[i % CLASS_COLORS.length] + "22",
                color: CLASS_COLORS[i % CLASS_COLORS.length],
                border: `1px solid ${CLASS_COLORS[i % CLASS_COLORS.length]}44`,
                fontWeight: 500,
              }}>{a.name}</span>
            ))}
            {runAssets.length === 0 && (
              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>—</span>
            )}
          </div>
        </div>

        {/* Classes */}
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
            {run.classMap.length} classes:{" "}
            <span style={{ color: "var(--text)", fontFamily: "monospace" }}>
              {run.classMap.slice(0, 3).join(", ")}{run.classMap.length > 3 ? ` +${run.classMap.length - 3}` : ""}
            </span>
          </div>
        </div>

        {/* Footer */}
        <div style={{ paddingTop: 10, borderTop: "1px solid var(--border)" }}>
          <div style={{
            fontSize: 10, color: "var(--text-muted)", fontFamily: "monospace",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginBottom: 4,
          }} title={run.outputPath}>
            <FolderOpen size={10} style={{ display: "inline", marginRight: 4, verticalAlign: "middle" }} />
            {run.outputPath}
          </div>
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Updated {run.updatedAt}</div>
        </div>
      </div>
    </div>
  );
}

function ActionBtn({ Icon, color, title, onClick, danger }: {
  Icon: React.ElementType; color: string; title: string; onClick: () => void; danger?: boolean;
}) {
  return (
    <button
      title={title}
      onClick={e => { e.stopPropagation(); onClick(); }}
      style={{
        background: "none", border: "none", cursor: "pointer",
        color, padding: "2px 4px", borderRadius: 4,
        display: "flex", alignItems: "center",
        transition: "opacity 0.12s",
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.opacity = danger ? "1" : "0.7"; }}
      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.opacity = "1"; }}
    >
      <Icon size={13} />
    </button>
  );
}

// ── NewRunModal ────────────────────────────────────────────────────────────────

const DEFAULT_EPOCHS = 100;
const DEFAULT_BATCH  = 16;
const DEFAULT_IMGSZ  = 640;
const DEFAULT_DEVICE = "auto";

function NewRunModal({ assets, onClose, onCreate }: {
  assets: Asset[];
  onClose: () => void;
  onCreate: (run: TrainingRun) => void;
}) {
  const [name, setName]                     = useState("");
  const [nameEdited, setNameEdited]         = useState(false);
  const [selectedAssets, setSelectedAssets] = useState<string[]>([]);
  const [baseModel, setBaseModel]           = useState(BASE_MODELS[0]);
  const [epochs, setEpochs]                 = useState(DEFAULT_EPOCHS);
  const [batchSize, setBatchSize]           = useState(DEFAULT_BATCH);
  const [imgsz, setImgsz]                   = useState(DEFAULT_IMGSZ);
  const [device, setDevice]                 = useState(DEFAULT_DEVICE);
  const [outputPath, setOutputPath]         = useState("");
  const [outputEdited, setOutputEdited]     = useState(false);
  const [picking, setPicking]               = useState(false);

  // Build merged class list (stable insertion order, deduplicated).
  const classMap = [...new Map(
    assets
      .filter(a => selectedAssets.includes(a.id))
      .flatMap(a => a.classes)
      .map(c => [c, c])
  ).keys()];

  function toggleAsset(id: string) {
    setSelectedAssets(prev => {
      const next = prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id];
      if (!nameEdited) {
        const first = assets.find(a => a.id === next[0]);
        const suggested = first
          ? `${first.name.toLowerCase().replace(/\s+/g, "-")}-${baseModel}-v1`
          : "";
        setName(suggested);
        if (!outputEdited) setOutputPath(suggested ? `~/.yolostudio/runs/${suggested}` : "");
      }
      return next;
    });
  }

  function handleNameChange(val: string) {
    setName(val);
    setNameEdited(true);
    if (!outputEdited) setOutputPath(val.trim() ? `~/.yolostudio/runs/${val.trim()}` : "");
  }

  async function pickFolder() {
    setPicking(true);
    try {
      const { canceled, path } = await getRPC().request.openFolderPathDialog({});
      if (!canceled && path) { setOutputPath(path); setOutputEdited(true); }
    } finally {
      setPicking(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || selectedAssets.length === 0 || !outputPath.trim()) return;
    onCreate({
      id:         crypto.randomUUID(),
      name:       name.trim(),
      assetIds:   selectedAssets,
      classMap,
      baseModel,
      epochs,
      batchSize,
      imgsz,
      device,
      outputPath: outputPath.trim(),
      status:     "idle",
      updatedAt:  "just now",
    });
  }

  const valid = name.trim() && selectedAssets.length > 0 && outputPath.trim();

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        width: 500, background: "var(--surface)", borderRadius: 10,
        border: "1px solid var(--border)", padding: "24px",
        boxShadow: "0 20px 60px rgba(0,0,0,0.5)", maxHeight: "90vh", overflowY: "auto",
      }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 20, letterSpacing: "-0.3px" }}>
          New Training Run
        </h2>

        {assets.length === 0 ? (
          <div style={{ textAlign: "center", padding: "32px 0", color: "var(--text-muted)", fontSize: 13 }}>
            No assets yet. Create and annotate an asset first.
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>

            <Field label="Run Name">
              <input
                autoFocus
                value={name}
                onChange={e => handleNameChange(e.target.value)}
                placeholder="e.g. vehicles-yolo26n-v1"
                style={{ ...inputStyle, fontFamily: "monospace" }}
              />
            </Field>

            <Field label="Assets">
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {assets.map(a => {
                  const selected = selectedAssets.includes(a.id);
                  const ready    = a.annotatedCount > 0;
                  return (
                    <label
                      key={a.id}
                      style={{
                        display: "flex", alignItems: "center", gap: 10,
                        padding: "8px 10px", borderRadius: 6, cursor: ready ? "pointer" : "default",
                        border: `1px solid ${selected ? "var(--accent)" : "var(--border)"}`,
                        background: selected ? "rgba(59,130,246,0.06)" : "var(--bg)",
                        transition: "border-color 0.12s, background 0.12s",
                        opacity: ready ? 1 : 0.5,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={selected}
                        disabled={!ready}
                        onChange={() => toggleAsset(a.id)}
                        style={{ accentColor: "var(--accent)" }}
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text)" }}>{a.name}</div>
                        <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                          {a.annotatedCount}/{a.imageCount} annotated · {a.classes.length} classes
                          {!ready && <span style={{ color: "#EF4444", marginLeft: 6 }}>— no annotations</span>}
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>
            </Field>

            {classMap.length > 0 && (
              <div style={{ padding: "10px 12px", borderRadius: 6, background: "var(--bg)", border: "1px solid var(--border)" }}>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6 }}>
                  Merged class map · {classMap.length} classes
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                  {classMap.map((cls, i) => (
                    <span key={cls} style={{
                      fontSize: 10, padding: "2px 6px", borderRadius: 3,
                      background: CLASS_COLORS[i % CLASS_COLORS.length] + "22",
                      color: CLASS_COLORS[i % CLASS_COLORS.length],
                      border: `1px solid ${CLASS_COLORS[i % CLASS_COLORS.length]}44`,
                      fontFamily: "monospace",
                    }}>
                      {i}: {cls}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <Field label="Base Model">
              <select value={baseModel} onChange={e => setBaseModel(e.target.value)} style={{ ...inputStyle, cursor: "pointer" }}>
                {BASE_MODELS.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </Field>

            <Field label="Hyperparameters">
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <NumField label="Epochs"     value={epochs}    min={1}   max={10000} onChange={setEpochs} />
                <NumField label="Batch Size" value={batchSize} min={-1}  max={1024}  onChange={setBatchSize} hint="-1 = auto" />
                <NumField label="Image Size" value={imgsz}     min={32}  max={1280}  onChange={setImgsz} />
                <div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>Device</div>
                  <select value={device} onChange={e => setDevice(e.target.value)} style={{ ...inputStyle, padding: "6px 10px", cursor: "pointer" }}>
                    {DEVICES.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
              </div>
            </Field>

            <Field label="Output Folder">
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  value={outputPath}
                  onChange={e => { setOutputPath(e.target.value); setOutputEdited(true); }}
                  placeholder="~/.yolostudio/runs/my-run"
                  style={{ ...inputStyle, flex: 1, fontFamily: "monospace", fontSize: 11 }}
                />
                <button
                  type="button"
                  onClick={pickFolder}
                  disabled={picking}
                  style={{
                    padding: "0 12px", borderRadius: 6, border: "1px solid var(--border)",
                    background: "var(--surface-2)", color: "var(--text-muted)",
                    cursor: picking ? "not-allowed" : "pointer", fontSize: 12, fontFamily: "inherit",
                    display: "flex", alignItems: "center", gap: 6, flexShrink: 0,
                  }}
                >
                  <FolderOpen size={13} /> Browse
                </button>
              </div>
            </Field>

            <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
              <button
                type="button"
                onClick={onClose}
                style={{
                  flex: 1, padding: "9px", borderRadius: 7,
                  border: "1px solid var(--border)", background: "transparent",
                  color: "var(--text-muted)", fontSize: 13, cursor: "pointer", fontFamily: "inherit",
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!valid}
                style={{
                  flex: 1, padding: "9px", borderRadius: 7, border: "none",
                  background: valid ? "var(--accent)" : "var(--border)",
                  color: valid ? "#fff" : "var(--text-muted)",
                  fontSize: 13, fontWeight: 600,
                  cursor: valid ? "pointer" : "not-allowed", fontFamily: "inherit",
                }}
              >
                Create Run
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function NumField({ label, value, min, max, onChange, hint }: {
  label: string; value: number; min: number; max: number;
  onChange: (v: number) => void; hint?: string;
}) {
  return (
    <div>
      <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>
        {label}{hint && <span style={{ opacity: 0.6, marginLeft: 4 }}>({hint})</span>}
      </div>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={e => onChange(Number(e.target.value))}
        style={{ ...inputStyle, padding: "6px 10px" }}
      />
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ display: "block", fontSize: 12, fontWeight: 500, color: "var(--text-muted)", marginBottom: 6 }}>
        {label}
      </label>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "8px 10px", borderRadius: 6,
  border: "1px solid var(--border)", background: "var(--bg)",
  color: "var(--text)", fontSize: 13, fontFamily: "inherit",
  outline: "none", boxSizing: "border-box",
};
