import { type RunStatus, type Asset, type TrainingRun } from "./types";

export const CLASS_COLORS = [
  "#3B82F6", // blue
  "#22C55E", // green
  "#EF4444", // red
  "#F97316", // orange
  "#A855F7", // purple
  "#14B8A6", // teal
  "#F59E0B", // amber
  "#EC4899", // pink
];

export const RUN_STATUS_LABELS: Record<RunStatus, string> = {
  idle:     "Idle",
  training: "Training",
  done:     "Done",
  failed:   "Failed",
};

export const RUN_STATUS_COLORS: Record<RunStatus, string> = {
  idle:     "#6B7280",
  training: "#F97316",
  done:     "#22C55E",
  failed:   "#EF4444",
};

export const BASE_MODELS = [
  "YOLOv8n",
  "YOLOv8s",
  "YOLOv8m",
  "YOLOv11n",
  "YOLOv11s",
];

export const MOCK_ASSETS: Asset[] = [
  {
    id: "a1",
    name: "Vehicles",
    storagePath: "~/YOLOStudio/assets/vehicles",
    classes: ["car", "truck", "bus", "bike", "van"],
    imageCount: 420,
    annotatedCount: 380,
    updatedAt: "2d ago",
    thumbnailColor: "#1e3a5f",
  },
  {
    id: "a2",
    name: "Pedestrians",
    storagePath: "~/YOLOStudio/assets/pedestrians",
    classes: ["person", "cyclist"],
    imageCount: 312,
    annotatedCount: 200,
    updatedAt: "1 day ago",
    thumbnailColor: "#2d1f3d",
  },
  {
    id: "a3",
    name: "PCB Defects",
    storagePath: "~/YOLOStudio/assets/pcb-defects",
    classes: ["scratch", "hole", "bridge", "open"],
    imageCount: 942,
    annotatedCount: 942,
    updatedAt: "Oct 24, 2025",
    thumbnailColor: "#1a3d2b",
  },
  {
    id: "a4",
    name: "Retail Shelf",
    storagePath: "~/YOLOStudio/assets/retail-shelf",
    classes: ["product", "empty-slot", "misplace"],
    imageCount: 128,
    annotatedCount: 64,
    updatedAt: "Oct 30, 2025",
    thumbnailColor: "#3d2a1a",
  },
];

export const MOCK_RUNS: TrainingRun[] = [
  {
    id: "r1",
    name: "vehicles-v1",
    assetIds: ["a1"],
    classMap: ["car", "truck", "bus", "bike", "van"],
    baseModel: "YOLOv8s",
    outputPath: "~/YOLOStudio/runs/vehicles-v1",
    status: "done",
    mAP: 0.912,
    updatedAt: "3d ago",
  },
  {
    id: "r2",
    name: "traffic-mixed-v2",
    assetIds: ["a1", "a2"],
    classMap: ["car", "truck", "bus", "bike", "van", "person", "cyclist"],
    baseModel: "YOLOv8n",
    outputPath: "~/YOLOStudio/runs/traffic-mixed-v2",
    status: "training",
    updatedAt: "1h ago",
  },
  {
    id: "r3",
    name: "pcb-defect-v3",
    assetIds: ["a3"],
    classMap: ["scratch", "hole", "bridge", "open"],
    baseModel: "YOLOv8m",
    outputPath: "~/YOLOStudio/runs/pcb-defect-v3",
    status: "done",
    mAP: 0.942,
    updatedAt: "Oct 24, 2025",
  },
];
