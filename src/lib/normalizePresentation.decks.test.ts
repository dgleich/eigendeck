// Transparency guarantee: the untrusted-content normalizer (audit H-1 + C-2) must
// NOT drop or reject any element in the decks we actually ship. This reads every
// examples/ and test-presentations/ .eigendeck, runs normalizeUntrustedElement over
// its current elements, and fails with a precise deck+element+reason if any real
// element would be dropped — so tightening the allowlist can never silently delete
// legitimate content.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { readdirSync, copyFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { normalizeUntrustedElement, normalizeUntrustedPresentation, isSafeCssValue, isSafeColor } from './normalizePresentation';
import type { SlideElement } from '../types/presentation';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

function deckFiles(): string[] {
  const files: string[] = [];
  for (const dir of ['examples', 'test-presentations']) {
    let entries: string[] = [];
    try { entries = readdirSync(dir); } catch { continue; }
    for (const f of entries) if (f.endsWith('.eigendeck')) files.push(join(dir, f));
  }
  return files;
}

// Read current elements AND the deck config from a deck via a TEMP COPY so the tracked
// file never gets a -wal/-shm sidecar (a read-only WAL open would otherwise leave one).
function readDeck(deckPath: string): { elements: Array<{ type: string; el: SlideElement }>; config: Record<string, unknown> } {
  const tmp = join(tmpdir(), `normdecktest-${process.pid}-${Math.abs(hashStr(deckPath))}`);
  copyFileSync(deckPath, tmp);
  try {
    const db = new Database(tmp, { readonly: true });
    try {
      const rows = db.prepare('SELECT type, data FROM elements WHERE valid_to IS NULL').all() as Array<{ type: string; data: string }>;
      const elements = rows.map((r) => {
        const el = JSON.parse(r.data) as SlideElement;
        if (!(el as { type?: string }).type) (el as { type?: string }).type = r.type; // type lives in its own column
        return { type: r.type, el };
      });
      let config: Record<string, unknown> = {};
      try {
        const cfg = db.prepare("SELECT value FROM presentation WHERE key = 'config'").get() as { value?: string } | undefined;
        if (cfg?.value) config = JSON.parse(cfg.value);
      } catch { /* deck without a config row */ }
      return { elements, config };
    } finally { db.close(); }
  } finally {
    for (const p of [tmp, `${tmp}-wal`, `${tmp}-shm`]) if (existsSync(p)) rmSync(p);
  }
}

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

// Human-readable reason the normalizer would drop this element (for diagnostics).
function dropReason(el: SlideElement): string | null {
  const a = el as { position?: { x?: unknown; y?: unknown; width?: unknown; height?: unknown }; color?: unknown; fontFamily?: unknown; fontSize?: unknown; type?: string };
  const finite = (n: unknown) => typeof n === 'number' && Number.isFinite(n);
  const p = a.position;
  if (!p || !finite(p.x) || !finite(p.y) || !finite(p.width) || !finite(p.height)) return `non-finite geometry: ${JSON.stringify(p)}`;
  const pad = (a as { padding?: { top?: unknown; right?: unknown; bottom?: unknown; left?: unknown } }).padding;
  if (pad != null && (typeof pad !== 'object' || !finite(pad.top) || !finite(pad.right) || !finite(pad.bottom) || !finite(pad.left))) return `non-finite padding: ${JSON.stringify(pad)}`;
  const bc = (a as { backgroundColor?: unknown }).backgroundColor;
  if (typeof a.color === 'string' && a.color.trim() !== '' && !isSafeColor(a.color)) return `unsafe color: ${JSON.stringify(a.color)}`;
  if (typeof bc === 'string' && bc.trim() !== '' && !isSafeColor(bc)) return `unsafe backgroundColor: ${JSON.stringify(bc)}`;
  if (a.type === 'text') {
    if (a.fontFamily != null && !isSafeCssValue(a.fontFamily)) return `unsafe fontFamily: ${JSON.stringify(a.fontFamily)}`;
    if (a.fontSize != null && !finite(a.fontSize)) return `non-finite fontSize: ${JSON.stringify(a.fontSize)}`;
  }
  return null;
}

describe('normalizer transparency on shipped decks', () => {
  const files = deckFiles();

  it('has decks to check', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it('drops no element and deletes no config.textSizes from any shipped deck', () => {
    const failures: string[] = [];
    let total = 0;
    for (const file of files) {
      let deck: ReturnType<typeof readDeck>;
      try { deck = readDeck(file); } catch (e) { failures.push(`${file}: could not read (${(e as Error).message})`); continue; }
      for (const { type, el } of deck.elements) {
        total++;
        if (normalizeUntrustedElement(el) === null) {
          failures.push(`${file}: dropped ${type} element ${(el as { id?: string }).id} — ${dropReason(el) ?? 'unknown'}`);
        }
      }
      // config.textSizes transparency: the normalizer must not delete a real entry.
      const ts = (deck.config as { textSizes?: Record<string, unknown> }).textSizes;
      if (ts) {
        const before = Object.keys(ts).length;
        normalizeUntrustedPresentation({ slides: [], config: deck.config as { textSizes?: Record<string, unknown> } });
        const after = Object.keys(ts).length;
        if (after !== before) failures.push(`${file}: config.textSizes lost ${before - after} entry(ies): ${JSON.stringify(ts)}`);
      }
    }
    // Surface the full list so a real regression is actionable, not just a count.
    expect(failures, `normalizer altered legit content in shipped decks:\n${failures.join('\n')}`).toEqual([]);
    expect(total).toBeGreaterThan(50); // sanity: we actually inspected real elements
  });
});
