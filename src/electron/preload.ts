import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  invoke: (channel: string, params?: unknown) => ipcRenderer.invoke(channel, params),
});
