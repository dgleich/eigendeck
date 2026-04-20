import { describe, it, expect, beforeEach } from 'vitest';
import { usePresentationStore } from './presentation';
import { createDefaultPresentation } from '../types/presentation';

describe('presentation store', () => {
  beforeEach(() => {
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

  it('initializes with a default presentation', () => {
    const state = usePresentationStore.getState();
    expect(state.presentation.slides).toHaveLength(1);
    expect(state.presentation.title).toBe('Untitled Presentation');
    expect(state.currentSlideIndex).toBe(0);
    expect(state.isDirty).toBe(false);
  });

  it('adds a slide after the current one', () => {
    usePresentationStore.getState().addSlide();
    const state = usePresentationStore.getState();
    expect(state.presentation.slides).toHaveLength(2);
    expect(state.currentSlideIndex).toBe(1);
    expect(state.isDirty).toBe(true);
  });

  it('deletes a slide and adjusts index', () => {
    const store = usePresentationStore.getState();
    store.addSlide(); store.addSlide();
    expect(usePresentationStore.getState().presentation.slides).toHaveLength(3);
    store.selectSlide(1);
    store.deleteSlide(1);
    const state = usePresentationStore.getState();
    expect(state.presentation.slides).toHaveLength(2);
    expect(state.currentSlideIndex).toBe(1);
  });

  it('does not delete the last remaining slide', () => {
    usePresentationStore.getState().deleteSlide(0);
    expect(usePresentationStore.getState().presentation.slides).toHaveLength(1);
  });

  it('duplicates a slide with new element IDs', () => {
    usePresentationStore.getState().duplicateSlide(0);
    const state = usePresentationStore.getState();
    expect(state.presentation.slides).toHaveLength(2);
    expect(state.currentSlideIndex).toBe(1);
    expect(state.presentation.slides[0].id).not.toBe(state.presentation.slides[1].id);
    if (state.presentation.slides[0].elements.length > 0) {
      expect(state.presentation.slides[0].elements[0].id).not.toBe(
        state.presentation.slides[1].elements[0].id
      );
    }
  });

  it('moves a slide', () => {
    const store = usePresentationStore.getState();
    store.addSlide(); store.addSlide();
    const id0 = usePresentationStore.getState().presentation.slides[0].id;
    store.moveSlide(0, 2);
    expect(usePresentationStore.getState().presentation.slides[2].id).toBe(id0);
  });

  it('adds and updates elements', () => {
    const store = usePresentationStore.getState();
    store.addElement({
      id: 'test-el', type: 'text', preset: 'body', html: '<p>Hello</p>',
      position: { x: 0, y: 0, width: 100, height: 50 },
    });
    expect(usePresentationStore.getState().presentation.slides[0].elements).toHaveLength(2);

    store.updateElement('test-el', { html: '<p>Updated</p>' } as any);
    const el = usePresentationStore.getState().presentation.slides[0].elements.find((e) => e.id === 'test-el');
    expect(el?.type === 'text' && el.html).toBe('<p>Updated</p>');
  });

  it('deletes elements', () => {
    const store = usePresentationStore.getState();
    store.addElement({
      id: 'del-me', type: 'text', preset: 'textbox', html: 'x',
      position: { x: 0, y: 0, width: 100, height: 50 },
    });
    expect(usePresentationStore.getState().presentation.slides[0].elements).toHaveLength(2);
    store.deleteElement('del-me');
    expect(usePresentationStore.getState().presentation.slides[0].elements).toHaveLength(1);
  });

  it('moves element z-order', () => {
    const store = usePresentationStore.getState();
    store.addElement({ id: 'a', type: 'text', preset: 'textbox', html: 'A', position: { x: 0, y: 0, width: 100, height: 50 } });
    store.addElement({ id: 'b', type: 'text', preset: 'textbox', html: 'B', position: { x: 0, y: 0, width: 100, height: 50 } });
    store.moveElementZ('a', 'top');
    const els = usePresentationStore.getState().presentation.slides[0].elements;
    expect(els[els.length - 1].id).toBe('a');
  });

  it('marks clean after save', () => {
    const store = usePresentationStore.getState();
    store.updateSlide(0, { notes: 'changed' });
    expect(usePresentationStore.getState().isDirty).toBe(true);
    store.markClean();
    expect(usePresentationStore.getState().isDirty).toBe(false);
  });

  it('toggles presenting mode', () => {
    usePresentationStore.getState().setPresenting(true);
    expect(usePresentationStore.getState().isPresenting).toBe(true);
    usePresentationStore.getState().setPresenting(false);
    expect(usePresentationStore.getState().isPresenting).toBe(false);
  });

  describe('duplicate slide sync behavior', () => {
    it('creates sync between original and duplicate', () => {
      const store = usePresentationStore.getState();
      store.duplicateSlide(0);
      const state = usePresentationStore.getState();
      expect(state.presentation.slides).toHaveLength(2);
      const el1 = state.presentation.slides[0].elements[0];
      const el2 = state.presentation.slides[1].elements[0];
      // Both should have syncId and they should match
      expect(el1.syncId).toBeTruthy();
      expect(el2.syncId).toBe(el1.syncId);
    });

    it('duplicating a freed-sync slide does not leak old syncId (#45)', () => {
      const store = usePresentationStore.getState();
      // Slide 1 → duplicate to slide 2 (synced)
      store.duplicateSlide(0);
      const s1 = usePresentationStore.getState();
      const originalSyncId = s1.presentation.slides[0].elements[0].syncId;
      expect(originalSyncId).toBeTruthy();

      // Duplicate slide 2 → slide 3 (all 3 synced)
      store.duplicateSlide(1);

      // Free sync on slide 3's title
      store.selectSlide(2);
      const slide3El = usePresentationStore.getState().presentation.slides[2].elements[0];
      store.updateElement(slide3El.id, { syncId: undefined, _syncId: slide3El.syncId } as any);

      // Verify slide 3 title is freed
      const freed = usePresentationStore.getState().presentation.slides[2].elements[0];
      expect(freed.syncId).toBeUndefined();
      expect((freed as any)._syncId).toBeTruthy();

      // Now duplicate slide 3 → slide 4
      store.duplicateSlide(2);
      const final = usePresentationStore.getState();
      expect(final.presentation.slides).toHaveLength(4);

      const slide3Title = final.presentation.slides[2].elements[0];
      const slide4Title = final.presentation.slides[3].elements[0];

      // Slides 3 and 4 should have a NEW syncId (not the original)
      expect(slide3Title.syncId).toBeTruthy();
      expect(slide4Title.syncId).toBe(slide3Title.syncId);
      expect(slide3Title.syncId).not.toBe(originalSyncId);

      // _syncId should be cleared — no lingering reference to old group
      expect((slide3Title as any)._syncId).toBeUndefined();
      expect((slide4Title as any)._syncId).toBeUndefined();

      // Original slides 1 and 2 should still have their original syncId
      expect(final.presentation.slides[0].elements[0].syncId).toBe(originalSyncId);
      expect(final.presentation.slides[1].elements[0].syncId).toBe(originalSyncId);
    });

    it('duplicate inserts after group when slide is in a group', () => {
      const store = usePresentationStore.getState();
      // Create a build (group)
      store.addBuildSlide();
      expect(usePresentationStore.getState().presentation.slides).toHaveLength(2);
      const groupId = usePresentationStore.getState().presentation.slides[0].groupId;
      expect(groupId).toBeTruthy();

      // Duplicate slide 1 (in group) — should insert after the group
      store.selectSlide(0);
      store.duplicateSlide(0);
      const state = usePresentationStore.getState();
      expect(state.presentation.slides).toHaveLength(3);
      // New slide should be at index 2 (after both group members)
      expect(state.currentSlideIndex).toBe(2);
    });
  });
});
