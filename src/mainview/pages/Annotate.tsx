import { useState, useEffect, useRef, useMemo } from "react";
import {
  ChevronLeft, ChevronRight, SkipForward,
  Maximize2, Hand, Square, Lasso, ZoomIn, ZoomOut, Trash2, ArrowLeft,
} from "lucide-react";
import AnnotationCanvas, { type CanvasHandle } from "../components/AnnotationCanvas";
import ImageList from "../components/ImageList";
import ClassPanel from "../components/ClassPanel";
import UploadZone from "../components/UploadZone";
import { type BBox, type ClassDef, type AnnotateTool, type ImageEntry } from "../lib/annotationTypes";
import { type Asset } from "../lib/types";
import { loadImageSrc } from "../lib/imageLoader";
import { getRPC } from "../lib/rpc";
import { CLASS_COLORS } from "../lib/constants";

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

interface Props {
  asset: Asset;
  onAssetUpdate: (updated: Asset) => void;
  onBack: () => void;
}

export default function Annotate({ asset, onAssetUpdate, onBack }: Props) {
  const [images, setImages]                     = useState<ImageEntry[]>([]);
  const [currentIndex, setCurrentIndex]         = useState(0);
  const [classes, setClasses]                   = useState<ClassDef[]>([]);
  const [activeClassIndex, setActiveClassIndex] = useState(0);
  const [tool, setTool]                         = useState<AnnotateTool>("hand");
  const [selectedId, setSelectedId]             = useState<string | null>(null);
  const [zoom, setZoom]                         = useState(100);
  const [coords, setCoords]                     = useState({ x: 0, y: 0 });
  const [canvasSrc, setCanvasSrc]               = useState("");

  const canvasRef    = useRef<CanvasHandle>(null);
  const currentImage = images[currentIndex];

  // Keep latest images/classes accessible in debounced save without stale closures.
  const imagesRef  = useRef(images);
  const classesRef = useRef(classes);
  imagesRef.current  = images;
  classesRef.current = classes;

  // Prevents saving before the initial load completes.
  const loadedRef    = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Tracks the current canvas blob URL so we can revoke it when navigating away.
  const canvasSrcRef = useRef("");

  // Clear pending save and revoke canvas blob URL on unmount.
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      if (canvasSrcRef.current.startsWith("blob:")) URL.revokeObjectURL(canvasSrcRef.current);
    };
  }, []);

  // ── persistence ───────────────────────────────────────────────────────────

  // Load images, labels, and classes from the asset's storagePath on open.
  useEffect(() => {
    loadedRef.current = false;
    setImages([]);
    setClasses([]);
    setCurrentIndex(0);

    getRPC().request.loadAssetData({ storagePath: asset.storagePath }).then(data => {
      const entries: ImageEntry[] = data.images.map(img => ({
        id:          crypto.randomUUID(),
        filename:    img.filename,
        src:         "",
        filePath:    img.filePath,
        annotations: (data.labels[img.filename] ?? []).map(a => ({
          id:         crypto.randomUUID(),
          classIndex: a.classIndex,
          cx:         a.cx,
          cy:         a.cy,
          w:          a.w,
          h:          a.h,
        })),
      }));
      setImages(entries);
      setClasses(data.classes.map((name, i) => ({
        name,
        color: CLASS_COLORS[i % CLASS_COLORS.length],
      })));
      loadedRef.current = true;
    }).catch(() => {
      loadedRef.current = true;
    });
  }, [asset.id]);

  function saveNow(imgs: ImageEntry[], cls: ClassDef[]) {
    const labels: Record<string, Array<{ classIndex: number; cx: number; cy: number; w: number; h: number }>> = {};
    for (const img of imgs) {
      labels[img.filename] = img.annotations.map(({ classIndex, cx, cy, w, h }) => ({ classIndex, cx, cy, w, h }));
    }
    getRPC().request.saveAnnotations({
      storagePath: asset.storagePath,
      labels,
      classes: cls.map(c => c.name),
    }).catch(() => {});
  }

  // Schedule a debounced save (200 ms). Uses refs so the timeout always sees
  // the latest images/classes regardless of when it fires.
  function scheduleSave() {
    if (!loadedRef.current) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveNow(imagesRef.current, classesRef.current);
    }, 200);
  }

  // ── image loading ─────────────────────────────────────────────────────────

  // Copy images into storagePath/images/ then add them to the list.
  function addImages(entries: ImageEntry[]) {
    const files = entries.map(e => ({
      filename:   e.filename,
      sourcePath: e.filePath,
      dataUrl:    !e.filePath ? e.src : undefined,
    }));
    getRPC().request.importImages({ storagePath: asset.storagePath, files })
      .then(({ images: imported }) => {
        const newEntries: ImageEntry[] = entries.map((entry, i) => ({
          ...entry,
          src:      "",   // image is now on disk — thumbnail fetches via IntersectionObserver
          filename: imported[i]?.filename ?? entry.filename,
          filePath: imported[i]?.filePath ?? entry.filePath,
        }));
        setImages(prev => {
          const existing = new Set(prev.map(img => img.filename));
          const toAdd = newEntries.filter(e => !existing.has(e.filename));
          return toAdd.length > 0 ? [...prev, ...toAdd] : prev;
        });
        scheduleSave();
      })
      .catch(() => {
        setImages(prev => {
          const existing = new Set(prev.map(img => img.filename));
          const toAdd = entries.filter(e => !existing.has(e.filename));
          return toAdd.length > 0 ? [...prev, ...toAdd] : prev;
        });
      });
  }

  // Fetch the canvas image independently of thumbnails.
  // Revokes the previous blob URL before loading the next one.
  useEffect(() => {
    if (canvasSrcRef.current.startsWith("blob:")) {
      URL.revokeObjectURL(canvasSrcRef.current);
      canvasSrcRef.current = "";
    }

    const img = images[currentIndex];
    if (!img) { setCanvasSrc(""); return; }
    if (img.src)      { setCanvasSrc(img.src); canvasSrcRef.current = img.src; return; }
    if (!img.filePath) return;

    let canceled = false;
    loadImageSrc(img).then(src => {
      if (canceled) { URL.revokeObjectURL(src); return; }
      canvasSrcRef.current = src;
      setCanvasSrc(src);
    }).catch(() => {});
    return () => { canceled = true; };
  }, [currentIndex, images[currentIndex]?.filePath]);

  // ── annotations ───────────────────────────────────────────────────────────

  function updateAnnotations(anns: BBox[]) {
    setImages(prev => prev.map((img, i) => i === currentIndex ? { ...img, annotations: anns } : img));
    scheduleSave();
  }

  function handleClassesChange(newClasses: ClassDef[]) {
    setClasses(newClasses);
    scheduleSave();
  }

  // ── navigation ────────────────────────────────────────────────────────────

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

  // ── derived state ─────────────────────────────────────────────────────────

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
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>

      {/* Top bar */}
      <div style={{
        height: 44, display: "flex", alignItems: "center",
        padding: "0 16px", gap: 12, flexShrink: 0,
        borderBottom: "1px solid var(--border)",
        background: "var(--surface)",
      }}>
        <button
          onClick={() => {
            saveNow(images, classes);
            onAssetUpdate({
              ...asset,
              imageCount:     images.length,
              annotatedCount: images.filter(i => i.annotations.length > 0).length,
              classes:        classes.map(c => c.name),
              updatedAt:      "just now",
            });
          }}
          style={{
            display: "flex", alignItems: "center", gap: 4,
            background: "none", border: "none", cursor: "pointer",
            color: "var(--text-muted)", fontSize: 12, padding: 0, fontFamily: "inherit",
          }}
        >
          <ArrowLeft size={12} /> Assets
        </button>
        <ChevronRight size={12} color="var(--border)" />
        <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text)" }}>{asset.name}</span>
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
          onClick={() => saveNow(images, classes)}
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
        />
      </div>
    </div>
  );
}
