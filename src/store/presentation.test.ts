import { describe, it, expect, beforeEach } from 'vitest';
import { usePresentationStore } from './presentation';
import { createDefaultPresentation } from '../types/presentation';

describe('presentation store', () => {
  beforeEach(() => {
    // Reset store to default state before each test
    usePresentationStore.setState({
      presentation: createDefaultPresentation(),
      currentSlideIndex: 0,
      isPresenting: false,
      isDirty: false,
      projectPath: null,
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
    const { addSlide } = usePresentationStore.getState();
    addSlide();

    const state = usePresentationStore.getState();
    expect(state.presentation.slides).toHaveLength(2);
    expect(state.currentSlideIndex).toBe(1);
    expect(state.isDirty).toBe(true);
  });

  it('deletes a slide and adjusts index', () => {
    const store = usePresentationStore.getState();
    store.addSlide();
    store.addSlide();
    // Now 3 slides, index at 2
    expect(usePresentationStore.getState().presentation.slides).toHaveLength(3);

    store.selectSlide(1);
    store.deleteSlide(1);

    const state = usePresentationStore.getState();
    expect(state.presentation.slides).toHaveLength(2);
    expect(state.currentSlideIndex).toBe(1);
  });

  it('does not delete the last remaining slide', () => {
    const { deleteSlide } = usePresentationStore.getState();
    deleteSlide(0);

    expect(usePresentationStore.getState().presentation.slides).toHaveLength(1);
  });

  it('duplicates a slide', () => {
    const { duplicateSlide } = usePresentationStore.getState();
    duplicateSlide(0);

    const state = usePresentationStore.getState();
    expect(state.presentation.slides).toHaveLength(2);
    expect(state.currentSlideIndex).toBe(1);
    // Duplicated slide should have different id
    expect(state.presentation.slides[0].id).not.toBe(
      state.presentation.slides[1].id
    );
    // But same content
    expect(state.presentation.slides[0].content.html).toBe(
      state.presentation.slides[1].content.html
    );
  });

  it('moves a slide', () => {
    const store = usePresentationStore.getState();
    store.addSlide();
    store.addSlide();
    // slides: [0, 1, 2]

    const id0 = usePresentationStore.getState().presentation.slides[0].id;
    store.moveSlide(0, 2);

    const state = usePresentationStore.getState();
    expect(state.presentation.slides[2].id).toBe(id0);
    expect(state.currentSlideIndex).toBe(2);
  });

  it('updates slide content', () => {
    const { updateSlideContent } = usePresentationStore.getState();
    updateSlideContent(0, { html: '<h1>Updated</h1>' });

    const state = usePresentationStore.getState();
    expect(state.presentation.slides[0].content.html).toBe('<h1>Updated</h1>');
    expect(state.isDirty).toBe(true);
  });

  it('marks clean after save', () => {
    const store = usePresentationStore.getState();
    store.updateSlideContent(0, { html: '<h1>Changed</h1>' });
    expect(usePresentationStore.getState().isDirty).toBe(true);

    store.markClean();
    expect(usePresentationStore.getState().isDirty).toBe(false);
  });

  it('sets presentation and resets state', () => {
    const store = usePresentationStore.getState();
    store.addSlide();
    store.selectSlide(1);

    const newPres = createDefaultPresentation();
    newPres.title = 'New Talk';
    store.setPresentation(newPres);

    const state = usePresentationStore.getState();
    expect(state.presentation.title).toBe('New Talk');
    expect(state.currentSlideIndex).toBe(0);
    expect(state.isDirty).toBe(false);
  });

  it('toggles presenting mode', () => {
    const { setPresenting } = usePresentationStore.getState();
    setPresenting(true);
    expect(usePresentationStore.getState().isPresenting).toBe(true);

    setPresenting(false);
    expect(usePresentationStore.getState().isPresenting).toBe(false);
  });
});
