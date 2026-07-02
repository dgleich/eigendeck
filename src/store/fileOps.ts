/**
 * File operations — SQLite (.eigendeck) only.
 *
 * No JSON directory support. Convert old presentations via:
 *   eigendeck-cli new.eigendeck import json old/presentation.json
 */

import { save, message } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { Presentation } from '../types/presentation';
import { usePresentationStore, openSqliteProject, flushToSqlite, createSeededPresentation } from './presentation';
import { getPreference } from '../lib/preferences';
import { showToast, dismissToast } from '../lib/toasts';

/**
 * Trust the currently-open deck AND approve all its current linked paths at once.
 *
 * NOT wired to any UI: the app keeps deck-trust and file-approval as two separate steps
 * (Trust this deck → then approve files, per file or per folder), and there is
 * deliberately no combined "trust deck & approve all" button. This helper collapses
 * both into one call solely as the e2e automation seam (`window.__eigendeck.trustDeck`),
 * which needs a one-shot way to put a fixture deck into the trusted+watched state. Mints
 * a deck token if the deck predates the feature, records trust in the ledger, and
 * re-scans so watching resumes. See docs/ASSETS-SECURITY.md.
 */
export async function trustCurrentDeck(): Promise<void> {
  const store = usePresentationStore.getState();
  let token = store.presentation.config.deckToken;
  if (!token) {
    token = crypto.randomUUID();
    store.updateConfig({ deckToken: token }); // persists via the write-through subscriber
  }
  try {
    const { createTrustedDeck, approvePath } = await import('../lib/trustStore');
    await createTrustedDeck(token);
    if (store.projectPath) {
      const { scanForChangedAssets, dirname, resolvePosixPath } = await import('../lib/watcherRegistry');
      const { resolveAndGate } = await import('../lib/assetGate');
      const projectDir = dirname(store.projectPath);
      // "Trust this deck" = trust + approve its CURRENT linked paths (per-path gate).
      // Forbidden/unreadable targets are skipped (never approved). New paths added
      // later are approved on add; changed targets resurface as unapproved.
      const linked = await invoke<Array<{ asset_id: string; external_path: string }>>('db_list_linked_assets').catch(() => []);
      for (const a of linked) {
        if (!a.external_path || !a.asset_id) continue;
        const gate = await resolveAndGate(resolvePosixPath(projectDir, a.external_path));
        if (gate.ok && gate.canonicalPath) await approvePath(token, a.asset_id, gate.canonicalPath);
      }
      const presOverride = store.presentation.config.autoReloadAssets ?? null;
      await scanForChangedAssets(projectDir, presOverride).catch(() => {});
    }
    dismissToast('deck-untrusted-watch');
    showToast({ kind: 'success', ttl: 5000, message: 'Deck trusted — its linked files will now live-update.' });
  } catch (e) {
    console.warn('[trustCurrentDeck] failed:', e);
    showToast({ kind: 'error', ttl: 6000, message: 'Couldn’t trust this deck.' });
  }
}

/**
 * File → New / scratch: mark a freshly-CREATED local deck trusted for asset
 * watching — but only when global watching is on (off = PowerPoint model, so trust
 * is moot). Trust attaches ONLY here, never on Save/Save-As of a received deck (see
 * docs/ASSETS-SECURITY.md). Best-effort; never throws.
 */
async function markNewDeckTrusted(presentation: Presentation): Promise<void> {
  const token = presentation.config.deckToken;
  if (!token || !getPreference('autoReloadAssets')) return;
  try {
    const { createTrustedDeck } = await import('../lib/trustStore');
    await createTrustedDeck(token);
  } catch (e) {
    console.warn('[create] markNewDeckTrusted failed (non-fatal):', e);
  }
}
// @ts-ignore — pure JS module shared with the CLI tool
import { buildExportHtml } from '../lib/exportCore.mjs';
import { readTextFile, writeTextFile, exists } from '@tauri-apps/plugin-fs';
import {
  fontForPreset, fontFamilyForPreset, buildEmbeddedFontFacesCSS, resolveMonoFontPackage,
} from '../lib/fonts';
import {
  renderMathInHtml as renderMathPerBundle,
} from '../lib/mathjaxRenderer';
import { TEXT_PRESET_STYLES, effectiveFontSize } from '../types/presentation';
import { resolveTheme, themeColorForPreset } from '../lib/themes';
import { buildTextElementSvgMarkup } from '../components/TextElementSvg';
import { demoVarsCssForSlide } from '../lib/demoThemeInject';
import { previewKey, loadPreviewDataUrl } from '../lib/previewCache';
import { pngBytesToDataUrl } from '../lib/assetCachePreview.mjs';
import { ASSET_TIER } from '../lib/assetCache';
import { renderAsset } from '../lib/assetRenderer';
import type { TextElement, Slide, SlideElement, NotebookElement } from '../types/presentation';
import { renderNotebookElementHtml } from '../lib/notebookExport';

/**
 * Resolve an element's preview PNG to a base64 data: URL for export, mirroring
 * what the static on-screen renderer (SlideThumbnail) shows:
 *   - image kind:'pdf' → the pdfium-rasterized PNG (asset_cache '_', rendered
 *     on demand if not yet cached);
 *   - notebook / video  → the proactively-cached preview PNG (asset_cache
 *     'preview', keyed by the element's sync identity).
 * Returns null on a miss (caller falls back to a placeholder).
 */
async function getElementPreviewDataUrl(el: SlideElement): Promise<string | null> {
  try {
    if (el.type === 'image' && el.kind === 'pdf') {
      // Render (or cache-hit) the PDF's first page at the full tier, then read
      // the cached PNG bytes back as a data URL. renderAsset returns a blob
      // URL; we want bytes that embed in the file, so read the cache directly.
      await renderAsset({
        assetId: el.assetId, kind: 'pdf',
        variant: el.snapshotVariant ?? '_',
        maxWidth: ASSET_TIER.full, maxHeight: ASSET_TIER.full,
      });
      const buf = await invoke<ArrayBuffer>('db_get_asset_cache_bytes', {
        sourceId: el.assetId, variant: el.snapshotVariant ?? '_',
        width: ASSET_TIER.full, height: ASSET_TIER.full,
      });
      const bytes = new Uint8Array(buf);
      return bytes.length ? pngBytesToDataUrl(bytes) : null;
    }
    if (el.type === 'notebook' || el.type === 'video') {
      return await loadPreviewDataUrl(previewKey(el));
    }
  } catch (e) {
    console.warn('getElementPreviewDataUrl failed:', e);
  }
  return null;
}

/** Asset-bytes resolver for the notebook export builder. Handles two
 *  kinds of keys:
 *   - a normal asset id (the .ipynb) → db_get_asset_by_id;
 *   - the `overlay-<elementKey>` convention the builder uses to ask for a
 *     notebook's recording overlay → resolve the element's OWNED overlay
 *     asset id (db_get_owned_asset_id, the same lookup useOverlay does)
 *     and fetch that, so legacy/random overlay ids still resolve.
 *  Throws on a miss (the builder treats that as "no overlay" / fails the
 *  whole notebook → caller falls back to the PNG). */
async function getNotebookAssetBytes(assetId: string): Promise<ArrayBuffer> {
  if (assetId.startsWith('overlay-')) {
    const ownerElementId = assetId.slice('overlay-'.length);
    const ownedId = await invoke<string | null>('db_get_owned_asset_id', { ownerElementId });
    if (!ownedId) throw new Error(`no overlay for ${ownerElementId}`);
    return invoke<ArrayBuffer>('db_get_asset_by_id', { assetId: ownedId });
  }
  return invoke<ArrayBuffer>('db_get_asset_by_id', { assetId });
}

async function showError(msg: string) {
  await message(msg, { title: 'Error', kind: 'error' });
}

// ============================================================================
// Recent projects (localStorage)
// ============================================================================
const RECENT_KEY = 'eigendeck-recent-projects';
const MAX_RECENT = 10;

export interface RecentProject {
  path: string;
  title: string;
  lastOpened: string;
}

export function getRecentProjects(): RecentProject[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
  } catch { return []; }
}

function addRecentProject(path: string, title: string) {
  const recents = getRecentProjects().filter((r) => r.path !== path);
  recents.unshift({ path, title, lastOpened: new Date().toISOString() });
  if (recents.length > MAX_RECENT) recents.length = MAX_RECENT;
  localStorage.setItem(RECENT_KEY, JSON.stringify(recents));
  syncRecentMenu();
}

export function removeRecentProject(path: string): void {
  const recents = getRecentProjects().filter((r) => r.path !== path);
  localStorage.setItem(RECENT_KEY, JSON.stringify(recents));
  void syncRecentMenu();
}

export async function syncRecentMenu(): Promise<void> {
  try {
    const recents = getRecentProjects();
    await invoke('update_recent_menu', { projects: recents });
  } catch { /* not in Tauri or command not available */ }
}

// ============================================================================
// Open / Create / Save
// ============================================================================

export async function openProject(): Promise<void> {
  const { open } = await import('@tauri-apps/plugin-dialog');
  const selected = await open({
    title: 'Open Presentation',
    filters: [{ name: 'Eigendeck', extensions: ['eigendeck'] }],
  });
  if (!selected) return;

  try {
    await openSqliteProject(selected as string);
    const store = usePresentationStore.getState();
    addRecentProject(selected as string, store.presentation.title);
  } catch (e) {
    await showError(`Failed to open: ${e}`);
  }
}

export async function openRecentProject(path: string): Promise<void> {
  // A Recent entry can point at a file that was moved/deleted. Opening it anyway
  // would CREATE an empty DB at that path (SQLite's open creates the file),
  // silently blanking the editor (#103). Check first: on a miss, surface an
  // error, prune the dead entry, and leave the current document untouched.
  try {
    if (!(await exists(path))) {
      removeRecentProject(path);
      await showError(`Can't open "${path.split('/').pop()}" — the file no longer exists. Removed it from Recent.`);
      return;
    }
  } catch { /* exists() unavailable (non-Tauri) — fall through and let open report */ }
  try {
    await openSqliteProject(path);
    const store = usePresentationStore.getState();
    addRecentProject(path, store.presentation.title);
  } catch (e) {
    await showError(`Failed to open: ${e}`);
  }
}

export async function createProject(): Promise<void> {
  const selected = await save({
    title: 'Create New Presentation',
    defaultPath: 'Untitled.eigendeck',
    filters: [{ name: 'Eigendeck', extensions: ['eigendeck'] }],
  });
  if (!selected) return;

  try {
    // Close previous project cleanly before creating new one
    const { closeSqliteProject } = await import('./presentation');
    await closeSqliteProject();

    // Same seeding helper the Zustand cold-start uses — keeps the two
    // "fresh presentation" entry points in sync.
    const presentation = createSeededPresentation();
    // Build the new deck in a FRESH in-memory DB, then atomically write it
    // over `selected`. Never db_open() an existing file just to clear it —
    // that "open-dirty-then-wipe" pattern caused the dca9005 stale-asset
    // bug and issue #65. The atomic save replaces any old file wholesale.
    await invoke('db_open_memory');
    await invoke('db_import_json', { json: JSON.stringify(presentation) });
    await invoke('db_save_to_file', { path: selected });
    await openSqliteProject(selected as string);
    const store = usePresentationStore.getState();
    store.markClean();
    addRecentProject(selected as string, presentation.title);
    await markNewDeckTrusted(presentation);
  } catch (e) {
    await showError(`Failed to create: ${e}`);
  }
}

/**
 * "Just let me scribble" — create a disk-anchored scratch deck in the app's
 * local-data dir without prompting for a path (#66). Still file-backed, so
 * file-watching / linked assets / saves all work; the user can Save As later to
 * give it a real home.
 */
export async function createScratchProject(): Promise<void> {
  try {
    const { documentDir, join } = await import('@tauri-apps/api/path');
    const { mkdir } = await import('@tauri-apps/plugin-fs');
    // ~/Documents/Eigendeck — a real, user-visible, cross-platform home (macOS,
    // Windows, Linux XDG) so scratch decks are easy to find and keep.
    const dir = await join(await documentDir(), 'Eigendeck');
    await mkdir(dir, { recursive: true }).catch(() => { /* already exists */ });
    const stamp = new Date().toISOString().slice(0, 19).replace('T', ' ').replace(/:/g, '-');
    const title = `Scratch ${stamp}`;
    const path = await join(dir, `${title}.eigendeck`);

    const { closeSqliteProject } = await import('./presentation');
    await closeSqliteProject();
    const presentation = createSeededPresentation();
    presentation.title = title;
    // Build fresh in-memory, atomic-save to the scratch path, then open it
    // (same model as createProject — no open-dirty-then-wipe).
    await invoke('db_open_memory');
    await invoke('db_import_json', { json: JSON.stringify(presentation) });
    await invoke('db_save_to_file', { path });
    await openSqliteProject(path);
    usePresentationStore.getState().markClean();
    addRecentProject(path, title);
    await markNewDeckTrusted(presentation);
  } catch (e) {
    await showError(`Failed to create scratch deck: ${e}`);
  }
}

export async function saveProject(): Promise<void> {
  const store = usePresentationStore.getState();

  // Every editing session is now file-anchored from the start (Welcome window /
  // #66), so there's no untitled-first-save path — just flush to the open file.
  // Guard in case Save is invoked before a project exists (e.g. the global
  // Cmd+S handler firing on the Welcome screen).
  if (!store.projectPath) return;

  try {
    await flushToSqlite();
    store.markClean();
    void reconcileDeckApprovals();   // ledger hygiene: drop approvals for dropped assets
  } catch (e) {
    console.error('Save failed:', e);
    await showError(`Failed to save: ${e}`);
  }
}

/**
 * Ledger hygiene (docs/ASSETS-SECURITY.md): prune the trust ledger to exactly the
 * deck's CURRENT linked assets. Called on save + on open. Removing an element/asset
 * (or otherwise dropping a linked source) leaves an orphaned approval; this drops it
 * so a copied deck-token can never reach a path the deck no longer references. Relocate
 * doesn't need this (it re-points the asset's approval in place), but delete/re-link do.
 * No-op for an untrusted / TTL-lapsed deck (the ledger guards that too). Best-effort.
 */
export async function reconcileDeckApprovals(): Promise<void> {
  try {
    const token = usePresentationStore.getState().presentation.config.deckToken;
    if (!token) return;
    const { isTrusted, reconcileApprovals } = await import('../lib/trustStore');
    if (!(await isTrusted(token))) return;
    const linked = await invoke<Array<{ asset_id: string }>>('db_list_linked_assets').catch(() => []);
    await reconcileApprovals(token, linked.map((a) => a.asset_id).filter(Boolean));
  } catch (e) {
    console.warn('[reconcileDeckApprovals] failed (non-fatal):', e);
  }
}

/**
 * On OPEN, surface the deck's trust status as a non-blocking, dismissible toast — never
 * a modal (docs/ASSETS-SECURITY.md, "default to silence"). Two cases only:
 *   - U-ttl (trust lapsed by the 30-day TTL) → offer one-click Re-confirm.
 *   - T-Won-E (trusted + watching on + some linked files still unapproved) → offer Review.
 * Silent otherwise (untrusted deck, watching off, or everything already approved).
 * Open-only — NOT called on save. Best-effort.
 */
export async function notifyTrustStatusOnOpen(): Promise<void> {
  try {
    const store = usePresentationStore.getState();
    const token = store.presentation.config.deckToken;
    if (!token) return;
    const { deckState, reconfirmDeck } = await import('../lib/trustStore');
    const state = await deckState(token);

    if (state.status === 'untrusted-ttl') {
      showToast({
        kind: 'warning', ttl: 12000, key: 'deck-trust-ttl',
        message: 'This deck’s trust expired — re-confirm to resume watching its linked files.',
        action: {
          label: 'Re-confirm',
          onClick: () => void (async () => {
            await reconfirmDeck(token);
            const { scanForChangedAssets, dirname } = await import('../lib/watcherRegistry');
            if (store.projectPath) {
              const presOverride = store.presentation.config.autoReloadAssets ?? null;
              await scanForChangedAssets(dirname(store.projectPath), presOverride).catch(() => {});
            }
            showToast({ kind: 'success', ttl: 5000, message: 'Trust restored — linked files will live-update again.' });
          })(),
        },
      });
      return;
    }

    // T-Won-E: trusted + watching on + linked files still awaiting approval. This fires
    // on EVERY open by design — a trusted deck referencing unreviewed content is the risk
    // to keep surfacing — but the message is SCOPED to acknowledge prior behavior: NEW
    // eligible paths (never surfaced before, e.g. added or a changed target) are the
    // dangerous case and are called out distinctly from ones you've already seen.
    if (state.status !== 'trusted') return;
    if (!getPreference('autoReloadAssets') || store.presentation.config.autoReloadAssets === 'off') return;
    const { buildDeckSecurityReport } = await import('../lib/securityReport');
    const rep = await buildDeckSecurityReport();
    const eligible = rep.rows.filter((r) => r.state === 'eligible' && r.resolvedPath).map((r) => r.resolvedPath as string);
    if (eligible.length === 0) return;
    const { noteEligibleOnOpen } = await import('../lib/trustStore');
    const { total, newCount } = await noteEligibleOnOpen(token, eligible);
    const message = newCount > 0
      ? `${newCount} NEW linked file${newCount === 1 ? '' : 's'} ${newCount === 1 ? 'isn’t' : 'aren’t'} watched — review to approve.`
      : `${total} linked file${total === 1 ? '' : 's'} still ${total === 1 ? 'isn’t' : 'aren’t'} watched — review to approve.`;
    showToast({
      kind: newCount > 0 ? 'warning' : 'info', ttl: 12000, key: 'deck-eligible-review',
      message,
      action: { label: 'Review', onClick: () => void import('../lib/securityWindow').then((m) => m.openSecurityWindow()) },
    });
  } catch (e) {
    console.warn('[notifyTrustStatusOnOpen] failed (non-fatal):', e);
  }
}

/**
 * Save As: prompt for a new path, copy the current in-memory DB to that
 * file, and switch the active project to it. The original file (if any)
 * is left untouched on disk.
 */
export async function saveAsProject(): Promise<void> {
  const store = usePresentationStore.getState();
  const baseName = store.presentation.title.replace(/[^a-zA-Z0-9]/g, '-') || 'Untitled';

  const selected = await save({
    title: 'Save Presentation As...',
    defaultPath: `${baseName}.eigendeck`,
    filters: [{ name: 'Eigendeck', extensions: ['eigendeck'] }],
  });
  if (!selected) return;

  try {
    // Self-heal in case boot-time db_open_memory hasn't completed
    // yet — no-op if a DB is already open.
    await invoke('db_open_memory');
    // Make sure the in-memory DB matches the live Zustand state before
    // we serialize it to the new file.
    await flushToSqlite();
    // Import resets structure but PRESERVES assets — the open DB holds this
    // deck's images/PDFs/notebooks, which aren't in the JSON (issue #65).
    await invoke('db_import_json', { json: JSON.stringify(store.presentation) });
    await invoke('db_save_to_file', { path: selected });
    // Switch the active project to the new file going forward.
    store.setProjectPath((selected as string).replace(/\.eigendeck$/, ''));
    const { setSqliteDbPath } = await import('./presentation');
    setSqliteDbPath(selected as string);
    store.markClean();
    addRecentProject(selected as string, store.presentation.title);
  } catch (e) {
    console.error('Save As failed:', e);
    await showError(`Failed to save: ${e}`);
  }
}

// ============================================================================
// Export
// ============================================================================

/**
 * Build the per-text-element SVG renderer used by exportPresentation (and by
 * the Debug menu's batch HTML export, so batch tests THE SAME path).
 *
 * Each element's preset picks its own MathJax bundle, math is pre-rendered
 * via the iframe pool with fontCache:'none' (inlined glyph paths → fully
 * self-contained SVG), and the result is wrapped via buildTextElementSvgMarkup.
 */
export function makeTextElementRenderer(presentation: Presentation) {
  return async (el: TextElement, slide: Slide): Promise<string> => {
    const presetStyle = TEXT_PRESET_STYLES[el.preset];
    const theme = resolveTheme(presentation.theme, slide.theme);
    const presetFontPkg = fontForPreset(el.preset, slide, presentation.config);
    const fontFamily = el.fontFamily || fontFamilyForPreset(presetFontPkg, el.preset);
    const color = el.color || themeColorForPreset(theme, el.preset);
    const valign = el.verticalAlign || (el.preset === 'title' || el.preset === 'footnote' ? 'bottom' : undefined);
    const renderedHtml = await renderMathPerBundle(
      el.html || '', presetFontPkg.id, presentation.config.mathPreamble || ''
    ).catch(() => el.html || '');
    return buildTextElementSvgMarkup(el, renderedHtml, {
      fontFamily,
      fontSize: effectiveFontSize(el, presentation.config),
      fontWeight: presetStyle.fontWeight,
      fontStyle: presetStyle.fontStyle,
      color,
      valign,
      mono: resolveMonoFontPackage(presentation.config.defaultMonoFont).family,
    });
  };
}

/**
 * Build the full interactive-HTML export for a presentation, with the REAL
 * callbacks: asset reads via `invoke`, per-text SVG via the iframe pool,
 * full-fidelity notebook renders, cached previews, and embedded fonts.
 *
 * Dialog-free and disk-free on purpose, so it's testable: the E2E seam
 * (`window.__eigendeck.exportHtml`) calls THIS to verify the live
 * invoke-backed pipeline end-to-end without a native save dialog.
 */
export async function buildPresentationExportHtml(
  presentation: Presentation,
): Promise<string> {
  // Embed @font-face data URLs for all fonts actually used.
  const fontFacesCss = await buildEmbeddedFontFacesCSS(presentation);

  // exportCore reads media by PATH (el.src / demo-piece's el.demoSrc), but the
  // data model stores only assetId (path lives on the asset, looked up by id).
  // Resolve each media element's assetId → path and hydrate that field, so the
  // exporter can readFile() it. Unresolved ids stay undefined → exportCore emits
  // a placeholder rather than crashing.
  const pathCache = new Map<string, string | undefined>();
  const pathFor = async (assetId?: string): Promise<string | undefined> => {
    if (!assetId) return undefined;
    if (pathCache.has(assetId)) return pathCache.get(assetId);
    let path: string | undefined;
    try {
      const meta = await invoke<{ path?: string | null } | null>('db_get_asset_meta_by_id', { assetId });
      path = meta?.path ?? undefined;
    } catch { path = undefined; }
    pathCache.set(assetId, path);
    return path;
  };
  const hydrateEl = async (e: SlideElement): Promise<SlideElement> => {
    const m = e as { assetId?: string; src?: string; demoSrc?: string; type: string; kind?: string };
    if (!m.assetId) return e;
    if (e.type === 'demo-piece') {
      return m.demoSrc ? e : ({ ...e, demoSrc: await pathFor(m.assetId) } as unknown as SlideElement);
    }
    if (e.type === 'image' || e.type === 'demo' || (e.type === 'video' && e.kind === 'file')) {
      return m.src ? e : ({ ...e, src: await pathFor(m.assetId) } as unknown as SlideElement);
    }
    return e;
  };
  const hydrated: Presentation = {
    ...presentation,
    slides: await Promise.all(presentation.slides.map(async (s) => ({
      ...s,
      elements: await Promise.all(s.elements.map(hydrateEl)),
    }))),
  };

  // Read assets from SQLite for inlining
  return buildExportHtml({
    presentation: hydrated,
    // Export reads ONLY embedded/cached bytes from SQLite — it NEVER touches disk.
    // Assets are always embedded (ASSETS.md: the asset table is the source of
    // truth), so there is no legitimate need for a disk read here; and resolving
    // `${projectPath}/${path}` with the deck-controlled `path` would let a crafted
    // deck exfiltrate arbitrary files into the exported artifact
    // (docs/ASSETS-SECURITY.md — "export → cached-bytes-only"). Missing → throw,
    // and exportCore emits a placeholder rather than crashing.
    readFile: async (path: string) => {
      const data = await invoke<number[]>('db_get_asset', { path });
      return new Uint8Array(data);
    },
    readTextFile: async (path: string) => {
      const data = await invoke<number[]>('db_get_asset', { path });
      return new TextDecoder().decode(new Uint8Array(data));
    },
    // Pre-render each text element to its own self-contained SVG via the
    // iframe pool — see makeTextElementRenderer.
    renderTextElement: makeTextElementRenderer(presentation),
    fontFacesCss,
    // Per-slide demo theme vars (#86): demos inherit the deck's fonts + theme
    // via injected --eigendeck-* custom properties (opt-in in demo CSS).
    demoThemeVarsCss: (slide: Slide) => demoVarsCssForSlide(presentation.config, presentation.theme, slide),
    // Rasterized/cached preview PNGs for elements that can't be rendered
    // statically from source bytes in a plain <img> (pdf images, notebooks,
    // file videos). Mirrors the static on-screen renderer (SlideThumbnail).
    getElementPreview: getElementPreviewDataUrl,
    // Full-fidelity, scrollable notebook render (recorded outputs, no
    // kernel) through the same React components as the live view. Falls
    // back to the preview PNG / placeholder when this returns null.
    renderNotebookElement: async (el: SlideElement, slide: Slide) => {
      if (el.type !== 'notebook') return null;
      const nb = el as NotebookElement;
      try {
        return await renderNotebookElementHtml(
          nb, slide, presentation, getNotebookAssetBytes,
        );
      } catch (e) {
        console.error('renderNotebookElement failed:', e);
        return null;
      }
    },
  });
}

export async function exportPresentation(): Promise<void> {
  const store = usePresentationStore.getState();
  const { presentation } = store;

  const selected = await save({
    title: 'Export Presentation',
    defaultPath: `${presentation.title.replace(/[^a-zA-Z0-9]/g, '-')}.html`,
    filters: [{ name: 'HTML', extensions: ['html'] }],
  });
  if (!selected) return;

  try {
    const html = await buildPresentationExportHtml(presentation);
    await writeTextFile(selected as string, html);
  } catch (e) {
    await showError(`Failed to export: ${e}`);
  }
}

// ============================================================================
// Import from exported HTML
// ============================================================================

export async function importFromHtml(): Promise<void> {
  const { open } = await import('@tauri-apps/plugin-dialog');
  const htmlFile = await open({
    title: 'Import from Exported HTML',
    filters: [{ name: 'HTML', extensions: ['html'] }],
  });
  if (!htmlFile) return;

  try {
    const htmlContent = await readTextFile(htmlFile as string);
    const match = htmlContent.match(/<!-- eigendeck-source: (.+?) -->/);
    if (!match) {
      await showError('This HTML file does not contain embedded Eigendeck data.');
      return;
    }

    let presentation: Presentation;
    try {
      presentation = JSON.parse(atob(match[1]));
    } catch {
      await showError('Failed to decode embedded presentation data.');
      return;
    }

    // Save as new .eigendeck file
    const selected = await save({
      title: 'Save Imported Presentation',
      defaultPath: `${presentation.title.replace(/[^a-zA-Z0-9]/g, '-')}.eigendeck`,
      filters: [{ name: 'Eigendeck', extensions: ['eigendeck'] }],
    });
    if (!selected) return;

    // Build in a fresh in-memory DB and atomic-save over `selected` rather
    // than opening (possibly an existing file) to clear it in place. See
    // createProject for why (dca9005 / issue #65). Close any open project
    // first: db_open_memory is a no-op while a DB is open, so without this
    // we'd import into the CURRENT deck's DB and carry its assets across.
    const { closeSqliteProject } = await import('./presentation');
    await closeSqliteProject();
    await invoke('db_open_memory');
    await invoke('db_import_json', { json: JSON.stringify(presentation) });
    await invoke('db_save_to_file', { path: selected });
    await openSqliteProject(selected as string);
    addRecentProject(selected as string, presentation.title);
  } catch (e) {
    await showError(`Failed to import: ${e}`);
  }
}
