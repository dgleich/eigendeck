// Notebook element renderer. Loads the .ipynb asset bytes, parses
// natively, and renders each cell. The kernel layer is lazy —
// no WS connection until the user clicks Run on a cell.
//
// External-kernel only for v1 (kernel.kind === 'lite' falls back to
// display-only with a placeholder banner). Lite support comes in
// v1.5; the type / cascade are already in place.

import { useCallback, useRef, useState } from 'react';
import { DraggableBox } from './SlideElementRenderer';
import { CodeCell } from './notebook/CodeCell';
import { MarkdownCell } from './notebook/MarkdownCell';
import { RawCell } from './notebook/RawCell';
import { useNotebook } from '../lib/useNotebook';
import { useKernel } from '../lib/useKernel';
import { resolveNotebookKernel } from '../lib/notebookKernel';
import { CellOutput } from '../lib/notebookFormat';
import {
  ElementPosition, NotebookElement, SlideElement,
} from '../types/presentation';
import { usePresentationStore } from '../store/presentation';

export function NotebookBox({ element, zIndex, scale, isSelected, onSelect, onDelete, onUpdate }: {
  element: NotebookElement;
  zIndex: number; scale: number;
  isSelected: boolean;
  onSelect: (e?: { shiftKey: boolean }) => void; onDelete: () => void;
  onUpdate: (changes: Partial<SlideElement>) => void;
}) {
  const [interacting, setInteracting] = useState(false);
  const { notebook, error, loading } = useNotebook(element.assetId);
  const config = usePresentationStore((s) => s.presentation?.config);
  const resolved = resolveNotebookKernel(element, config, notebook);

  // Cells filtered through the visibility whitelist.
  const cells = notebook
    ? (element.visibleCells && element.visibleCells.length > 0
        ? notebook.cells.filter((c) => element.visibleCells!.includes(c.index))
        : notebook.cells)
    : [];

  return (
    <DraggableBox
      elementId={element.id}
      position={element.position} zIndex={zIndex} scale={scale}
      className="el-notebook" isSelected={isSelected}
      linkId={element.linkId} syncId={element.syncId}
      _linkId={(element as { _linkId?: string })._linkId}
      _syncId={(element as { _syncId?: string })._syncId}
      onSelect={onSelect} onDelete={onDelete}
      onPositionChange={(pos: ElementPosition) => onUpdate({ position: pos })}
      onUpdate={onUpdate}
    >
      <div className="nb-frame">
        {resolved.kind === 'external' ? (
          <ExternalKernelBody
            cells={cells}
            loading={loading}
            error={error}
            interacting={interacting}
            resolved={resolved}
            kernelDisplayName={notebook?.kernelDisplayName ?? notebook?.kernelspecName ?? null}
          />
        ) : (
          <LiteKernelPlaceholder
            cells={cells}
            interacting={interacting}
            kernelDisplayName={notebook?.kernelDisplayName ?? notebook?.kernelspecName ?? null}
          />
        )}
      </div>
      {!interacting && (
        <div className="nb-overlay"
          onDoubleClick={(e) => { e.stopPropagation(); setInteracting(true); }}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, cursor: 'grab', zIndex: 1 }} />
      )}
      {interacting && (
        <div style={{ position: 'absolute', top: 4, right: 4, zIndex: 2 }}>
          <button onClick={() => setInteracting(false)}
            style={{ padding: '2px 8px', fontSize: 11, border: '1px solid #ccc',
                     borderRadius: 3, background: 'rgba(255,255,255,0.95)', cursor: 'pointer' }}>
            Lock
          </button>
        </div>
      )}
    </DraggableBox>
  );
}

// --- External-kernel body (the actual interactive notebook) --------

interface CellRunState {
  outputs: CellOutput[];
  executionCount: number | '*' | null;
  running: boolean;
}

function ExternalKernelBody({
  cells, loading, error, interacting, resolved, kernelDisplayName,
}: {
  cells: ReturnType<typeof Object>['constructor'] extends never ? never : import('../lib/notebookFormat').Cell[];
  loading: boolean; error: Error | null;
  interacting: boolean;
  resolved: import('../lib/notebookKernel').ResolvedExternal;
  kernelDisplayName: string | null;
}) {
  const kernel = useKernel(resolved);
  // Per-cell live run state, keyed by cell index. Map-in-state pattern:
  // we replace the map reference to trigger re-render.
  const [runState, setRunState] = useState<Map<number, CellRunState>>(new Map());
  // Latest accumulator reference for stream/output callbacks (avoid stale
  // closures when multiple outputs arrive between renders).
  const accRef = useRef(runState);
  accRef.current = runState;

  const setCellState = useCallback((index: number, patch: Partial<CellRunState> | ((prev: CellRunState | undefined) => CellRunState)) => {
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
  }, []);

  const runOne = useCallback(async (index: number, source: string) => {
    setCellState(index, { outputs: [], executionCount: '*', running: true });
    try {
      const handle = await kernel.runCell(source, {
        onStream: (s) => setCellState(index, (prev) => {
          // Stream messages append to the LAST stream output of the same
          // channel; otherwise start a new one. Matches Jupyter Lab.
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
  }, [kernel, setCellState]);

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
      <div className="nb-body" style={{ pointerEvents: interacting ? 'auto' : 'none' }}>
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

function labelForStatus(s: import('../lib/useKernel').KernelStatus): string {
  switch (s) {
    case 'disconnected': return '○ not connected';
    case 'connecting': return '◐ connecting…';
    case 'idle': return '● idle';
    case 'busy': return '◑ busy';
    case 'error': return '✕ error';
    case 'dead': return '✕ dead';
  }
}

// --- Lite-kernel placeholder (display only, no exec) ---------------

function LiteKernelPlaceholder({
  cells, interacting, kernelDisplayName,
}: {
  cells: import('../lib/notebookFormat').Cell[];
  interacting: boolean;
  kernelDisplayName: string | null;
}) {
  return (
    <>
      <div className="nb-header">
        <span className="nb-kernel-label">{kernelDisplayName || 'Notebook'}</span>
        <span className="nb-status nb-status-disconnected">lite (display only — v1.5)</span>
      </div>
      <div className="nb-body" style={{ pointerEvents: interacting ? 'auto' : 'none' }}>
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
