import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { injectFontFaces } from "./lib/fonts";

// Register @font-face declarations for all bundled font packages.
// Browser will lazy-load the actual font files when CSS references them.
injectFontFaces();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
