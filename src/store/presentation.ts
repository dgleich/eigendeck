import { create } from 'zustand';
import { temporal } from 'zundo';
import {
  Presentation,
  Slide,
  createDefaultPresentation,
  createBlankSlide,
} from '../types/presentation';

interface PresentationState {
  presentation: Presentation;
  currentSlideIndex: number;
  isPresenting: boolean;
  isDirty: boolean;
  projectPath: string | null;

  // Actions
  setPresentation: (p: Presentation) => void;
  setProjectPath: (path: string | null) => void;
  selectSlide: (index: number) => void;
  addSlide: () => void;
  deleteSlide: (index: number) => void;
  duplicateSlide: (index: number) => void;
  moveSlide: (from: number, to: number) => void;
  updateSlide: (index: number, slide: Partial<Slide>) => void;
  updateSlideContent: (index: number, content: Partial<Slide['content']>) => void;
  setPresenting: (presenting: boolean) => void;
  markClean: () => void;
  setTitle: (title: string) => void;
  setTheme: (theme: string) => void;
}

export const usePresentationStore = create<PresentationState>()(
  temporal(
    (set) => ({
      presentation: createDefaultPresentation(),
      currentSlideIndex: 0,
      isPresenting: false,
      isDirty: false,
      projectPath: null,

      setPresentation: (presentation) =>
        set({ presentation, currentSlideIndex: 0, isDirty: false }),

      setProjectPath: (projectPath) => set({ projectPath }),

      selectSlide: (index) => set({ currentSlideIndex: index }),

      addSlide: () =>
        set((state) => {
          const slides = [...state.presentation.slides];
          const insertAt = state.currentSlideIndex + 1;
          slides.splice(insertAt, 0, createBlankSlide());
          return {
            presentation: { ...state.presentation, slides },
            currentSlideIndex: insertAt,
            isDirty: true,
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

      updateSlide: (index, partial) =>
        set((state) => {
          const slides = [...state.presentation.slides];
          slides[index] = { ...slides[index], ...partial };
          return {
            presentation: { ...state.presentation, slides },
            isDirty: true,
          };
        }),

      updateSlideContent: (index, contentPartial) =>
        set((state) => {
          const slides = [...state.presentation.slides];
          slides[index] = {
            ...slides[index],
            content: { ...slides[index].content, ...contentPartial },
          };
          return {
            presentation: { ...state.presentation, slides },
            isDirty: true,
          };
        }),

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
    }),
    {
      // Only track presentation data changes for undo, not UI state
      partialize: (state) => ({
        presentation: state.presentation,
        currentSlideIndex: state.currentSlideIndex,
      }),
      limit: 50,
    }
  )
);
