// Singleton RPC channel between the renderer and the Bun main process.
// Call initRPC() once at startup before rendering the app.

type RPCSchema = {
  bun: {
    requests: {
      getBridgeConfig: {
        params:   Record<string, never>;
        response: { port: number; token: string };
      };
      openImagesDialog: {
        params:   Record<string, never>;
        response: { canceled: boolean; paths: string[] };
      };
      openFolderDialog: {
        params:   Record<string, never>;
        response: { canceled: boolean; paths: string[] };
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
