import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { setupRPC, initRPC } from "./lib/rpc";

// Wire up IPC proxy synchronously — all RPC calls work before the first render.
setupRPC();

const root = createRoot(document.getElementById("root")!);
root.render(
  <StrictMode>
    <App />
  </StrictMode>
);

// Fetch bridge config in the background (only needed for image URL generation).
initRPC().catch(err => console.error("RPC bridge config failed:", err));
