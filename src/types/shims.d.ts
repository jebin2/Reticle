declare module "three";

declare module "*.pt" {
  const path: string;
  export default path;
}

declare module "*.py" {
  const path: string;
  export default path;
}

interface Window {
  electronAPI: {
    invoke: (channel: string, params?: unknown) => Promise<unknown>;
  };
}
