import { open, save, message } from '@tauri-apps/plugin-dialog';
import {
  readTextFile,
  writeTextFile,
  mkdir,
  exists,
} from '@tauri-apps/plugin-fs';
import {
  Presentation,
  createDefaultPresentation,
} from '../types/presentation';
import { usePresentationStore } from './presentation';
import { renderMathInHtml, applyMathPreamble } from '../lib/mathjax';
// @ts-ignore — pure JS module shared with the CLI tool
import { buildExportHtml } from '../lib/exportCore.mjs';

async function showError(msg: string) {
  await message(msg, { title: 'Error', kind: 'error' });
}

// ============================================
// Recent projects (stored in localStorage)
// ============================================
const RECENT_KEY = 'eigendeck-recent-projects';
const MAX_RECENT = 10;

export interface RecentProject {
  path: string;
  title: string;
  lastOpened: string; // ISO timestamp
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

/** Sync the recent projects list to the native File menu */
export async function syncRecentMenu(): Promise<void> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const recents = getRecentProjects();
    await invoke('update_recent_menu', { projects: recents });
  } catch {
    // Not in Tauri or command not available
  }
}

export async function openRecentProject(path: string): Promise<void> {
  const jsonPath = `${path}/presentation.json`;
  try {
    if (!(await exists(jsonPath))) {
      await showError('Project not found at this path.');
      return;
    }
    const content = await readTextFile(jsonPath);
    const presentation: Presentation = JSON.parse(content);
    const store = usePresentationStore.getState();
    store.setProjectPath(path);
    store.setPresentation(presentation);
    addRecentProject(path, presentation.title);
  } catch (e) {
    await showError(`Failed to open project: ${e}`);
  }
}

export async function openProject(): Promise<void> {
  // Allow opening both directories (JSON) and .eigendeck files (SQLite)
  const selected = await open({
    directory: false,
    multiple: false,
    title: 'Open Presentation',
    filters: [
      { name: 'Eigendeck', extensions: ['eigendeck'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });

  if (!selected) {
    // Try directory picker as fallback
    const dir = await open({ directory: true, title: 'Open Presentation Directory' });
    if (!dir) return;
    const projectPath = dir as string;
    const jsonPath = `${projectPath}/presentation.json`;
    try {
      if (!(await exists(jsonPath))) {
        await showError('No presentation.json found in selected directory.');
        return;
      }
      const content = await readTextFile(jsonPath);
      const presentation: Presentation = JSON.parse(content);
      const store = usePresentationStore.getState();
      store.setProjectPath(projectPath);
      store.setPresentation(presentation);
      addRecentProject(projectPath, presentation.title);
    } catch (e) {
      await showError(`Failed to open project: ${e}`);
    }
    return;
  }

  const filePath = selected as string;

  // SQLite .eigendeck file
  if (filePath.endsWith('.eigendeck')) {
    try {
      const { openSqliteProject } = await import('./presentation');
      await openSqliteProject(filePath);
      const store = usePresentationStore.getState();
      addRecentProject(filePath, store.presentation.title);
    } catch (e) {
      await showError(`Failed to open .eigendeck file: ${e}`);
    }
    return;
  }

  // JSON directory (selected a file inside it)
  const projectPath = filePath.substring(0, filePath.lastIndexOf('/'));
  const jsonPath = `${projectPath}/presentation.json`;

  try {
    if (!(await exists(jsonPath))) {
      await showError('No presentation.json found in selected directory.');
      return;
    }

    const content = await readTextFile(jsonPath);
    const presentation: Presentation = JSON.parse(content);

    const store = usePresentationStore.getState();
    store.setProjectPath(projectPath);
    store.setPresentation(presentation);
    addRecentProject(projectPath, presentation.title);
  } catch (e) {
    await showError(`Failed to open project: ${e}`);
  }
}

export async function createProject(): Promise<void> {
  const selected = await open({
    directory: true,
    title: 'Select Directory for New Project',
  });
  if (!selected) return;

  const projectPath = selected as string;
  const presentation = createDefaultPresentation();

  try {
    const demosDir = `${projectPath}/demos`;
    const imagesDir = `${projectPath}/images`;
    if (!(await exists(demosDir))) await mkdir(demosDir);
    if (!(await exists(imagesDir))) await mkdir(imagesDir);

    await writeTextFile(
      `${projectPath}/presentation.json`,
      JSON.stringify(presentation, null, 2)
    );

    const store = usePresentationStore.getState();
    store.setProjectPath(projectPath);
    store.setPresentation(presentation);
    addRecentProject(projectPath, presentation.title);
  } catch (e) {
    await showError(`Failed to create project: ${e}`);
  }
}

export async function saveProject(): Promise<void> {
  const store = usePresentationStore.getState();

  if (!store.projectPath) {
    // No project open — ask user to pick a directory
    const selected = await open({
      directory: true,
      title: 'Choose a folder to save this presentation',
    });
    if (!selected) return;

    const projectPath = selected as string;
    store.setProjectPath(projectPath);

    // Create subdirectories if they don't exist
    try {
      const demosDir = `${projectPath}/demos`;
      const imagesDir = `${projectPath}/images`;
      if (!(await exists(demosDir))) await mkdir(demosDir);
      if (!(await exists(imagesDir))) await mkdir(imagesDir);
    } catch {
      // dirs may already exist
    }
  }

  const projectPath = usePresentationStore.getState().projectPath;
  if (!projectPath) return;

  try {
    // If SQLite is open, the write-through subscriber handles persistence.
    // Just force a flush.
    const { isSqliteOpen } = await import('./presentation');
    if (isSqliteOpen()) {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('db_import_json', { json: JSON.stringify(store.presentation) });
      store.markClean();
      console.log('Saved to SQLite');
      return;
    }

    // JSON directory save
    const jsonPath = `${projectPath}/presentation.json`;
    const content = JSON.stringify(usePresentationStore.getState().presentation, null, 2);
    console.log(`Saving to: ${jsonPath}`);
    await writeTextFile(jsonPath, content);
    store.markClean();
    console.log('Save successful');
  } catch (e) {
    console.error('Save failed:', e);
    await showError(`Failed to save: ${e}`);
  }
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
    const html = await buildExportHtml({
      presentation,
      // Tauri-based filesystem (paths are relative to projectPath)
      readFile: async (path: string) => {
        if (!projectPath) throw new Error('No project path');
        const { readFile } = await import('@tauri-apps/plugin-fs');
        return readFile(`${projectPath}/${path}`);
      },
      readTextFile: async (path: string) => {
        if (!projectPath) throw new Error('No project path');
        return readTextFile(`${projectPath}/${path}`);
      },
      // GUI: pre-render math via the in-app MathJax instance
      renderMath: renderMathInHtml,
      applyMathPreamble: applyMathPreamble,
    });

    await writeTextFile(selected, html);
  } catch (e) {
    await showError(`Failed to export: ${e}`);
  }
}

/**
 * Import a presentation from an exported HTML file.
 * Extracts the embedded presentation.json and sets up a project directory.
 */
export async function importFromHtml(): Promise<void> {
  const htmlFile = await open({
    title: 'Import from Exported HTML',
    filters: [{ name: 'HTML', extensions: ['html'] }],
  });
  if (!htmlFile) return;

  try {
    const htmlContent = await readTextFile(htmlFile as string);

    // Extract embedded presentation JSON
    const match = htmlContent.match(/<!-- eigendeck-source: (.+?) -->/);
    if (!match) {
      await showError('This HTML file does not contain embedded Eigendeck data.\n\nOnly files exported from Eigendeck can be imported.');
      return;
    }

    let presentation: Presentation;
    try {
      presentation = JSON.parse(atob(match[1]));
    } catch {
      await showError('Failed to decode embedded presentation data.');
      return;
    }

    // Ask where to create the project directory
    const projectDir = await open({
      directory: true,
      title: 'Select Directory for Imported Project',
    });
    if (!projectDir) return;

    const projectPath = projectDir as string;

    // Create subdirectories
    const demosDir = `${projectPath}/demos`;
    const imagesDir = `${projectPath}/images`;
    if (!(await exists(demosDir))) await mkdir(demosDir);
    if (!(await exists(imagesDir))) await mkdir(imagesDir);

    // Extract inline images (data URLs) back to files
    for (const slide of presentation.slides) {
      for (const el of slide.elements) {
        if (el.type === 'image' && el.src.startsWith('data:')) {
          try {
            const mimeMatch = el.src.match(/^data:image\/(\w+);base64,/);
            const ext = mimeMatch?.[1] === 'jpeg' ? 'jpg' : (mimeMatch?.[1] || 'png');
            const fileName = `imported-${el.id.slice(0, 8)}.${ext}`;
            const base64 = el.src.replace(/^data:image\/\w+;base64,/, '');
            const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
            const { writeFile } = await import('@tauri-apps/plugin-fs');
            await writeFile(`${imagesDir}/${fileName}`, bytes);
            el.src = `images/${fileName}`;
          } catch (e) {
            console.warn('Failed to extract image:', e);
          }
        }
      }
    }

    // Save presentation.json
    await writeTextFile(
      `${projectPath}/presentation.json`,
      JSON.stringify(presentation, null, 2)
    );

    // Open the imported project
    const store = usePresentationStore.getState();
    store.setProjectPath(projectPath);
    store.setPresentation(presentation);
    addRecentProject(projectPath, presentation.title);

    console.log('Import successful:', projectPath);
  } catch (e) {
    await showError(`Failed to import: ${e}`);
  }
}
