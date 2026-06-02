import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { injectFontFaces } from "./lib/fonts";
import { discoverAllServers } from "./lib/serverDiscovery";

// Register @font-face declarations for all bundled font packages.
// Browser will lazy-load the actual font files when CSS references them.
injectFontFaces();

// Refresh the Jupyter server registry's availableKernels + lastSeenAt
// in the background so the topbar status pill shows current state
// without the user having to click "Refresh all" manually. Fire and
// forget — the pill reads from preferences and updates reactively.
void discoverAllServers();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
