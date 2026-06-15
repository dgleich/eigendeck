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
// @ts-ignore — pure JS module shared with the CLI tool
import { buildExportHtml } from '../lib/exportCore.mjs';
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
import {
  fontForPreset, fontFamilyForPreset, buildEmbeddedFontFacesCSS,
} from '../lib/fonts';
import {
  renderMathInHtml as renderMathPerBundle,
} from '../lib/mathjaxRenderer';
import { TEXT_PRESET_STYLES, effectiveFontSize } from '../types/presentation';
import { resolveTheme, themeColorForPreset } from '../lib/themes';
import { buildTextElementSvgMarkup } from '../components/TextElementSvg';
import type { TextElement, Slide } from '../types/presentation';

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
  } catch (e) {
    console.error('Save failed:', e);
    await showError(`Failed to save: ${e}`);
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
    });
  };
}

export async function exportPresentation(): Promise<void> {
  const store = usePresentationStore.getState();
  const { presentation, projectPath } = store;

  const selected = await save({
    title: 'Export Presentation',
    defaultPath: `${presentation.title.replace(/[^a-zA-Z0-9]/g, '-')}.html`,
    filters: [{ name: 'HTML', extensions: ['html'] }],
  });
  if (!selected) return;

  try {
    // Embed @font-face data URLs for all fonts actually used.
    const fontFacesCss = await buildEmbeddedFontFacesCSS(presentation);

    // Read assets from SQLite for inlining
    const html = await buildExportHtml({
      presentation,
      readFile: async (path: string) => {
        try {
          const data = await invoke<number[]>('db_get_asset', { path });
          return new Uint8Array(data);
        } catch {
          // Fallback: try reading from disk (for unpacked assets)
          if (projectPath) {
            const { readFile } = await import('@tauri-apps/plugin-fs');
            return readFile(`${projectPath}/${path}`);
          }
          throw new Error(`Asset not found: ${path}`);
        }
      },
      readTextFile: async (path: string) => {
        try {
          const data = await invoke<number[]>('db_get_asset', { path });
          return new TextDecoder().decode(new Uint8Array(data));
        } catch {
          if (projectPath) {
            return readTextFile(`${projectPath}/${path}`);
          }
          throw new Error(`Asset not found: ${path}`);
        }
      },
      // Pre-render each text element to its own self-contained SVG via the
      // iframe pool — see makeTextElementRenderer.
      renderTextElement: makeTextElementRenderer(presentation),
      fontFacesCss,
    });

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
