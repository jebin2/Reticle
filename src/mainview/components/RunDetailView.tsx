import { useState, useEffect, useRef, useMemo } from "react";
import { Play, Pause, Square, Terminal, ChevronDown, Info } from "lucide-react";
import DetailPageHeader, { HeaderBtn } from "./DetailPageHeader";
import { type TrainingRun } from "../lib/types";
import { RUN_STATUS_LABELS, RUN_STATUS_COLORS, DEVICES, CLASS_COLORS } from "../lib/constants";
import { getRPC } from "../lib/rpc";
import { parseLog, type LogProgress } from "../lib/trainLog";
import { parseLogLine } from "../lib/logParser";
import { panel, sectionLabel, statusBadge, dropdownItemHover } from "../lib/styleUtils";
import LogPanel from "./LogPanel";

// ── Config strip helpers ───────────────────────────────────────────────────────

const CONFIG_VALUE_STYLE: React.CSSProperties = {
  fontSize: 12, lineHeight: "18px", fontFamily: "monospace", color: "var(--text)",
};

function ConfigStatField({ label, value, width }: { label: string; value: string; width?: number }) {
  return (
    <div style={{ flexShrink: 0, width }}>
      <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 2 }}>{label}</div>
      <div style={{ ...CONFIG_VALUE_STYLE, height: 18 }}>{value}</div>
    </div>
  );
}

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
        {!editing && <div style={{ ...CONFIG_VALUE_STYLE, pointerEvents: "none" }}>{display}</div>}
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
          style={{ ...CONFIG_VALUE_STYLE, cursor: editable ? "pointer" : "default", display: "flex", alignItems: "center", gap: 4, borderBottom: editable ? "1px dashed var(--border)" : "1px solid transparent" }}
        >
          {value}
          {editable && <ChevronDown size={10} style={{ opacity: 0.5 }} />}
        </div>
      </div>
      {open && (
        <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 200, minWidth: 90, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6, boxShadow: "0 8px 24px rgba(0,0,0,0.4)", overflow: "hidden" }}>
          {options.map(opt => (
            <div
              key={opt}
              onClick={() => { onChange(opt); setOpen(false); }}
              style={{ padding: "7px 10px", fontSize: 12, fontFamily: "monospace", cursor: "pointer", color: opt === value ? "var(--accent)" : "var(--text)", background: opt === value ? "rgba(59,130,246,0.08)" : "transparent" }}
              {...dropdownItemHover(opt === value)}
            >
              {opt}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── MemoryBar ─────────────────────────────────────────────────────────────────

function MemoryBar({ label, valueMB, peakMB, color }: { label: string; valueMB: number; peakMB: number; color: string }) {
  const fmt = (mb: number) => mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`;
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
      <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{label}</span>
      <div style={{ textAlign: "right" }}>
        <span style={{ fontSize: 12, fontFamily: "monospace", fontWeight: 700, color }}>{fmt(valueMB)}</span>
        {peakMB > valueMB && <div style={{ fontSize: 10, fontFamily: "monospace", color: "var(--text-muted)" }}>↑ {fmt(peakMB)}</div>}
      </div>
    </div>
  );
}

// ── LogLine ───────────────────────────────────────────────────────────────────

function LogLine({ line }: { line: string }) {
  const ev = parseLogLine(line);
  if (ev) {
    if (ev.type === "start")    return <div style={{ color: "var(--text-muted)", marginBottom: 2, opacity: 0.6 }}>● run started {new Date(ev.timestamp as string).toLocaleString()}</div>;
    if (ev.type === "progress") return (
      <div style={{ color: "var(--text)", marginBottom: 1 }}>
        <span style={{ color: "var(--text-muted)" }}>epoch {String(ev.epoch).padStart(4)} </span>
        {ev.lossBox != null && <span>box <span style={{ color: "#F97316" }}>{(ev.lossBox as number).toFixed(4)}</span>  </span>}
        {ev.lossCls != null && <span>cls <span style={{ color: "#22C55E" }}>{(ev.lossCls as number).toFixed(4)}</span>  </span>}
        {ev.lossDfl != null && <span>dfl <span style={{ color: "#A78BFA" }}>{(ev.lossDfl as number).toFixed(4)}</span>  </span>}
        {ev.mAP     != null && <span>mAP <span style={{ color: "var(--accent)" }}>{(ev.mAP as number).toFixed(4)}</span></span>}
        {!!ev.earlyStop && <span style={{ color: "#F59E0B", marginLeft: 6 }}>⏹ early stop</span>}
      </div>
    );
    if (ev.type === "dataset") return <div style={{ color: "var(--text-muted)", marginBottom: 2, opacity: 0.7 }}>dataset: {ev.imageCount as number} annotated images</div>;
    if (ev.type === "done")   return <div style={{ color: "#22C55E", marginTop: 4, fontWeight: 700 }}>✓ done — mAP50: {(ev.mAP50 as number).toFixed(4)}  mAP50-95: {(ev.mAP50_95 as number).toFixed(4)}</div>;
    if (ev.type === "error")  return <div style={{ color: "#EF4444", marginTop: 4 }}>✗ error: {ev.message as string}</div>;
    if (ev.type === "stderr") return <div style={{ color: "#F59E0B", marginBottom: 1, opacity: 0.8 }}>{ev.text as string}</div>;
  }
  return <div style={{ color: "var(--text-muted)", marginBottom: 1 }}>{line}</div>;
}

// ── MetricsInfoModal ──────────────────────────────────────────────────────────

function MetricsInfoModal({ onClose }: { onClose: () => void }) {
  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "28px 32px", maxWidth: 520, width: "90%", maxHeight: "85vh", overflowY: "auto", boxShadow: "0 24px 64px rgba(0,0,0,0.5)" }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>Understanding Your Training Metrics</span>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: 20, lineHeight: 1, padding: 0 }}>×</button>
        </div>

        <Section title="Loss Curves — Lower is Better">
          <p>Loss measures how wrong the model is. All three curves should steadily fall and flatten as training progresses.</p>
          <Metric color="#F97316" name="Box Loss" desc="How accurately the model places bounding boxes around objects. High early on — drops fast." />
          <Metric color="#22C55E" name="Cls Loss" desc="How confidently the model identifies the correct class (e.g. car vs. truck). Drops steadily with more examples." />
          <Metric color="#A78BFA" name="Dfl Loss" desc="Distribution Focal Loss — fine-tunes box edge sharpness. Usually the smallest of the three." />
          <Callout>A healthy run looks like a smooth downward curve that levels off near the end. Spiky or rising loss usually means your learning rate is too high, or your dataset has noisy labels.</Callout>
        </Section>

        <Section title="Accuracy Metrics — Higher is Better">
          <Metric color="var(--accent)" name="mAP @ .50" desc="Mean Average Precision at 50% overlap. The main score: 0 = useless, 1 = perfect. Aim for >0.70 for reliable detection." />
          <Metric color="var(--accent)" name="mAP @ .50:.95" desc="Stricter score averaged across overlap thresholds 50%–95%. More demanding — good models score 0.40–0.60+." />
          <Metric color="var(--accent)" name="Precision" desc="Of all detections made, what fraction were correct? High precision means few false alarms." />
          <Metric color="var(--accent)" name="Recall" desc="Of all real objects, what fraction did the model find? High recall means few missed detections." />
          <Callout>Precision and recall trade off against each other. A good model balances both above 0.80.</Callout>
        </Section>

        <Section title="Dataset Size Guidelines">
          <p>YOLO learns by seeing many examples. Small datasets lead to overfitting — the model memorises training images but fails on new ones.</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
            <Row label="< 50 images" value="Too few — expect poor results" color="#EF4444" />
            <Row label="50–200 images" value="Borderline — use data augmentation" color="#F59E0B" />
            <Row label="200–500 images" value="Good starting point" color="#22C55E" />
            <Row label="500+ images" value="Excellent — model can generalise well" color="#22C55E" />
          </div>
          <Callout>Aim for at least 50–100 annotated images per class. More diversity beats sheer quantity.</Callout>
        </Section>

        <Section title="Early Stopping">
          <p>If the model stops improving for several epochs in a row, training halts automatically. This is normal and saves time — it means the model has converged. You'll see the <span style={{ color: "#F59E0B", fontFamily: "monospace", fontWeight: 700 }}>EARLY STOP</span> badge when this happens.</p>
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--text-muted)", marginBottom: 10 }}>{title}</div>
      <div style={{ fontSize: 13, color: "var(--text)", lineHeight: 1.6 }}>{children}</div>
    </div>
  );
}

function Metric({ color, name, desc }: { color: string; name: string; desc: string }) {
  return (
    <div style={{ display: "flex", gap: 10, marginBottom: 8, alignItems: "flex-start" }}>
      <div style={{ width: 10, height: 10, borderRadius: 2, background: color, flexShrink: 0, marginTop: 3 }} />
      <div><span style={{ fontWeight: 600, color: "var(--text)" }}>{name}</span> — {desc}</div>
    </div>
  );
}

function Callout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 10, padding: "8px 12px", borderRadius: 6, background: "rgba(59,130,246,0.08)", border: "1px solid rgba(59,130,246,0.2)", fontSize: 12, color: "var(--text)", lineHeight: 1.5 }}>
      {children}
    </div>
  );
}

function Row({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
      <span style={{ fontFamily: "monospace", color: "var(--text-muted)" }}>{label}</span>
      <span style={{ color }}>{value}</span>
    </div>
  );
}

// ── RunDetailView ─────────────────────────────────────────────────────────────

interface Props {
  run: TrainingRun;
  progress?: LogProgress;
  onClose: () => void;
  onUpdate: (patch: Partial<TrainingRun>) => void;
  onStartFresh: () => void;
  onResume: () => void;
  onPause: () => void;
  onStop: () => void;
}

export default function RunDetailView({ run, progress, onClose, onUpdate, onStartFresh, onResume, onPause, onStop }: Props) {
  const [lines,          setLines]          = useState<string[]>([]);
  const [runMeta,        setRunMeta]        = useState<{ found: boolean; classMap: string[]; imageCount: number; newCount: number; modifiedCount: number; hasPolygons: boolean } | null>(null);
  const [showMetricsInfo, setShowMetricsInfo] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);

  const peakRamMB = useMemo(() => { let p = 0; for (const l of lines) { const ev = parseLogLine(l); if (ev?.type === "progress" && ev.ramMB != null) p = Math.max(p, ev.ramMB as number); } return p || null; }, [lines]);
  const peakGpuMB = useMemo(() => { let p = 0; for (const l of lines) { const ev = parseLogLine(l); if (ev?.type === "progress" && ev.gpuMB != null) p = Math.max(p, ev.gpuMB as number); } return p || null; }, [lines]);

  useEffect(() => {
    let active = true;
    async function load() {
      try { const { lines: l } = await getRPC().request.readTrainingLog({ outputPath: run.outputPath }); if (active) setLines(l); } catch {}
    }
    load();
    const id = setInterval(load, 1000);
    return () => { active = false; clearInterval(id); };
  }, [run.id, run.outputPath]);

  useEffect(() => { logEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [lines.length]);

  useEffect(() => {
    getRPC().request.readRunMeta({ outputPath: run.outputPath }).then(setRunMeta).catch(() => {});
  }, [run.id, run.status]);

  const { done, datasetSize, earlyStopTriggered } = parseLog(lines);
  const statusColor  = RUN_STATUS_COLORS[run.status];
  const pct          = run.status === "done" ? 100 : progress ? Math.round((progress.epoch / progress.epochs) * 100) : 0;
  const totalEpochs  = progress?.epochs ?? run.epochs;
  const currentEpoch = progress?.epoch  ?? (run.status === "done" ? run.epochs : 0);
  const mAP50   = done?.mAP50    ?? run.mAP    ?? progress?.mAP ?? null;
  const mAP5095 = done?.mAP50_95 ?? null;

  // Build per-curve point arrays for box / cls / dfl losses.
  const { curves, liveDots } = useMemo(() => {
    type Pt = { epoch: number; loss: number };
    const box: Pt[] = [], cls: Pt[] = [], dfl: Pt[] = [];
    for (const line of lines) {
      const ev = parseLogLine(line);
      if (!ev || ev.type !== "progress") continue;
      if (ev.lossBox != null) box.push({ epoch: ev.epoch as number, loss: ev.lossBox as number });
      if (ev.lossCls != null) cls.push({ epoch: ev.epoch as number, loss: ev.lossCls as number });
      if (ev.lossDfl != null) dfl.push({ epoch: ev.epoch as number, loss: ev.lossDfl as number });
    }
    const allPts = [...box, ...cls, ...dfl];
    if (allPts.length < 2) return { curves: null, liveDots: null };

    const maxE  = Math.max(...allPts.map(p => p.epoch));
    const allL  = allPts.map(p => p.loss);
    const minL  = Math.min(...allL);
    const rangeL = (Math.max(...allL) - minL) || 1;
    const toXY  = (p: Pt) => ({ x: (p.epoch / maxE) * 800, y: 200 - ((p.loss - minL) / rangeL) * 160 - 20 });
    const toStr = (pts: Pt[]) => pts.length < 2 ? "" : pts.map(p => { const {x,y} = toXY(p); return `${x.toFixed(1)},${y.toFixed(1)}`; }).join(" ");

    const live = run.status === "training";
    const lastXY = (pts: Pt[]) => pts.length > 0 ? toXY(pts[pts.length - 1]) : null;
    return {
      curves: { box: toStr(box), cls: toStr(cls), dfl: toStr(dfl) },
      liveDots: live ? { box: lastXY(box), cls: lastXY(cls), dfl: lastXY(dfl) } : null,
    };
  }, [lines, run.status]);

  const editable = run.status === "idle" || run.status === "paused";

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: "var(--bg)" }}>

      <DetailPageHeader
        onBack={onClose}
        title={run.name}
        badge={
          <span style={{ ...statusBadge(statusColor), padding: "2px 8px", flexShrink: 0 }}>
            {RUN_STATUS_LABELS[run.status]}
          </span>
        }
        actions={<>
          {(run.status === "idle" || run.status === "done" || run.status === "failed") && (
            <HeaderBtn onClick={onStartFresh} bg="var(--accent)"><Play size={13} fill="#fff" />{run.status === "idle" ? "Start" : run.status === "done" ? "Start Again" : "Retry"}</HeaderBtn>
          )}
          {run.status === "paused" && (() => {
            const modelMismatch = runMeta?.hasPolygons === true && !run.baseModel.endsWith("-seg");
            return modelMismatch
              ? <span style={{ fontSize: 11, color: "#F59E0B", padding: "4px 10px", borderRadius: 5, border: "1px solid rgba(245,158,11,0.4)", background: "rgba(245,158,11,0.08)", maxWidth: 260, lineHeight: 1.4 }}>Dataset now has polygons — start a fresh run with a seg model</span>
              : <HeaderBtn onClick={onResume} bg="#3B82F6"><Play size={13} fill="#fff" /> Resume</HeaderBtn>;
          })()}
          {run.status === "training" && <HeaderBtn onClick={onPause} bg="#F97316"><Pause size={13} fill="#fff" /> Pause</HeaderBtn>}
          {(run.status === "training" || run.status === "installing" || run.status === "paused") && (
            <HeaderBtn onClick={onStop} bg="#EF4444"><Square size={13} fill="#fff" /> Stop</HeaderBtn>
          )}
        </>}
      />

      {/* Config strip */}
      <div style={{ padding: "10px 24px", borderBottom: "1px solid var(--border)", display: "flex", gap: 28, alignItems: "center", flexShrink: 0, flexWrap: "wrap", background: "var(--surface)" }}>
        <ConfigStatField label="Model" value={run.baseModel} width={72} />
        <ConfigNumField label="Epochs" value={run.epochs} min={1} max={10000} editable={editable} onChange={v => onUpdate({ epochs: v })} />
        <ConfigNumField label="Batch" value={run.batchSize} min={-1} max={1024} editable={editable} format={v => v === -1 ? "auto" : String(v)} onChange={v => onUpdate({ batchSize: v })} />
        <ConfigNumField label="Img" value={run.imgsz} min={32} max={1280} editable={editable} format={v => `${v}px`} onChange={v => onUpdate({ imgsz: v })} />
        <ConfigSelectField label="Device" value={run.device} options={DEVICES} editable={editable} onChange={v => onUpdate({ device: v })} />
        <ConfigStatField label="Classes" value={String(run.classMap.length)} width={58} />
      </div>

      {/* Main: chart (left) + metrics (right) */}
      <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 280px", gap: 0, overflow: "hidden" }}>

        {/* Left: chart + terminal */}
        <div style={{ display: "flex", flexDirection: "column", overflow: "hidden", borderRight: "1px solid var(--border)" }}>

          {/* Loss chart */}
          <div style={{ padding: "16px 20px", background: "var(--surface)", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
              {(run.status === "installing" || run.status === "training") && <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--accent)", display: "inline-block", animation: "pulse 1.5s infinite" }} />}
              {run.status === "paused" && <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#3B82F6", display: "inline-block" }} />}
              <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.12em", color: "var(--text)" }}>Live Network Loss</span>
              <button
                onClick={() => setShowMetricsInfo(true)}
                title="What do these numbers mean?"
                style={{ background: "none", border: "none", cursor: "pointer", padding: 2, color: "var(--text-muted)", display: "flex", alignItems: "center", opacity: 0.6 }}
                onMouseEnter={e => (e.currentTarget.style.opacity = "1")}
                onMouseLeave={e => (e.currentTarget.style.opacity = "0.6")}
              ><Info size={13} /></button>
              {run.status === "training" && <span style={{ background: "var(--surface-2)", border: "1px solid var(--accent)33", color: "var(--accent)", fontSize: 10, padding: "1px 7px", borderRadius: 3, fontFamily: "monospace" }}>Training…</span>}
              {run.status === "paused"   && <span style={{ background: "var(--surface-2)", border: "1px solid #3B82F633", color: "#3B82F6", fontSize: 10, padding: "1px 7px", borderRadius: 3, fontFamily: "monospace" }}>Paused</span>}
            </div>

            {/* Legend */}
            {curves && (
              <div style={{ display: "flex", gap: 14, marginBottom: 8 }}>
                {([["Box", "#F97316", curves.box], ["Cls", "#22C55E", curves.cls], ["Dfl", "#A78BFA", curves.dfl]] as [string, string, string][])
                  .filter(([,, pts]) => pts)
                  .map(([label, color]) => (
                    <div key={label} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                      <div style={{ width: 18, height: 2, background: color, borderRadius: 1 }} />
                      <span style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "monospace" }}>{label}</span>
                    </div>
                  ))}
              </div>
            )}

            <div style={{ height: 160, position: "relative", marginBottom: 4 }}>
              <svg viewBox="0 0 800 200" preserveAspectRatio="none" width="100%" height="100%" style={{ position: "absolute", inset: 0 }}>
                {[40, 80, 120, 160].map(y => <line key={y} x1="0" y1={y} x2="800" y2={y} stroke="var(--border)" strokeWidth="1" />)}
                {curves ? (<>
                  {curves.box && <polyline fill="none" stroke="#F97316" strokeWidth="2.5" strokeLinejoin="round" points={curves.box} vectorEffect="non-scaling-stroke" />}
                  {curves.cls && <polyline fill="none" stroke="#22C55E" strokeWidth="2.5" strokeLinejoin="round" points={curves.cls} vectorEffect="non-scaling-stroke" />}
                  {curves.dfl && <polyline fill="none" stroke="#A78BFA" strokeWidth="2.5" strokeLinejoin="round" points={curves.dfl} vectorEffect="non-scaling-stroke" />}
                  {liveDots?.box && <circle cx={liveDots.box.x} cy={liveDots.box.y} r="4" fill="#F97316" />}
                  {liveDots?.cls && <circle cx={liveDots.cls.x} cy={liveDots.cls.y} r="4" fill="#22C55E" />}
                  {liveDots?.dfl && <circle cx={liveDots.dfl.x} cy={liveDots.dfl.y} r="4" fill="#A78BFA" />}
                </>) : (
                  <text x="400" y="100" textAnchor="middle" fill="var(--text-muted)" fontSize="14" fontFamily="monospace">
                    {run.status === "idle" ? "Not started" : "Waiting for first epoch…"}
                  </text>
                )}
              </svg>
              <div style={{ position: "absolute", bottom: 0, left: 0, fontSize: 9, color: "var(--text-muted)", fontFamily: "monospace" }}>Epoch 0</div>
              <div style={{ position: "absolute", bottom: 0, right: 0, fontSize: 9, color: "var(--text-muted)", fontFamily: "monospace" }}>Epoch {run.epochs}</div>
            </div>

            <div style={{ paddingTop: 12, borderTop: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 20 }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Training Progress</span>
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
                    {(earlyStopTriggered || progress?.earlyStop) && (
                      <span style={{ fontSize: 9, marginLeft: 6, color: "#F59E0B", fontFamily: "monospace", verticalAlign: "middle" }}>EARLY STOP</span>
                    )}
                  </div>
                </div>
                {progress?.lossBox != null && (
                  <div>
                    <div style={{ fontSize: 9, color: "#F97316", fontFamily: "monospace", textTransform: "uppercase" }}>Box</div>
                    <div style={{ fontSize: 14, fontFamily: "monospace", color: "#F97316" }}>{progress.lossBox.toFixed(4)}</div>
                  </div>
                )}
                {progress?.lossCls != null && (
                  <div>
                    <div style={{ fontSize: 9, color: "#22C55E", fontFamily: "monospace", textTransform: "uppercase" }}>Cls</div>
                    <div style={{ fontSize: 14, fontFamily: "monospace", color: "#22C55E" }}>{progress.lossCls.toFixed(4)}</div>
                  </div>
                )}
                {progress?.lossDfl != null && (
                  <div>
                    <div style={{ fontSize: 9, color: "#A78BFA", fontFamily: "monospace", textTransform: "uppercase" }}>Dfl</div>
                    <div style={{ fontSize: 14, fontFamily: "monospace", color: "#A78BFA" }}>{progress.lossDfl.toFixed(4)}</div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Terminal log */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: "#0e0e0e" }}>
            <div style={{ padding: "6px 14px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 8, flexShrink: 0, background: "var(--surface)" }}>
              <Terminal size={12} style={{ color: "var(--text-muted)" }} />
              <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--text-muted)" }}>Training Logs — {run.name}</span>
            </div>
            <div style={{ flex: 1, minHeight: 0 }}>
              <LogPanel
                lines={lines}
                renderLine={(line, i) => <LogLine key={i} line={line} />}
                endRef={logEndRef}
              />
            </div>
          </div>
        </div>

        {/* Right: metrics */}
        <div style={{ display: "flex", flexDirection: "column", overflowY: "auto", padding: 16, gap: 12 }}>

          <div style={panel}>
            <div style={sectionLabel}>Real-time Validation</div>
            {([["mAP @ .50", mAP50], ["mAP @ .50:.95", mAP5095], ["Precision", progress?.precision ?? null], ["Recall", progress?.recall ?? null]] as [string, number | null][]).map(([label, value]) => (
              <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 10px", borderRadius: 4, background: "var(--bg)", marginBottom: 6 }}>
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{label}</span>
                <span style={{ fontFamily: "monospace", fontSize: 13, fontWeight: 700, color: value != null ? "var(--accent)" : "var(--text-muted)" }}>{value != null ? value.toFixed(3) : "—"}</span>
              </div>
            ))}
          </div>

          {(progress?.ramMB != null || progress?.gpuMB != null) && (
            <div style={panel}>
              <div style={sectionLabel}>Memory</div>
              {progress?.ramMB != null && <MemoryBar label="RAM" valueMB={progress.ramMB} peakMB={peakRamMB ?? progress.ramMB} color="var(--accent)" />}
              {progress?.gpuMB != null && <MemoryBar label="GPU" valueMB={progress.gpuMB} peakMB={peakGpuMB ?? progress.gpuMB} color="#A78BFA" />}
            </div>
          )}

          <div style={panel}>
            <div style={sectionLabel}>Run Configuration</div>
            {([["Model", run.baseModel], ["Epochs", String(run.epochs)], ["Batch", run.batchSize === -1 ? "auto" : String(run.batchSize)], ["Image Size", `${run.imgsz}px`], ["Device", run.device]] as [string, string][]).map(([k, v]) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{k}</span>
                <span style={{ fontSize: 11, fontFamily: "monospace", color: "var(--text)" }}>{v}</span>
              </div>
            ))}
          </div>

          {runMeta?.found && (
            <div style={panel}>
              <div style={sectionLabel}>Dataset</div>
              {(datasetSize ?? runMeta.imageCount) < 50 && (
                <div style={{ marginBottom: 10, padding: "8px 10px", borderRadius: 6, background: "#F59E0B18", border: "1px solid #F59E0B44" }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#F59E0B", marginBottom: 3 }}>⚠ Small dataset</div>
                  <div style={{ fontSize: 11, color: "#F59E0B", opacity: 0.85, lineHeight: 1.5 }}>
                    {datasetSize ?? runMeta.imageCount} images is too few for reliable results. Aim for 50–100+ per class to avoid overfitting.
                  </div>
                </div>
              )}
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

          <div style={panel}>
            <div style={{ ...sectionLabel, marginBottom: 8 }}>Output</div>
            <div style={{ fontSize: 11, fontFamily: "monospace", color: "var(--text-muted)", wordBreak: "break-all", lineHeight: 1.5 }}>{run.outputPath}</div>
          </div>

        </div>
      </div>

      {showMetricsInfo && <MetricsInfoModal onClose={() => setShowMetricsInfo(false)} />}
    </div>
  );
}
