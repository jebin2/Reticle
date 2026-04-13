/**
 * Polygon / label-file utilities shared across the Bun backend.
 *
 * YOLO segmentation format: class x1 y1 x2 y2 ... (≥7 tokens, even coord count)
 * YOLO detection format:    class cx cy w h        (5 tokens)
 *
 * When Nab saves a plain bbox as a segmentation label it emits the four
 * corners in TL→TR→BR→BL order.  That axis-aligned rectangle is not a "real"
 * polygon — we treat it as bbox-only so hasPolygons stays false.
 */

const POLYGON_EPS = 1e-5;

export interface Point { x: number; y: number }

/**
 * Returns true when `pts` is the exact axis-aligned rectangle that
 * saveAnnotations writes for a plain bounding-box (TL TR BR BL).
 */
export function isAxisAlignedRect(pts: Point[]): boolean {
	if (pts.length !== 4) return false;
	const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
	const minX = Math.min(...xs), maxX = Math.max(...xs);
	const minY = Math.min(...ys), maxY = Math.max(...ys);
	return (
		Math.abs(pts[0].x - minX) < POLYGON_EPS && Math.abs(pts[0].y - minY) < POLYGON_EPS &&
		Math.abs(pts[1].x - maxX) < POLYGON_EPS && Math.abs(pts[1].y - minY) < POLYGON_EPS &&
		Math.abs(pts[2].x - maxX) < POLYGON_EPS && Math.abs(pts[2].y - maxY) < POLYGON_EPS &&
		Math.abs(pts[3].x - minX) < POLYGON_EPS && Math.abs(pts[3].y - maxY) < POLYGON_EPS
	);
}

/**
 * Parse a single YOLO label line into its point array.
 * Returns null if the line is not a valid segmentation entry (must have ≥7
 * tokens and an even number of coordinate values).
 */
export function parseSegmentationLine(line: string): Point[] | null {
	const parts = line.trim().split(" ").map(Number);
	if (parts.length < 7 || (parts.length - 1) % 2 !== 0) return null;
	const pts: Point[] = [];
	for (let i = 1; i < parts.length; i += 2) pts.push({ x: parts[i], y: parts[i + 1] });
	return pts;
}

/**
 * Returns true if `pts` represent a true polygon (not a bbox-derived rect).
 * Callers use this to decide whether to attach `points` to an annotation or
 * discard them and treat the entry as a plain detection bbox.
 */
export function isTruePolygon(pts: Point[]): boolean {
	if (pts.length !== 4) return true;   // >4 points → always a real polygon
	return !isAxisAlignedRect(pts);
}
