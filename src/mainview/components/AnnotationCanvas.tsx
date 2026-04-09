import { useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from "react";
import { type BBox, type ClassDef, type AnnotateTool, clampBBox, clampPt, bboxToPoints, pointsToBbox } from "../lib/annotationTypes";

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

// ── constants ─────────────────────────────────────────────────────────────────

const HANDLE_RADIUS        = 6;
const MIN_BOX_PX           = 10;
const CANVAS_BG            = "#111111";
const ZOOM_MIN             = 0.1;
const ZOOM_MAX             = 10;
const ZOOM_WHEEL_IN        = 1.1;
const ZOOM_BTN             = 1.25;
const POLYGON_CLOSE_RADIUS = 12;

// ── pure utilities (no component state) ──────────────────────────────────────


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

function drawPolygon(
  ctx: CanvasRenderingContext2D,
  pts: Array<{ x: number; y: number }>,
  color: string,
  label: string,
  isSelected: boolean,
) {
  if (pts.length < 3) return;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
  ctx.fillStyle = color + "18";
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = isSelected ? 2 : 1.5;
  ctx.setLineDash([]);
  ctx.stroke();

  // label pill at top-left of bounding rect
  const minX = Math.min(...pts.map(p => p.x));
  const minY = Math.min(...pts.map(p => p.y));
  ctx.font = "bold 11px Inter, system-ui, sans-serif";
  const pillW = ctx.measureText(label).width + 12;
  const pillH = 18;
  const px = minX;
  const py = minY - pillH - 2 < 0 ? minY + 2 : minY - pillH - 2;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(px, py, pillW, pillH, 3);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.fillText(label, px + 6, py + 12);

  // vertex dots when selected
  if (isSelected) {
    for (const pt of pts) {
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = "#fff";
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }
}

function pointInPolygon(
  pos: { x: number; y: number },
  pts: Array<{ x: number; y: number }>,
): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].x, yi = pts[i].y;
    const xj = pts[j].x, yj = pts[j].y;
    if ((yi > pos.y) !== (yj > pos.y) &&
        pos.x < ((xj - xi) * (pos.y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

// ── component ─────────────────────────────────────────────────────────────────

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

  // box drawing state
  const isDrawingRef = useRef(false);
  const drawStartRef = useRef({ x: 0, y: 0 });
  const drawEndRef   = useRef({ x: 0, y: 0 });

  // hand tool drag state
  const dragModeRef     = useRef<"none" | "pan" | "move" | "resize" | "vertex">("none");
  const dragStartPosRef = useRef({ x: 0, y: 0 });
  const dragAnnIdRef    = useRef<string | null>(null);
  const dragAnnOrigRef  = useRef<BBox | null>(null);
  const resizeCornerRef   = useRef<number>(0);
  const dragVertexIndexRef = useRef<number>(-1);
  const previewAnnRef   = useRef<BBox | null>(null);

  const spaceDownRef = useRef(false);

  // polygon drawing state: points stored as normalized image coords [0,1]
  const polygonPointsRef = useRef<Array<{ x: number; y: number }>>([]);
  // current mouse position in canvas coords for the preview line
  const polygonMouseRef  = useRef<{ x: number; y: number } | null>(null);

  // ── stable prop refs (avoid re-attaching listeners on every parent render) ──
  const annotationsRef      = useRef(annotations);
  const selectedIdRef       = useRef(selectedId);
  const toolRef             = useRef(tool);
  const classesRef          = useRef(classes);
  const activeClassIndexRef = useRef(activeClassIndex);
  const onZoomChangeRef     = useRef(onZoomChange);
  const onAnnotationsChangeRef = useRef(onAnnotationsChange);
  const onSelectRef            = useRef(onSelect);
  const onCoordsChangeRef      = useRef(onCoordsChange);

  annotationsRef.current         = annotations;
  selectedIdRef.current          = selectedId;
  toolRef.current                = tool;
  classesRef.current             = classes;
  activeClassIndexRef.current    = activeClassIndex;
  onZoomChangeRef.current        = onZoomChange;
  onAnnotationsChangeRef.current = onAnnotationsChange;
  onSelectRef.current            = onSelect;
  onCoordsChangeRef.current      = onCoordsChange;

  // ── coordinate helpers ────────────────────────────────────────────────────

  function canvasPos(e: MouseEvent) {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function clampToImage(pos: { x: number; y: number }) {
    const { w: iw, h: ih } = imgSizeRef.current;
    const sc = scaleRef.current;
    const { x: ox, y: oy } = offsetRef.current;
    return {
      x: Math.max(ox, Math.min(ox + iw * sc, pos.x)),
      y: Math.max(oy, Math.min(oy + ih * sc, pos.y)),
    };
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

  // ── hit testing ───────────────────────────────────────────────────────────

  // Returns corner index: 0=TL 1=TR 2=BL 3=BR, or -1
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

  function hitAnnotation(pos: { x: number; y: number }, ann: BBox): boolean {
    if (ann.points && ann.points.length >= 3) {
      const { w: iw, h: ih } = imgSizeRef.current;
      const sc = scaleRef.current;
      const { x: ox, y: oy } = offsetRef.current;
      const canvasPts = ann.points.map(p => ({
        x: p.x * iw * sc + ox,
        y: p.y * ih * sc + oy,
      }));
      return pointInPolygon(pos, canvasPts);
    }
    return hitBox(pos, ann);
  }

  function hitVertex(pos: { x: number; y: number }, ann: BBox): number {
    if (!ann.points || ann.points.length < 3) return -1;
    const { w: iw, h: ih } = imgSizeRef.current;
    const sc = scaleRef.current;
    const { x: ox, y: oy } = offsetRef.current;
    for (let i = 0; i < ann.points.length; i++) {
      const vx = ann.points[i].x * iw * sc + ox;
      const vy = ann.points[i].y * ih * sc + oy;
      const dx = pos.x - vx, dy = pos.y - vy;
      if (Math.sqrt(dx * dx + dy * dy) <= HANDLE_RADIUS + 2) return i;
    }
    return -1;
  }

  function annToCanvasPts(ann: BBox): Array<{ x: number; y: number }> | null {
    if (!ann.points || ann.points.length < 3) return null;
    const { w: iw, h: ih } = imgSizeRef.current;
    const sc = scaleRef.current;
    const { x: ox, y: oy } = offsetRef.current;
    return ann.points.map(p => ({
      x: p.x * iw * sc + ox,
      y: p.y * ih * sc + oy,
    }));
  }

  // ── redraw ────────────────────────────────────────────────────────────────

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const { width: cw, height: ch } = canvas;

    ctx.clearRect(0, 0, cw, ch);
    ctx.fillStyle = CANVAS_BG;
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
      const canvasPts = annToCanvasPts(display);
      if (canvasPts) {
        drawPolygon(ctx, canvasPts, color, label, display.id === selId);
      } else {
        const rect = yoloToCanvas(display.cx, display.cy, display.w, display.h);
        drawBox(ctx, rect, color, label, display.id === selId);
      }
    }

    // in-progress polygon preview
    const polyPts = polygonPointsRef.current;
    if (polyPts.length > 0) {
      const color    = cls[activeClassIndexRef.current]?.color ?? "#3B82F6";
      const mouse    = polygonMouseRef.current;
      const canClose = polyPts.length >= 3;
      const canvasPts = polyPts.map(p => ({
        x: p.x * iw * sc + ox,
        y: p.y * ih * sc + oy,
      }));
      const isHoverClose = canClose && mouse !== null &&
        Math.sqrt((mouse.x - canvasPts[0].x) ** 2 + (mouse.y - canvasPts[0].y) ** 2) <= POLYGON_CLOSE_RADIUS;

      // draw lines between placed points + preview line to mouse
      ctx.beginPath();
      ctx.moveTo(canvasPts[0].x, canvasPts[0].y);
      for (let i = 1; i < canvasPts.length; i++) ctx.lineTo(canvasPts[i].x, canvasPts[i].y);
      if (mouse) {
        if (isHoverClose) ctx.lineTo(canvasPts[0].x, canvasPts[0].y);
        else              ctx.lineTo(mouse.x, mouse.y);
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.stroke();
      ctx.setLineDash([]);

      // fill preview when hovering close
      if (isHoverClose && canvasPts.length >= 3) {
        ctx.beginPath();
        ctx.moveTo(canvasPts[0].x, canvasPts[0].y);
        for (let i = 1; i < canvasPts.length; i++) ctx.lineTo(canvasPts[i].x, canvasPts[i].y);
        ctx.closePath();
        ctx.fillStyle = color + "18";
        ctx.fill();
      }

      // vertex dots
      for (let i = 0; i < canvasPts.length; i++) {
        const isFirst = i === 0;
        ctx.beginPath();
        ctx.arc(canvasPts[i].x, canvasPts[i].y, isFirst ? POLYGON_CLOSE_RADIUS / 2 : 4, 0, Math.PI * 2);
        ctx.fillStyle = (isFirst && isHoverClose) ? "#22C55E" : "#fff";
        ctx.fill();
        ctx.strokeStyle = (isFirst && isHoverClose) ? "#22C55E" : color;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
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

  // ── zoom helpers ──────────────────────────────────────────────────────────

  // Single zoom implementation — all zoom paths go through this.
  function applyZoomAtPoint(factor: number, pivotX: number, pivotY: number) {
    const ns = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, scaleRef.current * factor));
    offsetRef.current = {
      x: pivotX - (pivotX - offsetRef.current.x) * (ns / scaleRef.current),
      y: pivotY - (pivotY - offsetRef.current.y) * (ns / scaleRef.current),
    };
    scaleRef.current = ns;
    onZoomChangeRef.current(Math.round(ns * 100));
    redraw();
  }

  function applyZoom(factor: number) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    applyZoomAtPoint(factor, canvas.width / 2, canvas.height / 2);
  }

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

  useImperativeHandle(ref, () => ({
    fitImage,
    zoomIn:  () => applyZoom(ZOOM_BTN),
    zoomOut: () => applyZoom(1 / ZOOM_BTN),
  }));

  // ── resize observer ───────────────────────────────────────────────────────

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

  // ── load image ────────────────────────────────────────────────────────────

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

  // ── keyboard ──────────────────────────────────────────────────────────────

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.code === "Space") { spaceDownRef.current = true; e.preventDefault(); }
      if (e.key === "Escape") {
        isDrawingRef.current   = false;
        previewAnnRef.current  = null;
        polygonPointsRef.current = [];
        polygonMouseRef.current  = null;
        redraw();
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        const tag = (document.activeElement as HTMLElement)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA") return;
        const selId = selectedIdRef.current;
        if (selId) {
          onAnnotationsChangeRef.current(annotationsRef.current.filter(a => a.id !== selId));
          onSelectRef.current(null);
        }
      }
    }
    function onKeyUp(e: KeyboardEvent) {
      if (e.code === "Space") spaceDownRef.current = false;
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup",   onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup",   onKeyUp);
    };
  }, [redraw]);

  // ── polygon helpers ───────────────────────────────────────────────────────

  function finishPolygon() {
    const normPts = polygonPointsRef.current;
    if (normPts.length < 3) return;
    const newAnn: BBox = {
      id:         crypto.randomUUID(),
      classIndex: activeClassIndexRef.current,
      ...pointsToBbox(normPts),
      points:     normPts,
    };
    onAnnotationsChangeRef.current([...annotationsRef.current, newAnn]);
    onSelectRef.current(newAnn.id);
    polygonPointsRef.current = [];
    polygonMouseRef.current  = null;
    redraw();
  }

  // ── mouse events ──────────────────────────────────────────────────────────

  useEffect(() => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;

    function getHandCursor(pos: { x: number; y: number }): string {
      const anns   = annotationsRef.current;
      const selAnn = anns.find(a => a.id === selectedIdRef.current);
      if (selAnn) {
        if (!selAnn.points || selAnn.points.length === 4) {
          const corner = hitCorner(pos, selAnn);
          if (corner === 0 || corner === 3) return "nwse-resize";
          if (corner === 1 || corner === 2) return "nesw-resize";
        } else if (hitVertex(pos, selAnn) !== -1) {
          return "crosshair";
        }
        if (hitAnnotation(pos, selAnn)) return "move";
      }
      for (let i = anns.length - 1; i >= 0; i--) {
        if (hitAnnotation(pos, anns[i])) return "pointer";
      }
      return "grab";
    }

    function updateCursor(pos?: { x: number; y: number }) {
      const t = toolRef.current;
      if (t === "box" || t === "polygon") { canvas.style.cursor = "crosshair"; return; }
      if (t === "hand") { canvas.style.cursor = pos ? getHandCursor(pos) : "grab"; return; }
      canvas.style.cursor = "default";
    }

    function onMouseDown(e: MouseEvent) {
      const pos = canvasPos(e);

      // middle mouse or space → pan always
      if (e.button === 1 || spaceDownRef.current) {
        dragModeRef.current     = "pan";
        dragStartPosRef.current = pos;
        canvas.style.cursor     = "grabbing";
        return;
      }

      if (toolRef.current === "hand") {
        const anns   = annotationsRef.current;
        const selAnn = anns.find(a => a.id === selectedIdRef.current);

        if (selAnn && (!selAnn.points || selAnn.points.length === 4)) {
          const corner = hitCorner(pos, selAnn);
          if (corner !== -1) {
            dragModeRef.current     = "resize";
            dragStartPosRef.current = pos;
            dragAnnIdRef.current    = selAnn.id;
            dragAnnOrigRef.current  = { ...selAnn };
            resizeCornerRef.current = corner;
            canvas.style.cursor     = (corner === 0 || corner === 3) ? "nwse-resize" : "nesw-resize";
            return;
          }
        }

        if (selAnn && selAnn.points && selAnn.points.length > 4) {
          const vi = hitVertex(pos, selAnn);
          if (vi !== -1) {
            dragModeRef.current      = "vertex";
            dragStartPosRef.current  = pos;
            dragAnnIdRef.current     = selAnn.id;
            dragAnnOrigRef.current   = { ...selAnn };
            dragVertexIndexRef.current = vi;
            canvas.style.cursor      = "crosshair";
            return;
          }
        }

        for (let i = anns.length - 1; i >= 0; i--) {
          if (hitAnnotation(pos, anns[i])) {
            onSelectRef.current(anns[i].id);
            dragModeRef.current     = "move";
            dragStartPosRef.current = pos;
            dragAnnIdRef.current    = anns[i].id;
            dragAnnOrigRef.current  = { ...anns[i] };
            canvas.style.cursor     = "move";
            return;
          }
        }

        // empty space → deselect + pan
        onSelectRef.current(null);
        dragModeRef.current     = "pan";
        dragStartPosRef.current = pos;
        canvas.style.cursor     = "grabbing";
        return;
      }

      if (toolRef.current === "box") {
        const clamped = clampToImage(pos);
        isDrawingRef.current = true;
        drawStartRef.current = clamped;
        drawEndRef.current   = clamped;
        return;
      }

      if (toolRef.current === "polygon") {
        const clamped = clampToImage(pos);
        const pts     = polygonPointsRef.current;
        const { w: iw, h: ih } = imgSizeRef.current;

        // Check if clicking near first point to close polygon (≥3 points placed)
        if (pts.length >= 3) {
          const sc = scaleRef.current;
          const { x: ox, y: oy } = offsetRef.current;
          const firstCanvas = { x: pts[0].x * iw * sc + ox, y: pts[0].y * ih * sc + oy };
          const dx = clamped.x - firstCanvas.x;
          const dy = clamped.y - firstCanvas.y;
          if (Math.sqrt(dx * dx + dy * dy) <= POLYGON_CLOSE_RADIUS) {
            finishPolygon();
            return;
          }
        }

        // Add new point (normalized image coords)
        const imgPos = canvasToImage(clamped.x, clamped.y);
        const normPt = { x: clampPt(imgPos.x / iw), y: clampPt(imgPos.y / ih) };
        polygonPointsRef.current = [...pts, normPt];
        redraw();
        return;
      }
    }

    function onMouseMove(e: MouseEvent) {
      const pos    = canvasPos(e);
      const imgPos = canvasToImage(pos.x, pos.y);
      onCoordsChangeRef.current(Math.round(imgPos.x), Math.round(imgPos.y));

      if (dragModeRef.current === "pan") {
        const dx = pos.x - dragStartPosRef.current.x;
        const dy = pos.y - dragStartPosRef.current.y;
        offsetRef.current   = { x: offsetRef.current.x + dx, y: offsetRef.current.y + dy };
        dragStartPosRef.current = pos;
        redraw();
        return;
      }

      if (dragModeRef.current === "move") {
        const orig     = dragAnnOrigRef.current!;
        const startImg = canvasToImage(dragStartPosRef.current.x, dragStartPosRef.current.y);
        const currImg  = canvasToImage(pos.x, pos.y);
        const { w: iw, h: ih } = imgSizeRef.current;
        const dx = (currImg.x - startImg.x) / iw;
        const dy = (currImg.y - startImg.y) / ih;

        if (orig.points && orig.points.length >= 3) {
          const newPoints = orig.points.map(p => ({ x: clampPt(p.x + dx), y: clampPt(p.y + dy) }));
          previewAnnRef.current = { ...orig, ...pointsToBbox(newPoints), points: newPoints };
        } else {
          const newCx = orig.cx + dx;
          const newCy = orig.cy + dy;
          previewAnnRef.current = { ...orig, ...clampBBox(newCx, newCy, orig.w, orig.h) };
        }
        redraw();
        return;
      }

      if (dragModeRef.current === "vertex") {
        const orig = dragAnnOrigRef.current!;
        const { w: iw, h: ih } = imgSizeRef.current;
        const imgCurr = canvasToImage(pos.x, pos.y);
        const vi = dragVertexIndexRef.current;
        const newPts = orig.points!.map((p, i) =>
          i === vi ? { x: clampPt(imgCurr.x / iw), y: clampPt(imgCurr.y / ih) } : p
        );
        previewAnnRef.current = { ...orig, ...pointsToBbox(newPts), points: newPts };
        redraw();
        return;
      }

      if (dragModeRef.current === "resize") {
        const orig = dragAnnOrigRef.current!;
        const { w: iw, h: ih } = imgSizeRef.current;
        const imgCurr = canvasToImage(pos.x, pos.y);
        const c = resizeCornerRef.current;

        let l = (orig.cx - orig.w / 2) * iw;
        let r = (orig.cx + orig.w / 2) * iw;
        let t = (orig.cy - orig.h / 2) * ih;
        let b = (orig.cy + orig.h / 2) * ih;

        if (c === 0) { l = imgCurr.x; t = imgCurr.y; }
        if (c === 1) { r = imgCurr.x; t = imgCurr.y; }
        if (c === 2) { l = imgCurr.x; b = imgCurr.y; }
        if (c === 3) { r = imgCurr.x; b = imgCurr.y; }

        // enforce minimum size
        if (r - l < MIN_BOX_PX) { if (c === 0 || c === 2) l = r - MIN_BOX_PX; else r = l + MIN_BOX_PX; }
        if (b - t < MIN_BOX_PX) { if (c === 0 || c === 1) t = b - MIN_BOX_PX; else b = t + MIN_BOX_PX; }

        const clamped = clampBBox((l + r) / 2 / iw, (t + b) / 2 / ih, (r - l) / iw, (b - t) / ih);
        previewAnnRef.current = {
          ...orig,
          ...clamped,
          points: bboxToPoints(clamped.cx, clamped.cy, clamped.w, clamped.h),
        };
        redraw();
        return;
      }

      if (isDrawingRef.current) {
        drawEndRef.current = clampToImage(pos);
        redraw();
        return;
      }

      if (toolRef.current === "polygon") {
        polygonMouseRef.current = clampToImage(pos);
        if (polygonPointsRef.current.length > 0) { redraw(); return; }
      }

      if (toolRef.current === "hand") updateCursor(pos);
    }

    function onMouseUp(e: MouseEvent) {
      if (dragModeRef.current === "move" || dragModeRef.current === "resize" || dragModeRef.current === "vertex") {
        const preview = previewAnnRef.current;
        if (preview) {
          onAnnotationsChangeRef.current(
            annotationsRef.current.map(a => a.id === preview.id ? preview : a)
          );
          previewAnnRef.current = null;
        }
        dragModeRef.current    = "none";
        dragAnnIdRef.current   = null;
        dragAnnOrigRef.current = null;
        updateCursor(canvasPos(e));
        return;
      }

      if (dragModeRef.current === "pan") {
        dragModeRef.current = "none";
        updateCursor(canvasPos(e));
        return;
      }

      if (isDrawingRef.current && toolRef.current === "box") {
        isDrawingRef.current = false;
        const s   = drawStartRef.current;
        const end = clampToImage(canvasPos(e));
        if (Math.abs(end.x - s.x) > 8 && Math.abs(end.y - s.y) > 8) {
          const si      = canvasToImage(s.x, s.y);
          const ei      = canvasToImage(end.x, end.y);
          const yolo    = imageToYolo(
            Math.min(si.x, ei.x), Math.min(si.y, ei.y),
            Math.abs(ei.x - si.x), Math.abs(ei.y - si.y),
          );
          const clamped = clampBBox(yolo.cx, yolo.cy, yolo.w, yolo.h);
          const newAnn: BBox = {
            id:         crypto.randomUUID(),
            classIndex: activeClassIndexRef.current,
            ...clamped,
            points: bboxToPoints(clamped.cx, clamped.cy, clamped.w, clamped.h),
          };
          onAnnotationsChangeRef.current([...annotationsRef.current, newAnn]);
          onSelectRef.current(newAnn.id);
        }
        redraw();
      }
    }

    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const pos = canvasPos(e);
      applyZoomAtPoint(e.deltaY < 0 ? ZOOM_WHEEL_IN : 1 / ZOOM_WHEEL_IN, pos.x, pos.y);
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
  }, [redraw, tool]);

  return (
    <div ref={wrapperRef} style={{ flex: 1, overflow: "hidden", background: CANVAS_BG }}>
      <canvas ref={canvasRef} style={{ display: "block", width: "100%", height: "100%" }} />
    </div>
  );
});

export default AnnotationCanvas;
