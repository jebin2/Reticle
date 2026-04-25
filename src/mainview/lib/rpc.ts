// Singleton IPC channel between the renderer and the Electron main process.
// Call initRPC() once at startup before rendering the app.

import { type Asset, type TrainingRun } from "./types";

type EmptyParams = Record<string, never>;
type EmptyResponse = Record<string, never>;
type StudioData = { assets: Asset[]; runs: TrainingRun[] };
type BridgeConfig = { port: number; token: string; isWindows: boolean };
type DialogPathsResult = { canceled: boolean; paths: string[] };
type DialogPathResult = { canceled: boolean; path: string };
type ImageFile = { filename: string; filePath: string };
type LabelPoint = { x: number; y: number };
type AnnotationRecord = {
  classIndex: number;
  cx: number;
  cy: number;
  w: number;
  h: number;
  points?: LabelPoint[];
};
type AssetLabels = Record<string, AnnotationRecord[]>;
type LoadAssetDataParams = { storagePath: string };
type LoadAssetDataResponse = { images: ImageFile[]; labels: AssetLabels; classes: string[] };
type SaveAnnotationsParams = { storagePath: string; labels: AssetLabels; classes: string[] };
type ImportImageFile = { filename: string; sourcePath?: string; dataUrl?: string };
type ImportImagesParams = { storagePath: string; files: ImportImageFile[] };
type ImportImagesResponse = { images: ImageFile[] };
type StartTrainingParams = {
  id: string;
  name: string;
  assetPaths: string[];
  classMap: string[];
  baseModel: string;
  epochs: number;
  batchSize: number;
  imgsz: number;
  device: string;
  outputPath: string;
  fresh: boolean;
};
type OutputPathParams = { outputPath: string };
type LinesResponse = { lines: string[] };
type RunMetaResponse = {
  found: boolean;
  classMap: string[];
  imageCount: number;
  hasPolygons: boolean;
  currentHasPolygons: boolean;
  hasPolygonsChanged: boolean;
  newCount: number;
  deletedCount: number;
  modifiedCount: number;
  hasDrift: boolean;
};
type UpdateDatasetResponse = { imageCount: number; hasPolygons: boolean; previousHasPolygons: boolean };
type StopTrainingParams = { runId: string; clearCheckpoint?: boolean; outputPath?: string };
type ExportModelParams = { outputPath: string; format: string };
type ExportResult = { exportedPath: string; fileSize: number; error: string | null };
type CliBuildParams = { outputPath: string; runName: string; runId: string };
type CliBuildResult = { filePath: string; filename: string; error: string | null };
type ExportCliParams = { outputPath: string; runName: string; destDir: string; runId: string };
type ExportCliResult = { bundlePath: string; error: string | null };
type StartExportParams = { outputPath: string; format: string; runName: string; runId: string };
type ReadExportLogParams = { outputPath: string; runId: string };
type DownloadFileResult = { savedPath: string; error: string | null };
type CheckWeightsParams = { outputPaths: string[] };
type InferenceDetection = {
  classIndex: number;
  label: string;
  confidence: number;
  cx: number;
  cy: number;
  w: number;
  h: number;
};
type RunInferenceParams = { imagePath: string; outputPath: string; confidence: number };
type RunInferenceResponse = {
  detections: InferenceDetection[];
  inferenceMs: number;
  error: string | null;
};
type StartHubPushParams = { outputPath: string; repoId: string; token: string; runName: string };
type StartHubPushResponse = { jobId: string };

type RPCSchema = {
  getBridgeConfig:       { params: EmptyParams;           response: BridgeConfig };
  loadStudio:            { params: EmptyParams;           response: StudioData };
  saveStudio:            { params: StudioData;            response: EmptyResponse };
  openImagesDialog:      { params: EmptyParams;           response: DialogPathsResult };
  openFolderDialog:      { params: EmptyParams;           response: DialogPathsResult };
  openFolderPathDialog:  { params: EmptyParams;           response: DialogPathResult };
  loadAssetData:         { params: LoadAssetDataParams;   response: LoadAssetDataResponse };
  saveAnnotations:       { params: SaveAnnotationsParams; response: EmptyResponse };
  ensureDir:             { params: { path: string };      response: EmptyResponse };
  importImages:          { params: ImportImagesParams;    response: ImportImagesResponse };
  startTraining:         { params: StartTrainingParams;   response: { started: boolean } };
  readTrainingLog:       { params: OutputPathParams;      response: LinesResponse };
  readRunMeta:           { params: OutputPathParams;      response: RunMetaResponse };
  updateDataset:         { params: OutputPathParams;      response: UpdateDatasetResponse };
  stopTraining:          { params: StopTrainingParams;    response: EmptyResponse };
  exportModel:           { params: ExportModelParams;     response: ExportResult };
  buildAndDownloadCLI:   { params: CliBuildParams;        response: CliBuildResult };
  exportCLI:             { params: ExportCliParams;       response: ExportCliResult };
  cancelExport:          { params: { runId: string };     response: EmptyResponse };
  startExport:           { params: StartExportParams;     response: { error: string | null } };
  readExportLog:         { params: ReadExportLogParams;   response: LinesResponse };
  downloadFile:          { params: { srcPath: string };   response: DownloadFileResult };
  deleteFolder:          { params: { folderPath: string }; response: EmptyResponse };
  checkWeights:          { params: CheckWeightsParams;    response: { results: Record<string, boolean> } };
  runInference:          { params: RunInferenceParams;    response: RunInferenceResponse };
  startHubPush:          { params: StartHubPushParams;    response: StartHubPushResponse };
  readHubLog:            { params: { jobId: string };     response: LinesResponse };
};

type RPC = {
  request: {
    [K in keyof RPCSchema]: (
      params: RPCSchema[K]["params"]
    ) => Promise<RPCSchema[K]["response"]>;
  };
};

let _rpc: RPC | null = null;
let _bridgeConfig: BridgeConfig | null = null;

export function getBridgeUrl(filePath: string): string {
  if (!_bridgeConfig) return "";
  return (
    `http://localhost:${_bridgeConfig.port}/file` +
    `?token=${_bridgeConfig.token}` +
    `&path=${encodeURIComponent(filePath)}`
  );
}

export function getRPC(): RPC {
  if (!_rpc) throw new Error("RPC not initialized");
  return _rpc;
}

// Phase 1: wire up the IPC proxy synchronously — all RPC calls work immediately.
export function setupRPC(): void {
  const invoke = window.electronAPI.invoke;
  _rpc = {
    request: new Proxy({} as RPC["request"], {
      get(_target, channel: string) {
        return (params: unknown) => invoke(channel, params);
      },
    }),
  };
}

// Phase 2: fetch bridge config (only needed for image URLs).
export async function initRPC(): Promise<void> {
  _bridgeConfig = await getRPC().request.getBridgeConfig({} as EmptyParams);
}

export function getBridgeConfig(): BridgeConfig | null {
  return _bridgeConfig;
}
