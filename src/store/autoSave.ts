import {
  writeTextFile,
  readDir,
  remove,
} from '@tauri-apps/plugin-fs';
import { usePresentationStore } from './presentation';

const AUTO_SAVE_DELAY = 3000; // 3 seconds after last change
const MAX_BACKUPS = 20;
const BACKUP_PREFIX = 'presentation.backup-';

let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
let lastSavedJson = '';

/**
 * Initialize auto-save. Call once from App.
 * Watches the store for changes and auto-saves after a debounce.
 */
export function initAutoSave() {
  usePresentationStore.subscribe((state, prevState) => {
    // Only trigger on presentation data changes
    if (state.presentation === prevState.presentation) return;
    if (!state.projectPath) return;
    if (state.isPresenting) return;

    // Debounce
    if (autoSaveTimer) clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(() => {
      performAutoSave();
    }, AUTO_SAVE_DELAY);
  });

  // Also save on window blur
  window.addEventListener('blur', () => {
    const state = usePresentationStore.getState();
    if (state.isDirty && state.projectPath) {
      performAutoSave();
    }
  });
}

async function performAutoSave() {
  const state = usePresentationStore.getState();
  if (!state.projectPath || !state.isDirty) return;

  const json = JSON.stringify(state.presentation, null, 2);

  // Skip if nothing actually changed
  if (json === lastSavedJson) return;

  const jsonPath = `${state.projectPath}/presentation.json`;

  try {
    // Save main file
    await writeTextFile(jsonPath, json);
    lastSavedJson = json;
    state.markClean();
    console.log('Auto-saved');

    // Create timestamped backup
    await createBackup(state.projectPath, json);
  } catch (e) {
    console.error('Auto-save failed:', e);
  }
}

async function createBackup(projectPath: string, json: string) {
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = `${projectPath}/${BACKUP_PREFIX}${timestamp}.json`;
    await writeTextFile(backupPath, json);

    // Prune old backups
    await pruneBackups(projectPath);
  } catch (e) {
    console.error('Backup failed:', e);
  }
}

async function pruneBackups(projectPath: string) {
  try {
    const entries = await readDir(projectPath);
    const backups = entries
      .filter((e) => e.name?.startsWith(BACKUP_PREFIX))
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    // Keep only the last MAX_BACKUPS
    while (backups.length > MAX_BACKUPS) {
      const oldest = backups.shift();
      if (oldest?.name) {
        await remove(`${projectPath}/${oldest.name}`);
      }
    }
  } catch {
    // readDir may fail if permissions are wrong, ignore
  }
}

/**
 * Force an immediate save (used before presenting, on Cmd+S, etc.)
 */
export async function forceSave() {
  if (autoSaveTimer) {
    clearTimeout(autoSaveTimer);
    autoSaveTimer = null;
  }
  await performAutoSave();
}
