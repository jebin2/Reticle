import { useState, useEffect, useRef, useMemo } from "react";
import { Plus, FolderOpen, Cpu, Play, Pause, Square, Trash2, Terminal, ChevronDown } from "lucide-react";
import DetailPageHeader, { HeaderBtn } from "../components/DetailPageHeader";
import DeleteConfirmModal from "../components/DeleteConfirmModal";
import CustomSelect from "../components/CustomSelect";
import { type TrainingRun, type Asset } from "../lib/types";
import { RUN_STATUS_LABELS, RUN_STATUS_COLORS, BASE_MODELS, DEVICES, CLASS_COLORS } from "../lib/constants";
import { getRPC } from "../lib/rpc";

interface Props {
  assets: Asset[];
  runs: TrainingRun[];
  onRunsChange: (runs: TrainingRun[]) => void;
}

// ── log parsing ────────────────────────────────────────────────────────────────

type LogProgress = { epoch: number; epochs: number; loss: number | null; mAP: number | null; ramMB: number | null; gpuMB: number | null };
type LogDone     = { mAP50: number; mAP50_95: number; weightsPath: string };
type LogError    = { message: string };

function parseLog(lines: string[]): { progress?: LogProgress; done?: LogDone; error?: LogError } {
  let progress: LogProgress | undefined;
  let done: LogDone | undefined;
  let error: LogError | undefined;

  for (const line of lines) {
    try {
      const ev = JSON.parse(line);
      if (ev.type === "progress") progress = { epoch: ev.epoch, epochs: ev.epochs, loss: ev.loss ?? null, mAP: ev.mAP ?? null, ramMB: ev.ramMB ?? null, gpuMB: ev.gpuMB ?? null };
      if (ev.type === "done")    done    = { mAP50: ev.mAP50, mAP50_95: ev.mAP50_95, weightsPath: ev.weightsPath };
      if (ev.type === "error")   error   = { message: ev.message };
    } catch {}
  }

  return { progress, done, error };
}

// ── component ─────────────────────────────────────────────────────────────────

export default function Train({ assets, runs, onRunsChange }: Props) {
  const [showModal, setShowModal]         = useState(false);
  const [detailRun, setDetailRun]         = useState<TrainingRun | null>(null);
  const [runProgress, setRunProgress]     = useState<Record<string, LogProgress>>({});
  const [deleteTarget, setDeleteTarget]   = useState<TrainingRun | null>(null);

  // Keep a stable ref so the polling interval always sees the latest runs/callback.
  const runsRef          = useRef(runs);
  const onRunsChangeRef  = useRef(onRunsChange);
  runsRef.current        = runs;
  onRunsChangeRef.current = onRunsChange;

  // Poll log files for every training run once per second.
  useEffect(() => {
    const activeIds = runs
      .filter(r => r.status === "installing" || r.status === "training")
      .map(r => r.id)
      .join(",");

    if (!activeIds) return;

    async function poll() {
      for (const run of runsRef.current.filter(r => r.status === "installing" || r.status === "training")) {
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
  }, [runs.filter(r => r.status === "installing" || r.status === "training").map(r => r.id).join(",")]);

  function handleCreate(run: TrainingRun) {
    onRunsChange([...runs, run]);
    setShowModal(false);
  }

  async function handleStart(run: TrainingRun, fresh: boolean) {
    // Show "installing" immediately — setup (venv + pip install ultralytics) can
    // take several minutes on first run. Flips to "training" once RPC returns.
    onRunsChange(runs.map(r =>
      r.id === run.id ? { ...r, status: "installing" as const, mAP: undefined, updatedAt: "just now" } : r
    ));

    // Clear stale progress so the chart and epoch counter reset immediately.
    if (fresh) {
      setRunProgress(prev => { const next = { ...prev }; delete next[run.id]; return next; });
    }

    const runAssets = assets.filter(a => run.assetIds.includes(a.id));
    try {
      await getRPC().request.startTraining({
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
        fresh,
      });
      // Setup done — YOLO training is now actually running.
      onRunsChange(runsRef.current.map(r =>
        r.id === run.id ? { ...r, status: "training" as const } : r
      ));
    } catch (err) {
      console.error("Failed to start training:", err);
      // Only set to failed if still in an active state — the user may have clicked
      // Stop/Pause while setup was running, which already updated the status.
      onRunsChange(runsRef.current.map(r =>
        r.id === run.id && (r.status === "installing" || r.status === "training")
          ? { ...r, status: "failed" as const, updatedAt: "just now" }
          : r
      ));
    }
  }

  // Pause: kill process, keep last.pt checkpoint → user can Resume later.
  async function handlePause(run: TrainingRun) {
    try {
      await getRPC().request.stopTraining({ runId: run.id });
      onRunsChange(runs.map(r =>
        r.id === run.id ? { ...r, status: "paused" as const, updatedAt: "just now" } : r
      ));
    } catch (err) {
      console.error("Failed to pause training:", err);
    }
  }

  // Stop: kill process + clear checkpoint → next Start is always from scratch.
  async function handleStop(run: TrainingRun) {
    try {
      await getRPC().request.stopTraining({ runId: run.id, clearCheckpoint: true, outputPath: run.outputPath });
      onRunsChange(runs.map(r =>
        r.id === run.id ? { ...r, status: "idle" as const, updatedAt: "just now" } : r
      ));
      setRunProgress(prev => { const next = { ...prev }; delete next[run.id]; return next; });
    } catch (err) {
      console.error("Failed to stop training:", err);
    }
  }

  // When a run is selected, show the inline detail view.
  if (detailRun) {
    const liveRun = runs.find(r => r.id === detailRun.id) ?? detailRun;
    return (
      <RunDetailView
        run={liveRun}
        progress={runProgress[detailRun.id]}
        onClose={() => setDetailRun(null)}
        onUpdate={patch => onRunsChange(runs.map(r => r.id === liveRun.id ? { ...r, ...patch } : r))}
        onStartFresh={() => handleStart(liveRun, true)}
        onResume={() => handleStart(liveRun, false)}
        onPause={() => handlePause(liveRun)}
        onStop={() => handleStop(liveRun)}
      />
    );
  }

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: "var(--bg)" }}>

      {/* Header */}
      <div style={{ height: 56, padding: "0 28px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", letterSpacing: "-0.3px" }}>Train</span>
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

      {/* Grid */}
      <div style={{ flex: 1, overflowY: "auto", padding: "24px 28px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 16 }}>

          {runs.map(run => (
            <RunCard
              key={run.id}
              run={run}
              assets={assets}
              progress={runProgress[run.id]}
              onClick={() => setDetailRun(run)}
              onStartFresh={() => handleStart(run, true)}
              onResume={() => handleStart(run, false)}
              onPause={() => handlePause(run)}
              onStop={() => handleStop(run)}
              onDelete={() => setDeleteTarget(run)}
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
        <NewRunModal assets={assets} runs={runs} onClose={() => setShowModal(false)} onCreate={handleCreate} />
      )}

      {deleteTarget && (
        <DeleteConfirmModal
          title="Delete Training Run"
          description={`"${deleteTarget.name}" will be removed from Reticle. This cannot be undone.`}
          folderPath={deleteTarget.outputPath}
          folderLabel={deleteTarget.outputPath}
          onConfirm={() => { onRunsChange(runs.filter(r => r.id !== deleteTarget.id)); setDeleteTarget(null); }}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}

// ── RunCard ────────────────────────────────────────────────────────────────────

interface RunCardProps {
  run: TrainingRun;
  assets: Asset[];
  progress?: LogProgress;
  onClick: () => void;
  onStartFresh: () => void;
  onResume: () => void;
  onPause: () => void;
  onStop: () => void;
  onDelete: () => void;
}

function RunCard({ run, assets, progress, onClick, onStartFresh, onResume, onPause, onStop, onDelete }: RunCardProps) {
  const statusColor = RUN_STATUS_COLORS[run.status];
  const statusLabel = RUN_STATUS_LABELS[run.status];
  const runAssets   = assets.filter(a => run.assetIds.includes(a.id));
  const pct         = progress ? Math.round((progress.epoch / progress.epochs) * 100) : 0;

  return (
    <div
      onClick={onClick}
      style={{
        background: "var(--surface)", border: "1px solid var(--border)",
        borderRadius: 8, overflow: "hidden", cursor: "pointer",
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
            {(run.status === "idle" || run.status === "done" || run.status === "failed") && (
              <ActionBtn Icon={Play} color="var(--accent)"
                title={run.status === "idle" ? "Start" : run.status === "done" ? "Start again" : "Retry"}
                onClick={onStartFresh} />
            )}
            {run.status === "paused" && (
              <ActionBtn Icon={Play} color="#3B82F6" title="Resume" onClick={onResume} />
            )}
            {run.status === "paused" && (
              <ActionBtn Icon={Square} color="#EF4444" title="Stop (discard checkpoint)" onClick={onStop} />
            )}
            {run.status === "training" && (
              <ActionBtn Icon={Pause} color="#F97316" title="Pause" onClick={onPause} />
            )}
            {(run.status === "training" || run.status === "installing") && (
              <ActionBtn Icon={Square} color="#EF4444" title="Stop (discard checkpoint)" onClick={onStop} />
            )}
            {(run.status === "idle" || run.status === "done" || run.status === "failed") && (
              <ActionBtn Icon={Trash2} color="var(--text-muted)" title="Delete run" onClick={onDelete} danger />
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

function MemoryBar({ label, valueMB, peakMB, color }: { label: string; valueMB: number; peakMB: number; color: string }) {
  const fmt = (mb: number) => mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`;
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
      <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{label}</span>
      <div style={{ textAlign: "right" }}>
        <span style={{ fontSize: 12, fontFamily: "monospace", fontWeight: 700, color }}>{fmt(valueMB)}</span>
        {peakMB > valueMB && (
          <div style={{ fontSize: 10, fontFamily: "monospace", color: "var(--text-muted)" }}>↑ {fmt(peakMB)}</div>
        )}
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


// ── Config strip helpers ───────────────────────────────────────────────────────

function ConfigStatField({ label, value, width }: { label: string; value: string; width?: number }) {
  return (
    <div style={{ flexShrink: 0, width }}>
      <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 2 }}>{label}</div>
      <div style={{ ...CONFIG_VALUE_STYLE, height: 18 }}>{value}</div>
    </div>
  );
}

const CONFIG_VALUE_STYLE: React.CSSProperties = {
  fontSize: 12, lineHeight: "18px", fontFamily: "monospace", color: "var(--text)",
};

function ConfigNumField({ label, value, min, max, editable, format, onChange }: {
  label: string; value: number; min: number; max: number;
  editable: boolean; format?: (v: number) => string; onChange: (v: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const display = format ? format(value) : String(value);

  function commit(raw: string) {
    const n = parseInt(raw, 10);
    if (!isNaN(n) && n >= min && n <= max) onChange(n);
    setEditing(false);
  }

  return (
    <div style={{ flexShrink: 0, width: 58 }}>
      <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 2 }}>{label}</div>
      <div style={{ height: 18, position: "relative" }}>
        <input
          value={editing ? draft : ""}
          onChange={e => setDraft(e.target.value)}
          onFocus={() => { setDraft(String(value)); setEditing(true); }}
          onBlur={() => commit(draft)}
          onKeyDown={e => { if (e.key === "Enter") commit(draft); if (e.key === "Escape") { setEditing(false); (e.target as HTMLInputElement).blur(); } }}
          readOnly={!editing}
          style={{
            ...CONFIG_VALUE_STYLE,
            position: "absolute", inset: 0, width: "100%",
            padding: 0, margin: 0, background: "transparent",
            border: "none", borderBottom: editing ? "1px solid var(--accent)" : editable ? "1px dashed var(--border)" : "1px solid transparent",
            outline: "none", cursor: editable ? "text" : "default",
            color: editing ? "var(--text)" : "transparent",
          }}
        />
        {!editing && (
          <div style={{ ...CONFIG_VALUE_STYLE, pointerEvents: "none" }}>{display}</div>
        )}
      </div>
    </div>
  );
}

function ConfigSelectField({ label, value, options, editable, onChange }: {
  label: string; value: string; options: string[];
  editable: boolean; onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative", flexShrink: 0, width: 72 }}>
      <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 2 }}>{label}</div>
      <div style={{ height: 18 }}>
        <div
          onClick={() => { if (editable) setOpen(o => !o); }}
          title={editable ? "Click to edit" : undefined}
          style={{
            ...CONFIG_VALUE_STYLE,
            cursor: editable ? "pointer" : "default", display: "flex", alignItems: "center", gap: 4,
            borderBottom: editable ? "1px dashed var(--border)" : "1px solid transparent",
          }}
        >
          {value}
          {editable && <ChevronDown size={10} style={{ opacity: 0.5 }} />}
        </div>
      </div>
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 200, minWidth: 90,
          background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6,
          boxShadow: "0 8px 24px rgba(0,0,0,0.4)", overflow: "hidden",
        }}>
          {options.map(opt => (
            <div
              key={opt}
              onClick={() => { onChange(opt); setOpen(false); }}
              style={{
                padding: "7px 10px", fontSize: 12, fontFamily: "monospace", cursor: "pointer",
                color: opt === value ? "var(--accent)" : "var(--text)",
                background: opt === value ? "rgba(59,130,246,0.08)" : "transparent",
              }}
              onMouseEnter={e => { if (opt !== value) (e.currentTarget as HTMLDivElement).style.background = "var(--bg)"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = opt === value ? "rgba(59,130,246,0.08)" : "transparent"; }}
            >
              {opt}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── RunDetailView ──────────────────────────────────────────────────────────────

function RunDetailView({ run, progress, onClose, onUpdate, onStartFresh, onResume, onPause, onStop }: {
  run: TrainingRun;
  progress?: LogProgress;
  onClose: () => void;
  onUpdate: (patch: Partial<TrainingRun>) => void;
  onStartFresh: () => void;
  onResume: () => void;
  onPause: () => void;
  onStop: () => void;
}) {
  const [lines,   setLines]   = useState<string[]>([]);
  const [runMeta, setRunMeta] = useState<{ found: boolean; classMap: string[]; imageCount: number; newCount: number; modifiedCount: number } | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  const peakRamMB = useMemo(() => {
    let peak = 0;
    for (const line of lines) {
      try { const ev = JSON.parse(line); if (ev.type === "progress" && ev.ramMB != null) peak = Math.max(peak, ev.ramMB); } catch {}
    }
    return peak || null;
  }, [lines]);

  const peakGpuMB = useMemo(() => {
    let peak = 0;
    for (const line of lines) {
      try { const ev = JSON.parse(line); if (ev.type === "progress" && ev.gpuMB != null) peak = Math.max(peak, ev.gpuMB); } catch {}
    }
    return peak || null;
  }, [lines]);

  // Poll the log whenever the detail view is open — not just while "training",
  // because setup messages (venv, pip install) are written before status flips.
  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const { lines: l } = await getRPC().request.readTrainingLog({ outputPath: run.outputPath });
        if (active) setLines(l);
      } catch {}
    }
    load();
    const id = setInterval(load, 1000);
    return () => { active = false; clearInterval(id); };
  }, [run.id, run.outputPath]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines.length]);

  // Fetch run-meta.json whenever the run changes (status flips after start/resume).
  useEffect(() => {
    getRPC().request.readRunMeta({ outputPath: run.outputPath })
      .then(meta => setRunMeta(meta))
      .catch(() => {});
  }, [run.id, run.status]);

  // Latest done/validation info.
  const { done } = parseLog(lines);

  const statusColor  = RUN_STATUS_COLORS[run.status];
  const pct          = run.status === "done" ? 100 : progress ? Math.round((progress.epoch / progress.epochs) * 100) : 0;
  const totalEpochs  = progress?.epochs ?? run.epochs;
  const currentEpoch = progress?.epoch  ?? (run.status === "done" ? run.epochs : 0);

  // Parse loss history, compute SVG polyline points and live dot in one pass.
  const { chartPoints, liveDot } = useMemo(() => {
    const pts: Array<{ epoch: number; loss: number }> = [];
    for (const line of lines) {
      try {
        const ev = JSON.parse(line);
        if (ev.type === "progress" && ev.loss != null) pts.push({ epoch: ev.epoch, loss: ev.loss });
      } catch {}
    }
    if (pts.length < 2) return { chartPoints: "", liveDot: null as { cx: number; cy: number } | null };

    const maxE   = pts[pts.length - 1].epoch;
    const losses = pts.map(d => d.loss);
    const minL   = Math.min(...losses);
    const rangeL = (Math.max(...losses) - minL) || 1;
    const toXY   = (d: { epoch: number; loss: number }) => ({
      x: (d.epoch / maxE) * 800,
      y: 200 - ((d.loss - minL) / rangeL) * 160 - 20,
    });

    const points     = pts.map(toXY);
    const chartPoints = points.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
    const last        = points[points.length - 1];
    const liveDot     = run.status === "training" ? { cx: last.x, cy: last.y } : null;

    return { chartPoints, liveDot };
  }, [lines, run.status]);

  // Validation metrics (from done, or latest progress).
  const mAP50    = done?.mAP50    ?? run.mAP    ?? progress?.mAP  ?? null;
  const mAP5095  = done?.mAP50_95 ?? null;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: "var(--bg)" }}>

      {/* ── Top bar ── */}
      <DetailPageHeader
        onBack={onClose}
        title={run.name}
        badge={
          <span style={{
            padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 600,
            background: statusColor + "22", border: `1px solid ${statusColor}55`, color: statusColor,
            letterSpacing: "0.04em", textTransform: "uppercase", flexShrink: 0,
          }}>
            {RUN_STATUS_LABELS[run.status]}
          </span>
        }
        actions={<>
          {(run.status === "idle" || run.status === "done" || run.status === "failed") && (
            <HeaderBtn onClick={onStartFresh} bg="var(--accent)">
              <Play size={13} fill="#fff" />
              {run.status === "idle" ? "Start" : run.status === "done" ? "Start Again" : "Retry"}
            </HeaderBtn>
          )}
          {run.status === "paused" && (
            <HeaderBtn onClick={onResume} bg="#3B82F6">
              <Play size={13} fill="#fff" /> Resume
            </HeaderBtn>
          )}
          {run.status === "training" && (
            <HeaderBtn onClick={onPause} bg="#F97316">
              <Pause size={13} fill="#fff" /> Pause
            </HeaderBtn>
          )}
          {(run.status === "training" || run.status === "installing" || run.status === "paused") && (
            <HeaderBtn onClick={onStop} bg="#EF4444">
              <Square size={13} fill="#fff" /> Stop
            </HeaderBtn>
          )}
        </>}
      />

      {/* ── Config strip ── */}
      {(() => {
        const editable = run.status === "idle" || run.status === "paused";
        return (
          <div style={{
            padding: "10px 24px", borderBottom: "1px solid var(--border)",
            display: "flex", gap: 28, alignItems: "center", flexShrink: 0, flexWrap: "wrap",
            background: "var(--surface)",
          }}>
            {/* Static: Model */}
            <ConfigStatField label="Model" value={run.baseModel} width={72} />

            {/* Editable: Epochs */}
            <ConfigNumField label="Epochs" value={run.epochs} min={1} max={10000} editable={editable}
              onChange={v => onUpdate({ epochs: v })} />

            {/* Editable: Batch */}
            <ConfigNumField label="Batch" value={run.batchSize} min={-1} max={1024} editable={editable}
              format={v => v === -1 ? "auto" : String(v)}
              onChange={v => onUpdate({ batchSize: v })} />

            {/* Editable: Img */}
            <ConfigNumField label="Img" value={run.imgsz} min={32} max={1280} editable={editable}
              format={v => `${v}px`}
              onChange={v => onUpdate({ imgsz: v })} />

            {/* Editable: Device */}
            <ConfigSelectField label="Device" value={run.device} options={DEVICES} editable={editable}
              onChange={v => onUpdate({ device: v })} />

            {/* Static: Classes */}
            <ConfigStatField label="Classes" value={String(run.classMap.length)} width={58} />
          </div>
        );
      })()}

      {/* ── Main area: chart (left) + metrics (right) ── */}
      <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 280px", gap: 0, overflow: "hidden" }}>

        {/* Left column: chart + terminal */}
        <div style={{ display: "flex", flexDirection: "column", overflow: "hidden", borderRight: "1px solid var(--border)" }}>

          {/* Loss chart */}
          <div style={{ padding: "16px 20px", background: "var(--surface)", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
              {(run.status === "installing" || run.status === "training") && (
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--accent)", display: "inline-block", animation: "pulse 1.5s infinite" }} />
              )}
              {run.status === "paused" && (
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#3B82F6", display: "inline-block" }} />
              )}
              <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.12em", color: "var(--text)" }}>
                Live Network Loss
              </span>
              {run.status === "training" && (
                <span style={{
                  background: "var(--surface-2)", border: "1px solid var(--accent)33",
                  color: "var(--accent)", fontSize: 10, padding: "1px 7px", borderRadius: 3, fontFamily: "monospace",
                }}>
                  Training…
                </span>
              )}
              {run.status === "paused" && (
                <span style={{
                  background: "var(--surface-2)", border: "1px solid #3B82F633",
                  color: "#3B82F6", fontSize: 10, padding: "1px 7px", borderRadius: 3, fontFamily: "monospace",
                }}>
                  Paused
                </span>
              )}
            </div>

            {/* SVG chart — fixed viewBox 800×200, scales with container */}
            <div style={{ height: 160, position: "relative", marginBottom: 4 }}>
              <svg
                viewBox="0 0 800 200"
                preserveAspectRatio="none"
                width="100%"
                height="100%"
                style={{ position: "absolute", inset: 0 }}
              >
                {/* Grid lines */}
                {[40, 80, 120, 160].map(y => (
                  <line key={y} x1="0" y1={y} x2="800" y2={y}
                    stroke="var(--border)" strokeWidth="1" />
                ))}
                {chartPoints ? (
                  <polyline
                    fill="none"
                    stroke="#3B82F6"
                    strokeWidth="3"
                    strokeLinejoin="round"
                    points={chartPoints}
                    vectorEffect="non-scaling-stroke"
                  />
                ) : (
                  <text x="400" y="100" textAnchor="middle" fill="var(--text-muted)"
                    fontSize="14" fontFamily="monospace">
                    {run.status === "idle" ? "Not started" : "Waiting for first epoch…"}
                  </text>
                )}
                {liveDot && <circle cx={liveDot.cx} cy={liveDot.cy} r="5" fill="#3B82F6" />}
              </svg>
              <div style={{ position: "absolute", bottom: 0, left: 0, fontSize: 9, color: "var(--text-muted)", fontFamily: "monospace" }}>Epoch 0</div>
              <div style={{ position: "absolute", bottom: 0, right: 0, fontSize: 9, color: "var(--text-muted)", fontFamily: "monospace" }}>Epoch {run.epochs}</div>
            </div>

            {/* Progress bar + epoch counter */}
            <div style={{ paddingTop: 12, borderTop: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 20 }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                    Training Progress
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "var(--accent)", fontFamily: "monospace" }}>{pct}%</span>
                </div>
                <div style={{ height: 4, borderRadius: 2, background: "var(--border)" }}>
                  <div style={{ height: "100%", borderRadius: 2, width: `${pct}%`, background: "var(--accent)", transition: "width 0.8s ease" }} />
                </div>
              </div>
              <div style={{ display: "flex", gap: 20, flexShrink: 0 }}>
                <div>
                  <div style={{ fontSize: 9, color: "var(--text-muted)", fontFamily: "monospace", textTransform: "uppercase" }}>Current Epoch</div>
                  <div style={{ fontSize: 16, fontFamily: "monospace", color: "var(--text)" }}>
                    {currentEpoch}/{totalEpochs}
                  </div>
                </div>
                {progress?.loss != null && (
                  <div>
                    <div style={{ fontSize: 9, color: "var(--text-muted)", fontFamily: "monospace", textTransform: "uppercase" }}>Box Loss</div>
                    <div style={{ fontSize: 16, fontFamily: "monospace", color: "#F97316" }}>
                      {progress.loss.toFixed(4)}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Terminal log */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: "#0e0e0e" }}>
            <div style={{
              padding: "6px 14px", borderBottom: "1px solid var(--border)",
              display: "flex", alignItems: "center", gap: 8, flexShrink: 0,
              background: "var(--surface)",
            }}>
              <Terminal size={12} style={{ color: "var(--text-muted)" }} />
              <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--text-muted)" }}>
                Training Logs — {run.name}
              </span>
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px", fontFamily: "monospace", fontSize: 11, lineHeight: 1.6 }}>
              {lines.length === 0 ? (
                <div style={{ color: "var(--text-muted)", paddingTop: 16 }}>No log entries yet.</div>
              ) : (
                lines.map((line, i) => <LogLine key={i} line={line} />)
              )}
              <div ref={logEndRef} />
            </div>
          </div>
        </div>

        {/* Right column: validation metrics */}
        <div style={{ display: "flex", flexDirection: "column", overflowY: "auto", padding: 16, gap: 12 }}>

          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "14px 16px" }}>
            <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.12em", color: "var(--text-muted)", marginBottom: 12 }}>
              Real-time Validation
            </div>
            {[
              { label: "mAP @ .50",     value: mAP50   },
              { label: "mAP @ .50:.95", value: mAP5095 },
              { label: "Precision",     value: progress?.mAP ?? null },
              { label: "Recall",        value: null },
            ].map(({ label, value }) => (
              <div key={label} style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "8px 10px", borderRadius: 4, background: "var(--bg)", marginBottom: 6,
              }}>
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{label}</span>
                <span style={{ fontFamily: "monospace", fontSize: 13, fontWeight: 700, color: value != null ? "var(--accent)" : "var(--text-muted)" }}>
                  {value != null ? value.toFixed(3) : "—"}
                </span>
              </div>
            ))}
          </div>

          {(progress?.ramMB != null || progress?.gpuMB != null) && (
            <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "14px 16px" }}>
              <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.12em", color: "var(--text-muted)", marginBottom: 12 }}>
                Memory
              </div>
              {progress?.ramMB != null && (
                <MemoryBar label="RAM" valueMB={progress.ramMB} peakMB={peakRamMB ?? progress.ramMB} color="var(--accent)" />
              )}
              {progress?.gpuMB != null && (
                <MemoryBar label="GPU" valueMB={progress.gpuMB} peakMB={peakGpuMB ?? progress.gpuMB} color="#A78BFA" />
              )}
            </div>
          )}

          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "14px 16px" }}>
            <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.12em", color: "var(--text-muted)", marginBottom: 12 }}>
              Run Configuration
            </div>
            {[
              ["Model",      run.baseModel],
              ["Epochs",     String(run.epochs)],
              ["Batch",      run.batchSize === -1 ? "auto" : String(run.batchSize)],
              ["Image Size", `${run.imgsz}px`],
              ["Device",     run.device],
            ].map(([k, v]) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{k}</span>
                <span style={{ fontSize: 11, fontFamily: "monospace", color: "var(--text)" }}>{v}</span>
              </div>
            ))}
          </div>

          {/* Dataset card — reads from run-meta.json (frozen at training start) */}
          {runMeta?.found && (
            <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "14px 16px" }}>
              <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.12em", color: "var(--text-muted)", marginBottom: 12 }}>
                Dataset
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Annotated images</span>
                <span style={{ fontSize: 11, fontFamily: "monospace", fontWeight: 700, color: "var(--text)" }}>{runMeta.imageCount}</span>
              </div>
              {(runMeta.newCount > 0 || runMeta.modifiedCount > 0) && (
                <div style={{ fontSize: 11, color: "#F59E0B", marginBottom: 8, lineHeight: 1.5 }}>
                  {runMeta.newCount > 0 && <div>+{runMeta.newCount} new since this run</div>}
                  {runMeta.modifiedCount > 0 && <div>~{runMeta.modifiedCount} modified since this run</div>}
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Classes</span>
                <span style={{ fontSize: 11, fontFamily: "monospace", color: "var(--text)" }}>{runMeta.classMap.length}</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 8 }}>
                {runMeta.classMap.map((cls, i) => (
                  <div key={cls} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ width: 8, height: 8, borderRadius: 2, flexShrink: 0, background: CLASS_COLORS[i % CLASS_COLORS.length] }} />
                    <span style={{ fontSize: 11, fontFamily: "monospace", color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{cls}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "14px 16px" }}>
            <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.12em", color: "var(--text-muted)", marginBottom: 8 }}>
              Output
            </div>
            <div style={{ fontSize: 11, fontFamily: "monospace", color: "var(--text-muted)", wordBreak: "break-all", lineHeight: 1.5 }}>
              {run.outputPath}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}

function LogLine({ line }: { line: string }) {
  try {
    const ev = JSON.parse(line);
    if (ev.type === "start") return (
      <div style={{ color: "var(--text-muted)", marginBottom: 2, opacity: 0.6 }}>
        ● run started {new Date(ev.timestamp).toLocaleString()}
      </div>
    );
    if (ev.type === "progress") return (
      <div style={{ color: "var(--text)", marginBottom: 1 }}>
        <span style={{ color: "var(--text-muted)" }}>epoch {String(ev.epoch).padStart(4)} </span>
        {ev.loss  != null && <span>loss <span style={{ color: "#F97316" }}>{ev.loss.toFixed(4)}</span>  </span>}
        {ev.mAP   != null && <span>mAP <span style={{ color: "#22C55E" }}>{ev.mAP.toFixed(4)}</span></span>}
      </div>
    );
    if (ev.type === "done") return (
      <div style={{ color: "#22C55E", marginTop: 4, fontWeight: 700 }}>
        ✓ done — mAP50: {ev.mAP50.toFixed(4)}  mAP50-95: {ev.mAP50_95.toFixed(4)}
      </div>
    );
    if (ev.type === "error") return (
      <div style={{ color: "#EF4444", marginTop: 4 }}>✗ error: {ev.message}</div>
    );
    if (ev.type === "stderr") return (
      <div style={{ color: "#F59E0B", marginBottom: 1, opacity: 0.8 }}>{ev.text}</div>
    );
  } catch {}
  return <div style={{ color: "var(--text-muted)", marginBottom: 1 }}>{line}</div>;
}

// ── CustomSelect ───────────────────────────────────────────────────────────────


// ── NewRunModal ────────────────────────────────────────────────────────────────

const DEFAULT_EPOCHS = 100;
const DEFAULT_BATCH  = 16;
const DEFAULT_IMGSZ  = 640;
const DEFAULT_DEVICE = "auto";

function NewRunModal({ assets, runs, onClose, onCreate }: {
  assets: Asset[];
  runs: TrainingRun[];
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
  const [baseFolder, setBaseFolder]         = useState("~/.reticle/runs");
  const [picking, setPicking]               = useState(false);

  const nameConflict = name.trim()
    ? runs.some(r => r.name.toLowerCase() === name.trim().toLowerCase())
    : false;

  const slug = name.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
  const outputPath = slug ? `${baseFolder}/${slug}` : "";

  // Merged class list: stable insertion order, deduplicated, recomputed only when selection changes.
  const classMap = useMemo(() => [...new Map(
    assets
      .filter(a => selectedAssets.includes(a.id))
      .flatMap(a => a.classes)
      .map(c => [c, c])
  ).keys()], [assets, selectedAssets]);

  function toggleAsset(id: string) {
    setSelectedAssets(prev => {
      const next = prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id];
      if (!nameEdited) {
        const first = assets.find(a => a.id === next[0]);
        const suggested = first
          ? `${first.name.toLowerCase().replace(/\s+/g, "-")}-${baseModel}-v1`
          : "";
        setName(suggested);
      }
      return next;
    });
  }

  function handleNameChange(val: string) {
    setName(val);
    setNameEdited(true);
  }

  async function pickFolder() {
    setPicking(true);
    try {
      const { canceled, path } = await getRPC().request.openFolderPathDialog({});
      if (!canceled && path) setBaseFolder(path);
    } finally {
      setPicking(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!outputPath || selectedAssets.length === 0 || nameConflict) return;
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
      outputPath,
      status:     "idle",
      updatedAt:  "just now",
    });
  }

  const valid = outputPath && selectedAssets.length > 0 && !nameConflict;

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
                style={{ ...inputStyle, fontFamily: "monospace", borderColor: nameConflict ? "#EF4444" : undefined }}
              />
              {nameConflict && (
                <div style={{ fontSize: 11, color: "#EF4444", marginTop: 4 }}>
                  A run with this name already exists.
                </div>
              )}
            </Field>

            <Field label="Assets">
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {assets.map(a => {
                  const selected = selectedAssets.includes(a.id);
                  const ready    = a.annotatedCount > 0;
                  return (
                    <div
                      key={a.id}
                      onClick={() => ready && toggleAsset(a.id)}
                      style={{
                        display: "flex", alignItems: "center", gap: 10,
                        padding: "8px 10px", borderRadius: 6, cursor: ready ? "pointer" : "default",
                        border: `1px solid ${selected ? "var(--accent)" : "var(--border)"}`,
                        background: selected ? "rgba(59,130,246,0.06)" : "var(--bg)",
                        transition: "border-color 0.12s, background 0.12s",
                        opacity: ready ? 1 : 0.5,
                      }}
                    >
                      <div style={{
                        width: 16, height: 16, borderRadius: 4, flexShrink: 0,
                        border: `1.5px solid ${selected ? "var(--accent)" : "var(--border)"}`,
                        background: selected ? "var(--accent)" : "transparent",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        transition: "background 0.15s, border-color 0.15s",
                      }}>
                        {selected && (
                          <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                            <path d="M1 4l2.5 2.5L9 1" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text)" }}>{a.name}</div>
                        <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                          {a.annotatedCount}/{a.imageCount} annotated · {a.classes.length} classes
                          {!ready && <span style={{ color: "#EF4444", marginLeft: 6 }}>— no annotations</span>}
                        </div>
                      </div>
                    </div>
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
              <CustomSelect value={baseModel} options={BASE_MODELS} onChange={setBaseModel} />
            </Field>

            <Field label="Hyperparameters">
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <NumField label="Epochs"     value={epochs}    min={1}   max={10000} onChange={setEpochs} />
                <NumField label="Batch Size" value={batchSize} min={-1}  max={1024}  onChange={setBatchSize} hint="-1 = auto" />
                <NumField label="Image Size" value={imgsz}     min={32}  max={1280}  onChange={setImgsz} />
                <div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>Device</div>
                  <CustomSelect value={device} options={DEVICES} onChange={setDevice} />
                </div>
              </div>
            </Field>

            <Field label="Output Folder">
              <div style={{ display: "flex", gap: 8 }}>
                <div style={{ ...inputStyle, flex: 1, fontFamily: "monospace", fontSize: 11, color: "var(--text-muted)" }}>
                  {baseFolder}
                </div>
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
              {slug && (
                <div style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "monospace", marginTop: 5 }}>
                  → {outputPath}
                </div>
              )}
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
