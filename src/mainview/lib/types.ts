// App-level domain types shared across pages and components.
// Canvas/annotation-specific types live in annotationTypes.ts.

export type NavPage = "overview" | "assets" | "train" | "inference" | "export" | "hub";

export interface Asset {
  id: string;
  name: string;
  storagePath: string;     // absolute FS path where images + labels live
  classes: string[];
  imageCount: number;
  annotatedCount: number;
  updatedAt: string;
  thumbnailColor: string;
  // true if any annotation in this asset is a true polygon (not just a bbox rectangle).
  // undefined for assets created before this field was added.
  hasPolygons?: boolean;
}

export type RunStatus = "idle" | "installing" | "training" | "paused" | "done" | "failed";

export interface TrainingRun {
  id: string;
  name: string;
  assetIds: string[];      // references to Asset.id
  classMap: string[];      // final ordered class list for this run (remapped)
  baseModel: string;
  epochs: number;
  batchSize: number;       // -1 = auto
  imgsz: number;
  device: string;          // "auto" | "cpu" | "cuda:0" | "mps"
  outputPath: string;      // absolute FS path for weights + results
  status: RunStatus;
  mAP?: number;
  updatedAt: string;
}
