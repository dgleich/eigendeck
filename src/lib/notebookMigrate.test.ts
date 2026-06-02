import { describe, it, expect, beforeEach } from 'vitest';
import { migrateLegacyNotebookTokens } from './notebookMigrate';
import { getPreference, setPreference } from './preferences';
import type { Presentation } from '../types/presentation';

function mkDeck(overrides?: Partial<Presentation>): Presentation {
  return {
    title: 'T', theme: 'white',
    slides: [{
      id: 's1', elements: [], notes: '',
    }],
    config: {
      transition: 'none', backgroundTransition: 'none',
      width: 1920, height: 1080,
    },
    ...overrides,
  };
}

beforeEach(() => {
  // Fresh registry per test.
  setPreference('jupyterServers', []);
});

describe('migrateLegacyNotebookTokens', () => {
  it('extracts element-level baseUrl + token into a new registry entry', () => {
    const deck = mkDeck();
    deck.slides[0].elements.push({
      id: 'n1', type: 'notebook', assetId: 'a1',
      position: { x: 0, y: 0, width: 1, height: 1 },
      // Legacy shape — TS doesn't know about these fields anymore,
      // but the on-disk JSON did. We cast through unknown.
      kernel: { kind: 'external', baseUrl: 'http://localhost:8888',
                token: 'abc', kernelName: 'python3' } as never,
    } as never);

    const mutated = migrateLegacyNotebookTokens(deck);
    expect(mutated).toBe(true);

    const registry = getPreference('jupyterServers');
    expect(registry).toHaveLength(1);
    expect(registry[0].baseUrl).toBe('http://localhost:8888');
    expect(registry[0].token).toBe('abc');

    const el = deck.slides[0].elements[0] as { kernel?: Record<string, unknown> };
    expect(el.kernel?.baseUrl).toBeUndefined();
    expect(el.kernel?.token).toBeUndefined();
    expect(el.kernel?.kernelName).toBe('python3');
    expect(el.kernel?.kind).toBe('external');
  });

  it('deduplicates against an existing registry entry by baseUrl', () => {
    setPreference('jupyterServers', [{
      label: 'mine', baseUrl: 'http://localhost:8888', token: 'existing',
    }]);

    const deck = mkDeck();
    deck.slides[0].elements.push({
      id: 'n1', type: 'notebook', assetId: 'a1',
      position: { x: 0, y: 0, width: 1, height: 1 },
      kernel: { kind: 'external', baseUrl: 'http://localhost:8888',
                token: 'fromdeck' } as never,
    } as never);

    migrateLegacyNotebookTokens(deck);

    const registry = getPreference('jupyterServers');
    expect(registry).toHaveLength(1);
    // Existing token wins; we don't overwrite.
    expect(registry[0].token).toBe('existing');
  });

  it('fills in token on existing registry entry that had none', () => {
    setPreference('jupyterServers', [{
      label: 'mine', baseUrl: 'http://localhost:8888', token: '',
    }]);

    const deck = mkDeck();
    deck.slides[0].elements.push({
      id: 'n1', type: 'notebook', assetId: 'a1',
      position: { x: 0, y: 0, width: 1, height: 1 },
      kernel: { kind: 'external', baseUrl: 'http://localhost:8888',
                token: 'fromdeck' } as never,
    } as never);

    migrateLegacyNotebookTokens(deck);

    const registry = getPreference('jupyterServers');
    expect(registry[0].token).toBe('fromdeck');
  });

  it('handles deck-level config.notebookKernel too', () => {
    const deck = mkDeck();
    (deck.config as { notebookKernel?: Record<string, unknown> }).notebookKernel = {
      kind: 'external', baseUrl: 'http://lab:9999', token: 'labkey',
    };

    migrateLegacyNotebookTokens(deck);

    const registry = getPreference('jupyterServers');
    expect(registry).toHaveLength(1);
    expect(registry[0].baseUrl).toBe('http://lab:9999');
    expect(registry[0].token).toBe('labkey');

    const cfg = deck.config as { notebookKernel?: Record<string, unknown> };
    expect(cfg.notebookKernel?.baseUrl).toBeUndefined();
    expect(cfg.notebookKernel?.token).toBeUndefined();
  });

  it('is idempotent on already-clean decks', () => {
    const deck = mkDeck();
    deck.slides[0].elements.push({
      id: 'n1', type: 'notebook', assetId: 'a1',
      position: { x: 0, y: 0, width: 1, height: 1 },
      kernel: { kind: 'external', kernelName: 'python3' },
    } as never);

    const mutated = migrateLegacyNotebookTokens(deck);
    expect(mutated).toBe(false);
    expect(getPreference('jupyterServers')).toHaveLength(0);
  });
});
