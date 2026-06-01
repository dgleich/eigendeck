import { describe, it, expect } from 'vitest';
import { createDefaultPresentation, createBlankSlide, NotebookElement } from './presentation';

describe('presentation types', () => {
  it('createDefaultPresentation returns valid structure', () => {
    const pres = createDefaultPresentation();
    expect(pres.title).toBe('Untitled Presentation');
    expect(pres.theme).toBe('white');
    expect(pres.slides).toHaveLength(1);
    expect(pres.slides[0].elements.length).toBeGreaterThan(0);
    expect(pres.slides[0].elements[0].type).toBe('text');
    expect(pres.config.width).toBe(1920);
    expect(pres.config.height).toBe(1080);
  });

  it('createBlankSlide generates unique ids', () => {
    const a = createBlankSlide();
    const b = createBlankSlide();
    expect(a.id).not.toBe(b.id);
    expect(a.notes).toBe('');
  });

  it('presentation.json roundtrips through JSON', () => {
    const pres = createDefaultPresentation();
    const json = JSON.stringify(pres);
    const parsed = JSON.parse(json);
    expect(parsed.title).toBe(pres.title);
    expect(parsed.slides).toHaveLength(pres.slides.length);
    expect(parsed.config).toEqual(pres.config);
  });

  it('NotebookElement roundtrips through JSON with both kernel kinds', () => {
    const external: NotebookElement = {
      id: 'nb-1', type: 'notebook',
      assetId: 'asset-1',
      kernel: { kind: 'external', baseUrl: 'http://localhost:8888', kernelName: 'julia-1.10' },
      preamble: 'using LinearAlgebra',
      autoRun: true,
      position: { x: 100, y: 100, width: 800, height: 600 },
    };
    const lite: NotebookElement = {
      id: 'nb-2', type: 'notebook',
      assetId: 'asset-2',
      kernel: { kind: 'lite' },
      position: { x: 0, y: 0, width: 1920, height: 1080 },
    };
    expect(JSON.parse(JSON.stringify(external))).toEqual(external);
    expect(JSON.parse(JSON.stringify(lite))).toEqual(lite);
  });

  it('NotebookElement with kernel absent is valid (resolves at render time)', () => {
    const el: NotebookElement = {
      id: 'nb-3', type: 'notebook',
      assetId: 'asset-3',
      position: { x: 0, y: 0, width: 100, height: 100 },
    };
    expect(el.kernel).toBeUndefined();
  });
});
