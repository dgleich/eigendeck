import { describe, it, expect } from 'vitest';
import { detectAssetKind, isNotebookFile } from './assetCache';

describe('detectAssetKind', () => {
  it('classifies by mime', () => {
    expect(detectAssetKind('foo', 'image/svg+xml')).toBe('svg');
    expect(detectAssetKind('foo', 'application/pdf')).toBe('pdf');
    expect(detectAssetKind('foo', 'image/png')).toBe('raster');
  });

  it('falls back to extension when mime is empty', () => {
    expect(detectAssetKind('x.svg')).toBe('svg');
    expect(detectAssetKind('x.SVGZ')).toBe('svg');
    expect(detectAssetKind('x.pdf')).toBe('pdf');
    expect(detectAssetKind('x.png')).toBe('raster');
    expect(detectAssetKind('no-extension')).toBe('raster');
  });
});

describe('isNotebookFile', () => {
  it('recognizes .ipynb extension', () => {
    expect(isNotebookFile('foo.ipynb')).toBe(true);
    expect(isNotebookFile('path/to/My Notebook.IPYNB')).toBe(true);
  });

  it('recognizes ipynb mime types', () => {
    expect(isNotebookFile('foo', 'application/x-ipynb+json')).toBe(true);
    expect(isNotebookFile('foo', 'application/x-ipynb')).toBe(true);
  });

  it('returns false for non-notebook files', () => {
    expect(isNotebookFile('foo.png')).toBe(false);
    expect(isNotebookFile('foo.json')).toBe(false);
    expect(isNotebookFile('notebook.html')).toBe(false);
    expect(isNotebookFile('foo', 'image/png')).toBe(false);
  });
});
