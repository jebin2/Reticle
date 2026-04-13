import { useState, useEffect, useRef } from "react";
import { type BBox, type ClassDef, type ImageEntry } from "./annotationTypes";
import { type Asset } from "./types";
import { loadImageSrc } from "./imageLoader";
import { getRPC } from "./rpc";
import { CLASS_COLORS } from "./constants";

export function useAnnotationData(asset: Asset, onAssetUpdate: (updated: Asset) => void) {
  const [images, setImages]                     = useState<ImageEntry[]>([]);
  const [currentIndex, setCurrentIndex]         = useState(0);
  const [classes, setClasses]                   = useState<ClassDef[]>([]);
  const [canvasSrc, setCanvasSrc]               = useState("");
  const [importProgress, setImportProgress]     = useState<{ done: number; total: number } | null>(null);
  const [showClassSetup, setShowClassSetup]     = useState(false);

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

  function scheduleSave() {
    if (!loadedRef.current) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveNow(imagesRef.current, classesRef.current);
    }, 200);
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
    if (img.src)       { setCanvasSrc(img.src); canvasSrcRef.current = img.src; return; }
    if (!img.filePath) return;

    let canceled = false;
    loadImageSrc(img).then(src => {
      if (canceled) { URL.revokeObjectURL(src); return; }
      canvasSrcRef.current = src;
      setCanvasSrc(src);
    }).catch(() => {});
    return () => { canceled = true; };
  }, [currentIndex, images[currentIndex]?.id]);

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

  function updateAnnotations(anns: BBox[]) {
    setImages(prev => prev.map((img, i) => i === currentIndex ? { ...img, annotations: anns } : img));
    scheduleSave();
  }

  function handleClassesChange(newClasses: ClassDef[]) {
    setClasses(newClasses);
    scheduleSave();
  }

  function flushAndUpdate() {
    saveNow(images, classes);
    onAssetUpdate({
      ...asset,
      imageCount:     images.length,
      annotatedCount: images.filter(i => i.annotations.length > 0).length,
      classes:        classes.map(c => c.name),
      hasPolygons:    images.some(i => i.annotations.some(a => a.points && a.points.length >= 3)),
      updatedAt:      "just now",
    });
  }

  return {
    images, setImages,
    currentIndex, setCurrentIndex,
    classes,
    canvasSrc,
    importProgress,
    showClassSetup, setShowClassSetup,
    addImages,
    updateAnnotations,
    handleClassesChange,
    scheduleSave,
    flushAndUpdate,
  };
}
