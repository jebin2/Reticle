/**
 * Clamp a YOLO box so all four edges stay within [0, 1].
 * The center is preserved; width/height are trimmed where they hit a boundary.
 * Used by draw, move, resize, and inline edit — single source of truth.
 */
export function clampBBox(
  cx: number, cy: number, w: number, h: number,
): Pick<BBox, "cx" | "cy" | "w" | "h"> {
  const left   = Math.max(0, cx - w / 2);
  const right  = Math.min(1, cx + w / 2);
  const top    = Math.max(0, cy - h / 2);
  const bottom = Math.min(1, cy + h / 2);
  return {
    cx: (left + right) / 2,
    cy: (top + bottom) / 2,
    w:  right - left,
    h:  bottom - top,
  };
}

export interface BBox {
  id: string;
  classIndex: number;
  // YOLO normalized: cx, cy, w, h (0–1). For polygons these are derived from the bounding rect of points.
  cx: number;
  cy: number;
  w: number;
  h: number;
  // When present, this is a segmentation polygon; normalized [0,1] image coordinates.
  points?: Array<{ x: number; y: number }>;
}

/** Clamp a single normalized coordinate to [0, 1]. */
export function clampPt(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/** Convert a YOLO center bbox to 4-corner polygon points (TL, TR, BR, BL). */
export function bboxToPoints(cx: number, cy: number, w: number, h: number): Array<{ x: number; y: number }> {
  const l = cx - w / 2, r = cx + w / 2;
  const t = cy - h / 2, b = cy + h / 2;
  return [{ x: l, y: t }, { x: r, y: t }, { x: r, y: b }, { x: l, y: b }];
}

/** Derive YOLO center bbox fields from the bounding rect of a polygon point array. */
export function pointsToBbox(points: Array<{ x: number; y: number }>): Pick<BBox, "cx" | "cy" | "w" | "h"> {
  const xs = points.map(p => p.x);
  const ys = points.map(p => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, w: maxX - minX, h: maxY - minY };
}

export interface ClassDef {
  name: string;
  color: string;
}

export interface ImageEntry {
  id: string;
  filename: string;
  src: string;        // blob URL or data URL — empty string until lazily loaded
  filePath?: string;  // absolute FS path (for bridge-served images from native dialog)
  annotations: BBox[];
  flagged?: boolean;
}

export type AnnotateTool = "hand" | "box" | "polygon";
