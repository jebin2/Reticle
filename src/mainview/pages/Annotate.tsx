import { useState, useRef, useMemo } from "react";
import {
  ChevronLeft, ChevronRight, SkipForward,
  Maximize2, Hand, Square, Lasso, ZoomIn, ZoomOut, Trash2,
} from "lucide-react";
import DetailPageHeader from "../components/DetailPageHeader";
import AnnotationCanvas, { type CanvasHandle } from "../components/AnnotationCanvas";
import ImageList from "../components/ImageList";
import ClassPanel from "../components/ClassPanel";
import UploadZone from "../components/UploadZone";
import { type AnnotateTool, bboxToPoints } from "../lib/annotationTypes";
import { type Asset } from "../lib/types";
import { CLASS_COLORS } from "../lib/constants";
import { useAnnotationData } from "../lib/useAnnotationData";
import { useAnnotationKeys } from "../lib/useAnnotationKeys";

// ── toolbar types ─────────────────────────────────────────────────────────────

type ToolAction = "fit" | "zoomIn" | "zoomOut" | "delete" | "prev" | "next" | "skip";

type ToolItem =
  | { kind: "tool";   id: AnnotateTool; Icon: React.ElementType; title: string }
  | { kind: "action"; action: ToolAction; Icon: React.ElementType; title: string };

type ToolbarEntry = ToolItem | "divider";

// ── toolbar definition (module-level — no component state dependency) ─────────

const TOOLBAR: ToolbarEntry[] = [
  { kind: "action", action: "fit",     Icon: Maximize2,    title: "Fit to screen (F)" },
  "divider",
  { kind: "tool",   id: "hand",        Icon: Hand,         title: "Hand — select / move / resize (H)" },
  { kind: "tool",   id: "box",         Icon: Square,       title: "Bounding box (B)" },
  { kind: "tool",   id: "polygon",     Icon: Lasso,        title: "Segmentation (P)" },
  "divider",
  { kind: "action", action: "zoomIn",  Icon: ZoomIn,       title: "Zoom in" },
  { kind: "action", action: "zoomOut", Icon: ZoomOut,      title: "Zoom out" },
  "divider",
  { kind: "action", action: "delete",  Icon: Trash2,       title: "Delete selected (Del)" },
  "divider",
  { kind: "action", action: "prev",    Icon: ChevronLeft,  title: "Previous image (←)" },
  { kind: "action", action: "next",    Icon: ChevronRight, title: "Next image (→)" },
  { kind: "action", action: "skip",    Icon: SkipForward,  title: "Skip image" },
];

// ── component ─────────────────────────────────────────────────────────────────

interface Props {
  asset: Asset;
  onAssetUpdate: (updated: Asset) => void;
  onBack: () => void;
}

export default function Annotate({ asset, onAssetUpdate, onBack }: Props) {
  const [activeClassIndex, setActiveClassIndex] = useState(0);
  const [tool, setTool]                         = useState<AnnotateTool>("hand");
  const [selectedId, setSelectedId]             = useState<string | null>(null);
  const [zoom, setZoom]                         = useState(100);
  const [coords, setCoords]                     = useState({ x: 0, y: 0 });

  const canvasRef    = useRef<CanvasHandle>(null);

  const {
    images, currentIndex, setCurrentIndex,
    classes, canvasSrc, importProgress,
    showClassSetup, setShowClassSetup,
    addImages, updateAnnotations, handleClassesChange,
  } = useAnnotationData(asset, onAssetUpdate);

  const currentImage = images[currentIndex];

  function navigate(delta: number) {
    setSelectedId(null);
    setCurrentIndex(prev => Math.max(0, Math.min(images.length - 1, prev + delta)));
  }

  useAnnotationKeys(setTool, navigate, canvasRef);

  const annotatedCount = useMemo(
    () => images.filter(i => i.annotations.length > 0).length,
    [images],
  );

  // ── toolbar handlers ──────────────────────────────────────────────────────

  function handleToolbarClick(item: ToolItem) {
    if (item.kind === "tool") { setTool(item.id); return; }
    switch (item.action) {
      case "fit":     canvasRef.current?.fitImage(); break;
      case "zoomIn":  canvasRef.current?.zoomIn();   break;
      case "zoomOut": canvasRef.current?.zoomOut();  break;
      case "delete":
        if (selectedId) {
          updateAnnotations(currentImage.annotations.filter(a => a.id !== selectedId));
          setSelectedId(null);
        }
        break;
      case "prev": navigate(-1); break;
      case "next": navigate(1);  break;
      case "skip": navigate(1);  break;
    }
  }

  function isActive(item: ToolItem): boolean {
    return item.kind === "tool" && item.id === tool;
  }

  function isDisabled(item: ToolItem): boolean {
    if (item.kind === "action") {
      if (item.action === "delete") return !selectedId;
      if (item.action === "prev")   return currentIndex === 0;
      if (item.action === "next" || item.action === "skip") return currentIndex === images.length - 1;
    }
    return false;
  }

  // ── render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", position: "relative" }}>

      {/* Top bar */}
      <DetailPageHeader
        onBack={onBack}
        backLabel="Assets"
        title={asset.name}
        meta={
          <span style={{ fontSize: 12, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 12 }}>
            {images.length > 0 ? `${currentIndex + 1} / ${images.length}` : "No images"}
            {images.length > 0 && (
              <span style={{ opacity: 0.6, fontSize: 11 }}>← → to navigate</span>
            )}
            {images.length > 0 && (
              <span>{annotatedCount}/{images.length} annotated</span>
            )}
          </span>
        }
        actions={
          <span style={{ fontSize: 11, color: "var(--text-muted)", opacity: 0.7 }}>
            Annotations auto-save
          </span>
        }
      />

      {/* Main area */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        <ImageList
          images={images}
          currentIndex={currentIndex}
          onSelect={i => { setSelectedId(null); setCurrentIndex(i); }}
          onAddImages={addImages}
        />

        {/* Canvas area — upload zone when empty, canvas when images loaded */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", position: "relative" }}>
          {images.length === 0 ? (
            <UploadZone onLoad={addImages} importProgress={importProgress} />
          ) : (
            <>
              {importProgress && (
                <div style={{
                  position: "absolute", inset: 0, zIndex: 20,
                  background: "rgba(0,0,0,0.55)",
                  display: "flex", flexDirection: "column",
                  alignItems: "center", justifyContent: "center", gap: 14,
                }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "#fff" }}>
                    Copying images…
                  </div>
                  <div style={{ width: 240, height: 6, borderRadius: 3, background: "rgba(255,255,255,0.2)", overflow: "hidden" }}>
                    <div style={{
                      height: "100%", borderRadius: 3, background: "var(--accent)",
                      width: `${Math.round((importProgress.done / importProgress.total) * 100)}%`,
                      transition: "width 0.15s",
                    }} />
                  </div>
                  <div style={{ fontSize: 12, color: "rgba(255,255,255,0.7)" }}>
                    {importProgress.done} / {importProgress.total}
                  </div>
                </div>
              )}
              <AnnotationCanvas
                ref={canvasRef}
                tool={tool}
                classes={classes}
                activeClassIndex={activeClassIndex}
                annotations={currentImage.annotations}
                selectedId={selectedId}
                imageSrc={canvasSrc}
                onAnnotationsChange={updateAnnotations}
                onSelect={setSelectedId}
                onZoomChange={setZoom}
                onCoordsChange={(x, y) => setCoords({ x, y })}
              />

              {/* Bottom toolbar */}
              <div style={{
                height: 44, flexShrink: 0,
                background: "var(--surface)",
                borderTop: "1px solid var(--border)",
                display: "flex", alignItems: "center",
                justifyContent: "center", gap: 2, padding: "0 12px",
              }}>
                <span style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "monospace", marginRight: "auto" }}>
                  {zoom}% · {coords.x}, {coords.y}
                </span>

                {TOOLBAR.map((entry, i) => {
                  if (entry === "divider") {
                    return <div key={i} style={{ width: 1, height: 20, background: "var(--border)", margin: "0 4px" }} />;
                  }
                  const active   = isActive(entry);
                  const disabled = isDisabled(entry);
                  const isDanger = entry.kind === "action" && entry.action === "delete";
                  return (
                    <button
                      key={i}
                      title={entry.title}
                      disabled={disabled}
                      onClick={() => handleToolbarClick(entry)}
                      style={{
                        width: 34, height: 34, borderRadius: 7, border: "none",
                        background: active ? "rgba(59,130,246,0.15)" : "transparent",
                        color: disabled
                          ? "var(--border)"
                          : active
                            ? "var(--accent)"
                            : isDanger
                              ? (selectedId ? "#EF4444" : "var(--border)")
                              : "var(--text-muted)",
                        cursor: disabled ? "not-allowed" : "pointer",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        transition: "background 0.12s, color 0.12s",
                      }}
                    >
                      <entry.Icon size={16} />
                    </button>
                  );
                })}

                <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: "auto", fontFamily: "monospace" }}>
                  {currentImage.filename}
                </span>
              </div>
            </>
          )}
        </div>

        <ClassPanel
          classes={classes}
          activeClassIndex={activeClassIndex}
          annotations={currentImage?.annotations ?? []}
          selectedId={selectedId}
          onClassesChange={handleClassesChange}
          onActiveClassChange={setActiveClassIndex}
          onSelectAnnotation={setSelectedId}
          onDeleteAnnotation={id => {
            if (!currentImage) return;
            updateAnnotations(currentImage.annotations.filter(a => a.id !== id));
            if (selectedId === id) setSelectedId(null);
          }}
          onEditAnnotation={(id, patch) => {
            if (!currentImage) return;
            updateAnnotations(currentImage.annotations.map(a => {
              if (a.id !== id) return a;
              const updated = { ...a, ...patch };
              // Keep 4-corner points in sync when bbox is edited manually
              if (updated.points?.length === 4)
                updated.points = bboxToPoints(updated.cx, updated.cy, updated.w, updated.h);
              return updated;
            }));
          }}
        />
      </div>

      {showClassSetup && (
        <ClassSetupModal
          onSave={names => {
            const newClasses = names.map((name, i) => ({ name, color: CLASS_COLORS[i % CLASS_COLORS.length] }));
            handleClassesChange(newClasses);
            setShowClassSetup(false);
          }}
        />
      )}
    </div>
  );
}

// ── ClassSetupModal ────────────────────────────────────────────────────────────

function ClassSetupModal({ onSave }: { onSave: (names: string[]) => void }) {
  const [input, setInput]     = useState("");
  const [classes, setClasses] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  function addFromInput() {
    const name = input.trim().toUpperCase().replace(/\s+/g, "_");
    if (!name || classes.includes(name)) { setInput(""); return; }
    setClasses(prev => [...prev, name]);
    setInput("");
  }

  return (
    <div style={{
      position: "absolute", inset: 0, zIndex: 100,
      background: "rgba(0,0,0,0.6)",
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <div style={{
        background: "var(--surface)", border: "1px solid var(--border)",
        borderRadius: 12, padding: "28px 28px 24px", width: 360,
        display: "flex", flexDirection: "column", gap: 20,
      }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", marginBottom: 6 }}>
            Set up classes
          </div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
            Define at least one class before annotating. These are the object types you'll label in this asset.
          </div>
        </div>

        {/* Class list */}
        {classes.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {classes.map((cls, i) => (
              <span key={cls} style={{
                display: "inline-flex", alignItems: "center", gap: 5,
                fontSize: 11, fontWeight: 600, fontFamily: "monospace",
                padding: "3px 8px 3px 10px", borderRadius: 4,
                background: CLASS_COLORS[i % CLASS_COLORS.length] + "22",
                color: CLASS_COLORS[i % CLASS_COLORS.length],
                border: `1px solid ${CLASS_COLORS[i % CLASS_COLORS.length]}44`,
              }}>
                {cls}
                <button
                  onClick={() => setClasses(prev => prev.filter(c => c !== cls))}
                  style={{ background: "none", border: "none", cursor: "pointer", padding: 0, lineHeight: 1, color: "inherit", opacity: 0.6 }}
                >×</button>
              </span>
            ))}
          </div>
        )}

        {/* Input */}
        <div style={{ display: "flex", gap: 8 }}>
          <input
            ref={inputRef}
            autoFocus
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter") { e.preventDefault(); addFromInput(); }
            }}
            placeholder="CLASS_NAME"
            style={{
              flex: 1, background: "var(--bg)", border: "1px solid var(--border)",
              borderRadius: 6, padding: "7px 10px", color: "var(--text)",
              fontSize: 12, fontWeight: 600, fontFamily: "monospace",
              letterSpacing: "0.04em", outline: "none", textTransform: "uppercase",
            }}
            onFocus={e => (e.currentTarget.style.borderColor = "var(--accent)")}
            onBlur={e => (e.currentTarget.style.borderColor = "var(--border)")}
          />
          <button
            onClick={addFromInput}
            disabled={!input.trim()}
            style={{
              padding: "7px 14px", borderRadius: 6, fontSize: 12, fontWeight: 600,
              border: "1px solid var(--border)", background: "var(--bg)",
              color: "var(--text)", cursor: input.trim() ? "pointer" : "default",
              opacity: input.trim() ? 1 : 0.4,
            }}
          >Add</button>
        </div>

        <button
          onClick={() => { if (classes.length > 0) onSave(classes); }}
          disabled={classes.length === 0}
          style={{
            padding: "9px 0", borderRadius: 7, fontSize: 13, fontWeight: 600,
            border: "none", cursor: classes.length > 0 ? "pointer" : "default",
            background: classes.length > 0 ? "var(--accent)" : "var(--border)",
            color: classes.length > 0 ? "#fff" : "var(--text-muted)",
            transition: "background 0.15s",
          }}
        >
          {classes.length === 0 ? "Add at least one class" : `Save ${classes.length} class${classes.length > 1 ? "es" : ""}`}
        </button>
      </div>
    </div>
  );
}
