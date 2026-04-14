import { describe, it, expect, beforeEach, vi } from 'vitest';
import { open, save } from '@tauri-apps/plugin-dialog';
import { openProject, saveProject, createProject } from './fileOps';
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
    it('creates new project if none open', async () => {
      mockSave.mockResolvedValue(null);
      await saveProject();
      // Should have shown create dialog
      expect(mockSave).toHaveBeenCalled();
    });
  });
});
