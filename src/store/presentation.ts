import { create } from 'zustand';
import { temporal } from 'zundo';
import {
  Presentation,
  Slide,
  SlideElement,
  createDefaultPresentation,
  createBlankSlide,
} from '../types/presentation';

export type SelectedObject =
  | { type: 'slide' }
  | { type: 'element'; id: string }
  | { type: 'multi'; ids: string[] }
  | null;

interface PresentationState {
  presentation: Presentation;
  currentSlideIndex: number;
  isPresenting: boolean;
  isDirty: boolean;
  projectPath: string | null;
  selectedObject: SelectedObject;
  showProperties: boolean;

  // Presentation actions
  setPresentation: (p: Presentation) => void;
  setProjectPath: (path: string | null) => void;
  setPresenting: (presenting: boolean) => void;
  markClean: () => void;
  setTitle: (title: string) => void;
  setTheme: (theme: string) => void;
  updateConfig: (config: Partial<Presentation['config']>) => void;

  // Slide actions
  selectSlide: (index: number) => void;
  addSlide: () => void;
  deleteSlide: (index: number) => void;
  duplicateSlide: (index: number) => void;
  moveSlide: (from: number, to: number) => void;
  updateSlide: (index: number, changes: Partial<Slide>) => void;

  // Element actions
  addElement: (element: SlideElement) => void;
  updateElement: (elementId: string, changes: Partial<SlideElement>) => void;
  deleteElement: (elementId: string) => void;
  moveElementZ: (elementId: string, direction: 'top' | 'up' | 'down' | 'bottom') => void;

  // Selection
  selectObject: (obj: SelectedObject) => void;
  toggleProperties: () => void;
}

function updateCurrentSlide(
  state: PresentationState,
  updater: (slide: Slide) => Slide
): Partial<PresentationState> {
  const slides = [...state.presentation.slides];
  slides[state.currentSlideIndex] = updater(slides[state.currentSlideIndex]);
  return {
    presentation: { ...state.presentation, slides },
    isDirty: true,
  };
}

export const usePresentationStore = create<PresentationState>()(
  temporal(
    (set) => ({
      presentation: createDefaultPresentation(),
      currentSlideIndex: 0,
      isPresenting: false,
      isDirty: false,
      projectPath: null,
      selectedObject: { type: 'slide' },
      showProperties: false,

      setPresentation: (presentation) =>
        set({ presentation, currentSlideIndex: 0, isDirty: false, selectedObject: { type: 'slide' } }),

      setProjectPath: (projectPath) => set({ projectPath }),

      selectSlide: (index) => set({ currentSlideIndex: index, selectedObject: { type: 'slide' } }),

      addSlide: () =>
        set((state) => {
          const slides = [...state.presentation.slides];
          const insertAt = state.currentSlideIndex + 1;
          slides.splice(insertAt, 0, createBlankSlide());
          return {
            presentation: { ...state.presentation, slides },
            currentSlideIndex: insertAt,
            isDirty: true,
            selectedObject: { type: 'slide' },
          };
        }),

      deleteSlide: (index) =>
        set((state) => {
          if (state.presentation.slides.length <= 1) return state;
          const slides = state.presentation.slides.filter((_, i) => i !== index);
          const newIndex = Math.min(index, slides.length - 1);
          return {
            presentation: { ...state.presentation, slides },
            currentSlideIndex: newIndex,
            isDirty: true,
          };
        }),

      duplicateSlide: (index) =>
        set((state) => {
          const slides = [...state.presentation.slides];
          const original = slides[index];
          const copy: Slide = {
            ...JSON.parse(JSON.stringify(original)),
            id: crypto.randomUUID(),
            // Give new IDs to all elements
            elements: original.elements.map((el) => ({
              ...JSON.parse(JSON.stringify(el)),
              id: crypto.randomUUID(),
            })),
          };
          slides.splice(index + 1, 0, copy);
          return {
            presentation: { ...state.presentation, slides },
            currentSlideIndex: index + 1,
            isDirty: true,
          };
        }),

      moveSlide: (from, to) =>
        set((state) => {
          const slides = [...state.presentation.slides];
          const [moved] = slides.splice(from, 1);
          slides.splice(to, 0, moved);
          return {
            presentation: { ...state.presentation, slides },
            currentSlideIndex: to,
            isDirty: true,
          };
        }),

      updateSlide: (index, changes) =>
        set((state) => {
          const slides = [...state.presentation.slides];
          slides[index] = { ...slides[index], ...changes };
          return {
            presentation: { ...state.presentation, slides },
            isDirty: true,
          };
        }),

      // Element actions
      addElement: (element) =>
        set((state) =>
          updateCurrentSlide(state, (slide) => ({
            ...slide,
            elements: [...slide.elements, element],
          }))
        ),

      updateElement: (elementId, changes) =>
        set((state) =>
          updateCurrentSlide(state, (slide) => ({
            ...slide,
            elements: slide.elements.map((el) =>
              el.id === elementId ? { ...el, ...changes } as SlideElement : el
            ),
          }))
        ),

      deleteElement: (elementId) =>
        set((state) => ({
          ...updateCurrentSlide(state, (slide) => ({
            ...slide,
            elements: slide.elements.filter((el) => el.id !== elementId),
          })),
          selectedObject: { type: 'slide' },
        })),

      moveElementZ: (elementId, direction) =>
        set((state) =>
          updateCurrentSlide(state, (slide) => {
            const elements = [...slide.elements];
            const idx = elements.findIndex((el) => el.id === elementId);
            if (idx === -1) return slide;

            const [el] = elements.splice(idx, 1);
            switch (direction) {
              case 'top':
                elements.push(el);
                break;
              case 'bottom':
                elements.unshift(el);
                break;
              case 'up':
                elements.splice(Math.min(idx + 1, elements.length), 0, el);
                break;
              case 'down':
                elements.splice(Math.max(idx - 1, 0), 0, el);
                break;
            }
            return { ...slide, elements };
          })
        ),

      setPresenting: (isPresenting) => set({ isPresenting }),
      markClean: () => set({ isDirty: false }),

      setTitle: (title) =>
        set((state) => ({
          presentation: { ...state.presentation, title },
          isDirty: true,
        })),

      setTheme: (theme) =>
        set((state) => ({
          presentation: { ...state.presentation, theme },
          isDirty: true,
        })),

      updateConfig: (configPartial) =>
        set((state) => ({
          presentation: {
            ...state.presentation,
            config: { ...state.presentation.config, ...configPartial },
          },
          isDirty: true,
        })),

      selectObject: (selectedObject) => set({ selectedObject }),
      toggleProperties: () =>
        set((state) => ({ showProperties: !state.showProperties })),
    }),
    {
      partialize: (state) => ({
        presentation: state.presentation,
        currentSlideIndex: state.currentSlideIndex,
      }),
      limit: 50,
    }
  )
);
