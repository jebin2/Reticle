import { useState } from "react";
import { Plus, Trash2, FolderOpen, Tag, Image } from "lucide-react";
import { type Asset } from "../lib/types";
import { CLASS_COLORS } from "../lib/constants";
import { getRPC } from "../lib/rpc";
import DeleteConfirmModal from "../components/DeleteConfirmModal";

interface Props {
  assets: Asset[];
  onAssetsChange: (assets: Asset[]) => void;
  onOpenAsset: (asset: Asset) => void;
}

export default function Assets({ assets, onAssetsChange, onOpenAsset }: Props) {
  const [showModal, setShowModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Asset | null>(null);

  function handleCreate(name: string, storagePath: string) {
    const asset: Asset = {
      id:             crypto.randomUUID(),
      name,
      storagePath,
      classes:        [],
      imageCount:     0,
      annotatedCount: 0,
      updatedAt:      "just now",
      thumbnailColor: THUMBNAIL_COLORS[assets.length % THUMBNAIL_COLORS.length],
    };
    onAssetsChange([...assets, asset]);
    setShowModal(false);
    onOpenAsset(asset);
  }

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: "var(--bg)" }}>

      {/* Header */}
      <div style={{ height: 56, padding: "0 28px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", letterSpacing: "-0.3px" }}>Assets</span>
        <button
          onClick={() => setShowModal(true)}
          style={{
            display: "flex", alignItems: "center", gap: 7,
            padding: "8px 14px", borderRadius: 7, border: "none",
            background: "var(--accent)", color: "#fff",
            fontSize: 13, fontWeight: 500, cursor: "pointer", fontFamily: "inherit",
          }}
        >
          <Plus size={14} /> New Asset
        </button>
      </div>

      {/* Grid */}
      <div style={{ flex: 1, overflowY: "auto", padding: "24px 28px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16 }}>

          {assets.map(asset => (
            <AssetCard
              key={asset.id}
              asset={asset}
              onClick={() => onOpenAsset(asset)}
              onDelete={() => setDeleteTarget(asset)}
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
              <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 3 }}>New Asset</div>
              <div style={{ fontSize: 12, opacity: 0.7 }}>Create a new labeled dataset</div>
            </div>
          </button>

        </div>
      </div>

      {showModal && (
        <NewAssetModal assets={assets} onClose={() => setShowModal(false)} onCreate={handleCreate} />
      )}

      {deleteTarget && (
        <DeleteConfirmModal
          title="Delete Asset"
          description={`"${deleteTarget.name}" will be removed from Reticle. This cannot be undone.`}
          folderPath={deleteTarget.storagePath}
          folderLabel={deleteTarget.storagePath}
          onConfirm={() => { onAssetsChange(assets.filter(a => a.id !== deleteTarget.id)); setDeleteTarget(null); }}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}

// ── AssetCard ──────────────────────────────────────────────────────────────────

function AssetCard({ asset, onClick, onDelete }: { asset: Asset; onClick: () => void; onDelete: () => void }) {
  const pct = asset.imageCount > 0 ? Math.round(asset.annotatedCount / asset.imageCount * 100) : 0;

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
      {/* Thumbnail */}
      <div style={{
        height: 120, background: asset.thumbnailColor, position: "relative",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <div style={{
          position: "absolute", inset: 0,
          backgroundImage: "linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)",
          backgroundSize: "20px 20px",
        }} />

        {/* Annotation progress badge */}
        <div style={{
          position: "absolute", bottom: 10, left: 10,
          background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)",
          borderRadius: 5, padding: "3px 8px",
          fontSize: 11, fontWeight: 600, color: "#fff", fontFamily: "monospace",
        }}>
          {pct}% annotated
        </div>

        <button
          onClick={e => { e.stopPropagation(); onDelete(); }}
          title="Delete asset"
          style={{
            position: "absolute", top: 8, right: 8,
            background: "rgba(0,0,0,0.4)", border: "none", borderRadius: 5,
            padding: "4px 5px", cursor: "pointer", color: "rgba(255,255,255,0.6)",
            display: "flex", alignItems: "center",
            transition: "color 0.12s, background 0.12s",
          }}
          onMouseEnter={e => { const el = e.currentTarget as HTMLButtonElement; el.style.color = "#EF4444"; el.style.background = "rgba(0,0,0,0.65)"; }}
          onMouseLeave={e => { const el = e.currentTarget as HTMLButtonElement; el.style.color = "rgba(255,255,255,0.6)"; el.style.background = "rgba(0,0,0,0.4)"; }}
        >
          <Trash2 size={13} />
        </button>
      </div>

      {/* Info */}
      <div style={{ padding: "14px 14px 12px" }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", marginBottom: 10, letterSpacing: "-0.2px" }}>
          {asset.name}
        </h3>

        {/* Stats row */}
        <div style={{ display: "flex", gap: 16, marginBottom: 10 }}>
          <MetaStat icon={Image} label={`${asset.annotatedCount} / ${asset.imageCount}`} title="Annotated / Total images" />
          <MetaStat icon={Tag}   label={`${asset.classes.length} classes`}              title="Classes" />
        </div>

        {/* Classes */}
        {asset.classes.length > 0 ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 10 }}>
            {asset.classes.slice(0, 4).map((cls, i) => (
              <span
                key={cls}
                style={{
                  fontSize: 10, padding: "2px 6px", borderRadius: 3,
                  background: CLASS_COLORS[i % CLASS_COLORS.length] + "22",
                  color: CLASS_COLORS[i % CLASS_COLORS.length],
                  border: `1px solid ${CLASS_COLORS[i % CLASS_COLORS.length]}44`,
                  fontWeight: 500,
                }}
              >{cls}</span>
            ))}
            {asset.classes.length > 4 && (
              <span style={{ fontSize: 10, color: "var(--text-muted)", padding: "2px 4px" }}>
                +{asset.classes.length - 4} more
              </span>
            )}
          </div>
        ) : (
          <div style={{ marginBottom: 10 }}>
            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>No classes yet</span>
          </div>
        )}

        {/* Storage path + date */}
        <div style={{ paddingTop: 10, borderTop: "1px solid var(--border)" }}>
          <div style={{
            fontSize: 10, color: "var(--text-muted)", fontFamily: "monospace",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            marginBottom: 4,
          }}
            title={asset.storagePath}
          >
            <FolderOpen size={10} style={{ display: "inline", marginRight: 4, verticalAlign: "middle" }} />
            {asset.storagePath}
          </div>
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Updated {asset.updatedAt}</div>
        </div>
      </div>
    </div>
  );
}

function MetaStat({ icon: Icon, label, title }: { icon: React.ElementType; label: string; title: string }) {
  return (
    <div title={title} style={{ display: "flex", alignItems: "center", gap: 5 }}>
      <Icon size={11} color="var(--text-muted)" />
      <span style={{ fontSize: 12, color: "var(--text)", fontFamily: "monospace" }}>{label}</span>
    </div>
  );
}

// ── NewAssetModal ──────────────────────────────────────────────────────────────

function NewAssetModal({ assets, onClose, onCreate }: {
  assets: Asset[];
  onClose: () => void;
  onCreate: (name: string, storagePath: string) => void;
}) {
  const [name, setName]           = useState("");
  const [baseFolder, setBaseFolder] = useState("~/.reticle/assets");
  const [picking, setPicking]     = useState(false);

  const nameConflict = name.trim()
    ? assets.some(a => a.name.toLowerCase() === name.trim().toLowerCase())
    : false;

  const slug = name.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
  const storagePath = slug ? `${baseFolder}/${slug}` : "";

  function handleNameChange(val: string) {
    setName(val);
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
    if (!storagePath || nameConflict) return;
    onCreate(name.trim(), storagePath);
  }

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 100,
        background: "rgba(0,0,0,0.6)", display: "flex",
        alignItems: "center", justifyContent: "center",
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        width: 420, background: "var(--surface)", borderRadius: 10,
        border: "1px solid var(--border)", padding: "24px",
        boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
      }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 20, letterSpacing: "-0.3px" }}>
          New Asset
        </h2>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Field label="Asset Name">
            <input
              autoFocus
              value={name}
              onChange={e => handleNameChange(e.target.value)}
              placeholder="e.g. Vehicles, PCB Defects"
              style={{ ...inputStyle, borderColor: nameConflict ? "#EF4444" : undefined }}
            />
            {nameConflict && (
              <div style={{ fontSize: 11, color: "#EF4444", marginTop: 4 }}>
                An asset with this name already exists.
              </div>
            )}
          </Field>

          <Field label="Storage Folder">
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
                → {storagePath}
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
              disabled={!storagePath || nameConflict}
              style={{
                flex: 1, padding: "9px", borderRadius: 7, border: "none",
                background: storagePath && !nameConflict ? "var(--accent)" : "var(--border)",
                color: storagePath && !nameConflict ? "#fff" : "var(--text-muted)",
                fontSize: 13, fontWeight: 600,
                cursor: storagePath && !nameConflict ? "pointer" : "not-allowed",
                fontFamily: "inherit",
              }}
            >
              Create Asset
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

const THUMBNAIL_COLORS = [
  "#1e3a5f", "#2d1f3d", "#1a3d2b", "#3d2a1a",
  "#3d1a2a", "#1a2d3d", "#2a3d1a", "#1a3a3d",
];
