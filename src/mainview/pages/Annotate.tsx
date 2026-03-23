import { useState, useEffect, useRef } from "react";
import {
  ChevronLeft, ChevronRight, SkipForward,
  Maximize2, Hand, Square, Lasso, ZoomIn, ZoomOut, Trash2,
} from "lucide-react";
import AnnotationCanvas, { type CanvasHandle } from "../components/AnnotationCanvas";
import ImageList from "../components/ImageList";
import ClassPanel from "../components/ClassPanel";
import { type BBox, type ClassDef, type AnnotateTool, type ImageEntry } from "../lib/annotationTypes";
import { MOCK_IMAGES, MOCK_CLASSES } from "../lib/mockImages";

type ToolDef =
  | { id: AnnotateTool; Icon: React.ElementType; title: string; action?: never }
  | { action: "fit" | "zoomIn" | "zoomOut" | "delete"; Icon: React.ElementType; title: string; id?: never };

export default function Annotate() {
  const [images, setImages]                     = useState<ImageEntry[]>(MOCK_IMAGES);
  const [currentIndex, setCurrentIndex]         = useState(0);
  const [classes, setClasses]                   = useState<ClassDef[]>(MOCK_CLASSES);
  const [activeClassIndex, setActiveClassIndex] = useState(0);
  const [tool, setTool]                         = useState<AnnotateTool>("hand");
  const [selectedId, setSelectedId]             = useState<string | null>(null);
  const [zoom, setZoom]                         = useState(100);
  const [coords, setCoords]                     = useState({ x: 0, y: 0 });

  const canvasRef = useRef<CanvasHandle>(null);
  const currentImage = images[currentIndex];

  function updateAnnotations(anns: BBox[]) {
    setImages(prev => prev.map((img, i) => i === currentIndex ? { ...img, annotations: anns } : img));
  }

  function deleteSelected() {
    if (!selectedId) return;
    updateAnnotations(currentImage.annotations.filter(a => a.id !== selectedId));
    setSelectedId(null);
  }

  function navigate(delta: number) {
    setSelectedId(null);
    setCurrentIndex(prev => Math.max(0, Math.min(images.length - 1, prev + delta)));
  }

  // A / D keyboard navigation
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

  // ── toolbar definition ───────────────────────────────────────────────────────

  const TOOLBAR: (ToolDef | "divider")[] = [
    { action: "fit",     Icon: Maximize2,    title: "Fit to screen (F)" },
    "divider",
    { id: "hand",        Icon: Hand,         title: "Hand — select / move / resize (H)" },
    { id: "box",         Icon: Square,       title: "Bounding box (B)" },
    { id: "polygon",     Icon: Lasso,        title: "Segmentation (P)" },
    "divider",
    { action: "zoomIn",  Icon: ZoomIn,       title: "Zoom in" },
    { action: "zoomOut", Icon: ZoomOut,      title: "Zoom out" },
    "divider",
    { action: "delete",  Icon: Trash2,       title: "Delete selected (Del)" },
    "divider",
    { action: "prev",    Icon: ChevronLeft,  title: "Previous image (A)" } as any,
    { action: "next",    Icon: ChevronRight, title: "Next image (D)" } as any,
    { action: "skip",    Icon: SkipForward,  title: "Skip image" } as any,
  ];

  function handleToolbarClick(item: ToolDef) {
    if (item.id) { setTool(item.id); return; }
    switch (item.action) {
      case "fit":     canvasRef.current?.fitImage(); break;
      case "zoomIn":  canvasRef.current?.zoomIn(); break;
      case "zoomOut": canvasRef.current?.zoomOut(); break;
      case "delete":  deleteSelected(); break;
      case "prev":    navigate(-1); break;
      case "next":    navigate(1); break;
      case "skip":    navigate(1); break;
    }
  }

  function isActive(item: ToolDef): boolean {
    if (item.id) return item.id === tool;
    return false;
  }

  function isDisabled(item: ToolDef): boolean {
    if (item.action === "delete") return !selectedId;
    if ((item.action as any) === "prev") return currentIndex === 0;
    if ((item.action as any) === "next" || (item.action as any) === "skip")
      return currentIndex === images.length - 1;
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
          {currentIndex + 1} / {images.length}
        </span>
        <span style={{ fontSize: 11, color: "var(--text-muted)", opacity: 0.6 }}>A · D to navigate</span>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
          {annotatedCount}/{images.length} annotated
        </span>
        <button style={{
          padding: "6px 14px", borderRadius: 6, border: "none",
          background: "var(--accent)", color: "#fff",
          fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
        }}>
          Commit Annotations
        </button>
      </div>

      {/* Main area */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        <ImageList
          images={images}
          currentIndex={currentIndex}
          onSelect={i => { setSelectedId(null); setCurrentIndex(i); }}
        />

        {/* Canvas + bottom toolbar */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
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
            {/* zoom info on the left */}
            <span style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "monospace", marginRight: "auto" }}>
              {zoom}% · {coords.x}, {coords.y}
            </span>

            {TOOLBAR.map((item, i) => {
              if (item === "divider") {
                return <div key={i} style={{ width: 1, height: 20, background: "var(--border)", margin: "0 4px" }} />;
              }
              const active   = isActive(item as ToolDef);
              const disabled = isDisabled(item as ToolDef);
              const { Icon, title } = item as ToolDef;
              const isDanger = (item as any).action === "delete";
              return (
                <button
                  key={i}
                  title={title}
                  disabled={disabled}
                  onClick={() => handleToolbarClick(item as ToolDef)}
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
                  <Icon size={16} />
                </button>
              );
            })}

            {/* image name on the right */}
            <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: "auto", fontFamily: "monospace" }}>
              {currentImage.filename}
            </span>
          </div>
        </div>

        <ClassPanel
          classes={classes}
          activeClassIndex={activeClassIndex}
          annotations={currentImage.annotations}
          selectedId={selectedId}
          onClassesChange={setClasses}
          onActiveClassChange={setActiveClassIndex}
          onSelectAnnotation={setSelectedId}
          onDeleteAnnotation={id => {
            updateAnnotations(currentImage.annotations.filter(a => a.id !== id));
            if (selectedId === id) setSelectedId(null);
          }}
        />
      </div>
    </div>
  );
}
