import { Layers, Cpu, Image, Tag, ArrowRight } from "lucide-react";
import { type NavPage, type Asset, type TrainingRun } from "../lib/types";
import { RUN_STATUS_COLORS, RUN_STATUS_LABELS, CLASS_COLORS } from "../lib/constants";
import { mutedText } from "../lib/styleUtils";

interface Props {
  assets: Asset[];
  runs: TrainingRun[];
  onNavigate: (page: NavPage) => void;
}

export default function Overview({ assets, runs, onNavigate }: Props) {
  const totalImages = assets.reduce((s, a) => s + a.imageCount, 0);
  const totalAnnotated = assets.reduce((s, a) => s + a.annotatedCount, 0);
  const totalClasses = new Set(assets.flatMap(a => a.classes)).size;

  const recentAssets = [...assets].slice(0, 3);
  const recentRuns = [...runs].slice(0, 3);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: "var(--bg)" }}>

      {/* Header */}
      <div style={{ height: 56, padding: "0 28px", display: "flex", alignItems: "center", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", letterSpacing: "-0.3px" }}>Overview</span>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "28px 32px" }}>

      {/* Stat cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 36 }}>
        <StatCard icon={Layers} label="Assets" value={assets.length} />
        <StatCard icon={Cpu} label="Training Runs" value={runs.length} />
        <StatCard icon={Image} label="Images" value={totalImages} />
        <StatCard icon={Tag} label="Unique Classes" value={totalClasses} />
      </div>

      {/* Two-column recents */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>

        {/* Recent assets */}
        <Section title="Recent Assets" action="View all" onAction={() => onNavigate("assets")}>
          {recentAssets.map(a => <AssetRow key={a.id} asset={a} />)}
        </Section>

        {/* Recent runs */}
        <Section title="Recent Training Runs" action="View all" onAction={() => onNavigate("train")}>
          {recentRuns.map(r => <RunRow key={r.id} run={r} />)}
        </Section>

      </div>

      {/* Annotation progress */}
      <div style={{ marginTop: 24, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: "18px 20px" }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 14 }}>Annotation Progress</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {assets.map(a => (
            <ProgressRow key={a.id} label={a.name} value={a.annotatedCount} total={a.imageCount} />
          ))}
        </div>
        <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--border)", display: "flex", justifyContent: "space-between" }}>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Total</span>
          <span style={{ fontSize: 12, color: "var(--text)", fontFamily: "monospace" }}>
            {totalAnnotated} / {totalImages} ({totalImages > 0 ? Math.round(totalAnnotated / totalImages * 100) : 0}%)
          </span>
        </div>
      </div>

      </div>
    </div>
  );
}

// ── sub-components ─────────────────────────────────────────────────────────────

function StatCard({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: number }) {
  return (
    <div style={{
      background: "var(--surface)", border: "1px solid var(--border)",
      borderRadius: 10, padding: "16px 18px",
      display: "flex", flexDirection: "column", gap: 8,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Icon size={14} color="var(--accent)" strokeWidth={2} />
        <span style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</span>
      </div>
      <span style={{ fontSize: 26, fontWeight: 700, color: "var(--text)", letterSpacing: "-0.5px", fontFamily: "monospace" }}>
        {value}
      </span>
    </div>
  );
}

function Section({ title, action, onAction, children }: {
  title: string; action: string; onAction: () => void; children: React.ReactNode;
}) {
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "14px 16px", borderBottom: "1px solid var(--border)",
      }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{title}</span>
        <button
          onClick={onAction}
          style={{
            display: "flex", alignItems: "center", gap: 4,
            background: "none", border: "none", cursor: "pointer",
            fontSize: 12, color: "var(--accent)", padding: 0, fontFamily: "inherit",
          }}
        >
          {action} <ArrowRight size={12} />
        </button>
      </div>
      <div style={{ padding: "8px 0" }}>{children}</div>
    </div>
  );
}

function AssetRow({ asset }: { asset: Asset }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 12,
      padding: "8px 16px",
    }}>
      <div style={{
        width: 32, height: 32, borderRadius: 6, flexShrink: 0,
        background: asset.thumbnailColor,
      }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text)", marginBottom: 2 }}>{asset.name}</div>
        <div style={mutedText}>
          {asset.annotatedCount}/{asset.imageCount} images · {asset.classes.length} classes
        </div>
      </div>
      <div style={{ display: "flex", gap: 3, flexShrink: 0 }}>
        {asset.classes.slice(0, 4).map((cls, i) => (
          <div key={cls} title={cls} style={{ width: 7, height: 7, borderRadius: "50%", background: CLASS_COLORS[i % CLASS_COLORS.length] }} />
        ))}
        {asset.classes.length > 4 && (
          <span style={{ fontSize: 10, color: "var(--text-muted)" }}>+{asset.classes.length - 4}</span>
        )}
      </div>
    </div>
  );
}

function RunRow({ run }: { run: TrainingRun }) {
  const color = RUN_STATUS_COLORS[run.status];
  const label = RUN_STATUS_LABELS[run.status];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 16px" }}>
      <div style={{
        width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
        background: color,
        boxShadow: run.status === "training" ? `0 0 0 3px ${color}33` : "none",
      }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text)", marginBottom: 2, fontFamily: "monospace" }}>
          {run.name}
        </div>
        <div style={mutedText}>
          {run.baseModel} · {label}{run.mAP != null ? ` · mAP ${run.mAP.toFixed(3)}` : ""}
        </div>
      </div>
      <span style={{ fontSize: 11, color: "var(--text-muted)", flexShrink: 0 }}>{run.updatedAt}</span>
    </div>
  );
}

function ProgressRow({ label, value, total }: { label: string; value: number; total: number }) {
  const pct = total > 0 ? Math.round(value / total * 100) : 0;
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
        <span style={{ fontSize: 12, color: "var(--text)" }}>{label}</span>
        <span style={{ fontSize: 12, color: "var(--text-muted)", fontFamily: "monospace" }}>{value}/{total} ({pct}%)</span>
      </div>
      <div style={{ height: 4, borderRadius: 2, background: "var(--border)" }}>
        <div style={{ height: "100%", borderRadius: 2, width: `${pct}%`, background: "var(--accent)", transition: "width 0.3s" }} />
      </div>
    </div>
  );
}
