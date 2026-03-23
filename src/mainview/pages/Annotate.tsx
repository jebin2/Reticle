import { useState, useEffect, useRef } from "react";
import {
  ChevronLeft, ChevronRight, SkipForward,
  Maximize2, Hand, Square, Lasso, ZoomIn, ZoomOut, Trash2,
} from "lucide-react";
import AnnotationCanvas, { type CanvasHandle } from "../components/AnnotationCanvas";
import ImageList from "../components/ImageList";
import ClassPanel from "../components/ClassPanel";
import UploadZone from "../components/UploadZone";
import { type BBox, type ClassDef, type AnnotateTool, type ImageEntry } from "../lib/annotationTypes";
import { loadImageSrc } from "../lib/imageLoader";
import { MOCK_CLASSES } from "../lib/mockImages";

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
  { kind: "action", action: "prev",    Icon: ChevronLeft,  title: "Previous image (A)" },
  { kind: "action", action: "next",    Icon: ChevronRight, title: "Next image (D)" },
  { kind: "action", action: "skip",    Icon: SkipForward,  title: "Skip image" },
];

// ── component ─────────────────────────────────────────────────────────────────

export default function Annotate() {
  const [images, setImages]                     = useState<ImageEntry[]>([]);
  const [currentIndex, setCurrentIndex]         = useState(0);
  const [classes, setClasses]                   = useState<ClassDef[]>(MOCK_CLASSES);
  const [activeClassIndex, setActiveClassIndex] = useState(0);
  const [tool, setTool]                         = useState<AnnotateTool>("hand");
  const [selectedId, setSelectedId]             = useState<string | null>(null);
  const [zoom, setZoom]                         = useState(100);
  const [coords, setCoords]                     = useState({ x: 0, y: 0 });

  const canvasRef    = useRef<CanvasHandle>(null);
  const currentImage = images[currentIndex];

  function addImages(entries: ImageEntry[]) {
    setImages(prev => {
      if (prev.length === 0) setCurrentIndex(0);
      return [...prev, ...entries];
    });
  }

  // Persist blob URL resolved by LazyThumbnail back into the images array.
  function onSrcResolved(id: string, src: string) {
    setImages(prev => prev.map(img => img.id === id ? { ...img, src } : img));
  }

  // When navigating to an image that hasn't loaded its src yet, fetch it now
  // so AnnotationCanvas always receives a valid imageSrc.
  useEffect(() => {
    const img = images[currentIndex];
    if (!img || img.src || !img.filePath) return;
    loadImageSrc(img).then(src => {
      setImages(prev => prev.map((m, i) => i === currentIndex ? { ...m, src } : m));
    }).catch(() => {});
  }, [currentIndex, images[currentIndex]?.src]);

  function updateAnnotations(anns: BBox[]) {
    setImages(prev => prev.map((img, i) => i === currentIndex ? { ...img, annotations: anns } : img));
  }

  function navigate(delta: number) {
    setSelectedId(null);
    setCurrentIndex(prev => Math.max(0, Math.min(images.length - 1, prev + delta)));
  }

  // A / D / H / B / P / F keyboard shortcuts
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "a" || e.key === "A") navigate(-1);
      if (e.key === "d" || e.key === "D") navigate(1);
      if (e.key === "h" || e.key === "H") setTool("hand");
      if (e.key === "b" || e.key === "B") setTool("box");
      if (e.key === "p" || e.key === "P") setTool("polygon");
      if (e.key === "f" || e.key === "F") canvasRef.current?.fitImage();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [images.length]);

  const annotatedCount = images.filter(i => i.annotations.length > 0).length;

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

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>

      {/* Top bar */}
      <div style={{
        height: 44, display: "flex", alignItems: "center",
        padding: "0 16px", gap: 12, flexShrink: 0,
        borderBottom: "1px solid var(--border)",
        background: "var(--surface)",
      }}>
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Projects</span>
        <ChevronRight size={12} color="var(--border)" />
        <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text)" }}>AUTONOMOUS_DRIVE_V4</span>
        <div style={{ width: 1, height: 16, background: "var(--border)" }} />
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
          {images.length > 0 ? `${currentIndex + 1} / ${images.length}` : "No images"}
        </span>
        {images.length > 0 && (
          <span style={{ fontSize: 11, color: "var(--text-muted)", opacity: 0.6 }}>A · D to navigate</span>
        )}
        <div style={{ flex: 1 }} />
        {images.length > 0 && (
          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
            {annotatedCount}/{images.length} annotated
          </span>
        )}
        <button
          disabled={images.length === 0}
          style={{
            padding: "6px 14px", borderRadius: 6, border: "none",
            background: images.length > 0 ? "var(--accent)" : "var(--border)",
            color: images.length > 0 ? "#fff" : "var(--text-muted)",
            fontSize: 12, fontWeight: 600,
            cursor: images.length > 0 ? "pointer" : "not-allowed",
            fontFamily: "inherit",
          }}
        >
          Commit Annotations
        </button>
      </div>

      {/* Main area */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        <ImageList
          images={images}
          currentIndex={currentIndex}
          onSelect={i => { setSelectedId(null); setCurrentIndex(i); }}
          onAddImages={addImages}
          onSrcResolved={onSrcResolved}
        />

        {/* Canvas area — upload zone when empty, canvas when images loaded */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {images.length === 0 ? (
            <UploadZone onLoad={addImages} />
          ) : (
            <>
              <AnnotationCanvas
                ref={canvasRef}
                tool={tool}
                classes={classes}
                activeClassIndex={activeClassIndex}
                annotations={currentImage.annotations}
                selectedId={selectedId}
                imageSrc={currentImage.src}
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
                {/* zoom + coords on the left */}
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

                {/* image name on the right */}
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
          onClassesChange={setClasses}
          onActiveClassChange={setActiveClassIndex}
          onSelectAnnotation={setSelectedId}
          onDeleteAnnotation={id => {
            if (!currentImage) return;
            updateAnnotations(currentImage.annotations.filter(a => a.id !== id));
            if (selectedId === id) setSelectedId(null);
          }}
        />
      </div>
    </div>
  );
}
