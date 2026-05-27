// Tests for useImageSrc — the shared hook that picks between the
// raw-blob renderer (raster/svg) and the pdfium-rasterized PNG
// renderer (pdf). All three image surfaces (editor ImageBox,
// PresentImage, PresenterImage) route through this hook, so getting
// the branch right here covers all three.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import { useImageSrc } from './imageSrc';

const mockedInvoke = vi.mocked(invoke);

beforeEach(() => {
  let counter = 0;
  global.URL.createObjectURL = vi.fn(() => `blob:fake-${++counter}`);
  global.URL.revokeObjectURL = vi.fn();
  mockedInvoke.mockReset();
});

describe('useImageSrc', () => {
  it('kind=pdf routes through db_render_pdf_page (pdfium path)', async () => {
    const pdfPng = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9];
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'db_get_asset_cache') return null;
      if (cmd === 'db_render_pdf_page') return pdfPng;
      if (cmd === 'db_put_asset_cache') return undefined;
      throw new Error(`unexpected invoke: ${cmd}`);
    });

    const { result } = renderHook(() => useImageSrc('asset-pdf-1', 'pdf'));

    // Wait for the async render to settle and the URL to surface.
    await waitFor(() => expect(result.current).toMatch(/^blob:/));

    // Routes through pdfium — never asks for raw asset bytes through
    // db_get_asset (which is what useAssetUrl does).
    expect(mockedInvoke).toHaveBeenCalledWith(
      'db_render_pdf_page',
      expect.objectContaining({ assetId: 'asset-pdf-1', page: 0 }),
    );
    expect(mockedInvoke).not.toHaveBeenCalledWith(
      'db_get_asset_by_id',
      expect.anything(),
    );
  });

  it('kind=raster routes through useAssetUrl (raw blob)', async () => {
    const rasterBytes = [0xff, 0xd8, 0xff, 0xe0];  // jpeg
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'db_get_asset_by_id') return rasterBytes;
      if (cmd === 'db_get_asset_meta_by_id') return { mime_type: 'image/jpeg' };
      throw new Error(`unexpected invoke: ${cmd}`);
    });

    const { result } = renderHook(() => useImageSrc('asset-jpg-1', 'raster'));

    await waitFor(() => expect(result.current).toMatch(/^blob:/));

    // Raster takes the raw-blob path, never the pdfium path.
    expect(mockedInvoke).toHaveBeenCalledWith(
      'db_get_asset_by_id',
      { assetId: 'asset-jpg-1' },
    );
    expect(mockedInvoke).not.toHaveBeenCalledWith(
      'db_render_pdf_page',
      expect.anything(),
    );
  });

  it('kind=svg also takes the raw-blob path (browser renders SVG natively)', async () => {
    const svgBytes = Array.from(new TextEncoder().encode('<svg/>'));
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'db_get_asset_by_id') return svgBytes;
      if (cmd === 'db_get_asset_meta_by_id') return { mime_type: 'image/svg+xml' };
      throw new Error(`unexpected invoke: ${cmd}`);
    });

    const { result } = renderHook(() => useImageSrc('asset-svg-1', 'svg'));

    await waitFor(() => expect(result.current).toMatch(/^blob:/));

    expect(mockedInvoke).not.toHaveBeenCalledWith(
      'db_render_pdf_page',
      expect.anything(),
    );
  });

  it('kind=undefined defaults to the raw-blob path', async () => {
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'db_get_asset_by_id') return [1, 2, 3];
      if (cmd === 'db_get_asset_meta_by_id') return { mime_type: 'image/png' };
      throw new Error(`unexpected invoke: ${cmd}`);
    });

    const { result } = renderHook(() => useImageSrc('asset-legacy', undefined));

    await waitFor(() => expect(result.current).toMatch(/^blob:/));

    expect(mockedInvoke).not.toHaveBeenCalledWith(
      'db_render_pdf_page',
      expect.anything(),
    );
  });
});
