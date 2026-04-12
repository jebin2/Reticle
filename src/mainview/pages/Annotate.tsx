import { useState, useEffect, useRef, useMemo } from "react";
import {
  ChevronLeft, ChevronRight, SkipForward,
  Maximize2, Hand, Square, Lasso, ZoomIn, ZoomOut, Trash2,
} from "lucide-react";
import DetailPageHeader from "../components/DetailPageHeader";
import AnnotationCanvas, { type CanvasHandle } from "../components/AnnotationCanvas";
import ImageList from "../components/ImageList";
import ClassPanel from "../components/ClassPanel";
import UploadZone from "../components/UploadZone";
import { type BBox, type ClassDef, type AnnotateTool, type ImageEntry, bboxToPoints } from "../lib/annotationTypes";
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
  const [importProgress, setImportProgress]     = useState<{ done: number; total: number } | null>(null);
  const [showClassSetup, setShowClassSetup]     = useState(false);

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

  // Force-save and sync asset state on unmount (covers navigating away via sidebar).
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      if (loadedRef.current) {
        saveNow(imagesRef.current, classesRef.current);
        onAssetUpdate({
          ...asset,
          imageCount:     imagesRef.current.length,
          annotatedCount: imagesRef.current.filter(i => i.annotations.length > 0).length,
          classes:        classesRef.current.map(c => c.name),
          hasPolygons:    imagesRef.current.some(i => i.annotations.some(a => a.points && a.points.length >= 3)),
          updatedAt:      "just now",
        });
      }
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
          points:     a.points,
        })),
      }));
      setImages(entries);
      const loaded = data.classes.map((name, i) => ({
        name,
        color: CLASS_COLORS[i % CLASS_COLORS.length],
      }));
      setClasses(loaded);
      if (loaded.length === 0) setShowClassSetup(true);
      loadedRef.current = true;
    }).catch(() => {
      setShowClassSetup(true);
      loadedRef.current = true;
    });
  }, [asset.id]);

  function saveNow(imgs: ImageEntry[], cls: ClassDef[]) {
    const labels: Record<string, Array<{ classIndex: number; cx: number; cy: number; w: number; h: number; points?: Array<{ x: number; y: number }> }>> = {};
    for (const img of imgs) {
      labels[img.filename] = img.annotations.map(({ classIndex, cx, cy, w, h, points }) => ({ classIndex, cx, cy, w, h, points }));
    }
    getRPC().request.saveAnnotations({
      storagePath: asset.storagePath,
      labels,
      classes: cls.map(c => c.name),
    }).catch(err => console.error("Failed to save annotations:", err));
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

  // Copy images into storagePath/images/ in batches, reporting progress.
  async function addImages(entries: ImageEntry[]) {
    const BATCH = 20;
    setImportProgress({ done: 0, total: entries.length });
    const allImported: Array<{ filename: string; filePath: string }> = [];
    try {
      for (let i = 0; i < entries.length; i += BATCH) {
        const batch = entries.slice(i, i + BATCH);
        const files = batch.map(e => ({
          filename:   e.filename,
          sourcePath: e.filePath,
          dataUrl:    !e.filePath ? e.src : undefined,
        }));
        const { images: imported } = await getRPC().request.importImages({
          storagePath: asset.storagePath, files,
        });
        allImported.push(...imported);
        setImportProgress({ done: Math.min(i + BATCH, entries.length), total: entries.length });
      }
    } catch (err) {
      console.error("Failed to import images:", err);
    } finally {
      setImportProgress(null);
    }
    if (allImported.length === 0) return;
    const newEntries: ImageEntry[] = entries.slice(0, allImported.length).map((entry, i) => ({
      ...entry,
      src:      "",
      filename: allImported[i]?.filename ?? entry.filename,
      filePath: allImported[i]?.filePath ?? entry.filePath,
    }));
    setImages(prev => {
      const existing = new Set(prev.map(img => img.filename));
      const toAdd = newEntries.filter(e => !existing.has(e.filename));
      return toAdd.length > 0 ? [...prev, ...toAdd] : prev;
    });
    scheduleSave();
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
  }, [currentIndex, images[currentIndex]?.id]);

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
  }, [images.length, currentIndex]);

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
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", position: "relative" }}>

      {/* Top bar */}
      <DetailPageHeader
        onBack={() => {
          saveNow(images, classes);
          onAssetUpdate({
            ...asset,
            imageCount:     images.length,
            annotatedCount: images.filter(i => i.annotations.length > 0).length,
            classes:        classes.map(c => c.name),
            hasPolygons:    images.some(i => i.annotations.some(a => a.points && a.points.length >= 3)),
            updatedAt:      "just now",
          });
          onBack();
        }}
        backLabel="Assets"
        title={asset.name}
        meta={
          <span style={{ fontSize: 12, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 12 }}>
            {images.length > 0 ? `${currentIndex + 1} / ${images.length}` : "No images"}
            {images.length > 0 && (
              <span style={{ opacity: 0.6, fontSize: 11 }}>A · D to navigate</span>
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
            setClasses(newClasses);
            setShowClassSetup(false);
            scheduleSave();
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
