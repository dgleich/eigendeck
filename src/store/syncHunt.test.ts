// Sync/link persistence tests (from the 2026-09-24 bug hunt).
//
// Drives the REAL store actions + the REAL incremental save (subscriber diff →
// flushSqliteBatch) against a fake Tauri backend built on REAL SQLite
// (node:sqlite) using the SAME SQL statements as src-tauri/src/storage.rs, then
// "reopens" through the same db_load_presentation logic and compares against
// the session. Every named scenario is a real test: any finding fails it. Each
// test name carries its GitHub issue (#194-#201); those are OPEN bugs, so those
// tests FAIL until the persistence redesign fixes them. Tests tagged [guard]
// cover behaviour that already works and must stay green.
//
// Invariant under test: after a save, reopening reproduces the session exactly
// (per slide: same elements, same data + position, same order, same sync-group
// membership, same link pairings). Allowed normalizations: synced instance ids
// collapse to the canonical row id and syncId is re-derived.
//
// Report: .claude/notes/sync-link-hunt-2026-09-24.md. Usage:
//   npx vitest run src/store/syncHunt.test.ts                 # named scenarios (real tests)
//   HUNT_SCEN_OUT=/path/out.txt  ...                           # write each scenario's trace
//   HUNT=1 HUNT_SEEDS=40 HUNT_LEN=25 HUNT_OUT=/path/rep.txt ...  # randomized fuzz + shrinking
// Fuzz knobs: HUNT_FX=solo,syncgroup,linked,david  HUNT_ONLY=<ops>  HUNT_AVOID=undo,delete,
//   unlinkSynced,pasteJoin,promote,preflush (skip known triggers to find NEW classes)
//   HUNT_TARGET=<category> HUNT_SHRINK=<n> HUNT_ALL_OUT=<path>.  HUNT_ASSERT=1 makes findings fail.
// Modes: every = flush after every op; syncnow = flush right after sync/link ops only
// (current code: flushSyncLinkNow, everything else waits for the 1s debounce);
// batched = one flush per explicit flush/reopen op (the pre-006d924 behaviour).

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import {
  usePresentationStore, flushToSqlite, openSqliteProject, closeSqliteProject,
  undoWithNav, redoWithNav, seedUndoHistory,
} from './presentation';
import { pasteInternalClip } from '../lib/pasteClip';
import { detachDelta } from '../lib/syncLink';
import { offsetElement } from '../lib/offsetElement';
import type { EigendeckClip } from '../lib/clipboardModel';
import type { Presentation, Slide, SlideElement } from '../types/presentation';
import { createDefaultPresentation } from '../types/presentation';

const mockInvoke = vi.mocked(invoke);
// node:sqlite via getBuiltinModule (vite refuses to bundle a node: import in the jsdom env).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { DatabaseSync } = (process as any).getBuiltinModule('node:sqlite') as { DatabaseSync: any };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DatabaseSync = any;

// ─── Fake backend: real SQLite, storage.rs SQL ──────────────────────────────

const SCHEMA = `
CREATE TABLE IF NOT EXISTS _meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS presentation (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS slides (id TEXT NOT NULL, position INTEGER, notes TEXT, group_id TEXT, config TEXT,
  valid_from TEXT NOT NULL, valid_to TEXT, PRIMARY KEY (id, valid_from));
CREATE TABLE IF NOT EXISTS elements (id TEXT NOT NULL, type TEXT NOT NULL, data TEXT NOT NULL, link_id TEXT, asset_id TEXT,
  valid_from TEXT NOT NULL, valid_to TEXT, PRIMARY KEY (id, valid_from));
CREATE TABLE IF NOT EXISTS slide_elements (slide_id TEXT NOT NULL, element_id TEXT NOT NULL, z_order INTEGER NOT NULL,
  valid_from TEXT NOT NULL, valid_to TEXT, PRIMARY KEY (slide_id, element_id, valid_from));
CREATE INDEX IF NOT EXISTS idx_el_current ON elements(valid_to) WHERE valid_to IS NULL;
CREATE INDEX IF NOT EXISTS idx_el_id ON elements(id) WHERE valid_to IS NULL;
CREATE INDEX IF NOT EXISTS idx_se_slide ON slide_elements(slide_id) WHERE valid_to IS NULL;
CREATE INDEX IF NOT EXISTS idx_se_element ON slide_elements(element_id) WHERE valid_to IS NULL;
CREATE INDEX IF NOT EXISTS idx_slides_current ON slides(valid_to) WHERE valid_to IS NULL;
CREATE INDEX IF NOT EXISTS idx_el_link ON elements(link_id) WHERE valid_to IS NULL AND link_id IS NOT NULL;
`;

type Row = Record<string, unknown>;

class FakeBackend {
  files = new Map<string, DatabaseSync>();
  db: DatabaseSync | null = null;
  seq = 0;
  unknown = new Set<string>();
  log: string[] = [];
  /** Test hook: db_write_slide fails for this slide id (a backend error). */
  failWriteSlide: string | null = null;

  ts(): string { return `T${String(++this.seq).padStart(9, '0')}`; }
  get c(): DatabaseSync { if (!this.db) throw new Error('No database open'); return this.db; }
  fileDb(path: string): DatabaseSync {
    let d = this.files.get(path);
    if (!d) { d = new DatabaseSync(':memory:'); d.exec(SCHEMA); this.files.set(path, d); }
    return d;
  }
  tx<T>(fn: () => T): T {
    this.c.exec('BEGIN');
    try { const r = fn(); this.c.exec('COMMIT'); return r; } catch (e) { this.c.exec('ROLLBACK'); throw e; }
  }

  /** Seed a deck like `db_import_json` (true-sync dedup by syncId + identical data). */
  seed(path: string, p: Presentation): void {
    const d = this.fileDb(path);
    const ts = this.ts();
    d.prepare("INSERT OR REPLACE INTO presentation (key,value) VALUES ('title',?)").run(p.title);
    d.prepare("INSERT OR REPLACE INTO presentation (key,value) VALUES ('theme',?)").run(p.theme);
    d.prepare("INSERT OR REPLACE INTO presentation (key,value) VALUES ('config',?)").run(JSON.stringify(p.config));
    const syncMap = new Map<string, string>();
    p.slides.forEach((s, i) => {
      d.prepare('INSERT INTO slides (id,position,notes,group_id,config,valid_from,valid_to) VALUES (?,?,?,?,NULL,?,NULL)')
        .run(s.id, i, s.notes || '', s.groupId ?? null, ts);
      s.elements.forEach((el, z) => {
        const { syncId, linkId, assetId, src, demoSrc, ...data } = el as unknown as Row;
        void assetId; void src; void demoSrc;
        if (syncId && syncMap.has(syncId as string)) {
          d.prepare('INSERT INTO slide_elements VALUES (?,?,?,?,NULL)').run(s.id, syncMap.get(syncId as string)!, z, ts);
          return;
        }
        if (syncId) syncMap.set(syncId as string, el.id);
        d.prepare('INSERT INTO elements (id,type,data,link_id,asset_id,valid_from,valid_to) VALUES (?,?,?,?,NULL,?,NULL)')
          .run(el.id, el.type, JSON.stringify(data), (linkId as string) ?? null, ts);
        d.prepare('INSERT INTO slide_elements VALUES (?,?,?,?,NULL)').run(s.id, el.id, z, ts);
      });
    });
  }

  /** build_presentation_value (current, or as-of `at` like db_get_state_at). */
  build(at?: string): Presentation {
    const c = this.c;
    const alive = at ? 'valid_from <= ? AND (valid_to IS NULL OR valid_to > ?)' : 'valid_to IS NULL';
    const args = at ? [at, at] : [];
    let title = 'Untitled', theme = 'white'; let config: unknown = {};
    for (const r of c.prepare('SELECT key, value FROM presentation').all() as Row[]) {
      if (r.key === 'title') title = r.value as string;
      else if (r.key === 'theme') theme = r.value as string;
      else if (r.key === 'config') { try { config = JSON.parse(r.value as string); } catch { /* keep */ } }
    }
    const elements = new Map<string, { data: Row; link: string | null; asset: string | null }>();
    for (const r of c.prepare(`SELECT id, data, link_id, asset_id FROM elements WHERE ${alive}`).all(...args) as Row[]) {
      let parsed: Row; try { parsed = JSON.parse(r.data as string); } catch { parsed = null as unknown as Row; }
      elements.set(r.id as string, { data: parsed, link: r.link_id as string | null, asset: r.asset_id as string | null });
    }
    const seBySlide = new Map<string, string[]>(); const elCount = new Map<string, number>();
    // Mirrors storage.rs: the live loader only counts junctions on LIVE slides (#199);
    // the as-of (db_get_state_at) path is unchanged.
    const seSql = at
      ? `SELECT slide_id, element_id, z_order FROM slide_elements WHERE ${alive} ORDER BY slide_id, z_order`
      : 'SELECT se.slide_id, se.element_id, se.z_order FROM slide_elements se JOIN slides s ON s.id = se.slide_id AND s.valid_to IS NULL WHERE se.valid_to IS NULL ORDER BY se.slide_id, se.z_order';
    for (const r of c.prepare(seSql).all(...args) as Row[]) {
      const sid = r.slide_id as string, eid = r.element_id as string;
      if (!seBySlide.has(sid)) seBySlide.set(sid, []);
      // Mirrors storage.rs: one element at most once per slide (a #195 duplicate
      // junction is skipped, keeping the lowest z).
      if (seBySlide.get(sid)!.includes(eid)) continue;
      seBySlide.get(sid)!.push(eid);
      elCount.set(eid, (elCount.get(eid) ?? 0) + 1);
    }
    const slides: Slide[] = [];
    for (const r of c.prepare(`SELECT id, position, notes, group_id, config FROM slides WHERE ${alive} ORDER BY position`).all(...args) as Row[]) {
      const els: SlideElement[] = [];
      for (const eid of seBySlide.get(r.id as string) ?? []) {
        const e = elements.get(eid); if (!e) continue;
        const el = JSON.parse(JSON.stringify(e.data)) as Row;
        if (el && typeof el === 'object') {
          if (e.link) el.linkId = e.link;
          if (e.asset) el.assetId = e.asset;
          if ((elCount.get(eid) ?? 0) > 1) el.syncId = eid;
        }
        els.push(el as unknown as SlideElement);
      }
      const slide: Row = { id: r.id, elements: els, notes: (r.notes as string) ?? '' };
      if (r.group_id) slide.groupId = r.group_id;
      if (r.config) { try { Object.assign(slide, JSON.parse(r.config as string)); } catch { /* ignore */ } }
      slides.push(slide as unknown as Slide);
    }
    return { title, theme, slides, config } as unknown as Presentation;
  }

  handle(cmd: string, a: Row = {}): unknown {
    const c = () => this.c;
    switch (cmd) {
      case 'db_open': this.db = this.fileDb(a.path as string); return undefined;
      case 'db_close': this.db = null; return undefined;
      case 'db_checkpoint': case 'db_get_project_id': return cmd === 'db_get_project_id' ? 'pid' : undefined;
      case 'db_load_presentation': return JSON.stringify(this.build());
      case 'db_get_state_at': return JSON.stringify(this.build(a.at as string));
      case 'db_get_history_timestamps': {
        const ts = new Set<string>();
        for (const r of c().prepare('SELECT valid_from FROM elements').all() as Row[]) ts.add(r.valid_from as string);
        for (const r of c().prepare('SELECT valid_from FROM slides').all() as Row[]) ts.add(r.valid_from as string);
        return JSON.stringify([...ts].sort().map((t) => ({ timestamp: t, summary: '' })));
      }
      case 'db_update_presentation':
        c().prepare('INSERT OR REPLACE INTO presentation (key, value) VALUES (?, ?)').run(a.key as string, a.value as string);
        return undefined;
      case 'db_add_slide': {
        const ts = this.ts();
        c().prepare("INSERT INTO slides (id, position, notes, group_id, config, valid_from, valid_to) VALUES (?, ?, '', ?, NULL, ?, NULL)")
          .run(a.id as string, a.position as number, (a.groupId as string) ?? null, ts);
        return undefined;
      }
      // Mirrors storage.rs db_write_slide: upsert rows (new version only when they
      // differ or have duplicates), then set this slide's junctions to exactly the list.
      case 'db_write_slide': {
        const ts = this.ts();
        const els = a.elements as { id: string; type: string; data: string; linkId: string | null; assetId: string | null }[];
        if (a.slideId === this.failWriteSlide) throw new Error(`write failed for ${a.slideId}`);
        const seen = new Set<string>();
        for (const e of els) {
          if (seen.has(e.id)) throw new Error(`element ${e.id} appears twice on slide ${a.slideId}`);
          seen.add(e.id);
        }
        this.tx(() => {
          for (const e of els) {
            const live = (c().prepare('SELECT COUNT(*) AS n FROM elements WHERE id = ? AND valid_to IS NULL').get(e.id) as Row).n as number;
            // Mirrors storage.rs: data compares as JSON values, so key order is no change.
            const cur = live === 1 ? c().prepare('SELECT type, data, link_id, asset_id FROM elements WHERE id = ? AND valid_to IS NULL').get(e.id) as Row : null;
            const same = !!cur && cur.type === e.type && cur.link_id === (e.linkId ?? null) && cur.asset_id === (e.assetId ?? null)
              && canon(JSON.parse(cur.data as string)) === canon(JSON.parse(e.data));
            if (!same) {
              c().prepare('UPDATE elements SET valid_to = ? WHERE id = ? AND valid_to IS NULL').run(ts, e.id);
              c().prepare('INSERT INTO elements (id, type, data, link_id, asset_id, valid_from, valid_to) VALUES (?, ?, ?, ?, ?, ?, NULL)')
                .run(e.id, e.type, e.data, e.linkId ?? null, e.assetId ?? null, ts);
            }
          }
          const current = new Map<string, number[]>();
          for (const r of c().prepare('SELECT element_id, z_order FROM slide_elements WHERE slide_id = ? AND valid_to IS NULL').all(a.slideId as string) as Row[]) {
            const k = r.element_id as string;
            current.set(k, [...(current.get(k) ?? []), r.z_order as number]);
          }
          const desired = new Map(els.map((e, z) => [e.id, z]));
          for (const [id, zs] of current) {
            const z = desired.get(id);
            if (!(z !== undefined && zs.length === 1 && zs[0] === z))
              c().prepare('UPDATE slide_elements SET valid_to = ? WHERE slide_id = ? AND element_id = ? AND valid_to IS NULL').run(ts, a.slideId as string, id);
          }
          els.forEach((e, z) => {
            const zs = current.get(e.id);
            if (!(zs && zs.length === 1 && zs[0] === z))
              c().prepare('INSERT INTO slide_elements (slide_id, element_id, z_order, valid_from, valid_to) VALUES (?, ?, ?, ?, NULL)').run(a.slideId as string, e.id, z, ts);
          });
        });
        return undefined;
      }
      // Mirrors storage.rs db_set_slides: upsert slide rows, close slides not listed (with junctions).
      case 'db_set_slides': {
        const ts = this.ts();
        const ss = a.slides as { id: string; position: number; notes: string; groupId: string | null; config: string }[];
        this.tx(() => {
          const keep = new Set(ss.map((s) => s.id));
          for (const r of c().prepare('SELECT id FROM slides WHERE valid_to IS NULL').all() as Row[]) {
            if (keep.has(r.id as string)) continue;
            c().prepare('UPDATE slides SET valid_to = ? WHERE id = ? AND valid_to IS NULL').run(ts, r.id as string);
            c().prepare('UPDATE slide_elements SET valid_to = ? WHERE slide_id = ? AND valid_to IS NULL').run(ts, r.id as string);
          }
          for (const s of ss) {
            const cfg = s.config === '' ? null : s.config;
            const n = (c().prepare('SELECT COUNT(*) AS n FROM slides WHERE id = ? AND valid_to IS NULL').get(s.id) as Row).n as number;
            const same = n === 1 && !!(c().prepare('SELECT (position = ? AND notes IS ? AND group_id IS ? AND config IS ?) AS s FROM slides WHERE id = ? AND valid_to IS NULL')
              .get(s.position, s.notes, s.groupId ?? null, cfg, s.id) as Row).s;
            if (!same) {
              c().prepare('UPDATE slides SET valid_to = ? WHERE id = ? AND valid_to IS NULL').run(ts, s.id);
              c().prepare('INSERT INTO slides (id, position, notes, group_id, config, valid_from, valid_to) VALUES (?, ?, ?, ?, ?, ?, NULL)')
                .run(s.id, s.position, s.notes, s.groupId ?? null, cfg, ts);
            }
          }
        });
        return undefined;
      }
      case 'db_delete_slide': {
        const ts = this.ts();
        this.tx(() => {
          c().prepare('UPDATE slides SET valid_to = ? WHERE id = ? AND valid_to IS NULL').run(ts, a.slideId as string);
          c().prepare('UPDATE slide_elements SET valid_to = ? WHERE slide_id = ? AND valid_to IS NULL').run(ts, a.slideId as string);
        });
        return undefined;
      }
      case 'db_update_slide': {
        const ts = this.ts();
        this.tx(() => {
          const cur = c().prepare('SELECT position, notes, group_id, config FROM slides WHERE id = ? AND valid_to IS NULL').get(a.slideId as string) as Row | undefined;
          if (!cur) throw new Error('Query returned no rows');
          c().prepare('UPDATE slides SET valid_to = ? WHERE id = ? AND valid_to IS NULL').run(ts, a.slideId as string);
          const cfg = a.config == null ? (cur.config as string | null) : (a.config === '' ? null : a.config as string);
          c().prepare('INSERT INTO slides (id, position, notes, group_id, config, valid_from, valid_to) VALUES (?, ?, ?, ?, ?, ?, NULL)')
            .run(a.slideId as string, (a.position as number) ?? (cur.position as number),
              (a.notes as string) ?? ((cur.notes as string) ?? ''), (a.groupId as string) ?? (cur.group_id as string | null), cfg, ts);
        });
        return undefined;
      }
      case 'db_add_element': {
        const ts = this.ts();
        this.tx(() => {
          c().prepare('INSERT INTO elements (id, type, data, link_id, asset_id, valid_from, valid_to) VALUES (?, ?, ?, ?, ?, ?, NULL)')
            .run(a.elementId as string, a.elementType as string, a.data as string, (a.linkId as string) ?? null, (a.assetId as string) ?? null, ts);
          c().prepare('INSERT INTO slide_elements (slide_id, element_id, z_order, valid_from, valid_to) VALUES (?, ?, ?, ?, NULL)')
            .run(a.slideId as string, a.elementId as string, a.zOrder as number, ts);
        });
        return undefined;
      }
      case 'db_add_element_to_slide': {
        const ts = this.ts();
        const exists = c().prepare('SELECT 1 FROM slide_elements WHERE slide_id = ? AND element_id = ? AND valid_to IS NULL').get(a.slideId as string, a.elementId as string);
        if (!exists) {
          c().prepare('INSERT INTO slide_elements (slide_id, element_id, z_order, valid_from, valid_to) VALUES (?, ?, ?, ?, NULL)')
            .run(a.slideId as string, a.elementId as string, a.zOrder as number, ts);
        }
        return undefined;
      }
      case 'db_element_exists':
        return !!c().prepare('SELECT 1 FROM elements WHERE id = ? AND valid_to IS NULL').get(a.elementId as string);
      case 'db_remove_element_from_slide': {
        const ts = this.ts();
        c().prepare('UPDATE slide_elements SET valid_to = ? WHERE slide_id = ? AND element_id = ? AND valid_to IS NULL').run(ts, a.slideId as string, a.elementId as string);
        return undefined;
      }
      case 'db_update_element': {
        const ts = this.ts();
        this.tx(() => {
          const cur = c().prepare('SELECT type FROM elements WHERE id = ? AND valid_to IS NULL').get(a.id as string) as Row | undefined;
          if (!cur) return;
          c().prepare('UPDATE elements SET valid_to = ? WHERE id = ? AND valid_to IS NULL').run(ts, a.id as string);
          c().prepare('INSERT INTO elements (id, type, data, link_id, asset_id, valid_from, valid_to) VALUES (?, ?, ?, ?, ?, ?, NULL)')
            .run(a.id as string, cur.type as string, a.data as string, (a.linkId as string) ?? null, (a.assetId as string) ?? null, ts);
        });
        return undefined;
      }
      case 'db_update_z_order': {
        const ts = this.ts();
        this.tx(() => {
          c().prepare('UPDATE slide_elements SET valid_to = ? WHERE slide_id = ? AND element_id = ? AND valid_to IS NULL').run(ts, a.slideId as string, a.elementId as string);
          c().prepare('INSERT INTO slide_elements (slide_id, element_id, z_order, valid_from, valid_to) VALUES (?, ?, ?, ?, NULL)')
            .run(a.slideId as string, a.elementId as string, a.newZOrder as number, ts);
        });
        return undefined;
      }
      case 'db_list_linked_assets': case 'db_load_math_cache': return [];
      default:
        this.unknown.add(cmd);
        return undefined;
    }
  }

  /** DB invariants over CURRENT rows. */
  dbViolations(): string[] {
    const c = this.c, out: string[] = [];
    for (const r of c.prepare('SELECT id, COUNT(*) n FROM elements WHERE valid_to IS NULL GROUP BY id HAVING n > 1').all() as Row[])
      out.push(`db:duprow ${r.id} x${r.n}`);
    for (const r of c.prepare('SELECT slide_id, element_id, COUNT(*) n FROM slide_elements WHERE valid_to IS NULL GROUP BY 1,2 HAVING n > 1').all() as Row[])
      out.push(`db:dupjunction ${r.slide_id}/${r.element_id} x${r.n}`);
    for (const r of c.prepare(`SELECT se.slide_id, se.element_id FROM slide_elements se WHERE se.valid_to IS NULL
        AND NOT EXISTS (SELECT 1 FROM elements e WHERE e.id = se.element_id AND e.valid_to IS NULL)`).all() as Row[])
      out.push(`db:dangling-junction ${r.slide_id}/${r.element_id}`);
    for (const r of c.prepare(`SELECT se.slide_id, se.element_id FROM slide_elements se WHERE se.valid_to IS NULL
        AND NOT EXISTS (SELECT 1 FROM slides s WHERE s.id = se.slide_id AND s.valid_to IS NULL)`).all() as Row[])
      out.push(`db:junction-on-dead-slide ${r.slide_id}/${r.element_id}`);
    for (const r of c.prepare('SELECT id, COUNT(*) n FROM slides WHERE valid_to IS NULL GROUP BY id HAVING n > 1').all() as Row[])
      out.push(`db:dupslide ${r.id} x${r.n}`);
    return out;
  }
  zTies(): string[] {
    return (this.c.prepare('SELECT slide_id, z_order, COUNT(*) n FROM slide_elements WHERE valid_to IS NULL GROUP BY 1,2 HAVING n > 1').all() as Row[])
      .map((r) => `db:ztie ${r.slide_id}@${r.z_order} x${r.n}`);
  }
}

// ─── Comparison ─────────────────────────────────────────────────────────────

const IDK = ['id', 'syncId', '_syncId', 'linkId', '_linkId', 'src', 'demoSrc'];
function canon(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v as Row).filter((k) => (v as Row)[k] !== undefined).sort()
      .map((k) => `${JSON.stringify(k)}:${canon((v as Row)[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}
function dataKey(el: SlideElement): string {
  const o: Row = { ...(el as unknown as Row) };
  for (const k of IDK) delete o[k];
  return canon(o);
}
function short(el: SlideElement): string {
  const e = el as unknown as Row;
  return `${e.id}${e.syncId ? `~s:${e.syncId}` : ''}${e._syncId ? `~_s:${e._syncId}` : ''}${e.linkId ? `~l:${e.linkId}` : ''}${e._linkId ? `~_l:${e._linkId}` : ''}(${(e as { html?: string }).html},${(e.position as Row)?.x},${(e.position as Row)?.y})`;
}
export function deckSummary(p: Presentation): string {
  return p.slides.map((s, i) => `  [${i}] ${s.id}: ${s.elements.map(short).join(' | ')}`).join('\n');
}

function partition(p: Presentation, keyOf: (el: SlideElement) => string | undefined): string {
  const groups = new Map<string, string[]>();
  p.slides.forEach((s, i) => s.elements.forEach((el, j) => {
    const k = keyOf(el); if (!k) return;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(`${i}:${j}`);
  }));
  return [...groups.values()].filter((g) => g.length > 1).map((g) => g.join(',')).sort().join(' / ');
}

/** Session vs reopen. Returns violation strings (category first). */
function compareReopen(S: Presentation, R: Presentation): string[] {
  const out: string[] = [];
  const sIds = S.slides.map((s) => s.id).join(','), rIds = R.slides.map((s) => s.id).join(',');
  if (sIds !== rIds) { out.push(`reopen:slides session=[${sIds}] reopen=[${rIds}]`); return out; }
  // #191 shape: an element that is UNSYNCED in the session comes back SYNCED.
  S.slides.forEach((ss, i) => {
    const rs = R.slides[i];
    const rUnsynced = rs.elements.filter((e) => !e.syncId).map(dataKey);
    const rSynced = new Set(rs.elements.filter((e) => e.syncId).map(dataKey));
    for (const se of ss.elements) {
      if (se.syncId) continue;
      const k = dataKey(se); const at = rUnsynced.indexOf(k);
      if (at >= 0) { rUnsynced.splice(at, 1); continue; }
      if (rSynced.has(k)) out.push(`reopen:unsynced-came-back-synced slide ${i} ${se.id}${se._syncId ? ' (freed)' : ''}`);
    }
  });
  let structural = false;
  S.slides.forEach((ss, i) => {
    const rs = R.slides[i];
    if (ss.elements.length !== rs.elements.length) {
      out.push(`reopen:count slide ${i} session=${ss.elements.length} reopen=${rs.elements.length}`);
      structural = true; return;
    }
    const sk = ss.elements.map(dataKey), rk = rs.elements.map(dataKey);
    if (sk.join('|') !== rk.join('|')) {
      structural = true;
      if ([...sk].sort().join('|') === [...rk].sort().join('|')) out.push(`reopen:order slide ${i}`);
      else out.push(`reopen:data slide ${i}`);
      return;
    }
    ss.elements.forEach((se, j) => {
      const re = rs.elements[j];
      if ((se.linkId ?? null) !== (re.linkId ?? null)) out.push(`reopen:link slide ${i} el ${j} session=${se.linkId} reopen=${re.linkId}`);
      if ((se._syncId ?? null) !== (re._syncId ?? null) || (se._linkId ?? null) !== (re._linkId ?? null))
        out.push(`remembered:lost slide ${i} el ${j}`);
    });
  });
  if (!structural) {
    const sp = partition(S, (el) => el.syncId);
    const rp = partition(R, (el) => el.id);
    if (sp !== rp) out.push(`reopen:sync session={${sp}} reopen={${rp}}`);
    // Latent: an UNSYNCED session instance whose id is not its DB row id. Later
    // per-id writes (update/delete/z-order) for it will miss.
    S.slides.forEach((ss, i) => ss.elements.forEach((se, j) => {
      const re = R.slides[i].elements[j];
      const synced = partition(S, (el) => el.syncId).split(/[ ,/]+/).includes(`${i}:${j}`);
      if (!synced && se.id !== re.id) out.push(`latent:alias slide ${i} el ${j} session-id=${se.id} row=${re.id}`);
    }));
  }
  return out;
}

function sessionViolations(p: Presentation): string[] {
  const out: string[] = [];
  const bySync = new Map<string, SlideElement[]>();
  const syncCount = new Map<string, number>(), linkCount = new Map<string, number>();
  for (const s of p.slides) {
    const ids = s.elements.map((e) => e.id);
    if (new Set(ids).size !== ids.length) out.push(`session:dupid slide ${s.id}`);
    for (const el of s.elements) {
      if (el.syncId) { if (!bySync.has(el.syncId)) bySync.set(el.syncId, []); bySync.get(el.syncId)!.push(el); }
      const sid = el.syncId ?? el._syncId; if (sid) syncCount.set(sid, (syncCount.get(sid) ?? 0) + 1);
      const lid = el.linkId ?? el._linkId; if (lid) linkCount.set(lid, (linkCount.get(lid) ?? 0) + 1);
    }
  }
  for (const [g, els] of bySync) {
    if (els.length > 1 && new Set(els.map(dataKey)).size > 1) out.push(`session:syncdata group ${g}`);
  }
  for (const s of p.slides) for (const el of s.elements) {
    if (el.syncId && syncCount.get(el.syncId) === 1) out.push(`session:lone-sync ${el.id}`);
    if (el.linkId && linkCount.get(el.linkId) === 1) out.push(`session:lone-link ${el.id}`);
  }
  return out;
}

// ─── Operations ─────────────────────────────────────────────────────────────

type Op = { op: string; a: number; b: number; c: number };
type Mode = 'every' | 'syncnow' | 'batched';
interface RunResult { findings: string[]; trace: string[]; info: string[] }

const SYNC_OPS = new Set(['free', 'resync', 'unlink', 'relink', 'link', 'promote', 'paste']);

let uuidN = 0; let clock = 0;
const st = () => usePresentationStore.getState();
const pick = <T,>(arr: T[], k: number): T | undefined => (arr.length ? arr[k % arr.length] : undefined);
let textN = 0;
function newText(x: number): SlideElement {
  return { id: crypto.randomUUID(), type: 'text', preset: 'textbox', html: `n${++textN}`, verticalAlign: 'top',
    position: { x, y: 100, width: 300, height: 100 } } as unknown as SlideElement;
}

const AVOID = new Set((process.env.HUNT_AVOID || '').split(',').filter(Boolean));
const ONLY = new Set((process.env.HUNT_ONLY || '').split(',').filter(Boolean));
/** Apply one op. Returns a trace string, or null when not applicable. */
function applyOp(o: Op, ctx: { clip: EigendeckClip | null }): string | null {
  const s = st(); const slides = s.presentation.slides; const cur = s.currentSlideIndex;
  const els = slides[cur]?.elements ?? [];
  const nS = slides.length;
  if (AVOID.has('undo') && (o.op === 'undo' || o.op === 'redo')) return null;
  if (AVOID.has('delete') && (o.op === 'delete' || o.op === 'deleteSlide')) return null;
  if (ONLY.size && !ONLY.has(o.op)) return null;
  if (AVOID.has('unlinkSynced') && (o.op === 'unlink' || o.op === 'relink')) {
    const want = o.op === 'unlink' ? els.filter((x) => x.linkId) : els.filter((x) => x._linkId);
    const e = pick(want, o.a); if (e?.syncId) return null;
  }
  if (AVOID.has('pasteJoin') && o.op === 'paste' && ctx.clip?.kind === 'elements') {
    const ce = ctx.clip.elements![0];
    if (ce.syncId && slides[cur].id !== ctx.clip.fromSlideId) {
      if (els.some((e) => e.syncId === ce.syncId)) return null;
      const peer = slides.flatMap((x) => x.elements).find((e) => e.syncId === ce.syncId);
      if (peer && dataKey(peer) !== dataKey(ce)) return null;
    }
  }
  if (AVOID.has('promote') && o.op === 'promote') {
    const cands = slides.flatMap((sl) => sl.elements).filter((e) => e.linkId && !e.syncId);
    const e = pick(cands, o.a);
    if (e) {
      const members = slides.map((sl) => sl.elements.filter((x) => x.linkId === e.linkId));
      if (members.some((m) => m.length > 1) || members.flat().some((x) => x.syncId)) return null;
    }
  }
  switch (o.op) {
    case 'select': { const i = o.a % nS; s.selectSlide(i); return `selectSlide(${i})`; }
    case 'addText': { const el = newText(100 + (o.a % 7) * 50); s.addElement(el); return `addElement(${el.id})`; }
    case 'dupSlide': s.duplicateSlide(cur); return `duplicateSlide(${cur})`;
    case 'buildSlide': s.addBuildSlide(); return `addBuildSlide() on ${cur}`;
    case 'deleteSlide': { if (nS <= 1) return null; const i = o.a % nS; s.deleteSlide(i); return `deleteSlide(${i})`; }
    case 'moveSlide': { if (nS < 2) return null; const f = o.a % nS, t = o.b % nS; if (f === t) return null; s.moveSlide(f, t); return `moveSlide(${f},${t})`; }
    case 'free': { const e = pick(els.filter((x) => x.syncId), o.a); if (!e) return null; s.freeElement(e.id); return `free(${short(e)}) on ${cur}`; }
    case 'resync': { const e = pick(els.filter((x) => x._syncId), o.a); if (!e) return null; s.resyncElement(e.id); return `resync(${short(e)}) on ${cur}`; }
    case 'unlink': { const e = pick(els.filter((x) => x.linkId), o.a); if (!e) return null; s.unlinkElement(e.id); return `unlink(${short(e)}) on ${cur}`; }
    case 'relink': { const e = pick(els.filter((x) => x._linkId), o.a); if (!e) return null; s.relinkElement(e.id); return `relink(${short(e)}) on ${cur}`; }
    case 'link': {
      const src = pick(els.filter((x) => !x.syncId), o.a); if (!src) return null;
      const cands: Array<[number, SlideElement]> = [];
      slides.forEach((sl, i) => { if (i !== cur) sl.elements.forEach((e) => { if (!e.syncId && e.type === src.type) cands.push([i, e]); }); });
      const t = pick(cands, o.b); if (!t) return null;
      s.linkElements(src.id, t[0], t[1].id); return `link(${short(src)} on ${cur} -> ${short(t[1])} on ${t[0]})`;
    }
    case 'promote': {
      const cands = slides.flatMap((sl) => sl.elements).filter((e) => e.linkId && !e.syncId);
      const e = pick(cands, o.a); if (!e) return null; s.promoteToSync(e.id); return `promote(${short(e)})`;
    }
    case 'copy': {
      const e = pick(els, o.a); if (!e) return null;
      ctx.clip = { v: 1, kind: 'elements', elements: [JSON.parse(JSON.stringify(e))], fromSlideId: slides[cur].id, fromSlideIndex: cur };
      return `copy(${short(e)}) from ${cur}`;
    }
    case 'paste': { if (!ctx.clip) return null; pasteInternalClip(JSON.parse(JSON.stringify(ctx.clip))); return `paste onto ${cur} (clip from ${ctx.clip.fromSlideIndex})`; }
    case 'copySlide': { ctx.clip = { v: 1, kind: 'slide', slide: JSON.parse(JSON.stringify(slides[cur])), fromSlideId: slides[cur].id, fromSlideIndex: cur }; return `copySlide(${cur})`; }
    case 'cmdD': {
      const e = pick(els, o.a); if (!e) return null;
      const n = { ...JSON.parse(JSON.stringify(e)), id: crypto.randomUUID(), ...detachDelta() } as SlideElement;
      offsetElement(n, 40, 40); s.addElement(n); return `cmdD(${short(e)}) -> ${n.id}`;
    }
    case 'delete': { const e = pick(els, o.a); if (!e) return null; s.deleteElement(e.id); return `delete(${short(e)}) on ${cur}`; }
    case 'z': { const e = pick(els, o.a); if (!e || els.length < 2) return null; const d = (['top', 'bottom', 'up', 'down'] as const)[o.b % 4]; s.moveElementZ(e.id, d); return `z(${e.id},${d}) on ${cur}`; }
    case 'move': { const e = pick(els, o.a); if (!e) return null; const dx = 10 + (o.b % 5) * 10; s.moveElementsBy([e.id], dx, 0); return `move(${short(e)},+${dx}) on ${cur}`; }
    case 'edit': { const e = pick(els, o.a); if (!e) return null; s.updateElement(e.id, { html: `e${o.b % 97}` } as Partial<SlideElement>); return `edit(${short(e)} -> e${o.b % 97}) on ${cur}`; }
    case 'undo': undoWithNav(); return 'undo';
    case 'redo': redoWithNav(); return 'redo';
    default: return null;
  }
}

const OPS_WEIGHTED: Array<[string, number]> = [
  ['select', 6], ['addText', 3], ['dupSlide', 5], ['buildSlide', 2], ['deleteSlide', 1], ['moveSlide', 2],
  ['free', 6], ['resync', 4], ['unlink', 2], ['relink', 2], ['link', 3], ['promote', 2],
  ['copy', 4], ['paste', 4], ['copySlide', 1], ['cmdD', 2], ['delete', 3], ['z', 3], ['move', 4], ['edit', 3],
  ['undo', 4], ['redo', 2], ['flush', 4], ['reopen', 2],
];
function rng(seed: number) { let x = (seed >>> 0) || 1; return () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return (x >>> 0); }; }
function genOps(seed: number, n: number): Op[] {
  const r = rng(seed); const total = OPS_WEIGHTED.reduce((t, [, w]) => t + w, 0);
  const ops: Op[] = [];
  for (let i = 0; i < n; i++) {
    let k = r() % total, name = OPS_WEIGHTED[0][0];
    for (const [nm, w] of OPS_WEIGHTED) { if (k < w) { name = nm; break; } k -= w; }
    ops.push({ op: name, a: r() % 1000, b: r() % 1000, c: r() % 1000 });
  }
  return ops;
}

// ─── Fixtures ───────────────────────────────────────────────────────────────

const T = (id: string, x: number, extra: Row = {}) => ({ id, type: 'text', preset: 'textbox', html: id, verticalAlign: 'top',
  position: { x, y: 100, width: 300, height: 100 }, ...extra }) as unknown as SlideElement;
const deck = (slides: Array<{ id: string; elements: SlideElement[]; groupId?: string }>): Presentation =>
  ({ ...createDefaultPresentation(), title: 'hunt', slides: slides.map((s) => ({ notes: '', ...s })) as Slide[] });
const FIXTURES: Record<string, () => Presentation> = {
  solo: () => deck([{ id: 'S0', elements: [T('A', 100), T('B', 400)] }, { id: 'S1', elements: [T('C', 100)] }, { id: 'S2', elements: [] }]),
  syncgroup: () => deck([
    { id: 'S0', elements: [T('G', 100, { syncId: 'G', linkId: 'L' }), T('X', 500)] },
    { id: 'S1', elements: [T('G', 100, { syncId: 'G', linkId: 'L' })] },
    { id: 'S2', elements: [T('G', 100, { syncId: 'G', linkId: 'L' }), T('Y', 600)] },
  ]),
  david: () => deck([
    { id: 'S16', elements: [T('F', 1238, { preset: 'textbox' }), T('K', 200)] },
    { id: 'S17', elements: [T('p1', 100), T('p2', 300), T('p3', 500), T('p4', 700)] },
    { id: 'S20', elements: [T('d', 100), T('e', 300)] },
    { id: 'S21', elements: [] },
  ]),
  linked: () => deck([{ id: 'S0', elements: [T('P', 100, { linkId: 'K' })] }, { id: 'S1', elements: [T('Q', 700, { linkId: 'K' })] }, { id: 'S2', elements: [] }]),
};

// ─── Runner ─────────────────────────────────────────────────────────────────

const backend = new FakeBackend();
let pathN = 0;

async function settle(): Promise<void> { for (let i = 0; i < 30; i++) await Promise.resolve(); }

/** Reset everything and open fixture `fx` from a fresh fake file. */
async function openFixture(fx: string, seedUndo: boolean): Promise<string> {
  await closeSqliteProject();
  vi.clearAllTimers();
  uuidN = 0; textN = 0;
  const path = `/hunt/${fx}-${++pathN}.eigendeck`;
  backend.seed(path, FIXTURES[fx]());
  await openSqliteProject(path);
  await settle();
  if (!seedUndo) usePresentationStore.temporal.getState().clear();
  return path;
}

async function reopen(path: string, seedUndo: boolean): Promise<void> {
  await closeSqliteProject();
  vi.clearAllTimers();
  await openSqliteProject(path);
  if (seedUndo) await seedUndoHistory(); else usePresentationStore.temporal.getState().clear();
  await settle();
}

/** flush + compare the session against what a reopen would load right now. */
async function checkpointCompare(label: string, findings: string[], trace: string[], info: string[]): Promise<void> {
  await flushToSqlite();
  const S = JSON.parse(JSON.stringify(st().presentation)) as Presentation;
  const R = backend.build();
  const v = [...compareReopen(S, R), ...backend.dbViolations()];
  for (const f of v) (isInfo(f) ? info : findings).push(`${f}  [at ${label}]`);
  if (v.some((f) => !isInfo(f)) && !trace.some((t) => t.startsWith('--- session'))) {
    trace.push(`--- session @${label}:\n${deckSummary(S)}\n--- reopen:\n${deckSummary(R)}`);
  }
}

export async function runOps(fx: string, ops: Op[], mode: Mode, seedUndo = false): Promise<RunResult> {
  const path = await openFixture(fx, seedUndo);
  const trace: string[] = [`fixture=${fx} mode=${mode} seedUndo=${seedUndo}`];
  const findings: string[] = [];
  const info: string[] = [];
  const ctx = { clip: null as EigendeckClip | null };
  for (let i = 0; i < ops.length; i++) {
    const o = ops[i];
    clock += 1000;   // each op is its own undo step (past the 200ms coalescing window)
    if (o.op === 'flush') {
      trace.push(`${i}: flush`);
      await checkpointCompare(`${i}`, findings, trace, info);
      if (findings.length) break;
      continue;
    }
    if (o.op === 'reopen') {
      trace.push(`${i}: save+reopen`);
      await checkpointCompare(`${i}`, findings, trace, info);
      if (findings.length) break;
      await reopen(path, seedUndo);
      continue;
    }
    if (AVOID.has('preflush') && ['free', 'delete', 'deleteSlide', 'promote', 'resync'].includes(o.op)) await flushToSqlite();
    let t: string | null;
    try { t = applyOp(o, ctx); } catch (e) { t = `${o.op} THREW ${(e as Error).message}`; findings.push(`throw:${o.op} ${(e as Error).message}`); }
    if (t === null) continue;
    trace.push(`${i}: ${t}`);
    if (o.op === 'undo' || o.op === 'redo') {
      const n = st().presentation.slides.length;
      // #201: a real bug, so it is a finding. Do NOT clamp the index here: clamping
      // would hide the bug from every later step of the scenario.
      if (st().currentSlideIndex >= n) { findings.push(`session:index-out-of-range index=${st().currentSlideIndex} slides=${n} [after ${i}]`); break; }
    }
    const sv = sessionViolations(st().presentation);
    for (const f of sv) (isInfo(f) ? info : findings).push(`${f}  [after ${i}]`);
    if (sv.some((f) => !isInfo(f))) { trace.push(`--- session:\n${deckSummary(st().presentation)}`); break; }
    if (mode === 'every' || (mode === 'syncnow' && SYNC_OPS.has(o.op))) await flushToSqlite();
  }
  if (!findings.length) await checkpointCompare('end', findings, trace, info);
  await closeSqliteProject();
  return { findings, trace, info };
}

/** Category of a finding (for grouping + shrinking). */
const cat = (f: string) => f.split(' ')[0];
// Categories reported but not counted as failures. remembered:lost (#198) and the
// index-out-of-range (#201) used to be here; they are filed bugs, so they fail now.
const INFO = new Set(['latent:alias', 'session:lone-sync', 'session:lone-link']);
const isInfo = (f: string) => INFO.has(cat(f));

async function shrink(fx: string, ops: Op[], mode: Mode, seedUndo: boolean, target: string): Promise<Op[]> {
  let cur = ops.slice();
  const fails = async (o: Op[]) => (await runOps(fx, o, mode, seedUndo)).findings.some((f) => cat(f) === target);
  // Truncate after the first failing prefix, then delete ops one at a time.
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = cur.length - 1; i >= 0; i--) {
      const cand = cur.slice(0, i).concat(cur.slice(i + 1));
      if (await fails(cand)) { cur = cand; changed = true; }
    }
  }
  return cur;
}

// ─── Suite ──────────────────────────────────────────────────────────────────

const report: string[] = [];
const byCat = new Map<string, { n: number; best: { len: number; text: string } }>();

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  vi.spyOn(crypto, 'randomUUID').mockImplementation(() => `u${++uuidN}` as `${string}-${string}-${string}-${string}-${string}`);
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  mockInvoke.mockReset();
  mockInvoke.mockImplementation(((cmd: string, args?: Row) => {
    try { return Promise.resolve(backend.handle(cmd, args ?? {})); } catch (e) { return Promise.reject(e); }
  }) as unknown as typeof invoke);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterAll(async () => {
  await closeSqliteProject();
  vi.useRealTimers();
  if (report.length) console.log(report.join('\n'));
  if (backend.unknown.size) console.log('unhandled backend commands:', [...backend.unknown].join(', '));
});

const SEEDS = Number(process.env.HUNT_SEEDS || 60);
const LEN = Number(process.env.HUNT_LEN || 30);
const HUNT = process.env.HUNT === '1';

describe.skipIf(!HUNT)('sync/link persistence hunt (fuzz)', () => {
  for (const fx of (process.env.HUNT_FX ? process.env.HUNT_FX.split(',') : Object.keys(FIXTURES))) {
    for (const mode of ['every', 'syncnow', 'batched'] as Mode[]) {
      for (const seedUndo of [false, true]) {
        it(`${fx} / ${mode} / seedUndo=${seedUndo}`, async () => {
          for (let seed = 1; seed <= SEEDS; seed++) {
            const ops = genOps(seed * 7919 + fx.length * 31 + (mode === 'every' ? 1 : mode === 'syncnow' ? 2 : 3) + (seedUndo ? 100 : 0), LEN);
            const r = await runOps(fx, ops, mode, seedUndo);
            if (!r.findings.length) continue;
            const TGT = process.env.HUNT_TARGET;
            if (TGT && !r.findings.some((f) => cat(f) === TGT)) continue;
            const c = TGT || cat(r.findings[0]);
            const entry = byCat.get(`${c}|${mode}|${seedUndo}`) ?? { n: 0, best: { len: 1e9, text: '' } };
            entry.n++;
            if (entry.n <= Number(process.env.HUNT_SHRINK || 3)) {   // shrink a few per category/mode
              const small = await shrink(fx, ops, mode, seedUndo, c);
              const rr = await runOps(fx, small, mode, seedUndo);
              if (process.env.HUNT_ALL_OUT) (process as any).getBuiltinModule('node:fs').appendFileSync(process.env.HUNT_ALL_OUT,
                `\n### ${c} mode=${mode} seedUndo=${seedUndo} seed=${seed}\n${rr.findings.join('\n')}\n${rr.trace.filter((t) => !t.startsWith('---')).join('\n')}\n`);
              if (small.length < entry.best.len) {
                entry.best = { len: small.length, text: `### ${c} (mode=${mode}, seedUndo=${seedUndo}, fixture=${fx}, seed=${seed})\n${rr.findings.join('\n')}\n${rr.trace.join('\n')}\nops=${JSON.stringify(small)}` };
              }
            }
            byCat.set(`${c}|${mode}|${seedUndo}`, entry);
          }
        }, 600_000);
      }
    }
  }
  it('summary', () => {
    for (const [k, v] of [...byCat.entries()].sort()) {
      report.push(`\n==== ${k}: ${v.n} failing seeds\n${v.best.text}`);
    }
    const fs = (process as any).getBuiltinModule('node:fs');
    if (process.env.HUNT_OUT) fs.writeFileSync(process.env.HUNT_OUT, report.join('\n'));
    console.log(`hunt summary: ${byCat.size} category/mode buckets`);
    if (process.env.HUNT_ASSERT === '1') expect(byCat.size).toBe(0);
  });
});

// Targeted scenarios (always run; they REPORT, and assert only with HUNT_ASSERT=1).
export const SCENARIOS: Record<string, { fx: string; mode: Mode; seedUndo?: boolean; ops: Op[] }> = {};
const O = (op: string, a = 0, b = 0): Op => ({ op, a, b, c: 0 });
function scenario(name: string, fx: string, mode: Mode, ops: Op[], seedUndo = false) { SCENARIOS[name] = { fx, mode, ops, seedUndo }; }

scenario('baseline: free canonical, reopen', 'syncgroup', 'every', [O('free'), O('reopen')]);
scenario('baseline: dup, free copy, move, reopen', 'solo', 'every', [O('dupSlide'), O('free'), O('move'), O('reopen')]);
// Class: canonical row owner gone → surviving aliases can't write the shared row
scenario('L1 dup, delete ORIGINAL slide, edit copy', 'solo', 'every', [O('dupSlide'), O('deleteSlide', 0), O('edit', 0, 5), O('reopen')]);
scenario('L2 dup x2, delete original slide, edit copy', 'solo', 'every', [O('dupSlide'), O('dupSlide'), O('deleteSlide', 0), O('edit', 0, 5), O('reopen')]);
scenario('L3 dup, delete original ELEMENT, move copy', 'solo', 'every', [O('dupSlide'), O('select', 0), O('delete', 0), O('select', 1), O('move', 0, 2), O('reopen')]);
scenario('L4 dup, delete original element, delete copy', 'solo', 'every', [O('dupSlide'), O('select', 0), O('delete', 0), O('select', 1), O('delete', 0), O('reopen')]);
scenario('L5 dup, delete original element, reorder on copy slide', 'solo', 'every', [O('dupSlide'), O('select', 0), O('delete', 0), O('select', 1), O('z', 0, 0), O('reopen')]);
scenario('L6 new element, dup x2, delete original, flush, delete a copy (pass-2 fallback)', 'solo', 'syncnow', [O('select', 2), O('addText', 0), O('dupSlide'), O('dupSlide'), O('select', 2), O('delete', 0), O('flush'), O('select', 3), O('delete', 0), O('reopen')]);
// Class: pending group write keyed by the canonical id is dropped when that id is renamed
scenario('D1 dup, move original, free original (syncnow)', 'solo', 'syncnow', [O('dupSlide'), O('select', 0), O('move', 0, 1), O('free', 0), O('reopen')]);
scenario('D2 dup, edit original, free original (syncnow)', 'solo', 'syncnow', [O('dupSlide'), O('select', 0), O('edit', 0, 7), O('free', 0), O('reopen')]);
// Class: add/delete cancellation assumes a queued add is never-flushed
scenario('C1 delete element + undo in one batch (syncnow)', 'solo', 'syncnow', [O('delete', 1), O('undo'), O('reopen')]);
scenario('C2 delete slide + undo in one batch (syncnow)', 'solo', 'syncnow', [O('deleteSlide', 0), O('undo'), O('reopen')]);
scenario('C3 delete element, flush, undo (every)', 'solo', 'every', [O('delete', 1), O('undo'), O('reopen')]);
scenario('C4 delete, undo, redo in one batch (syncnow)', 'solo', 'syncnow', [O('delete', 1), O('undo'), O('redo'), O('reopen')]);
scenario('C5 delete slide, undo, redo in one batch (syncnow)', 'solo', 'syncnow', [O('deleteSlide', 1), O('undo'), O('redo'), O('reopen')]);
scenario('C6 free, undo (every) canonical', 'syncgroup', 'every', [O('free', 0), O('undo'), O('reopen')]);
// Class: per-instance state on a one-row group
scenario('A1 unlink one synced instance', 'syncgroup', 'every', [O('select', 1), O('unlink', 0), O('reopen')]);
scenario('A2 unlink canonical synced instance', 'syncgroup', 'every', [O('unlink', 0), O('reopen')]);
// Class: two instances of one group on one slide
scenario('B1 paste synced clip onto slide already holding the group', 'syncgroup', 'every', [O('copy', 0), O('select', 1), O('paste'), O('reopen')]);
scenario('B2 paste synced clip twice onto a new slide', 'solo', 'every', [O('dupSlide'), O('copy', 0), O('select', 3), O('paste'), O('paste'), O('reopen')]);
// Class: join adopts clip data, not group data
scenario('P1 copy synced, edit group, paste elsewhere', 'solo', 'every', [O('dupSlide'), O('copy', 0), O('edit', 0, 9), O('select', 3), O('paste'), O('reopen')]);
// Class: promote collapses every linkId member
scenario('R1 promote with two link members on one slide', 'linked', 'every', [O('addText', 1), O('link', 1, 0), O('promote', 1), O('reopen')]);
// Class: junction z_order not renormalized
scenario('Z1 delete lower element then add', 'solo', 'every', [O('delete', 0), O('addText', 3), O('reopen')]);
scenario('F2 dup, free ORIGINAL, edit copy', 'solo', 'every', [O('dupSlide'), O('select', 0), O('free', 0), O('select', 1), O('edit', 0, 3), O('reopen')]);
scenario('F3 dup, free ORIGINAL, resync, edit', 'solo', 'every', [O('dupSlide'), O('select', 0), O('free', 0), O('resync', 0), O('edit', 0, 3), O('reopen')]);
scenario('U1 dup, copy synced copy, undo dup, paste elsewhere', 'solo', 'every', [O('dupSlide'), O('copy', 0), O('undo'), O('select', 1), O('paste'), O('reopen')]);
scenario('U2 dup, free copy, undo, undo (syncnow)', 'solo', 'syncnow', [O('dupSlide'), O('free', 0), O('undo'), O('undo'), O('reopen')]);
scenario('U3 dup, copy copy, delete dup slide, paste elsewhere', 'solo', 'every', [O('dupSlide'), O('copy', 0), O('deleteSlide', 1), O('select', 1), O('paste'), O('reopen')]);
scenario('Z2 build, delete first on copy, add (syncnow)', 'solo', 'syncnow', [O('buildSlide'), O('delete', 0), O('addText', 3), O('reopen')]);
// Re-checks of .claude/notes/autonomous-e2e-findings.md
scenario('OLD-S1a dup, delete copy', 'solo', 'every', [O('dupSlide'), O('delete', 0), O('reopen')]);
scenario('OLD-S1a batched', 'solo', 'batched', [O('dupSlide'), O('delete', 0), O('reopen')]);
scenario('OLD-S1b dup, delete canonical', 'solo', 'every', [O('dupSlide'), O('select', 0), O('delete', 0), O('reopen')]);
scenario('OLD-S5b dup, free copy (batched)', 'solo', 'batched', [O('dupSlide'), O('free', 0), O('move', 0, 3), O('reopen')]);
scenario('OLD-S5c settled: dup, reopen, free, move', 'solo', 'every', [O('dupSlide'), O('reopen'), O('select', 1), O('free', 0), O('move', 0, 3), O('reopen')]);
scenario('OLD-S8 z-order on same-session copy', 'solo', 'every', [O('dupSlide'), O('z', 0, 0), O('reopen')]);
scenario('OLD-S8b dup, delete the dup slide', 'solo', 'batched', [O('dupSlide'), O('deleteSlide', 1), O('reopen')]);
scenario('OLD-S9 link twice from one anchor', 'solo', 'every', [O('link', 0, 0), O('link', 0, 1), O('reopen')]);
scenario('OLD-S2 dup, free copy, move, resync', 'solo', 'every', [O('dupSlide'), O('free', 0), O('move', 0, 3), O('resync', 0), O('reopen')]);
scenario('#192 settled free then resync', 'syncgroup', 'every', [O('select', 1), O('free', 0), O('reopen'), O('select', 1), O('resync', 0), O('reopen')]);
scenario('#192 same-session free then resync (syncnow)', 'syncgroup', 'syncnow', [O('select', 1), O('free', 0), O('move', 0, 2), O('resync', 0), O('reopen')]);
// Paste-join into a pruned group
scenario('M1 dup, copy copy, delete dup slide, paste back, move', 'syncgroup', 'syncnow', [O('dupSlide'), O('copy', 1), O('deleteSlide', 1), O('paste'), O('move', 1, 4), O('reopen')]);


// Class 2: undo re-adds a saved row. Free, undo, redo inside one save batch (pre-006d924 batching).
scenario('FUR free, undo, redo in one batch (batched)', 'syncgroup', 'batched', [O('select', 1), O('free', 0), O('undo'), O('redo'), O('reopen')]);
// Class 5: the remembered group id must survive a reopen, or a freed element can never rejoin.
scenario('RM dup, free copy, reopen (remembered _syncId kept)', 'solo', 'every', [O('dupSlide'), O('free', 0), O('reopen'), O('reopen')]);
// Incidental: undo of a duplicate of the LAST slide leaves currentSlideIndex out of range.
scenario('IDX duplicate last slide, undo', 'solo', 'every', [O('select', 2), O('dupSlide'), O('undo'), O('reopen')]);

// Each finding's GitHub issue, by scenario id. A scenario that reports anything fails.
// Several scenarios also lose the remembered _syncId (#198) on top of their own bug;
// they list both, so fixing #198 alone does not turn them green.
const ISSUE: Record<string, string> = {
  L1: '#194', L2: '#194', L3: '#194', L4: '#194', L5: '#194', L6: '#194', D1: '#194 #198', D2: '#194 #198',
  F2: '#194 #198', F3: '#194', M1: '#194', 'OLD-S1b': '#194',
  C1: '#195', C2: '#195', C3: '#195', C4: '#195', C5: '#195', C6: '#195', FUR: '#195', U2: '#195 #199',
  A1: '#196', A2: '#196 #198', B1: '#196', B2: '#196', P1: '#196', R1: '#196', U1: '#196', U3: '#196',
  Z2: '#197', RM: '#198', IDX: '#201',
  // These only fail because every free + reopen loses the remembered _syncId (#198).
  'baseline:': '#198', 'OLD-S5b': '#198', 'OLD-S5c': '#198',
};
const ISSUE_BY_NAME: Record<string, string> = { '#192 settled free then resync': '#198' };
const issueOf = (name: string) => ISSUE_BY_NAME[name] ?? ISSUE[name.split(' ')[0]] ?? 'guard';

describe('sync/link persistence: reopen reproduces the session', () => {
  for (const [name, sc] of Object.entries(SCENARIOS)) {
    it(`[${issueOf(name)}] ${name}`, async () => {
      const r = await runOps(sc.fx, sc.ops, sc.mode, sc.seedUndo);
      const txt = `\n#### SCENARIO ${name}: ${r.findings.length ? 'FINDINGS' : 'clean'}\n${r.findings.join('\n')}\n${r.info.length ? 'info: ' + r.info.join('; ') + '\n' : ''}${r.trace.join('\n')}`;
      if (process.env.HUNT_SCEN_OUT) (process as any).getBuiltinModule('node:fs').appendFileSync(process.env.HUNT_SCEN_OUT, txt + '\n');
      // A real test: any finding is a failure, printed with the trace so the
      // failure says what broke. The bugs are open, so these fail until fixed.
      expect(r.findings, `${r.findings.join('\n')}\n--- trace ---\n${r.trace.join('\n')}`).toEqual([]);
    });
  }
});

// Final review, Critical #1: a deck damaged by #195 has two live junctions for one
// element on one slide. It must open with the element once, and edits must save.
describe('damaged decks and failed writes', () => {
  it('[#195] a duplicate junction loads once and an edit on that slide saves', async () => {
    const path = await openFixture('solo', false);
    backend.files.get(path)!.prepare("INSERT INTO slide_elements (slide_id, element_id, z_order, valid_from, valid_to) VALUES ('S0', 'A', 5, 'T999999998', NULL)").run();
    await reopen(path, false);
    expect(st().presentation.slides[0].elements.map((e) => e.id)).toEqual(['A', 'B']);
    expect(st().presentation.slides[0].elements[0].syncId).toBeUndefined();
    st().updateElement('A', { html: 'edited' } as Partial<SlideElement>);
    await flushToSqlite();
    await reopen(path, false);
    expect((st().presentation.slides[0].elements[0] as { html?: string }).html).toBe('edited');
    expect(backend.dbViolations().filter((v) => v.startsWith('db:dupjunction'))).toEqual([]);
  });

  it('a slide whose write fails does not stop the other dirty slides from saving', async () => {
    const path = await openFixture('solo', false);
    backend.failWriteSlide = 'S0';
    try {
      st().updateElement('A', { html: 'lost-for-now' } as Partial<SlideElement>);
      st().updateElement('C', { html: 'saved' } as Partial<SlideElement>);
      await flushToSqlite();
    } finally { backend.failWriteSlide = null; }
    const R = backend.build();
    expect((R.slides[1].elements[0] as { html?: string }).html).toBe('saved');
    // the failed slide stays pending and saves on the next flush
    await flushToSqlite();
    await reopen(path, false);
    expect((st().presentation.slides[0].elements[0] as { html?: string }).html).toBe('lost-for-now');
  });
});

describe('hunt debug', () => {
  it.skipIf(process.env.HUNT_DEBUG !== '1')('debug one run', async () => {
    const r = await runOps('syncgroup', [O('select', 1), O('unlink'), O('flush'), O('reopen')], 'every');
    console.log('FINDINGS', r.findings, r.trace.join('\n'));
    console.log(deckSummary(backend.build()));
  });
});
