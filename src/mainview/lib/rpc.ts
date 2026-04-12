// Singleton RPC channel between the renderer and the Bun main process.
// Call initRPC() once at startup before rendering the app.

import { type Asset, type TrainingRun } from "./types";

type StudioData = { assets: Asset[]; runs: TrainingRun[] };

type RPCSchema = {
  bun: {
    requests: {
      getBridgeConfig: {
        params:   Record<string, never>;
        response: { port: number; token: string };
      };
      loadStudio: {
        params:   Record<string, never>;
        response: StudioData;
      };
      saveStudio: {
        params:   StudioData;
        response: Record<string, never>;
      };
      openImagesDialog: {
        params:   Record<string, never>;
        response: { canceled: boolean; paths: string[] };
      };
      openFolderDialog: {
        params:   Record<string, never>;
        response: { canceled: boolean; paths: string[] };
      };
      openFolderPathDialog: {
        params:   Record<string, never>;
        response: { canceled: boolean; path: string };
      };
      loadAssetData: {
        params:   { storagePath: string };
        response: {
          images:  Array<{ filename: string; filePath: string }>;
          labels:  Record<string, Array<{ classIndex: number; cx: number; cy: number; w: number; h: number; points?: Array<{ x: number; y: number }> }>>;
          classes: string[];
        };
      };
      saveAnnotations: {
        params: {
          storagePath: string;
          labels:  Record<string, Array<{ classIndex: number; cx: number; cy: number; w: number; h: number; points?: Array<{ x: number; y: number }> }>>;
          classes: string[];
        };
        response: Record<string, never>;
      };
      importImages: {
        params: {
          storagePath: string;
          files: Array<{ filename: string; sourcePath?: string; dataUrl?: string }>;
        };
        response: { images: Array<{ filename: string; filePath: string }> };
      };
      startTraining: {
        params: {
          id:         string;
          name:       string;
          assetPaths: string[];
          classMap:   string[];
          baseModel:  string;
          epochs:     number;
          batchSize:  number;
          imgsz:      number;
          device:     string;
          outputPath: string;
          fresh:      boolean;
        };
        response: { started: boolean };
      };
      readTrainingLog: {
        params:   { outputPath: string };
        response: { lines: string[] };
      };
      readRunMeta: {
        params:   { outputPath: string };
        response: {
          found:         boolean;
          classMap:      string[];
          imageCount:    number;
          newCount:      number;
          modifiedCount: number;
          hasPolygons:   boolean;
        };
      };
      stopTraining: {
        params:   { runId: string; clearCheckpoint?: boolean; outputPath?: string };
        response: Record<string, never>;
      };
      exportModel: {
        params:   { outputPath: string; format: string };
        response: { exportedPath: string; fileSize: number; error: string | null };
      };
      buildAndDownloadCLI: {
        params:   { outputPath: string; runName: string; runId: string };
        response: { filePath: string; filename: string; error: string | null };
      };
      exportCLI: {
        params:   { outputPath: string; runName: string; destDir: string };
        response: { bundlePath: string; error: string | null };
      };
      cancelExport: {
        params:   { runId: string };
        response: Record<string, never>;
      };
      downloadExport: {
        params:   { outputPath: string; format: string; runName: string; runId: string };
        response: { filePath: string; filename: string; error: string | null };
      };
      downloadFile: {
        params:   { srcPath: string };
        response: { savedPath: string; error: string | null };
      };
      deleteFolder: {
        params:   { folderPath: string };
        response: Record<string, never>;
      };
      checkWeights: {
        params:   { outputPaths: string[] };
        response: { results: Record<string, boolean> };
      };
      runInference: {
        params: { imagePath: string; outputPath: string; confidence: number };
        response: {
          detections: Array<{
            classIndex: number; label: string; confidence: number;
            cx: number; cy: number; w: number; h: number;
          }>;
          inferenceMs: number;
          error: string | null;
        };
      };
      startHubPush: {
        params:   { outputPath: string; repoId: string; token: string; runName: string };
        response: { jobId: string };
      };
      readHubLog: {
        params:   { jobId: string };
        response: { lines: string[] };
      };
    };
    messages: {};
    push: {};
  };
  webview: { requests: {}; messages: {}; push: {} };
};

type RPC = {
  request: {
    [K in keyof RPCSchema["bun"]["requests"]]: (
      params: RPCSchema["bun"]["requests"][K]["params"]
    ) => Promise<RPCSchema["bun"]["requests"][K]["response"]>;
  };
};

let _rpc: RPC | null = null;
let _bridgeConfig: { port: number; token: string } | null = null;

export function getBridgeUrl(filePath: string): string {
  if (!_bridgeConfig) throw new Error("RPC not initialized");
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

export async function initRPC(): Promise<void> {
  const { Electroview } = await import("electrobun/view");
  const electroview = new Electroview({
    rpc: Electroview.defineRPC<RPCSchema>({
      maxRequestTime: Infinity,
      handlers: { requests: {} },
    }),
  });
  _rpc = electroview.rpc as RPC;
  _bridgeConfig = await _rpc.request.getBridgeConfig({});
}
