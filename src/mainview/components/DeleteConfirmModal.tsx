import { useState } from "react";
import { Trash2 } from "lucide-react";
import { getRPC } from "../lib/rpc";

interface Props {
  title: string;
  description: string;
  folderPath: string;
  folderLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function DeleteConfirmModal({ title, description, folderPath, folderLabel, onConfirm, onCancel }: Props) {
  const [deleteFolder, setDeleteFolder] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleDelete() {
    setBusy(true);
    try {
      if (deleteFolder && folderPath) {
        await getRPC().request.deleteFolder({ folderPath });
      }
      onConfirm();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 200,
        background: "rgba(0,0,0,0.6)", display: "flex",
        alignItems: "center", justifyContent: "center",
      }}
      onClick={e => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div style={{
        width: 400, background: "var(--surface)", borderRadius: 10,
        border: "1px solid var(--border)", padding: "24px",
        boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 8, background: "rgba(239,68,68,0.12)",
            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
          }}>
            <Trash2 size={16} color="#EF4444" />
          </div>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", letterSpacing: "-0.2px" }}>
            {title}
          </h2>
        </div>

        <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 20, lineHeight: 1.5 }}>
          {description}
        </p>

        {folderPath && (
          <label style={{
            display: "flex", alignItems: "flex-start", gap: 10,
            padding: "10px 12px", borderRadius: 7,
            border: "1px solid var(--border)", background: "var(--bg)",
            cursor: "pointer", marginBottom: 20,
          }}>
            <input
              type="checkbox"
              checked={deleteFolder}
              onChange={e => setDeleteFolder(e.target.checked)}
              style={{ accentColor: "#EF4444", marginTop: 1, flexShrink: 0 }}
            />
            <div>
              <div style={{ fontSize: 13, color: "var(--text)", fontWeight: 500 }}>
                Also delete folder from disk
              </div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "monospace", marginTop: 3 }}>
                {folderLabel}
              </div>
            </div>
          </label>
        )}

        <div style={{ display: "flex", gap: 10 }}>
          <button
            onClick={onCancel}
            disabled={busy}
            style={{
              flex: 1, padding: "9px", borderRadius: 7,
              border: "1px solid var(--border)", background: "transparent",
              color: "var(--text-muted)", fontSize: 13, cursor: "pointer", fontFamily: "inherit",
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleDelete}
            disabled={busy}
            style={{
              flex: 1, padding: "9px", borderRadius: 7, border: "none",
              background: "#EF4444", color: "#fff",
              fontSize: 13, fontWeight: 600,
              cursor: busy ? "not-allowed" : "pointer", fontFamily: "inherit",
              opacity: busy ? 0.7 : 1,
            }}
          >
            {busy ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}
