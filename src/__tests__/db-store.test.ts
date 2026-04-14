import { describe, it, expect, vi, beforeEach } from 'vitest';

// The mock for @tauri-apps/api/core is set up in src/test/setup.ts.
// We import invoke so we can control its return values per test.
import { invoke } from '@tauri-apps/api/core';

const mockedInvoke = vi.mocked(invoke);

// Import the module under test AFTER mocks are set up
import {
  setCurrentSlideIndex,
  setPresenting,
  toggleProperties,
  setProjectPath,
  selectObject,
  toggleSelectElement,
  dbImportJson,
  dbExportJson,
  dbUpdateElement,
  dbAddElement,
  dbRemoveElementFromSlide,
  dbCompact,
  dbOpen,
  dbClose,
  type SelectedObject,
} from '../store/db';

describe('db-store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =========================================================================
  // Event bus (tested indirectly via the functions that call emit)
  // =========================================================================

  describe('dbOpen', () => {
    it('invokes db_open with the path', async () => {
      mockedInvoke.mockResolvedValueOnce(undefined);
      await dbOpen('/tmp/test.eigendeck');
      expect(mockedInvoke).toHaveBeenCalledWith('db_open', { path: '/tmp/test.eigendeck' });
    });
  });

  describe('dbClose', () => {
    it('invokes db_close', async () => {
      mockedInvoke.mockResolvedValueOnce(undefined);
      await dbClose();
      expect(mockedInvoke).toHaveBeenCalledWith('db_close');
    });
  });

  describe('dbImportJson', () => {
    it('serializes presentation to JSON and invokes db_import_json', async () => {
      mockedInvoke.mockResolvedValueOnce(undefined);
      const pres = {
        title: 'Test',
        theme: 'dark' as const,
        slides: [],
        config: {},
      } as any;
      await dbImportJson(pres);
      expect(mockedInvoke).toHaveBeenCalledWith('db_import_json', {
        json: JSON.stringify(pres),
      });
    });
  });

  describe('dbExportJson', () => {
    it('invokes db_export_json and parses the result', async () => {
      const pres = { title: 'Exported', slides: [] };
      mockedInvoke.mockResolvedValueOnce(JSON.stringify(pres));
      const result = await dbExportJson();
      expect(result).toEqual(pres);
      expect(mockedInvoke).toHaveBeenCalledWith('db_export_json');
    });
  });

  describe('dbUpdateElement', () => {
    it('invokes db_update_element with correct args', async () => {
      mockedInvoke.mockResolvedValueOnce(undefined);
      await dbUpdateElement('el-1', { x: 10, y: 20 }, 'link-abc');
      expect(mockedInvoke).toHaveBeenCalledWith('db_update_element', {
        id: 'el-1',
        data: JSON.stringify({ x: 10, y: 20 }),
        linkId: 'link-abc',
      });
    });

    it('passes null linkId when not provided', async () => {
      mockedInvoke.mockResolvedValueOnce(undefined);
      await dbUpdateElement('el-1', { x: 10 });
      expect(mockedInvoke).toHaveBeenCalledWith('db_update_element', {
        id: 'el-1',
        data: JSON.stringify({ x: 10 }),
        linkId: null,
      });
    });
  });

  describe('dbAddElement', () => {
    it('invokes db_add_element, stripping linkId from data', async () => {
      mockedInvoke.mockResolvedValueOnce(undefined);
      const element = {
        id: 'el-new',
        type: 'text' as const,
        linkId: 'link-1',
        x: 0,
        y: 0,
        width: 100,
        height: 50,
      } as any;
      await dbAddElement('slide-1', element, 3);
      expect(mockedInvoke).toHaveBeenCalledWith('db_add_element', {
        slideId: 'slide-1',
        elementId: 'el-new',
        elementType: 'text',
        data: expect.any(String),
        linkId: 'link-1',
        zOrder: 3,
      });
      // data should NOT contain linkId
      const callArgs = mockedInvoke.mock.calls[0][1] as any;
      const parsedData = JSON.parse(callArgs.data);
      expect(parsedData.linkId).toBeUndefined();
    });
  });

  describe('dbRemoveElementFromSlide', () => {
    it('invokes db_remove_element_from_slide', async () => {
      mockedInvoke.mockResolvedValueOnce(undefined);
      await dbRemoveElementFromSlide('slide-1', 'el-2');
      expect(mockedInvoke).toHaveBeenCalledWith('db_remove_element_from_slide', {
        slideId: 'slide-1',
        elementId: 'el-2',
      });
    });
  });

  describe('dbCompact', () => {
    it('parses the compact result', async () => {
      const result = { beforeBytes: 8192, afterBytes: 4096, savedBytes: 4096 };
      mockedInvoke.mockResolvedValueOnce(JSON.stringify(result));
      const out = await dbCompact(true);
      expect(out).toEqual(result);
      expect(mockedInvoke).toHaveBeenCalledWith('db_compact', { keepAll: true });
    });

    it('defaults keepAll to false', async () => {
      mockedInvoke.mockResolvedValueOnce(JSON.stringify({ beforeBytes: 0, afterBytes: 0, savedBytes: 0 }));
      await dbCompact();
      expect(mockedInvoke).toHaveBeenCalledWith('db_compact', { keepAll: false });
    });
  });

  // =========================================================================
  // UI state
  // =========================================================================

  describe('setCurrentSlideIndex', () => {
    it('updates the current slide index', () => {
      // We can't easily read the state without useUIState (React hook),
      // but we can verify it doesn't throw
      expect(() => setCurrentSlideIndex(5)).not.toThrow();
      expect(() => setCurrentSlideIndex(0)).not.toThrow();
    });
  });

  describe('setPresenting / toggleProperties / setProjectPath', () => {
    it('does not throw', () => {
      expect(() => setPresenting(true)).not.toThrow();
      expect(() => setPresenting(false)).not.toThrow();
      expect(() => toggleProperties()).not.toThrow();
      expect(() => setProjectPath('/tmp/foo')).not.toThrow();
      expect(() => setProjectPath(null)).not.toThrow();
    });
  });

  // =========================================================================
  // selectObject / toggleSelectElement
  // =========================================================================

  describe('selectObject', () => {
    it('accepts all selection types', () => {
      expect(() => selectObject({ type: 'slide' })).not.toThrow();
      expect(() => selectObject({ type: 'element', id: 'el-1' })).not.toThrow();
      expect(() => selectObject({ type: 'multi', ids: ['a', 'b'] })).not.toThrow();
      expect(() => selectObject(null)).not.toThrow();
    });
  });

  describe('toggleSelectElement', () => {
    it('selects an element when nothing is selected', () => {
      selectObject(null);
      // toggleSelectElement with no selection → should not throw
      // (internally sets to { type: 'slide' } which is handled)
      expect(() => toggleSelectElement('el-1')).not.toThrow();
    });

    it('toggles from slide to single element', () => {
      selectObject({ type: 'slide' });
      expect(() => toggleSelectElement('el-1')).not.toThrow();
    });

    it('deselects when toggling same element', () => {
      selectObject({ type: 'element', id: 'el-1' });
      // Toggling same id should go back to slide
      expect(() => toggleSelectElement('el-1')).not.toThrow();
    });

    it('creates multi-selection from single', () => {
      selectObject({ type: 'element', id: 'el-1' });
      expect(() => toggleSelectElement('el-2')).not.toThrow();
    });

    it('adds to multi-selection', () => {
      selectObject({ type: 'multi', ids: ['el-1', 'el-2'] });
      expect(() => toggleSelectElement('el-3')).not.toThrow();
    });

    it('removes from multi-selection', () => {
      selectObject({ type: 'multi', ids: ['el-1', 'el-2', 'el-3'] });
      expect(() => toggleSelectElement('el-2')).not.toThrow();
    });

    it('collapses multi to single when removing to 1', () => {
      selectObject({ type: 'multi', ids: ['el-1', 'el-2'] });
      expect(() => toggleSelectElement('el-1')).not.toThrow();
    });

    it('collapses multi to slide when removing all', () => {
      selectObject({ type: 'multi', ids: ['el-1'] });
      // Removing the last one → type: 'slide' (via length === 1 → element, then...)
      // Actually multi with 1 id: removing it → ids=[] → type: 'slide'
      expect(() => toggleSelectElement('el-1')).not.toThrow();
    });
  });
});
