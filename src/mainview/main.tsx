import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { initRPC } from "./lib/rpc";

const root = createRoot(document.getElementById("root")!);

initRPC()
  .then(() => {
    root.render(
      <StrictMode>
        <App />
      </StrictMode>
    );
  })
  .catch(err => {
    console.error("RPC init failed:", err);
    // Render anyway so the window isn't blank
    root.render(
      <StrictMode>
        <App />
      </StrictMode>
    );
  });
