import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { initRuntime } from "./lib/runtime";

// Shared boot (fonts + Jupyter server discovery). The projector window runs the
// SAME initRuntime() so the two windows can't diverge on setup.
initRuntime();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
