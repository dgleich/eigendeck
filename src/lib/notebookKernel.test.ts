import { describe, it, expect } from 'vitest';
import { resolveNotebookKernel, findServerForKernel } from './notebookKernel';
import type { NotebookElement, PresentationConfig } from '../types/presentation';
import type { Notebook } from './notebookFormat';
import type { JupyterServerEntry } from './preferences';

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

const localPyServer: JupyterServerEntry = {
  label: 'localhost py', baseUrl: 'http://localhost:8888', token: '',
  availableKernels: ['python3', 'ir'],
};
const remoteJuliaServer: JupyterServerEntry = {
  label: 'remote julia', baseUrl: 'http://10.0.0.5:8888', token: 'tok',
  availableKernels: ['julia-1.10', 'python3'],
};

describe('findServerForKernel', () => {
  it('returns the first server whose availableKernels includes the name', () => {
    const reg = [localPyServer, remoteJuliaServer];
    expect(findServerForKernel('python3', reg)).toBe(localPyServer);
    expect(findServerForKernel('julia-1.10', reg)).toBe(remoteJuliaServer);
  });

  it('returns null when no server advertises the kernel', () => {
    expect(findServerForKernel('octave', [localPyServer, remoteJuliaServer])).toBeNull();
    expect(findServerForKernel('python3', [])).toBeNull();
  });

  it('skips servers without an availableKernels field (untested registry entries)', () => {
    const untested: JupyterServerEntry = {
      label: 'never tried', baseUrl: 'http://x', token: '',
    };
    expect(findServerForKernel('python3', [untested])).toBeNull();
    expect(findServerForKernel('python3', [untested, localPyServer])).toBe(localPyServer);
  });
});

describe('resolveNotebookKernel kernelName cascade', () => {
  it('falls back to python3 when no tier specifies and no notebook metadata', () => {
    const r = resolveNotebookKernel(baseElement, baseConfig, null, []);
    expect(r.kind).toBe('external');
    expect((r as { kernelName: string }).kernelName).toBe('python3');
  });

  it('uses notebook metadata kernelspec when no tier specifies kernelName', () => {
    const r = resolveNotebookKernel(baseElement, baseConfig, nbJulia, []);
    expect((r as { kernelName: string }).kernelName).toBe('julia-1.10');
  });

  it('deck default overrides notebook metadata', () => {
    const r = resolveNotebookKernel(
      baseElement,
      { ...baseConfig, notebookKernel: { kind: 'external', kernelName: 'ir' } },
      nbJulia, [],
    );
    expect((r as { kernelName: string }).kernelName).toBe('ir');
  });

  it('element kernelName overrides deck default', () => {
    const r = resolveNotebookKernel(
      { ...baseElement, kernel: { kind: 'external', kernelName: 'python3' } },
      { ...baseConfig, notebookKernel: { kind: 'external', kernelName: 'ir' } },
      nbJulia, [],
    );
    expect((r as { kernelName: string }).kernelName).toBe('python3');
  });

  it('lite kind short-circuits — no server lookup', () => {
    const r = resolveNotebookKernel(
      { ...baseElement, kernel: { kind: 'lite' } },
      baseConfig, nbPython,
      [localPyServer], // ignored
    );
    expect(r).toEqual({ kind: 'lite' });
  });
});

describe('resolveNotebookKernel server lookup', () => {
  it('attaches the matching server when the registry has one', () => {
    const r = resolveNotebookKernel(baseElement, baseConfig, nbPython,
      [localPyServer, remoteJuliaServer]);
    expect(r.kind).toBe('external');
    expect((r as { server: JupyterServerEntry | null }).server).toBe(localPyServer);
  });

  it('attaches null when no registered server has the kernel', () => {
    const r = resolveNotebookKernel(baseElement, baseConfig, nbJulia, [localPyServer]);
    expect((r as { server: JupyterServerEntry | null }).server).toBeNull();
  });

  it('uses the first matching server in registry order', () => {
    const second: JupyterServerEntry = {
      label: 'second py', baseUrl: 'http://x', token: '',
      availableKernels: ['python3'],
    };
    // First in registry wins.
    const r = resolveNotebookKernel(baseElement, baseConfig, nbPython,
      [localPyServer, second]);
    expect((r as { server: JupyterServerEntry | null }).server).toBe(localPyServer);
    // Reordering changes the match.
    const r2 = resolveNotebookKernel(baseElement, baseConfig, nbPython,
      [second, localPyServer]);
    expect((r2 as { server: JupyterServerEntry | null }).server).toBe(second);
  });
});
