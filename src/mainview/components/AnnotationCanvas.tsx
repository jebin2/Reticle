import { useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from "react";
import { type BBox, type ClassDef, type AnnotateTool } from "../lib/annotationTypes";

interface Props {
  tool: AnnotateTool;
  classes: ClassDef[];
  activeClassIndex: number;
  annotations: BBox[];
  selectedId: string | null;
  imageSrc: string | null;
  onAnnotationsChange: (anns: BBox[]) => void;
  onSelect: (id: string | null) => void;
  onZoomChange: (z: number) => void;
  onCoordsChange: (x: number, y: number) => void;
}

export interface CanvasHandle {
  fitImage: () => void;
  zoomIn:   () => void;
  zoomOut:  () => void;
}

const HANDLE_RADIUS = 6;
const MIN_BOX_PX    = 10;

const AnnotationCanvas = forwardRef<CanvasHandle, Props>(function AnnotationCanvas(
  { tool, classes, activeClassIndex, annotations, selectedId, imageSrc,
    onAnnotationsChange, onSelect, onZoomChange, onCoordsChange },
  ref,
) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const imageRef   = useRef<HTMLImageElement | null>(null);
  const imgSizeRef = useRef({ w: 640, h: 480 });
  const didFitRef  = useRef(false);

  const scaleRef  = useRef(1);
  const offsetRef = useRef({ x: 0, y: 0 });

  // drawing (box tool)
  const isDrawingRef = useRef(false);
  const drawStartRef = useRef({ x: 0, y: 0 });
  const drawEndRef   = useRef({ x: 0, y: 0 });

  // hand tool drag state
  const dragModeRef      = useRef<"none" | "pan" | "move" | "resize">("none");
  const dragStartPosRef  = useRef({ x: 0, y: 0 });
  const dragAnnIdRef     = useRef<string | null>(null);
  const dragAnnOrigRef   = useRef<BBox | null>(null);
  const resizeCornerRef  = useRef<number>(0);
  const previewAnnRef    = useRef<BBox | null>(null);

  const spaceDownRef = useRef(false);

  // stable prop refs
  const annotationsRef      = useRef(annotations);
  const selectedIdRef       = useRef(selectedId);
  const toolRef             = useRef(tool);
  const classesRef          = useRef(classes);
  const activeClassIndexRef = useRef(activeClassIndex);
  const onZoomChangeRef     = useRef(onZoomChange);

  annotationsRef.current      = annotations;
  selectedIdRef.current       = selectedId;
  toolRef.current             = tool;
  classesRef.current          = classes;
  activeClassIndexRef.current = activeClassIndex;
  onZoomChangeRef.current     = onZoomChange;

  // ── coordinate helpers ───────────────────────────────────────────────────────

  function canvasPos(e: MouseEvent) {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function canvasToImage(cx: number, cy: number) {
    return {
      x: (cx - offsetRef.current.x) / scaleRef.current,
      y: (cy - offsetRef.current.y) / scaleRef.current,
    };
  }

  function yoloToCanvas(cx: number, cy: number, w: number, h: number) {
    const { w: iw, h: ih } = imgSizeRef.current;
    const sc = scaleRef.current;
    const { x: ox, y: oy } = offsetRef.current;
    return {
      x: (cx - w / 2) * iw * sc + ox,
      y: (cy - h / 2) * ih * sc + oy,
      w: w * iw * sc,
      h: h * ih * sc,
    };
  }

  function imageToYolo(ix: number, iy: number, iw2: number, ih2: number) {
    const { w: iw, h: ih } = imgSizeRef.current;
    return {
      cx: (ix + iw2 / 2) / iw,
      cy: (iy + ih2 / 2) / ih,
      w:  iw2 / iw,
      h:  ih2 / ih,
    };
  }

  const clamp = (v: number) => Math.max(0, Math.min(1, v));

  // ── hit testing ──────────────────────────────────────────────────────────────

  // Returns corner index 0=TL 1=TR 2=BL 3=BR, or -1
  function hitCorner(pos: { x: number; y: number }, ann: BBox): number {
    const r = yoloToCanvas(ann.cx, ann.cy, ann.w, ann.h);
    const corners = [
      { x: r.x,       y: r.y       },
      { x: r.x + r.w, y: r.y       },
      { x: r.x,       y: r.y + r.h },
      { x: r.x + r.w, y: r.y + r.h },
    ];
    for (let i = 0; i < corners.length; i++) {
      const dx = pos.x - corners[i].x;
      const dy = pos.y - corners[i].y;
      if (Math.sqrt(dx * dx + dy * dy) <= HANDLE_RADIUS + 2) return i;
    }
    return -1;
  }

  function hitBox(pos: { x: number; y: number }, ann: BBox): boolean {
    const r = yoloToCanvas(ann.cx, ann.cy, ann.w, ann.h);
    return pos.x >= r.x && pos.x <= r.x + r.w && pos.y >= r.y && pos.y <= r.y + r.h;
  }

  // ── redraw ───────────────────────────────────────────────────────────────────

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const { width: cw, height: ch } = canvas;

    ctx.clearRect(0, 0, cw, ch);
    ctx.fillStyle = "#111111";
    ctx.fillRect(0, 0, cw, ch);

    const img = imageRef.current;
    const { w: iw, h: ih } = imgSizeRef.current;
    const sc = scaleRef.current;
    const { x: ox, y: oy } = offsetRef.current;

    if (img) ctx.drawImage(img, ox, oy, iw * sc, ih * sc);

    const anns    = annotationsRef.current;
    const cls     = classesRef.current;
    const preview = previewAnnRef.current;
    const selId   = selectedIdRef.current;

    for (const ann of anns) {
      const display = (preview && ann.id === preview.id) ? preview : ann;
      const color   = cls[display.classIndex]?.color ?? "#3B82F6";
      const label   = cls[display.classIndex]?.name  ?? "?";
      const rect    = yoloToCanvas(display.cx, display.cy, display.w, display.h);
      drawBox(ctx, rect, color, label, display.id === selId);
    }

    // box draw preview
    if (isDrawingRef.current) {
      const s = drawStartRef.current;
      const e = drawEndRef.current;
      const color = cls[activeClassIndexRef.current]?.color ?? "#3B82F6";
      const rx = Math.min(s.x, e.x), ry = Math.min(s.y, e.y);
      const rw = Math.abs(e.x - s.x), rh = Math.abs(e.y - s.y);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(rx, ry, rw, rh);
      ctx.fillStyle = color + "18";
      ctx.fillRect(rx, ry, rw, rh);
      ctx.setLineDash([]);
    }
  }, []);

  function drawBox(
    ctx: CanvasRenderingContext2D,
    rect: { x: number; y: number; w: number; h: number },
    color: string,
    label: string,
    isSelected: boolean,
  ) {
    const { x, y, w, h } = rect;

    ctx.fillStyle = color + "18";
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = color;
    ctx.lineWidth = isSelected ? 2 : 1.5;
    ctx.setLineDash([]);
    ctx.strokeRect(x, y, w, h);

    // label pill
    ctx.font = "bold 11px Inter, system-ui, sans-serif";
    const pillW = ctx.measureText(label).width + 12;
    const pillH = 18;
    const px = x;
    const py = y - pillH - 2 < 0 ? y + 2 : y - pillH - 2;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(px, py, pillW, pillH, 3);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.fillText(label, px + 6, py + 12);

    // corner handles when selected
    if (isSelected) {
      const corners = [
        { x, y }, { x: x + w, y },
        { x, y: y + h }, { x: x + w, y: y + h },
      ];
      for (const c of corners) {
        ctx.beginPath();
        ctx.arc(c.x, c.y, HANDLE_RADIUS, 0, Math.PI * 2);
        ctx.fillStyle = "#fff";
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
  }

  // ── fit / zoom ───────────────────────────────────────────────────────────────

  function fitImage() {
    const canvas = canvasRef.current;
    if (!canvas || !imageRef.current) return;
    const { width: cw, height: ch } = canvas;
    if (cw === 0 || ch === 0) { requestAnimationFrame(fitImage); return; }
    const { w: iw, h: ih } = imgSizeRef.current;
    const sc = Math.min((cw / iw) * 0.9, (ch / ih) * 0.9);
    scaleRef.current  = sc;
    offsetRef.current = { x: (cw - iw * sc) / 2, y: (ch - ih * sc) / 2 };
    onZoomChangeRef.current(Math.round(sc * 100));
    redraw();
  }

  function applyZoom(factor: number) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const cx = canvas.width / 2, cy = canvas.height / 2;
    const ns = Math.max(0.1, Math.min(10, scaleRef.current * factor));
    offsetRef.current = {
      x: cx - (cx - offsetRef.current.x) * (ns / scaleRef.current),
      y: cy - (cy - offsetRef.current.y) * (ns / scaleRef.current),
    };
    scaleRef.current = ns;
    onZoomChangeRef.current(Math.round(ns * 100));
    redraw();
  }

  useImperativeHandle(ref, () => ({
    fitImage,
    zoomIn:  () => applyZoom(1.25),
    zoomOut: () => applyZoom(1 / 1.25),
  }));

  // ── resize observer ──────────────────────────────────────────────────────────

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const obs = new ResizeObserver(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width  = wrapper.clientWidth;
      canvas.height = wrapper.clientHeight;
      if (imageRef.current && !didFitRef.current) {
        fitImage();
        didFitRef.current = true;
      }
      redraw();
    });
    obs.observe(wrapper);
    return () => obs.disconnect();
  }, [redraw]);

  // ── load image ───────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!imageSrc) { imageRef.current = null; redraw(); return; }
    didFitRef.current = false;
    const canvas  = canvasRef.current;
    const wrapper = wrapperRef.current;
    if (canvas && wrapper && wrapper.clientWidth > 0) {
      canvas.width  = wrapper.clientWidth;
      canvas.height = wrapper.clientHeight;
    }
    const img = new Image();
    img.onload = () => {
      imageRef.current   = img;
      imgSizeRef.current = { w: img.naturalWidth, h: img.naturalHeight };
      fitImage();
      didFitRef.current = true;
    };
    img.src = imageSrc;
  }, [imageSrc, redraw]);

  useEffect(() => { redraw(); }, [annotations, selectedId, redraw]);

  // ── keyboard ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.code === "Space") { spaceDownRef.current = true; e.preventDefault(); }
      if (e.key === "Escape") { isDrawingRef.current = false; previewAnnRef.current = null; redraw(); }
      if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedIdRef.current) {
          onAnnotationsChange(annotationsRef.current.filter(a => a.id !== selectedIdRef.current));
          onSelect(null);
        }
      }
    }
    function onKeyUp(e: KeyboardEvent) {
      if (e.code === "Space") spaceDownRef.current = false;
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [redraw, onAnnotationsChange, onSelect]);

  // ── mouse events ─────────────────────────────────────────────────────────────

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    function getHandCursor(pos: { x: number; y: number }): string {
      const anns  = annotationsRef.current;
      const selId = selectedIdRef.current;
      const selAnn = anns.find(a => a.id === selId);

      if (selAnn) {
        const corner = hitCorner(pos, selAnn);
        if (corner === 0 || corner === 3) return "nwse-resize";
        if (corner === 1 || corner === 2) return "nesw-resize";
        if (hitBox(pos, selAnn)) return "move";
      }
      for (let i = anns.length - 1; i >= 0; i--) {
        if (hitBox(pos, anns[i])) return "pointer";
      }
      return "grab";
    }

    function updateCursor(pos?: { x: number; y: number }) {
      const t = toolRef.current;
      if (t === "box" || t === "polygon") { canvas.style.cursor = "crosshair"; return; }
      if (t === "hand") {
        canvas.style.cursor = pos ? getHandCursor(pos) : "grab";
        return;
      }
      canvas.style.cursor = "default";
    }

    function onMouseDown(e: MouseEvent) {
      const pos = canvasPos(e);

      // middle mouse or space → pan always
      if (e.button === 1 || spaceDownRef.current) {
        dragModeRef.current = "pan";
        dragStartPosRef.current = pos;
        canvas.style.cursor = "grabbing";
        return;
      }

      if (toolRef.current === "hand") {
        const anns  = annotationsRef.current;
        const selId = selectedIdRef.current;
        const selAnn = anns.find(a => a.id === selId);

        // check selected ann corners first
        if (selAnn) {
          const corner = hitCorner(pos, selAnn);
          if (corner !== -1) {
            dragModeRef.current    = "resize";
            dragStartPosRef.current = pos;
            dragAnnIdRef.current   = selAnn.id;
            dragAnnOrigRef.current = { ...selAnn };
            resizeCornerRef.current = corner;
            canvas.style.cursor = (corner === 0 || corner === 3) ? "nwse-resize" : "nesw-resize";
            return;
          }
        }

        // check all boxes for move
        for (let i = anns.length - 1; i >= 0; i--) {
          if (hitBox(pos, anns[i])) {
            onSelect(anns[i].id);
            dragModeRef.current    = "move";
            dragStartPosRef.current = pos;
            dragAnnIdRef.current   = anns[i].id;
            dragAnnOrigRef.current = { ...anns[i] };
            canvas.style.cursor = "move";
            return;
          }
        }

        // empty space → pan
        onSelect(null);
        dragModeRef.current = "pan";
        dragStartPosRef.current = pos;
        canvas.style.cursor = "grabbing";
        return;
      }

      if (toolRef.current === "box") {
        isDrawingRef.current = true;
        drawStartRef.current = pos;
        drawEndRef.current   = pos;
      }
    }

    function onMouseMove(e: MouseEvent) {
      const pos = canvasPos(e);
      const imgPos = canvasToImage(pos.x, pos.y);
      onCoordsChange(Math.round(imgPos.x), Math.round(imgPos.y));

      // pan
      if (dragModeRef.current === "pan") {
        const dx = pos.x - dragStartPosRef.current.x;
        const dy = pos.y - dragStartPosRef.current.y;
        offsetRef.current = { x: offsetRef.current.x + dx, y: offsetRef.current.y + dy };
        dragStartPosRef.current = pos;
        redraw();
        return;
      }

      // move
      if (dragModeRef.current === "move") {
        const orig = dragAnnOrigRef.current!;
        const startImg = canvasToImage(dragStartPosRef.current.x, dragStartPosRef.current.y);
        const currImg  = canvasToImage(pos.x, pos.y);
        const { w: iw, h: ih } = imgSizeRef.current;
        const dxN = (currImg.x - startImg.x) / iw;
        const dyN = (currImg.y - startImg.y) / ih;
        previewAnnRef.current = {
          ...orig,
          cx: clamp(orig.cx + dxN),
          cy: clamp(orig.cy + dyN),
        };
        redraw();
        return;
      }

      // resize
      if (dragModeRef.current === "resize") {
        const orig = dragAnnOrigRef.current!;
        const { w: iw, h: ih } = imgSizeRef.current;
        const imgCurr = canvasToImage(pos.x, pos.y);

        const origL = (orig.cx - orig.w / 2) * iw;
        const origR = (orig.cx + orig.w / 2) * iw;
        const origT = (orig.cy - orig.h / 2) * ih;
        const origB = (orig.cy + orig.h / 2) * ih;

        let l = origL, r = origR, t = origT, b = origB;
        const c = resizeCornerRef.current;
        if (c === 0) { l = imgCurr.x; t = imgCurr.y; }
        if (c === 1) { r = imgCurr.x; t = imgCurr.y; }
        if (c === 2) { l = imgCurr.x; b = imgCurr.y; }
        if (c === 3) { r = imgCurr.x; b = imgCurr.y; }

        // min size
        if (r - l < MIN_BOX_PX) { if (c === 0 || c === 2) l = r - MIN_BOX_PX; else r = l + MIN_BOX_PX; }
        if (b - t < MIN_BOX_PX) { if (c === 0 || c === 1) t = b - MIN_BOX_PX; else b = t + MIN_BOX_PX; }

        previewAnnRef.current = {
          ...orig,
          cx: clamp((l + r) / 2 / iw),
          cy: clamp((t + b) / 2 / ih),
          w:  clamp((r - l) / iw),
          h:  clamp((b - t) / ih),
        };
        redraw();
        return;
      }

      // box drawing
      if (isDrawingRef.current) {
        drawEndRef.current = pos;
        redraw();
        return;
      }

      // hover cursor update for hand tool
      if (toolRef.current === "hand") updateCursor(pos);
    }

    function onMouseUp(e: MouseEvent) {
      // commit move / resize
      if (dragModeRef.current === "move" || dragModeRef.current === "resize") {
        const preview = previewAnnRef.current;
        if (preview) {
          onAnnotationsChange(
            annotationsRef.current.map(a => a.id === preview.id ? preview : a)
          );
          previewAnnRef.current = null;
        }
        dragModeRef.current = "none";
        dragAnnIdRef.current = null;
        dragAnnOrigRef.current = null;
        updateCursor(canvasPos(e));
        return;
      }

      if (dragModeRef.current === "pan") {
        dragModeRef.current = "none";
        updateCursor(canvasPos(e));
        return;
      }

      // commit box draw
      if (isDrawingRef.current && toolRef.current === "box") {
        isDrawingRef.current = false;
        const s   = drawStartRef.current;
        const end = canvasPos(e);
        if (Math.abs(end.x - s.x) > 8 && Math.abs(end.y - s.y) > 8) {
          const si   = canvasToImage(s.x, s.y);
          const ei   = canvasToImage(end.x, end.y);
          const yolo = imageToYolo(
            Math.min(si.x, ei.x), Math.min(si.y, ei.y),
            Math.abs(ei.x - si.x), Math.abs(ei.y - si.y),
          );
          const newAnn: BBox = {
            id: crypto.randomUUID(),
            classIndex: activeClassIndexRef.current,
            cx: clamp(yolo.cx), cy: clamp(yolo.cy),
            w:  clamp(yolo.w),  h:  clamp(yolo.h),
          };
          onAnnotationsChange([...annotationsRef.current, newAnn]);
          onSelect(newAnn.id);
        }
        redraw();
      }
    }

    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const pos    = canvasPos(e);
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      const ns     = Math.max(0.1, Math.min(10, scaleRef.current * factor));
      offsetRef.current = {
        x: pos.x - (pos.x - offsetRef.current.x) * (ns / scaleRef.current),
        y: pos.y - (pos.y - offsetRef.current.y) * (ns / scaleRef.current),
      };
      scaleRef.current = ns;
      onZoomChangeRef.current(Math.round(ns * 100));
      redraw();
    }

    updateCursor();
    canvas.addEventListener("mousedown", onMouseDown);
    canvas.addEventListener("mousemove", onMouseMove);
    canvas.addEventListener("mouseup",   onMouseUp);
    canvas.addEventListener("wheel",     onWheel, { passive: false });
    return () => {
      canvas.removeEventListener("mousedown", onMouseDown);
      canvas.removeEventListener("mousemove", onMouseMove);
      canvas.removeEventListener("mouseup",   onMouseUp);
      canvas.removeEventListener("wheel",     onWheel);
    };
  }, [redraw, onAnnotationsChange, onSelect, onCoordsChange, tool]);

  return (
    <div ref={wrapperRef} style={{ flex: 1, overflow: "hidden", background: "#111" }}>
      <canvas ref={canvasRef} style={{ display: "block", width: "100%", height: "100%" }} />
    </div>
  );
});

export default AnnotationCanvas;
