import { useState } from "react";
import { Plus, MoreHorizontal, FolderOpen, Cpu } from "lucide-react";
import { type TrainingRun, type Asset } from "../lib/types";
import { MOCK_RUNS, MOCK_ASSETS, RUN_STATUS_LABELS, RUN_STATUS_COLORS, BASE_MODELS, CLASS_COLORS } from "../lib/constants";
import { getRPC } from "../lib/rpc";

export default function Train() {
  const [runs, setRuns]       = useState<TrainingRun[]>(MOCK_RUNS);
  const [showModal, setShowModal] = useState(false);

  function handleCreate(run: TrainingRun) {
    setRuns(prev => [...prev, run]);
    setShowModal(false);
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
              Configure and launch training runs from your assets.
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
            <RunCard key={run.id} run={run} assets={MOCK_ASSETS} />
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
        <NewRunModal assets={MOCK_ASSETS} onClose={() => setShowModal(false)} onCreate={handleCreate} />
      )}
    </div>
  );
}

// ── RunCard ────────────────────────────────────────────────────────────────────

function RunCard({ run, assets }: { run: TrainingRun; assets: Asset[] }) {
  const statusColor = RUN_STATUS_COLORS[run.status];
  const statusLabel = RUN_STATUS_LABELS[run.status];
  const runAssets   = assets.filter(a => run.assetIds.includes(a.id));

  return (
    <div
      style={{
        background: "var(--surface)", border: "1px solid var(--border)",
        borderRadius: 8, overflow: "hidden", cursor: "pointer",
        transition: "border-color 0.15s",
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.borderColor = "#444"; }}
      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = "var(--border)"; }}
    >
      {/* Header band */}
      <div style={{
        height: 6,
        background: statusColor,
        opacity: run.status === "idle" ? 0.4 : 1,
      }} />

      <div style={{ padding: "14px 14px 12px" }}>
        {/* Run name + menu */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 10 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", letterSpacing: "-0.2px", fontFamily: "monospace" }}>
            {run.name}
          </h3>
          <button
            onClick={e => e.stopPropagation()}
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: "0 0 0 8px" }}
          >
            <MoreHorizontal size={14} />
          </button>
        </div>

        {/* Status + model */}
        <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center" }}>
          <span style={{
            padding: "2px 7px", borderRadius: 4, fontSize: 11, fontWeight: 600,
            background: statusColor + "22", border: `1px solid ${statusColor}55`, color: statusColor,
            letterSpacing: "0.04em", textTransform: "uppercase",
          }}>
            {statusLabel}
          </span>
          <span style={{ fontSize: 12, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 4 }}>
            <Cpu size={11} /> {run.baseModel}
          </span>
          {run.mAP != null && (
            <span style={{ fontSize: 12, color: "var(--text)", fontFamily: "monospace", marginLeft: "auto" }}>
              mAP {run.mAP.toFixed(3)}
            </span>
          )}
        </div>

        {/* Assets used */}
        <div style={{ marginBottom: 12 }}>
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
          </div>
        </div>

        {/* Classes count */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
            {run.classMap.length} classes: <span style={{ color: "var(--text)", fontFamily: "monospace" }}>
              {run.classMap.slice(0, 3).join(", ")}{run.classMap.length > 3 ? ` +${run.classMap.length - 3}` : ""}
            </span>
          </div>
        </div>

        {/* Footer */}
        <div style={{ paddingTop: 10, borderTop: "1px solid var(--border)" }}>
          <div style={{
            fontSize: 10, color: "var(--text-muted)", fontFamily: "monospace",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginBottom: 4,
          }}
            title={run.outputPath}
          >
            <FolderOpen size={10} style={{ display: "inline", marginRight: 4, verticalAlign: "middle" }} />
            {run.outputPath}
          </div>
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Updated {run.updatedAt}</div>
        </div>
      </div>
    </div>
  );
}

// ── NewRunModal ────────────────────────────────────────────────────────────────

function NewRunModal({ assets, onClose, onCreate }: {
  assets: Asset[];
  onClose: () => void;
  onCreate: (run: TrainingRun) => void;
}) {
  const [name, setName]             = useState("");
  const [selectedAssets, setSelectedAssets] = useState<string[]>([]);
  const [baseModel, setBaseModel]   = useState(BASE_MODELS[0]);
  const [outputPath, setOutputPath] = useState("");
  const [picking, setPicking]       = useState(false);

  function toggleAsset(id: string) {
    setSelectedAssets(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }

  // Build merged class list from selected assets (preserving order, deduplicating)
  const classMap = [...new Set(
    assets.filter(a => selectedAssets.includes(a.id)).flatMap(a => a.classes)
  )];

  async function pickFolder() {
    setPicking(true);
    try {
      const { canceled, paths } = await getRPC().request.openFolderDialog({});
      if (!canceled && paths.length > 0) setOutputPath(paths[0]);
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
        width: 480, background: "var(--surface)", borderRadius: 10,
        border: "1px solid var(--border)", padding: "24px",
        boxShadow: "0 20px 60px rgba(0,0,0,0.5)", maxHeight: "90vh", overflowY: "auto",
      }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 20, letterSpacing: "-0.3px" }}>
          New Training Run
        </h2>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>

          <Field label="Run Name">
            <input
              autoFocus
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. vehicles-v2"
              style={{ ...inputStyle, fontFamily: "monospace" }}
            />
          </Field>

          <Field label="Select Assets">
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {assets.map(a => {
                const selected = selectedAssets.includes(a.id);
                return (
                  <label
                    key={a.id}
                    style={{
                      display: "flex", alignItems: "center", gap: 10,
                      padding: "8px 10px", borderRadius: 6, cursor: "pointer",
                      border: `1px solid ${selected ? "var(--accent)" : "var(--border)"}`,
                      background: selected ? "rgba(59,130,246,0.06)" : "var(--bg)",
                      transition: "border-color 0.12s, background 0.12s",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => toggleAsset(a.id)}
                      style={{ accentColor: "var(--accent)" }}
                    />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text)" }}>{a.name}</div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                        {a.imageCount} images · {a.classes.length} classes
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
          </Field>

          {classMap.length > 0 && (
            <div style={{
              padding: "10px 12px", borderRadius: 6, background: "var(--bg)",
              border: "1px solid var(--border)",
            }}>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6 }}>
                Merged class map ({classMap.length} classes)
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
            <select
              value={baseModel}
              onChange={e => setBaseModel(e.target.value)}
              style={{ ...inputStyle, cursor: "pointer" }}
            >
              {BASE_MODELS.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </Field>

          <Field label="Output Folder">
            <div style={{ display: "flex", gap: 8 }}>
              <input
                value={outputPath}
                onChange={e => setOutputPath(e.target.value)}
                placeholder="~/YOLOStudio/runs/my-run"
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
      </div>
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
