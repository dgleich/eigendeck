import { describe, it, expect, beforeEach, vi } from 'vitest';
import { open, save, message } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { openProject, saveProject, createProject, openRecentProject, getRecentProjects } from './fileOps';
import { usePresentationStore } from './presentation';
import { createDefaultPresentation } from '../types/presentation';

const mockOpen = vi.mocked(open);
const mockSave = vi.mocked(save);

describe('file operations (SQLite only)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePresentationStore.setState({
      presentation: createDefaultPresentation(),
      currentSlideIndex: 0,
      isPresenting: false,
      isDirty: false,
      projectPath: null,
      selectedObject: { type: 'slide' },
      showProperties: false,
    });
  });

  describe('openProject', () => {
    it('does nothing if dialog is cancelled', async () => {
      mockOpen.mockResolvedValue(null);
      await openProject();
      // No invoke calls should happen
    });

    it('shows .eigendeck filter in dialog', async () => {
      mockOpen.mockResolvedValue(null);
      await openProject();
      expect(mockOpen).toHaveBeenCalledWith(expect.objectContaining({
        filters: expect.arrayContaining([
          expect.objectContaining({ extensions: ['eigendeck'] }),
        ]),
      }));
    });
  });

  describe('createProject', () => {
    it('does nothing if save dialog is cancelled', async () => {
      mockSave.mockResolvedValue(null);
      await createProject();
    });

    it('defaults to .eigendeck extension', async () => {
      mockSave.mockResolvedValue(null);
      await createProject();
      expect(mockSave).toHaveBeenCalledWith(expect.objectContaining({
        defaultPath: 'Untitled.eigendeck',
      }));
    });
  });

  describe('saveProject', () => {
    it('is a no-op with no project open (no untitled-first-save dialog) (#66)', async () => {
      mockSave.mockResolvedValue(null);
      usePresentationStore.setState({ projectPath: null });
      await saveProject();
      // Sessions are file-anchored from the start now; Save never prompts.
      expect(mockSave).not.toHaveBeenCalled();
    });
  });

  describe('openRecentProject — missing file (#103)', () => {
    it('prunes the dead entry, shows an error, and does NOT blank the document', async () => {
      const DEAD = '/gone/deck.eigendeck';
      localStorage.setItem('eigendeck-recent-projects',
        JSON.stringify([{ path: DEAD, title: 'Gone', lastOpened: 'x' }]));
      const before = usePresentationStore.getState().presentation;
      // existsNative → invoke('path_exists'); the dead recent file doesn't exist.
      vi.mocked(invoke).mockImplementation(async (cmd: string) => (cmd === 'path_exists' ? false : undefined));

      await openRecentProject(DEAD);

      expect(getRecentProjects().some((r) => r.path === DEAD)).toBe(false); // pruned
      expect(vi.mocked(message)).toHaveBeenCalled();                        // error surfaced
      expect(usePresentationStore.getState().presentation).toBe(before);    // doc untouched (not blanked)
    });
  });
});
