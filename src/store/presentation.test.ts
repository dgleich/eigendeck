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
});
