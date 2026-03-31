import { describe, it, expect, beforeEach, vi } from 'vitest';
import { open, save } from '@tauri-apps/plugin-dialog';
import { readTextFile, writeTextFile, mkdir, exists } from '@tauri-apps/plugin-fs';
import { openProject, createProject, saveProject } from './fileOps';
import { usePresentationStore } from './presentation';
import { createDefaultPresentation } from '../types/presentation';

const mockOpen = vi.mocked(open);
const mockSave = vi.mocked(save);
const mockReadTextFile = vi.mocked(readTextFile);
const mockWriteTextFile = vi.mocked(writeTextFile);
const mockMkdir = vi.mocked(mkdir);
const mockExists = vi.mocked(exists);

describe('file operations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePresentationStore.setState({
      presentation: createDefaultPresentation(),
      currentSlideIndex: 0,
      isPresenting: false,
      isDirty: false,
      projectPath: null,
    });
  });

  describe('openProject', () => {
    it('does nothing if dialog is cancelled', async () => {
      mockOpen.mockResolvedValue(null);
      await openProject();
      expect(mockReadTextFile).not.toHaveBeenCalled();
    });

    it('loads presentation from selected directory', async () => {
      const pres = createDefaultPresentation();
      pres.title = 'Test Talk';

      mockOpen.mockResolvedValue('/home/user/talks/test');
      mockExists.mockResolvedValue(true);
      mockReadTextFile.mockResolvedValue(JSON.stringify(pres));

      await openProject();

      const state = usePresentationStore.getState();
      expect(state.projectPath).toBe('/home/user/talks/test');
      expect(state.presentation.title).toBe('Test Talk');
    });
  });

  describe('createProject', () => {
    it('creates directories and writes presentation.json', async () => {
      mockOpen.mockResolvedValue('/home/user/talks/new');
      mockExists.mockResolvedValue(false);
      mockMkdir.mockResolvedValue(undefined);
      mockWriteTextFile.mockResolvedValue(undefined);

      await createProject();

      expect(mockMkdir).toHaveBeenCalledWith('/home/user/talks/new/demos');
      expect(mockMkdir).toHaveBeenCalledWith('/home/user/talks/new/images');
      expect(mockWriteTextFile).toHaveBeenCalledWith(
        '/home/user/talks/new/presentation.json',
        expect.any(String)
      );

      const state = usePresentationStore.getState();
      expect(state.projectPath).toBe('/home/user/talks/new');
    });
  });

  describe('saveProject', () => {
    it('saves to existing project path without dialog', async () => {
      usePresentationStore.setState({
        projectPath: '/home/user/talks/existing',
        isDirty: true,
      });
      mockWriteTextFile.mockResolvedValue(undefined);

      await saveProject();

      expect(mockSave).not.toHaveBeenCalled();
      expect(mockWriteTextFile).toHaveBeenCalledWith(
        '/home/user/talks/existing/presentation.json',
        expect.any(String)
      );
      expect(usePresentationStore.getState().isDirty).toBe(false);
    });

    it('prompts for directory when no project is open', async () => {
      mockOpen.mockResolvedValue('/home/user/new');
      mockExists.mockResolvedValue(true);
      mockWriteTextFile.mockResolvedValue(undefined);

      await saveProject();

      expect(mockOpen).toHaveBeenCalledWith(
        expect.objectContaining({ directory: true })
      );
      expect(usePresentationStore.getState().projectPath).toBe('/home/user/new');
    });
  });
});
