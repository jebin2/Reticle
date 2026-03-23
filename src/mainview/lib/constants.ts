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

export type ProjectStatus = "annotating" | "ready" | "training" | "trained";

export interface Project {
  id: string;
  name: string;
  baseModel?: string;   // set in Train tab
  classes?: string[];   // set in Annotate tab
  status: ProjectStatus;
  imageCount: number;
  mAP?: number;
  updatedAt: string;
  thumbnailColor: string;
}

export const STATUS_LABELS: Record<ProjectStatus, string> = {
  annotating: "Annotating",
  ready: "Ready",
  training: "Training",
  trained: "Trained",
};

export const STATUS_COLORS: Record<ProjectStatus, string> = {
  annotating: "#EAB308",
  ready: "#3B82F6",
  training: "#F97316",
  trained: "#22C55E",
};

export const BASE_MODELS = [
  "YOLOv8n",
  "YOLOv8s",
  "YOLOv8m",
  "YOLOv11n",
  "YOLOv11s",
];

// Mock data for dashboard
export const MOCK_PROJECTS: Project[] = [
  {
    id: "1",
    name: "Warehouse Security V4",
    baseModel: "YOLOv8s",
    classes: ["person", "forklift", "pallet", "hardhat", "vest", "zone", "vehicle", "door"],
    status: "annotating",
    imageCount: 420,
    updatedAt: "2d ago",
    thumbnailColor: "#1e3a5f",
  },
  {
    id: "2",
    name: "PCB Defect Detector",
    baseModel: "YOLOv8m",
    classes: ["scratch", "hole", "bridge", "open"],
    status: "trained",
    imageCount: 942,
    mAP: 0.942,
    updatedAt: "Oct 24, 2025",
    thumbnailColor: "#1a3d2b",
  },
  {
    id: "3",
    name: "Urban Traffic Flow",
    baseModel: "YOLOv8n",
    classes: ["car", "truck", "bus", "bike", "pedestrian"],
    status: "ready",
    imageCount: 312,
    updatedAt: "1 day ago",
    thumbnailColor: "#2d1f3d",
  },
  {
    id: "4",
    name: "Smart Retail Shelf",
    baseModel: "YOLOv8n",
    classes: ["product", "empty-slot", "misplace"],
    status: "annotating",
    imageCount: 128,
    updatedAt: "Oct 30, 2025",
    thumbnailColor: "#3d2a1a",
  },
];
