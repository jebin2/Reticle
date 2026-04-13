// Shared helpers for reading and writing YOLO label files.
// Used by the assets handler and any future export/conversion logic.

import { parseSegmentationLine, isTruePolygon } from "./polygon";

export type AnnotationRecord = {
  classIndex: number;
  cx: number; cy: number;
  w: number;  h: number;
  points?: Array<{ x: number; y: number }>;
};

/**
 * Parse a single YOLO label file's text into annotation records.
 * Handles both plain bounding-box lines and segmentation polygon lines.
 */
export function parseYoloLabels(text: string): AnnotationRecord[] {
  return text.trim().split("\n").filter(Boolean).map(line => {
    const parts      = line.split(" ").map(Number);
    const classIndex = parts[0];

    const segPts = parseSegmentationLine(line);
    if (segPts) {
      const xs = segPts.map(p => p.x);
      const ys = segPts.map(p => p.y);
      const minX = Math.min(...xs), maxX = Math.max(...xs);
      const minY = Math.min(...ys), maxY = Math.max(...ys);
      const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
      const w  = maxX - minX,       h  = maxY - minY;
      // If the polygon is exactly the 4-corner axis-aligned rectangle that
      // serializeYoloLabels generates for a plain bbox (TL TR BR BL), treat it
      // as a bbox so hasPolygons stays false.
      return isTruePolygon(segPts)
        ? { classIndex, cx, cy, w, h, points: segPts }
        : { classIndex, cx, cy, w, h };
    }

    const [ci, cx, cy, w, h] = parts;
    return { classIndex: ci, cx, cy, w, h };
  });
}

/**
 * Serialize annotation records back to YOLO label file text.
 * Bounding boxes are stored as 4-corner polygons (TL TR BR BL) for
 * compatibility with YOLO segmentation format.
 */
export function serializeYoloLabels(anns: AnnotationRecord[]): string {
  return anns.map(a => {
    let pts = a.points;
    if (!pts || pts.length < 3) {
      const l = a.cx - a.w / 2, r = a.cx + a.w / 2;
      const t = a.cy - a.h / 2, b = a.cy + a.h / 2;
      pts = [{ x: l, y: t }, { x: r, y: t }, { x: r, y: b }, { x: l, y: b }];
    }
    return `${a.classIndex} ${pts.map(p => `${p.x.toFixed(6)} ${p.y.toFixed(6)}`).join(" ")}`;
  }).join("\n");
}
