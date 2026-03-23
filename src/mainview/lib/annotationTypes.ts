export interface BBox {
  id: string;
  classIndex: number;
  // YOLO normalized: cx, cy, w, h (0–1)
  cx: number;
  cy: number;
  w: number;
  h: number;
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
