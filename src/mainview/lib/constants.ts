import { type RunStatus } from "./types";

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
  idle:       "Idle",
  installing: "Installing",
  training:   "Training",
  paused:     "Paused",
  done:       "Done",
  failed:     "Failed",
};

export const RUN_STATUS_COLORS: Record<RunStatus, string> = {
  idle:       "#6B7280",
  installing: "#A855F7",
  training:   "#F97316",
  paused:     "#3B82F6",
  done:       "#22C55E",
  failed:     "#EF4444",
};

export const BASE_MODELS_SEG = [
  "yolo26n-seg",
  "yolo26s-seg",
  "yolo26m-seg",
  "yolo26l-seg",
  "yolo26x-seg",
];

export const BASE_MODELS_DET = [
  "yolo26n",
  "yolo26s",
  "yolo26m",
  "yolo26l",
  "yolo26x",
];

// Legacy alias — prefer BASE_MODELS_SEG / BASE_MODELS_DET directly.
export const BASE_MODELS = BASE_MODELS_SEG;

export const DEVICES = ["auto", "cpu", "cuda:0", "mps"];
