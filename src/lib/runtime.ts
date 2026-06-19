// Shared runtime bootstrap, run by BOTH window entries (main.tsx and the
// projector window's presenter.tsx). Having one place means the projector can
// never silently miss boot setup the main window does — the divergence that
// caused the projector font + math glitches. Add new global boot steps here,
// once.

import { injectFontFaces } from './fonts';
import { discoverAllServers } from './serverDiscovery';

export function initRuntime(): void {
  // Register @font-face for all bundled font packages (text + math).
  injectFontFaces();
  // Refresh the Jupyter server registry in the background (live notebooks).
  void discoverAllServers();
}
