import { FolderOpen, Cpu, Play, Pause, Square, Trash2 } from "lucide-react";
import { type TrainingRun, type Asset } from "../lib/types";
import { RUN_STATUS_LABELS, RUN_STATUS_COLORS, CLASS_COLORS } from "../lib/constants";
import { type LogProgress } from "../lib/trainLog";
import { cardHover, statusBadge, mutedText } from "../lib/styleUtils";

export type RunAction = "view" | "start-fresh" | "resume" | "pause" | "stop" | "delete";

export interface RunCardProps {
  run: TrainingRun;
  assets: Asset[];
  progress?: LogProgress;
  onAction: (action: RunAction) => void;
}

export function RunCard({ run, assets, progress, onAction }: RunCardProps) {
  const statusColor = RUN_STATUS_COLORS[run.status];
  const statusLabel = RUN_STATUS_LABELS[run.status];
  const runAssets   = assets.filter(a => run.assetIds.includes(a.id));
  const pct         = progress ? Math.round((progress.epoch / progress.epochs) * 100) : 0;

  return (
    <div
      onClick={() => onAction("view")}
      style={{
        background: "var(--surface)", border: "1px solid var(--border)",
        borderRadius: 8, overflow: "hidden", cursor: "pointer",
        transition: "border-color 0.15s",
      }}
      {...cardHover}
    >
      {/* Status band / progress bar */}
      {run.status === "training" && progress ? (
        <div style={{ height: 6, background: "var(--border)", position: "relative" }}>
          <div style={{
            position: "absolute", left: 0, top: 0, height: "100%",
            width: `${pct}%`, background: statusColor, transition: "width 0.5s ease",
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
                onClick={() => onAction("start-fresh")} />
            )}
            {run.status === "paused" && (
              <ActionBtn Icon={Play} color="#3B82F6" title="Resume" onClick={() => onAction("resume")} />
            )}
            {run.status === "paused" && (
              <ActionBtn Icon={Square} color="#EF4444" title="Stop (discard checkpoint)" onClick={() => onAction("stop")} />
            )}
            {run.status === "training" && (
              <ActionBtn Icon={Pause} color="#F97316" title="Pause" onClick={() => onAction("pause")} />
            )}
            {(run.status === "training" || run.status === "installing") && (
              <ActionBtn Icon={Square} color="#EF4444" title="Stop (discard checkpoint)" onClick={() => onAction("stop")} />
            )}
            {(run.status === "idle" || run.status === "done" || run.status === "failed") && (
              <ActionBtn Icon={Trash2} color="var(--text-muted)" title="Delete run" onClick={() => onAction("delete")} danger />
            )}
          </div>
        </div>

        {/* Status + model */}
        <div style={{ display: "flex", gap: 8, marginBottom: 10, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ ...statusBadge(statusColor), flexShrink: 0 }}>
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
          <div style={{ marginBottom: 10, padding: "8px 10px", borderRadius: 6, background: "var(--bg)", border: "1px solid var(--border)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
              <span style={mutedText}>Epoch {progress.epoch} / {progress.epochs}</span>
              <span style={{ fontSize: 11, fontWeight: 600, color: "var(--accent)", fontFamily: "monospace" }}>{pct}%</span>
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
          <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Assets</div>
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
            {runAssets.length === 0 && <span style={mutedText}>—</span>}
          </div>
        </div>

        {/* Classes */}
        <div style={{ marginBottom: 10 }}>
          <div style={mutedText}>
            {run.classMap.length} classes:{" "}
            <span style={{ color: "var(--text)", fontFamily: "monospace" }}>
              {run.classMap.slice(0, 3).join(", ")}{run.classMap.length > 3 ? ` +${run.classMap.length - 3}` : ""}
            </span>
          </div>
        </div>

        {/* Footer */}
        <div style={{ paddingTop: 10, borderTop: "1px solid var(--border)" }}>
          <div style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginBottom: 4 }} title={run.outputPath}>
            <FolderOpen size={10} style={{ display: "inline", marginRight: 4, verticalAlign: "middle" }} />
            {run.outputPath}
          </div>
          <div style={mutedText}>Updated {run.updatedAt}</div>
        </div>
      </div>
    </div>
  );
}

export function ActionBtn({ Icon, color, title, onClick, danger }: {
  Icon: React.ElementType; color: string; title: string; onClick: () => void; danger?: boolean;
}) {
  return (
    <button
      title={title}
      onClick={e => { e.stopPropagation(); onClick(); }}
      style={{
        background: "none", border: "none", cursor: "pointer",
        color, padding: "2px 4px", borderRadius: 4,
        display: "flex", alignItems: "center", transition: "opacity 0.12s",
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.opacity = danger ? "1" : "0.7"; }}
      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.opacity = "1"; }}
    >
      <Icon size={13} />
    </button>
  );
}
