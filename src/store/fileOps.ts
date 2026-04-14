/**
 * File operations — SQLite (.eigendeck) only.
 *
 * No JSON directory support. Convert old presentations via:
 *   eigendeck-cli new.eigendeck import json old/presentation.json
 */

import { save, message } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import {
  Presentation,
  createDefaultPresentation,
} from '../types/presentation';
import { usePresentationStore, openSqliteProject, flushToSqlite } from './presentation';
// @ts-ignore — pure JS module shared with the CLI tool
import { buildExportHtml } from '../lib/exportCore.mjs';
import { renderMathInHtml, applyMathPreamble } from '../lib/mathjax';
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';

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
    const presentation = createDefaultPresentation();
    await invoke('db_open', { path: selected });
    await invoke('db_import_json', { json: JSON.stringify(presentation) });
    await openSqliteProject(selected as string);
    const store = usePresentationStore.getState();
    store.markClean();
    addRecentProject(selected as string, presentation.title);
  } catch (e) {
    await showError(`Failed to create: ${e}`);
  }
}

export async function saveProject(): Promise<void> {
  const store = usePresentationStore.getState();

  if (!store.projectPath) {
    // No project open — create one
    await createProject();
    return;
  }

  try {
    await flushToSqlite();
    store.markClean();
  } catch (e) {
    console.error('Save failed:', e);
    await showError(`Failed to save: ${e}`);
  }
}

// ============================================================================
// Export
// ============================================================================

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
      renderMath: renderMathInHtml,
      applyMathPreamble: applyMathPreamble,
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

    await invoke('db_open', { path: selected });
    await invoke('db_import_json', { json: JSON.stringify(presentation) });
    await openSqliteProject(selected as string);
    addRecentProject(selected as string, presentation.title);
  } catch (e) {
    await showError(`Failed to import: ${e}`);
  }
}
