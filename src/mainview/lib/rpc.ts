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
          labels:  Record<string, Array<{ classIndex: number; cx: number; cy: number; w: number; h: number }>>;
          classes: string[];
        };
      };
      saveAnnotations: {
        params: {
          storagePath: string;
          labels:  Record<string, Array<{ classIndex: number; cx: number; cy: number; w: number; h: number }>>;
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
