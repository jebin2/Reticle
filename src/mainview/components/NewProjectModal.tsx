import { useState } from "react";
import { X } from "lucide-react";

interface NewProjectModalProps {
  onClose: () => void;
  onCreate: (name: string) => void;
}

export default function NewProjectModal({ onClose, onCreate }: NewProjectModalProps) {
  const [name, setName] = useState("");

  function handleCreate() {
    const trimmed = name.trim();
    if (!trimmed) return;
    onCreate(trimmed);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") handleCreate();
    if (e.key === "Escape") onClose();
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.7)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          width: 400,
          padding: 28,
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 600, color: "var(--text)", marginBottom: 4 }}>
              New Project
            </h2>
            <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
              You can add classes and choose a model after.
            </p>
          </div>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 2 }}
          >
            <X size={15} />
          </button>
        </div>

        {/* Project Name */}
        <div style={{ marginBottom: 20 }}>
          <label style={{
            display: "block",
            fontSize: 11,
            fontWeight: 600,
            color: "var(--text-muted)",
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            marginBottom: 6,
          }}>
            Project Name
          </label>
          <input
            autoFocus
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="e.g. Traffic_Surveillance_v1"
            style={{
              width: "100%",
              background: "var(--surface-2)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              padding: "9px 12px",
              color: "var(--text)",
              fontSize: 14,
              outline: "none",
              fontFamily: "inherit",
            }}
            onFocus={e => { e.currentTarget.style.borderColor = "var(--accent)"; }}
            onBlur={e => { e.currentTarget.style.borderColor = "var(--border)"; }}
          />
        </div>

        {/* Actions */}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button
            onClick={onClose}
            style={{
              padding: "8px 16px",
              borderRadius: 6,
              border: "1px solid var(--border)",
              background: "transparent",
              color: "var(--text-muted)",
              fontSize: 13,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={!name.trim()}
            style={{
              padding: "8px 18px",
              borderRadius: 6,
              border: "none",
              background: name.trim() ? "var(--accent)" : "var(--border)",
              color: name.trim() ? "#fff" : "var(--text-muted)",
              fontSize: 13,
              fontWeight: 500,
              cursor: name.trim() ? "pointer" : "not-allowed",
              fontFamily: "inherit",
              transition: "background 0.15s",
            }}
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
