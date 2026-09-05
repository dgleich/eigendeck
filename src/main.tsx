import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { initRuntime } from "./lib/runtime";
import { installCoverageBeacon } from "./lib/coverageBeacon";

// Shared boot (fonts + Jupyter server discovery). The projector window runs the
// SAME initRuntime() so the two windows can't diverge on setup.
initRuntime();
// No-op unless this is an Istanbul-instrumented build (COVERAGE_INSTRUMENT=1);
// then it streams e2e coverage to the collector server. See src/lib/coverageBeacon.
installCoverageBeacon();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
