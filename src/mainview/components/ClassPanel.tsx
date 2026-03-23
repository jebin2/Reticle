import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { type BBox, type ClassDef } from "../lib/annotationTypes";
import { CLASS_COLORS } from "../lib/constants";

interface Props {
  classes: ClassDef[];
  activeClassIndex: number;
  annotations: BBox[];
  selectedId: string | null;
  onClassesChange: (classes: ClassDef[]) => void;
  onActiveClassChange: (index: number) => void;
  onSelectAnnotation: (id: string | null) => void;
  onDeleteAnnotation: (id: string) => void;
}

export default function ClassPanel({
  classes, activeClassIndex, annotations, selectedId,
  onClassesChange, onActiveClassChange, onSelectAnnotation, onDeleteAnnotation,
}: Props) {
  const [addingClass, setAddingClass] = useState(false);
  const [newClassName, setNewClassName] = useState("");

  function confirmAddClass() {
    const name = newClassName.trim().toUpperCase().replace(/\s+/g, "_");
    if (!name) { setAddingClass(false); setNewClassName(""); return; }
    const color = CLASS_COLORS[classes.length % CLASS_COLORS.length];
    onClassesChange([...classes, { name, color }]);
    onActiveClassChange(classes.length);
    setNewClassName("");
    setAddingClass(false);
  }

  return (
    <div style={{
      width: 200, minWidth: 200,
      background: "var(--surface)",
      borderLeft: "1px solid var(--border)",
      display: "flex", flexDirection: "column",
      overflow: "hidden",
    }}>
      {/* Classes section */}
      <div style={{ borderBottom: "1px solid var(--border)" }}>
        <div style={{
          padding: "10px 12px 8px",
          fontSize: 10, fontWeight: 700,
          color: "var(--text-muted)",
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <span>Classes</span>
          <button
            onClick={() => setAddingClass(true)}
            title="Add class"
            style={{
              background: "none", border: "none", cursor: "pointer",
              color: "var(--text-muted)", padding: 2,
              display: "flex", alignItems: "center",
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = "var(--accent)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = "var(--text-muted)"; }}
          >
            <Plus size={12} />
          </button>
        </div>

        {/* Class list */}
        <div style={{ padding: "0 8px 8px" }}>
          {classes.length === 0 && !addingClass && (
            <div
              onClick={() => setAddingClass(true)}
              style={{
                padding: "8px 10px",
                fontSize: 12,
                color: "var(--text-muted)",
                cursor: "pointer",
                borderRadius: 5,
                border: "1px dashed var(--border)",
                textAlign: "center",
              }}
            >
              + Add first class
            </div>
          )}
          {classes.map((cls, i) => {
            const count = annotations.filter(a => a.classIndex === i).length;
            const active = i === activeClassIndex;
            return (
              <div
                key={i}
                onClick={() => onActiveClassChange(i)}
                style={{
                  display: "flex", alignItems: "center", gap: 8,
                  padding: "6px 8px", borderRadius: 5,
                  background: active ? "rgba(59,130,246,0.08)" : "transparent",
                  cursor: "pointer",
                  marginBottom: 1,
                }}
              >
                <div style={{
                  width: 8, height: 8, borderRadius: "50%",
                  background: cls.color, flexShrink: 0,
                }} />
                <span style={{
                  flex: 1, fontSize: 12, fontWeight: active ? 600 : 400,
                  color: active ? "var(--text)" : "var(--text-muted)",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {cls.name}
                </span>
                {count > 0 && (
                  <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{count}</span>
                )}
              </div>
            );
          })}

          {/* Inline add class input */}
          {addingClass && (
            <div style={{ marginTop: 4 }}>
              <input
                autoFocus
                value={newClassName}
                onChange={e => setNewClassName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter") confirmAddClass();
                  if (e.key === "Escape") { setAddingClass(false); setNewClassName(""); }
                }}
                onBlur={confirmAddClass}
                placeholder="CLASS_NAME"
                style={{
                  width: "100%",
                  background: "var(--surface-2)",
                  border: "1px solid var(--accent)",
                  borderRadius: 5,
                  padding: "5px 8px",
                  color: "var(--text)",
                  fontSize: 11,
                  fontWeight: 600,
                  letterSpacing: "0.04em",
                  outline: "none",
                  fontFamily: "inherit",
                  textTransform: "uppercase",
                }}
              />
              <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 3, paddingLeft: 2 }}>
                Enter to confirm · Esc to cancel
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Annotations section */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{
          padding: "10px 12px 8px",
          borderBottom: "1px solid var(--border)",
          fontSize: 10, fontWeight: 700,
          color: "var(--text-muted)",
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          display: "flex", justifyContent: "space-between",
        }}>
          <span>Annotations</span>
          <span style={{ fontWeight: 400 }}>{annotations.length}</span>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "6px 8px" }}>
          {annotations.length === 0 && (
            <div style={{ fontSize: 12, color: "var(--text-muted)", padding: "8px 4px" }}>
              Draw boxes on the image.
            </div>
          )}
          {annotations.map(ann => {
            const cls = classes[ann.classIndex];
            const isSelected = ann.id === selectedId;
            return (
              <div
                key={ann.id}
                onClick={() => onSelectAnnotation(ann.id)}
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  padding: "5px 8px", borderRadius: 5,
                  background: isSelected ? "rgba(59,130,246,0.08)" : "transparent",
                  border: isSelected ? "1px solid rgba(59,130,246,0.2)" : "1px solid transparent",
                  cursor: "pointer", marginBottom: 2,
                }}
              >
                <div style={{
                  width: 7, height: 7, borderRadius: 2,
                  border: `1.5px solid ${cls?.color ?? "#888"}`,
                  flexShrink: 0,
                }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11, fontWeight: 500, color: "var(--text)" }}>
                    {cls?.name ?? "unknown"}
                  </div>
                  <div style={{
                    fontSize: 10, color: "var(--text-muted)",
                    fontFamily: "monospace",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>
                    {ann.cx.toFixed(2)}, {ann.cy.toFixed(2)}, {ann.w.toFixed(2)}, {ann.h.toFixed(2)}
                  </div>
                </div>
                <button
                  onClick={e => { e.stopPropagation(); onDeleteAnnotation(ann.id); }}
                  style={{
                    background: "none", border: "none", cursor: "pointer",
                    color: "var(--text-muted)", padding: 2, flexShrink: 0,
                    display: "flex", alignItems: "center", opacity: 0.6,
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.opacity = "1"; (e.currentTarget as HTMLButtonElement).style.color = "#EF4444"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.opacity = "0.6"; (e.currentTarget as HTMLButtonElement).style.color = "var(--text-muted)"; }}
                >
                  <Trash2 size={11} />
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
