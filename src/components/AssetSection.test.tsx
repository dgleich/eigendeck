// Mount tests for AssetSection. The pure-logic math is covered by
// src/lib/assetUsage.test.ts; these tests catch render-shape bugs
// that pure-function tests can't — specifically the
// "Zustand selector returning object literal → infinite render loop"
// shape that crashed the app on Inspector open until a recent fix.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import { AssetSection } from './AssetSection';
import { usePresentationStore } from '../store/presentation';
import type { Presentation, SlideElement } from '../types/presentation';

// Mock the trust/gate modules AssetSection dynamically imports so we can put an
// asset into the "trusted deck, this file unapproved" state. Defaults match the
// pre-trust world (untrusted), so the other mount tests are unaffected.
vi.mock('../lib/trustStore', () => ({
  isTrusted: vi.fn(async () => false),
  isPathApproved: vi.fn(async () => false),
}));
vi.mock('../lib/assetGate', () => ({
  resolveAndGate: vi.fn(async () => ({ ok: true, canonicalPath: '/path/to/talk/images/chart.svg', bytes: new Uint8Array() })),
  // refreshTrust now uses the bounded decision read (no bytes needed for the checkbox).
  resolveAndGateDecision: vi.fn(async () => ({ ok: true, canonicalPath: '/path/to/talk/images/chart.svg', bytes: null })),
}));

const mockedInvoke = vi.mocked(invoke);

function img(id: string, assetId = 'A'): SlideElement {
  return {
    id, type: 'image', assetId,
    position: { x: 0, y: 0, width: 100, height: 100 },
  } as SlideElement;
}

function deckWith(elementsPerSlide: SlideElement[][]): Presentation {
  return {
    title: 'Test', theme: 'white',
    slides: elementsPerSlide.map((els, i) => ({
      id: `slide-${i + 1}`, elements: els, notes: '',
    })),
    config: { transition: 'slide', backgroundTransition: 'fade', width: 1920, height: 1080 },
  };
}

// Default meta + history responses — Tauri commands always succeed.
// Uses `in`-checks (not `??`) so an explicit `null` in the caller's
// override actually reaches the meta object — `??` would replace it
// with the default and make "path: null" untestable.
function setupHappyInvoke(meta: {
  asset_id: string;
  path?: string | null;
  external_path?: string | null;
  external_mtime?: string | null;
  mime_type?: string | null;
  auto_reload?: string | null;
  hash?: string | null;
}) {
  mockedInvoke.mockImplementation(async (cmd: string) => {
    switch (cmd) {
      case 'db_get_asset_meta_by_id':
        return {
          asset_id: meta.asset_id,
          path: 'path' in meta ? meta.path : 'chart.svg',
          external_path: 'external_path' in meta ? meta.external_path : 'images/chart.svg',
          external_mtime: 'external_mtime' in meta ? meta.external_mtime : '2026-05-27T10:00:00.000Z',
          mime_type: 'mime_type' in meta ? meta.mime_type : 'image/svg+xml',
          auto_reload: 'auto_reload' in meta ? meta.auto_reload : null,
          hash: 'hash' in meta ? meta.hash : 'h',
        };
      case 'db_get_asset_history':
        return [
          { asset_id: meta.asset_id, valid_from: '2026-05-27T10:00:00.000Z',
            valid_to: null, size: 42, hash: 'h',
            mime_type: 'mime_type' in meta ? meta.mime_type : 'image/svg+xml',
            external_mtime: null },
        ];
      default:
        return null;
    }
  });
}

describe('AssetSection — mount', () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    // Default store state: saved project, watch enabled by default. Each
    // test calls setupHappyInvoke + setState to configure.
    usePresentationStore.setState({
      projectPath: '/path/to/talk',
      presentation: deckWith([]),
    });
  });

  it('mounts on a shared-asset deck without infinite render loop', async () => {
    // 3 elements all bound to asset A — the exact shape that bit us
    // when AssetSection's selector returned an object literal.
    setupHappyInvoke({ asset_id: 'A' });
    usePresentationStore.setState({
      projectPath: '/path/to/talk',
      presentation: deckWith([
        [img('e1', 'A')],
        [img('e2', 'A')],
        [img('e3', 'A')],
      ]),
    });

    render(<AssetSection assetId="A" elementId="e2" />);

    // Wait for the async meta fetch to settle and the usage caption
    // to render. If the component infinite-loops, React eventually
    // throws "Maximum update depth exceeded" and this waitFor times
    // out / errors. The assertion both confirms the math AND that the
    // mount didn't blow up.
    await waitFor(() => {
      expect(screen.getByText(/Used on 3 slides/i)).toBeInTheDocument();
    }, { timeout: 2000 });
  });

  it('renders "this slide only" caption for a solo asset', async () => {
    setupHappyInvoke({ asset_id: 'A' });
    usePresentationStore.setState({
      projectPath: '/path/to/talk',
      presentation: deckWith([[img('e1', 'A')]]),
    });

    render(<AssetSection assetId="A" elementId="e1" />);

    await waitFor(() => {
      expect(screen.getByText(/Used on this slide only/i)).toBeInTheDocument();
    });
  });

  it('renders "Used N times on this slide" when multiple copies on one slide', async () => {
    setupHappyInvoke({ asset_id: 'A' });
    usePresentationStore.setState({
      projectPath: '/path/to/talk',
      presentation: deckWith([
        [img('e1', 'A'), img('e2', 'A'), img('e3', 'A')],  // 3 copies, 1 slide
      ]),
    });

    render(<AssetSection assetId="A" elementId="e1" />);

    await waitFor(() => {
      expect(screen.getByText(/Used 3 times on this slide/i)).toBeInTheDocument();
    });
  });

  it('renders "Used N times across M slides" for the mixed case', async () => {
    setupHappyInvoke({ asset_id: 'A' });
    usePresentationStore.setState({
      projectPath: '/path/to/talk',
      presentation: deckWith([
        [img('e1', 'A'), img('e2', 'A')],  // 2 copies on slide 1
        [img('e3', 'A')],                   // 1 copy on slide 2
      ]),
    });

    render(<AssetSection assetId="A" elementId="e1" />);

    await waitFor(() => {
      expect(screen.getByText(/Used 3 times across 2 slides/i)).toBeInTheDocument();
    });
  });

  it('shows the embedded-snapshot note when there is no linked source file', async () => {
    // The internal storage path is no longer shown; only the Source file. When
    // it's absent the section says the asset is an embedded snapshot.
    setupHappyInvoke({ asset_id: 'A', external_path: null });
    usePresentationStore.setState({
      projectPath: '/path/to/talk',
      presentation: deckWith([[img('e1', 'A')]]),
    });

    render(<AssetSection assetId="A" elementId="e1" />);
    await waitFor(() => {
      expect(screen.getByText(/Embedded snapshot/i)).toBeInTheDocument();
    });
  });

  it('does not render asset controls when meta lookup returns null', async () => {
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'db_get_asset_meta_by_id') return null;
      if (cmd === 'db_get_asset_history') return [];
      return null;
    });
    usePresentationStore.setState({
      projectPath: '/path/to/talk',
      presentation: deckWith([[img('e1', 'A')]]),
    });

    render(<AssetSection assetId="A" elementId="e1" />);

    await waitFor(() => {
      expect(screen.getByText(/Not yet stored/i)).toBeInTheDocument();
    });
  });

  it('a trusted deck with an UNAPPROVED file cannot toggle "Watch this file" on', async () => {
    const ts = await import('../lib/trustStore');
    vi.mocked(ts.isTrusted).mockResolvedValue(true);
    vi.mocked(ts.isPathApproved).mockResolvedValue(false);   // trusted, but this file not approved
    setupHappyInvoke({ asset_id: 'A' });
    const base = deckWith([[img('e1', 'A')]]);
    usePresentationStore.setState({
      projectPath: '/path/to/talk',
      presentation: { ...base, config: { ...base.config, deckToken: 'tok' } },
    });

    render(<AssetSection assetId="A" elementId="e1" />);

    // The watch toggle must be disabled + unchecked, with the "not approved" reason.
    await waitFor(() => {
      expect(screen.getByText(/isn.t approved yet/i)).toBeInTheDocument();
    });
    const cb = screen.getByRole('checkbox', { name: /Watch this file/i }) as HTMLInputElement;
    expect(cb).toBeDisabled();
    expect(cb).not.toBeChecked();
  });
});
