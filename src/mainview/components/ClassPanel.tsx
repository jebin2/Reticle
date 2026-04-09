import { useState, useEffect } from "react";
import { Plus, Trash2, Pencil } from "lucide-react";
import { type BBox, type ClassDef, clampBBox, clampPt, pointsToBbox } from "../lib/annotationTypes";
import { CLASS_COLORS } from "../lib/constants";
import { accentColorHover } from "../lib/styleUtils";

interface Props {
  classes: ClassDef[];
  activeClassIndex: number;
  annotations: BBox[];
  selectedId: string | null;
  onClassesChange: (classes: ClassDef[]) => void;
  onActiveClassChange: (index: number) => void;
  onSelectAnnotation: (id: string | null) => void;
  onDeleteAnnotation: (id: string) => void;
  onEditAnnotation: (id: string, patch: Partial<Pick<BBox, "cx" | "cy" | "w" | "h" | "points">>) => void;
}

export default function ClassPanel({
  classes, activeClassIndex, annotations, selectedId,
  onClassesChange, onActiveClassChange, onSelectAnnotation, onDeleteAnnotation, onEditAnnotation,
}: Props) {
  const [addingClass, setAddingClass] = useState(false);
  const [newClassName, setNewClassName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);

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
            {...accentColorHover}
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
              Draw boxes or polygons on the image.
            </div>
          )}
          {annotations.map(ann => {
            const cls = classes[ann.classIndex];
            const isSelected = ann.id === selectedId;
            const isEditing  = ann.id === editingId;
            return (
              <div key={ann.id} style={{ marginBottom: 2 }}>
                {/* Row */}
                <div
                  onClick={() => onSelectAnnotation(ann.id)}
                  style={{
                    display: "flex", alignItems: "center", gap: 6,
                    padding: "5px 8px", borderRadius: isEditing ? "5px 5px 0 0" : 5,
                    background: isSelected ? "rgba(59,130,246,0.08)" : "transparent",
                    border: isSelected ? "1px solid rgba(59,130,246,0.2)" : "1px solid transparent",
                    borderBottom: isEditing ? "none" : undefined,
                    cursor: "pointer",
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
                      {ann.points && ann.points.length > 4
                        ? `polygon · ${ann.points.length} pts`
                        : `${(ann.cx - ann.w / 2).toFixed(3)}, ${(ann.cy - ann.h / 2).toFixed(3)}, ${ann.w.toFixed(3)}, ${ann.h.toFixed(3)}`
                      }
                    </div>
                  </div>
                  <button
                    onClick={e => { e.stopPropagation(); setEditingId(isEditing ? null : ann.id); onSelectAnnotation(ann.id); }}
                    title="Edit"
                    style={{
                      background: "none", border: "none", cursor: "pointer",
                      color: isEditing ? "var(--accent)" : "var(--text-muted)",
                      padding: 2, flexShrink: 0,
                      display: "flex", alignItems: "center", opacity: isEditing ? 1 : 0.6,
                    }}
                    onMouseEnter={e => { if (!isEditing) { (e.currentTarget as HTMLButtonElement).style.opacity = "1"; (e.currentTarget as HTMLButtonElement).style.color = "var(--accent)"; } }}
                    onMouseLeave={e => { if (!isEditing) { (e.currentTarget as HTMLButtonElement).style.opacity = "0.6"; (e.currentTarget as HTMLButtonElement).style.color = "var(--text-muted)"; } }}
                  >
                    <Pencil size={11} />
                  </button>
                  <button
                    onClick={e => { e.stopPropagation(); onDeleteAnnotation(ann.id); }}
                    title="Delete"
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

                {isEditing && (!ann.points || ann.points.length === 4) && (
                  <BBoxEditor ann={ann} onEditAnnotation={onEditAnnotation} />
                )}
                {isEditing && ann.points && ann.points.length > 4 && (
                  <PolygonEditor ann={ann} onEditAnnotation={onEditAnnotation} />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── PolygonEditor ─────────────────────────────────────────────────────────────

function PolygonEditor({
  ann,
  onEditAnnotation,
}: {
  ann: BBox;
  onEditAnnotation: (id: string, patch: Partial<Pick<BBox, "cx" | "cy" | "w" | "h" | "points">>) => void;
}) {
  const pts = ann.points!;

  // Draft strings per point, per axis
  const [drafts, setDrafts] = useState<Array<{ x: string; y: string }>>(
    () => pts.map(p => ({ x: p.x.toFixed(4), y: p.y.toFixed(4) }))
  );

  useEffect(() => {
    setDrafts(pts.map(p => ({ x: p.x.toFixed(4), y: p.y.toFixed(4) })));
  }, [ann.points]);

  function handleChange(i: number, axis: "x" | "y", raw: string) {
    const next = drafts.map((d, j) => j === i ? { ...d, [axis]: raw } : d);
    setDrafts(next);
    const num = parseFloat(raw);
    if (isNaN(num)) return;
    const newPts = pts.map((p, j) =>
      j === i ? { ...p, [axis]: clampPt(num) } : p
    );
    onEditAnnotation(ann.id, { points: newPts, ...pointsToBbox(newPts) });
  }

  const inputStyle: React.CSSProperties = {
    width: "100%", background: "var(--bg)",
    border: "1px solid var(--border)", borderRadius: 4,
    padding: "3px 5px", color: "var(--text)",
    fontSize: 10, fontFamily: "monospace", outline: "none",
  };

  return (
    <div style={{
      padding: "6px 8px 8px",
      background: "rgba(59,130,246,0.04)",
      border: "1px solid rgba(59,130,246,0.2)",
      borderTop: "none",
      borderRadius: "0 0 5px 5px",
      maxHeight: 180,
      overflowY: "auto",
    }}>
      {drafts.map((d, i) => (
        <div key={i} style={{ display: "grid", gridTemplateColumns: "24px 1fr 1fr", gap: 4, marginBottom: 4, alignItems: "center" }}>
          <span style={{ fontSize: 9, fontWeight: 700, color: "var(--text-muted)", letterSpacing: "0.04em", fontFamily: "monospace" }}>
            P{i + 1}
          </span>
          <input
            type="number" min={0} max={1} step={0.0001}
            value={d.x}
            onChange={e => handleChange(i, "x", e.target.value)}
            style={inputStyle}
            onFocus={e => (e.currentTarget.style.borderColor = "var(--accent)")}
            onBlur={e => (e.currentTarget.style.borderColor = "var(--border)")}
          />
          <input
            type="number" min={0} max={1} step={0.0001}
            value={d.y}
            onChange={e => handleChange(i, "y", e.target.value)}
            style={inputStyle}
            onFocus={e => (e.currentTarget.style.borderColor = "var(--accent)")}
            onBlur={e => (e.currentTarget.style.borderColor = "var(--border)")}
          />
        </div>
      ))}
    </div>
  );
}

// ── BBoxEditor ────────────────────────────────────────────────────────────────

function BBoxEditor({
  ann,
  onEditAnnotation,
}: {
  ann: BBox;
  onEditAnnotation: (id: string, patch: Partial<Pick<BBox, "cx" | "cy" | "w" | "h" | "points">>) => void;
}) {
  // Work in top-left corner space: x = cx - w/2, y = cy - h/2
  const toXYWH = (a: BBox) => ({
    x: (a.cx - a.w / 2).toFixed(3),
    y: (a.cy - a.h / 2).toFixed(3),
    w: a.w.toFixed(3),
    h: a.h.toFixed(3),
  });

  const [drafts, setDrafts] = useState(() => toXYWH(ann));

  // Sync when canvas moves/resizes the box externally
  useEffect(() => {
    setDrafts(toXYWH(ann));
  }, [ann.cx, ann.cy, ann.w, ann.h]);

  function handleChange(field: "x" | "y" | "w" | "h", raw: string) {
    setDrafts(prev => ({ ...prev, [field]: raw }));
    const num = parseFloat(raw);
    if (isNaN(num)) return;

    // Current top-left values
    let x = ann.cx - ann.w / 2;
    let y = ann.cy - ann.h / 2;
    let w = ann.w;
    let h = ann.h;

    if (field === "x") x = clampPt(num);
    if (field === "y") y = clampPt(num);
    if (field === "w") w = clampPt(num);
    if (field === "h") h = clampPt(num);

    const next = clampBBox(x + w / 2, y + h / 2, w, h);

    setDrafts({
      x: x.toFixed(3),
      y: y.toFixed(3),
      w: w.toFixed(3),
      h: h.toFixed(3),
      [field]: raw,
    });

    onEditAnnotation(ann.id, next);
  }

  return (
    <div style={{
      padding: "8px 8px 10px",
      background: "rgba(59,130,246,0.04)",
      border: "1px solid rgba(59,130,246,0.2)",
      borderTop: "none",
      borderRadius: "0 0 5px 5px",
      display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6,
    }}>
      {(["x", "y", "w", "h"] as const).map(field => (
        <label key={field} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontSize: 9, fontWeight: 700, color: "var(--text-muted)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
            {field}
          </span>
          <input
            type="number"
            min={0} max={1} step={0.001}
            value={drafts[field]}
            onChange={e => handleChange(field, e.target.value)}
            style={{
              width: "100%", background: "var(--bg)",
              border: "1px solid var(--border)", borderRadius: 4,
              padding: "3px 5px", color: "var(--text)",
              fontSize: 11, fontFamily: "monospace", outline: "none",
            }}
            onFocus={e => (e.currentTarget.style.borderColor = "var(--accent)")}
            onBlur={e => (e.currentTarget.style.borderColor = "var(--border)")}
          />
        </label>
      ))}
    </div>
  );
}
