// Resolve the kernel + server for a NotebookElement.
//
// Two-step resolution:
//   1. The CASCADE picks the requested kernel name. Default-setting
//      flavor per DESIGN_DECISIONS.md "Preferences cascade":
//         element.kernel.kernelName
//           ?? config.notebookKernel.kernelName
//           ?? notebook.metadata.kernelspec.name
//           ?? 'python3' (final fallback)
//      Kernel kind ('external' | 'lite') walks the same cascade.
//
//   2. The REGISTRY picks the server. Notebook elements never carry
//      baseUrl + token (those are auth artifacts; decks are
//      git-committable). Instead we scan PrefSchema.jupyterServers
//      for the first entry whose `availableKernels` contains the
//      requested kernel name. No match → ResolvedExternal.server is
//      null and the status pill (Phase 3) shows red.

import {
  NotebookElement, PresentationConfig,
} from '../types/presentation';
import { Notebook } from './notebookFormat';
import type { JupyterServerEntry } from './preferences';

/** Hardcoded fallback kernel name when no tier expressed a preference
 *  and the notebook lacks kernelspec metadata. */
const DEFAULT_KERNEL_NAME = 'python3';

export interface ResolvedExternal {
  kind: 'external';
  /** The kernel name to start (e.g., 'python3', 'julia-1.10'). */
  kernelName: string;
  /** The registered server we'll dial, or null if no entry in the
   *  registry advertises the requested kernel. Consumers should
   *  render a "no matching server" state when null rather than
   *  attempting to connect. */
  server: JupyterServerEntry | null;
}

export interface ResolvedLite {
  kind: 'lite';
}

export type ResolvedKernel = ResolvedExternal | ResolvedLite;

/** Pick the first server in `registry` advertising `kernelName`. The
 *  registry order is the user's preference order; reorder in Settings
 *  to change the default match. A server with no `availableKernels`
 *  field (never tested) is skipped — discovery hasn't confirmed it
 *  has the kernel, so we don't gamble during a talk. */
export function findServerForKernel(
  kernelName: string,
  registry: JupyterServerEntry[],
): JupyterServerEntry | null {
  for (const s of registry) {
    if (s.availableKernels?.includes(kernelName)) return s;
  }
  return null;
}

export function resolveNotebookKernel(
  element: NotebookElement,
  config: PresentationConfig | undefined,
  notebook: Notebook | null,
  registry: JupyterServerEntry[],
): ResolvedKernel {
  // Step 1a — pick the kind via the standard cascade.
  const kind =
    element.kernel?.kind
    ?? config?.notebookKernel?.kind
    ?? 'external';

  if (kind === 'lite') return { kind: 'lite' };

  // Step 1b — pick the kernel name via the cascade.
  const elemExt = element.kernel?.kind === 'external' ? element.kernel : undefined;
  const deckExt = config?.notebookKernel?.kind === 'external'
    ? config.notebookKernel : undefined;
  const kernelName =
    elemExt?.kernelName
    ?? deckExt?.kernelName
    ?? notebook?.kernelspecName
    ?? DEFAULT_KERNEL_NAME;

  // Step 2 — registry lookup. Decoupled from the cascade so server
  // selection lives entirely on the local machine; deck files never
  // know the URL or token.
  return {
    kind: 'external',
    kernelName,
    server: findServerForKernel(kernelName, registry),
  };
}

/** Convenience export retained for tests / docs referencing the
 *  previous name. New code should call resolveNotebookKernel with a
 *  registry; this helper assumes an empty one (no server matches). */
export function resolveKernelNameOnly(
  element: NotebookElement,
  config: PresentationConfig | undefined,
  notebook: Notebook | null,
): ResolvedKernel {
  return resolveNotebookKernel(element, config, notebook, []);
}
