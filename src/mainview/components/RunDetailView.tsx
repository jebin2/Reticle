import { useState, useEffect, useRef, useMemo } from "react";
import { Play, Pause, Square, Terminal, Info } from "lucide-react";
import DetailPageHeader, { HeaderBtn } from "./DetailPageHeader";
import { type TrainingRun } from "../lib/types";
import { RUN_STATUS_LABELS, RUN_STATUS_COLORS, CLASS_COLORS } from "../lib/constants";
import { getRPC } from "../lib/rpc";
import { parseLog, type LogProgress } from "../lib/trainLog";
import { parseLogLine } from "../lib/logParser";
import { panel, sectionLabel, statusBadge, mutedText } from "../lib/styleUtils";
import LogPanel from "./LogPanel";
import RunConfigStrip from "./RunConfigStrip";
import TrainingMetricsHelpModal from "./TrainingMetricsHelpModal";
import DatasetUpdateModal, { type DatasetUpdateMeta } from "./DatasetUpdateModal";

// ── MemoryBar ─────────────────────────────────────────────────────────────────

function MemoryBar({ label, valueMB, peakMB, color }: { label: string; valueMB: number; peakMB: number; color: string }) {
  const fmt = (mb: number) => mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`;
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
      <span style={mutedText}>{label}</span>
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
    if (ev.type === "dataset_copy_start") return (
      <div style={{ color: "var(--text-muted)", marginBottom: 2 }}>
        copying dataset… (0 / {ev.total as number} images)
      </div>
    );
    if (ev.type === "dataset_copy_progress") {
      const done  = ev.done  as number;
      const total = ev.total as number;
      const pct   = total > 0 ? Math.round((done / total) * 100) : 0;
      const bar   = "█".repeat(Math.round(pct / 5)) + "░".repeat(20 - Math.round(pct / 5));
      return (
        <div style={{ color: "var(--text-muted)", marginBottom: 1, fontFamily: "monospace", fontSize: 11 }}>
          {bar} {pct}% ({done}/{total})
          {done === total && <span style={{ color: "#22C55E", marginLeft: 8 }}>✓ dataset ready</span>}
        </div>
      );
    }
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
  const [lines,            setLines]           = useState<string[]>([]);
  const [runMeta,          setRunMeta]         = useState<DatasetUpdateMeta | null>(null);
  const [showMetricsInfo,  setShowMetricsInfo] = useState(false);
  const [showUpdateModal,  setShowUpdateModal] = useState(false);
  const [updating,         setUpdating]        = useState(false);
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

  const { done, datasetSize, earlyStopTriggered, copyProgress } = parseLog(lines);
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
          {(run.status === "idle" || run.status === "done" || run.status === "failed") && (() => {
            const isSeg       = run.baseModel.endsWith("-seg");
            const mismatch    = runMeta != null && (runMeta.currentHasPolygons !== isSeg);
            const label       = run.status === "idle" ? "Start" : run.status === "done" ? "Start Again" : "Retry";
            return <>
              <HeaderBtn onClick={onStartFresh} bg="var(--accent)"><Play size={13} fill="#fff" />{label}</HeaderBtn>
              {mismatch && (
                <span style={{ fontSize: 11, color: "#F59E0B", padding: "4px 10px", borderRadius: 5, border: "1px solid rgba(245,158,11,0.4)", background: "rgba(245,158,11,0.08)", lineHeight: 1.4 }}>
                  {runMeta!.currentHasPolygons ? "Annotations now have polygons — consider a seg model" : "Annotations are bbox-only — consider a det model"}
                </span>
              )}
            </>;
          })()}
          {run.status === "paused" && (() => {
            // Resume mismatch is against the stored dataset, not current assets.
            const isSeg      = run.baseModel.endsWith("-seg");
            const mismatch   = runMeta?.hasPolygons != null && (runMeta.hasPolygons !== isSeg);
            return mismatch
              ? <span style={{ fontSize: 11, color: "#F59E0B", padding: "4px 10px", borderRadius: 5, border: "1px solid rgba(245,158,11,0.4)", background: "rgba(245,158,11,0.08)", maxWidth: 260, lineHeight: 1.4 }}>
                  {runMeta!.hasPolygons ? "Dataset has polygons — start a fresh run with a seg model" : "Dataset is bbox-only — start a fresh run with a det model"}
                </span>
              : <HeaderBtn onClick={onResume} bg="#3B82F6"><Play size={13} fill="#fff" /> Resume</HeaderBtn>;
          })()}
          {run.status === "training" && <HeaderBtn onClick={onPause} bg="#F97316"><Pause size={13} fill="#fff" /> Pause</HeaderBtn>}
          {(run.status === "training" || run.status === "installing" || run.status === "paused") && (
            <HeaderBtn onClick={onStop} bg="#EF4444"><Square size={13} fill="#fff" /> Stop</HeaderBtn>
          )}
        </>}
      />

      <RunConfigStrip run={run} editable={editable} onUpdate={onUpdate} />

      {/* Dataset drift banner */}
      {runMeta?.found && runMeta.hasDrift && (() => {
        const canUpdate = run.status === "idle" || run.status === "paused" || run.status === "done" || run.status === "failed";
        const parts: string[] = [];
        if (runMeta.newCount     > 0) parts.push(`+${runMeta.newCount} new`);
        if (runMeta.deletedCount > 0) parts.push(`−${runMeta.deletedCount} deleted`);
        if (runMeta.modifiedCount > 0) parts.push(`${runMeta.modifiedCount} modified`);
        if (runMeta.hasPolygonsChanged) parts.push(runMeta.currentHasPolygons ? "bbox → polygon" : "polygon → bbox");
        return (
          <div style={{ padding: "8px 20px", background: "rgba(245,158,11,0.07)", borderBottom: "1px solid rgba(245,158,11,0.25)", display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
            <span style={{ fontSize: 11, color: "#F59E0B", flex: 1 }}>
              Dataset has changed since last Start — {parts.join(", ")}
            </span>
            {canUpdate && (
              <button
                onClick={() => setShowUpdateModal(true)}
                style={{ fontSize: 11, fontWeight: 600, padding: "4px 12px", borderRadius: 5, border: "1px solid rgba(245,158,11,0.5)", background: "rgba(245,158,11,0.12)", color: "#F59E0B", cursor: "pointer", flexShrink: 0, fontFamily: "inherit" }}
              >
                Update Dataset
              </button>
            )}
          </div>
        );
      })()}

      {/* Main: chart (left) + metrics (right) */}
      <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 280px", gap: 0, overflow: "hidden" }}>

        {/* Left: chart + terminal */}
        <div style={{ display: "flex", flexDirection: "column", overflow: "hidden", borderRight: "1px solid var(--border)" }}>

          {/* Dataset copy progress — shown during the copy phase before training starts */}
          {copyProgress && copyProgress.done < copyProgress.total && (
            <div style={{ padding: "10px 20px", background: "rgba(59,130,246,0.06)", borderBottom: "1px solid var(--border)", flexShrink: 0, display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: "var(--accent)" }}>Copying dataset…</span>
                  <span style={{ fontSize: 11, fontFamily: "monospace", color: "var(--text-muted)" }}>{copyProgress.done} / {copyProgress.total}</span>
                </div>
                <div style={{ height: 4, borderRadius: 2, background: "var(--border)" }}>
                  <div style={{
                    height: "100%", borderRadius: 2, background: "var(--accent)", transition: "width 0.3s ease",
                    width: `${Math.round((copyProgress.done / copyProgress.total) * 100)}%`,
                  }} />
                </div>
              </div>
            </div>
          )}

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
                <span style={mutedText}>{k}</span>
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
                <span style={mutedText}>Images in dataset</span>
                <span style={{ fontSize: 11, fontFamily: "monospace", fontWeight: 700, color: "var(--text)" }}>{runMeta.imageCount}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                <span style={mutedText}>Type</span>
                <span style={{ fontSize: 11, fontFamily: "monospace", color: runMeta.hasPolygons ? "#A855F7" : "var(--accent)" }}>
                  {runMeta.hasPolygons ? "segmentation" : "detection"}
                </span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                <span style={mutedText}>Classes</span>
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

      {showMetricsInfo && <TrainingMetricsHelpModal onClose={() => setShowMetricsInfo(false)} />}

      {showUpdateModal && runMeta && (
        <DatasetUpdateModal
          runMeta={runMeta}
          currentBaseModel={run.baseModel}
          updating={updating}
          onConfirm={async (newBaseModel) => {
            setUpdating(true);
            try {
              await getRPC().request.updateDataset({ outputPath: run.outputPath });
              if (newBaseModel) {
                // Model type changed — reset to idle so the user must Start Fresh
                // (the old checkpoint is incompatible with the new model).
                onUpdate({ baseModel: newBaseModel, status: "idle" });
              }
              const fresh = await getRPC().request.readRunMeta({ outputPath: run.outputPath });
              setRunMeta(fresh as DatasetUpdateMeta);
            } catch (err) {
              console.error("Failed to update dataset:", err);
            } finally {
              setUpdating(false);
              setShowUpdateModal(false);
            }
          }}
          onCancel={() => setShowUpdateModal(false)}
        />
      )}
    </div>
  );
}
