import { describe, it, expect } from 'vitest';
import { resolveNotebookKernel } from './notebookKernel';
import type { NotebookElement, PresentationConfig } from '../types/presentation';
import type { Notebook } from './notebookFormat';

const baseElement: NotebookElement = {
  id: 'e1', type: 'notebook', assetId: 'a1',
  position: { x: 0, y: 0, width: 100, height: 100 },
};
const baseConfig: PresentationConfig = {
  transition: 'none', backgroundTransition: 'none', width: 1920, height: 1080,
};
const nbPython: Notebook = {
  cells: [], kernelspecName: 'python3',
  kernelDisplayName: 'Python 3', language: 'python',
};
const nbJulia: Notebook = {
  cells: [], kernelspecName: 'julia-1.10',
  kernelDisplayName: 'Julia 1.10', language: 'julia',
};

describe('resolveNotebookKernel cascade', () => {
  it('falls back to app default when no tier specifies', () => {
    const r = resolveNotebookKernel(baseElement, baseConfig, null);
    expect(r).toEqual({
      kind: 'external', baseUrl: 'http://localhost:8888',
      kernelName: 'python3', token: '',
    });
  });

  it('uses notebook metadata kernelspec when no tier specifies kernelName', () => {
    const r = resolveNotebookKernel(baseElement, baseConfig, nbJulia);
    expect(r.kind).toBe('external');
    expect((r as { kernelName: string }).kernelName).toBe('julia-1.10');
  });

  it('deck default overrides notebook metadata', () => {
    const r = resolveNotebookKernel(
      baseElement,
      { ...baseConfig, notebookKernel: { kind: 'external', kernelName: 'ir' } },
      nbJulia,
    );
    expect((r as { kernelName: string }).kernelName).toBe('ir');
  });

  it('element kernelName overrides deck default', () => {
    const r = resolveNotebookKernel(
      { ...baseElement, kernel: { kind: 'external', kernelName: 'python3' } },
      { ...baseConfig, notebookKernel: { kind: 'external', kernelName: 'ir' } },
      nbJulia,
    );
    expect((r as { kernelName: string }).kernelName).toBe('python3');
  });

  it('fields cascade independently — element baseUrl + deck kernelName', () => {
    const r = resolveNotebookKernel(
      { ...baseElement, kernel: { kind: 'external', baseUrl: 'http://other:9999' } },
      { ...baseConfig, notebookKernel: { kind: 'external', kernelName: 'julia-1.10' } },
      nbPython,
    );
    expect(r).toEqual({
      kind: 'external', baseUrl: 'http://other:9999',
      kernelName: 'julia-1.10', token: '',
    });
  });

  it('lite kind short-circuits — no external fields', () => {
    const r = resolveNotebookKernel(
      { ...baseElement, kernel: { kind: 'lite' } },
      { ...baseConfig, notebookKernel: { kind: 'external', baseUrl: 'http://x' } },
      nbPython,
    );
    expect(r).toEqual({ kind: 'lite' });
  });

  it('token cascades but defaults to empty string', () => {
    const r = resolveNotebookKernel(
      baseElement,
      { ...baseConfig, notebookKernel: { kind: 'external', token: 'deck-tok' } },
      nbPython,
    );
    expect((r as { token: string }).token).toBe('deck-tok');
    const r2 = resolveNotebookKernel(
      { ...baseElement, kernel: { kind: 'external', token: 'elem-tok' } },
      { ...baseConfig, notebookKernel: { kind: 'external', token: 'deck-tok' } },
      nbPython,
    );
    expect((r2 as { token: string }).token).toBe('elem-tok');
  });
});
