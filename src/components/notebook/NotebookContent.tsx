// The notebook's interactive body — header + scrollable cell area
// with optional Run buttons. Used by both NotebookBox (editor,
// wrapped in DraggableBox) and PresentNotebook (PresentMode,
// wrapped in an absolute-positioned div).
//
// `interactive: false` disables the pointer-events gate so cells
// accept clicks immediately in PresentMode (the editor's overlay
// trick exists so dragging works; PresentMode has no dragging).

import { useCallback, useEffect, useRef, useState } from 'react';
import { CodeCell } from './CodeCell';
import { MarkdownCell } from './MarkdownCell';
import { RawCell } from './RawCell';
import { useNotebook } from '../../lib/useNotebook';
import { useKernel, KernelStatus } from '../../lib/useKernel';
import { resolveNotebookKernel, ResolvedExternal } from '../../lib/notebookKernel';
import { Cell, CellOutput } from '../../lib/notebookFormat';
import { NotebookElement } from '../../types/presentation';
import { usePresentationStore } from '../../store/presentation';

export function NotebookContent({ element, interactive, mode = 'editor' }: {
  element: NotebookElement;
  interactive: boolean;
  /** 'editor' suppresses autoRun (the inspector toggle is meaningful
   *  only in PresentMode). Defaults to 'editor' so the editor can
   *  omit the prop. */
  mode?: 'editor' | 'present';
}) {
  const { notebook, error, loading } = useNotebook(element.assetId);
  const config = usePresentationStore((s) => s.presentation?.config);
  const resolved = resolveNotebookKernel(element, config, notebook);

  const cells: Cell[] = notebook
    ? (element.visibleCells && element.visibleCells.length > 0
        ? notebook.cells.filter((c) => element.visibleCells!.includes(c.index))
        : notebook.cells)
    : [];

  if (resolved.kind === 'lite') {
    return (
      <LiteKernelPlaceholder
        cells={cells}
        interactive={interactive}
        kernelDisplayName={notebook?.kernelDisplayName ?? notebook?.kernelspecName ?? null}
      />
    );
  }
  return (
    <ExternalKernelBody
      cells={cells}
      loading={loading}
      error={error}
      interactive={interactive}
      resolved={resolved}
      preamble={element.preamble}
      autoRun={mode === 'present' && !!element.autoRun}
      kernelDisplayName={notebook?.kernelDisplayName ?? notebook?.kernelspecName ?? null}
    />
  );
}

interface CellRunState {
  outputs: CellOutput[];
  executionCount: number | '*' | null;
  running: boolean;
}

function ExternalKernelBody({
  cells, loading, error, interactive, resolved, preamble, autoRun, kernelDisplayName,
}: {
  cells: Cell[];
  loading: boolean; error: Error | null;
  interactive: boolean;
  resolved: ResolvedExternal;
  preamble: string | undefined;
  autoRun: boolean;
  kernelDisplayName: string | null;
}) {
  const kernel = useKernel(resolved);
  const [runState, setRunState] = useState<Map<number, CellRunState>>(new Map());
  const accRef = useRef(runState);
  accRef.current = runState;
  // Track whether preamble has fired in the current kernel session.
  // Reset to false whenever the kernel reconnects (which happens on
  // resolved.* change — see useKernel's effect dep).
  const preambleFiredRef = useRef(false);
  useEffect(() => { preambleFiredRef.current = false; }, [resolved.baseUrl, resolved.token, resolved.kernelName]);

  const setCellState = useCallback(
    (index: number, patch: Partial<CellRunState> | ((prev: CellRunState | undefined) => CellRunState)) => {
      setRunState((prev) => {
        const next = new Map(prev);
        const old = next.get(index);
        const updated = typeof patch === 'function'
          ? patch(old)
          : { outputs: old?.outputs ?? [], executionCount: old?.executionCount ?? null, running: old?.running ?? false, ...patch };
        next.set(index, updated);
        accRef.current = next;
        return next;
      });
    },
    []
  );

  const runOne = useCallback(async (index: number, source: string) => {
    setCellState(index, { outputs: [], executionCount: '*', running: true });
    try {
      // Preamble fires once per kernel session, BEFORE the first cell.
      // Silent execute (no callbacks wired) — its outputs aren't user-
      // facing; only its side effects on the kernel namespace are.
      if (preamble && !preambleFiredRef.current) {
        preambleFiredRef.current = true;
        const ph = await kernel.runCell(preamble, {});
        await ph.done;
      }
      const handle = await kernel.runCell(source, {
        onStream: (s) => setCellState(index, (prev) => {
          const outs = prev?.outputs ? [...prev.outputs] : [];
          const last = outs[outs.length - 1];
          if (last && last.kind === 'stream' && last.name === s.name) {
            outs[outs.length - 1] = { ...last, text: last.text + s.text };
          } else {
            outs.push({ kind: 'stream', ...s });
          }
          return { outputs: outs, executionCount: prev?.executionCount ?? '*', running: true };
        }),
        onDisplayData: (d) => setCellState(index, (prev) => ({
          outputs: [...(prev?.outputs ?? []), { kind: 'display_data', data: d.data }],
          executionCount: prev?.executionCount ?? '*', running: true,
        })),
        onExecuteResult: (r) => setCellState(index, (prev) => ({
          outputs: [...(prev?.outputs ?? []), { kind: 'execute_result', data: r.data, executionCount: r.executionCount }],
          executionCount: r.executionCount ?? prev?.executionCount ?? '*',
          running: true,
        })),
        onError: (e) => setCellState(index, (prev) => ({
          outputs: [...(prev?.outputs ?? []), { kind: 'error', ename: e.ename, evalue: e.evalue, traceback: e.traceback }],
          executionCount: prev?.executionCount ?? '*', running: true,
        })),
      });
      await handle.done;
    } catch (e) {
      setCellState(index, (prev) => ({
        outputs: [
          ...(prev?.outputs ?? []),
          { kind: 'error', ename: 'KernelError', evalue: e instanceof Error ? e.message : String(e), traceback: [] },
        ],
        executionCount: prev?.executionCount ?? null,
        running: false,
      }));
    } finally {
      setCellState(index, (prev) => ({
        outputs: prev?.outputs ?? [],
        executionCount: prev?.executionCount ?? null,
        running: false,
      }));
    }
  }, [kernel, setCellState, preamble]);

  // autoRun: when active in PresentMode and the element has autoRun
  // set, fire all visible code cells in order on mount. Each call
  // waits for the previous to finish so output ordering matches the
  // notebook's natural top-to-bottom flow.
  useEffect(() => {
    if (!autoRun) return;
    let cancelled = false;
    (async () => {
      for (const c of cells) {
        if (cancelled) break;
        if (c.kind !== 'code') continue;
        await runOne(c.index, c.source);
      }
    })();
    return () => { cancelled = true; };
    // Intentionally only depends on autoRun + element identity (cells
    // ref changes on every parse; we don't want to retrigger).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRun]);

  return (
    <>
      <div className="nb-header">
        <span className="nb-kernel-label">
          {kernelDisplayName || resolved.kernelName}
          <span className="nb-kernel-suffix"> · {resolved.baseUrl.replace(/^https?:\/\//, '')}</span>
        </span>
        <span className={`nb-status nb-status-${kernel.status}`}>
          {labelForStatus(kernel.status)}
        </span>
      </div>
      <div className="nb-body" style={{ pointerEvents: interactive ? 'auto' : 'none' }}>
        {loading && <div className="nb-status">Loading…</div>}
        {error && <div className="nb-status nb-error">Parse error: {error.message}</div>}
        {kernel.error && (
          <div className="nb-status nb-error">
            Kernel error: {kernel.error}
            <div className="nb-hint">
              Start a server with:&nbsp;
              <code>jupyter server --no-browser --port=8888 --IdentityProvider.token=&apos;...&apos; --ServerApp.allow_origin=&apos;*&apos; --ServerApp.disable_check_xsrf=True</code>
            </div>
          </div>
        )}
        {cells.map((c) => {
          switch (c.kind) {
            case 'code': {
              const st = runState.get(c.index);
              return (
                <CodeCell key={c.index} cell={c}
                  liveOutputs={st?.outputs ?? null}
                  liveExecutionCount={st?.executionCount ?? null}
                  running={st?.running ?? false}
                  onRun={() => runOne(c.index, c.source)}
                />
              );
            }
            case 'markdown': return <MarkdownCell key={c.index} cell={c} />;
            case 'raw': return <RawCell key={c.index} cell={c} />;
          }
        })}
      </div>
    </>
  );
}

function labelForStatus(s: KernelStatus): string {
  switch (s) {
    case 'disconnected': return '○ not connected';
    case 'connecting': return '◐ connecting…';
    case 'idle': return '● idle';
    case 'busy': return '◑ busy';
    case 'error': return '✕ error';
    case 'dead': return '✕ dead';
  }
}

function LiteKernelPlaceholder({
  cells, interactive, kernelDisplayName,
}: {
  cells: Cell[];
  interactive: boolean;
  kernelDisplayName: string | null;
}) {
  return (
    <>
      <div className="nb-header">
        <span className="nb-kernel-label">{kernelDisplayName || 'Notebook'}</span>
        <span className="nb-status nb-status-disconnected">lite (display only — v1.5)</span>
      </div>
      <div className="nb-body" style={{ pointerEvents: interactive ? 'auto' : 'none' }}>
        {cells.map((c) => {
          switch (c.kind) {
            case 'code': return <CodeCell key={c.index} cell={c} />;
            case 'markdown': return <MarkdownCell key={c.index} cell={c} />;
            case 'raw': return <RawCell key={c.index} cell={c} />;
          }
        })}
      </div>
    </>
  );
}
