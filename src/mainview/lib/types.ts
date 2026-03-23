// App-level domain types shared across pages and components.
// Canvas/annotation-specific types live in annotationTypes.ts.

export type NavPage = "overview" | "assets" | "train" | "inference" | "export";

export interface Asset {
  id: string;
  name: string;
  storagePath: string;     // absolute FS path where images + labels live
  classes: string[];
  imageCount: number;
  annotatedCount: number;
  updatedAt: string;
  thumbnailColor: string;
}

export type RunStatus = "idle" | "training" | "done" | "failed";

export interface TrainingRun {
  id: string;
  name: string;
  assetIds: string[];      // references to Asset.id
  classMap: string[];      // final ordered class list for this run (remapped)
  baseModel: string;
  outputPath: string;      // absolute FS path for weights + results
  status: RunStatus;
  mAP?: number;
  updatedAt: string;
}
