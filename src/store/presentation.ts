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
  addBuildSlide: () => void; // duplicate current into same group (for builds)
  deleteSlide: (index: number) => void;
  duplicateSlide: (index: number) => void;
  moveSlide: (from: number, to: number) => void;
  updateSlide: (index: number, changes: Partial<Slide>) => void;
  groupSlides: (indices: number[]) => void;
  ungroupSlide: (index: number) => void;

  // Element actions
  addElement: (element: SlideElement) => void;
  updateElement: (elementId: string, changes: Partial<SlideElement>) => void;
  deleteElement: (elementId: string) => void;
  deleteElements: (elementIds: string[]) => void;
  moveElementZ: (elementId: string, direction: 'top' | 'up' | 'down' | 'bottom') => void;
  moveElementsBy: (elementIds: string[], dx: number, dy: number) => void;

  // Selection
  selectObject: (obj: SelectedObject) => void;
  toggleSelectElement: (id: string) => void;
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

      setPresentation: (presentation) => {
        set({ presentation, currentSlideIndex: 0, isDirty: false, selectedObject: { type: 'slide' } });
        // Clear undo history — the loaded file is the new baseline
        usePresentationStore.temporal.getState().clear();
      },

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
          // Ensure original elements have linkIds and syncIds
          const updatedOriginalElements = original.elements.map((el) => {
            const id = el.linkId || crypto.randomUUID();
            return { ...el, linkId: id, syncId: el.syncId || id };
          });
          slides[index] = { ...original, elements: updatedOriginalElements };
          const copy: Slide = {
            ...JSON.parse(JSON.stringify(slides[index])),
            id: crypto.randomUUID(),
            elements: updatedOriginalElements.map((el) => ({
              ...JSON.parse(JSON.stringify(el)),
              id: crypto.randomUUID(),
              // linkId and syncId preserved from original
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
          const slide = slides[from];

          // If both slides are in the same group, reorder within the group
          if (slide.groupId && slides[to]?.groupId === slide.groupId) {
            const [moved] = slides.splice(from, 1);
            slides.splice(to, 0, moved);
            return {
              presentation: { ...state.presentation, slides },
              currentSlideIndex: to,
              isDirty: true,
            };
          }

          // If this slide has a group and we're moving outside it, move the whole group
          if (slide.groupId) {
            const groupId = slide.groupId;
            // Collect all group members
            const groupSlides: Slide[] = [];
            const otherSlides: Slide[] = [];
            let firstGroupIdx = -1;
            slides.forEach((s, i) => {
              if (s.groupId === groupId) {
                if (firstGroupIdx === -1) firstGroupIdx = i;
                groupSlides.push(s);
              } else {
                otherSlides.push(s);
              }
            });

            // Compute target position in the "others" array
            // Adjust 'to' for removed group slides
            let adjustedTo = to;
            if (to > from) {
              adjustedTo = Math.max(0, to - groupSlides.length + 1);
            }
            adjustedTo = Math.min(adjustedTo, otherSlides.length);

            // Insert group at new position
            otherSlides.splice(adjustedTo, 0, ...groupSlides);

            // Find where the first group slide ended up
            const newIdx = otherSlides.findIndex((s) => s.id === slide.id);

            return {
              presentation: { ...state.presentation, slides: otherSlides },
              currentSlideIndex: newIdx >= 0 ? newIdx : to,
              isDirty: true,
            };
          }

          // Single slide move
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

      // Build slide: duplicate current slide into the same group
      addBuildSlide: () =>
        set((state) => {
          const slides = [...state.presentation.slides];
          const idx = state.currentSlideIndex;
          const original = slides[idx];
          const groupId = original.groupId || crypto.randomUUID();

          // Ensure original elements have linkIds and syncIds
          const updatedElements = original.elements.map((el) => {
            const id = el.linkId || crypto.randomUUID();
            return { ...el, linkId: id, syncId: el.syncId || id };
          });

          // Set groupId and link/sync ids on original if needed
          slides[idx] = { ...original, groupId, elements: updatedElements };

          const copy: Slide = {
            ...JSON.parse(JSON.stringify(slides[idx])),
            id: crypto.randomUUID(),
            groupId,
            elements: updatedElements.map((el) => ({
              ...JSON.parse(JSON.stringify(el)),
              id: crypto.randomUUID(),
              // linkId preserved from original
            })),
          };

          // Insert after the last slide in this group
          let insertAt = idx + 1;
          while (insertAt < slides.length && slides[insertAt].groupId === groupId) {
            insertAt++;
          }
          slides.splice(insertAt, 0, copy);

          return {
            presentation: { ...state.presentation, slides },
            currentSlideIndex: insertAt,
            isDirty: true,
          };
        }),

      // Group consecutive slides together
      groupSlides: (indices) =>
        set((state) => {
          if (indices.length < 2) return state;
          const slides = [...state.presentation.slides];
          const groupId = crypto.randomUUID();
          for (const i of indices) {
            slides[i] = { ...slides[i], groupId };
          }
          return {
            presentation: { ...state.presentation, slides },
            isDirty: true,
          };
        }),

      // Remove a slide from its group
      ungroupSlide: (index) =>
        set((state) => {
          const slides = [...state.presentation.slides];
          slides[index] = { ...slides[index], groupId: undefined };
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
        set((state) => {
          const currentSlide = state.presentation.slides[state.currentSlideIndex];
          const element = currentSlide.elements.find((el) => el.id === elementId);
          if (!element) return updateCurrentSlide(state, (s) => s);

          // Apply changes to the target element
          const updatedElement = { ...element, ...changes } as SlideElement;

          // If element has syncId, propagate syncable changes across all slides
          const syncId = updatedElement.syncId;
          if (syncId) {
            // Determine which properties to sync: position, html, fontSize, color, fontFamily
            const syncChanges: Partial<SlideElement> = {};
            if ('position' in changes) (syncChanges as any).position = (changes as any).position;
            if ('html' in changes) (syncChanges as any).html = (changes as any).html;
            if ('fontSize' in changes) (syncChanges as any).fontSize = (changes as any).fontSize;
            if ('color' in changes) (syncChanges as any).color = (changes as any).color;
            if ('fontFamily' in changes) (syncChanges as any).fontFamily = (changes as any).fontFamily;
            // Arrow coords
            if ('x1' in changes) (syncChanges as any).x1 = (changes as any).x1;
            if ('y1' in changes) (syncChanges as any).y1 = (changes as any).y1;
            if ('x2' in changes) (syncChanges as any).x2 = (changes as any).x2;
            if ('y2' in changes) (syncChanges as any).y2 = (changes as any).y2;

            if (Object.keys(syncChanges).length > 0) {
              const slides = state.presentation.slides.map((slide) => ({
                ...slide,
                elements: slide.elements.map((el) => {
                  if (el.id === elementId) return updatedElement;
                  if (el.syncId === syncId) return { ...el, ...syncChanges } as SlideElement;
                  return el;
                }),
              }));
              return { presentation: { ...state.presentation, slides }, isDirty: true };
            }
          }

          // No sync — just update current slide
          return updateCurrentSlide(state, (slide) => ({
            ...slide,
            elements: slide.elements.map((el) =>
              el.id === elementId ? updatedElement : el
            ),
          }));
        }),

      deleteElement: (elementId) =>
        set((state) => ({
          ...updateCurrentSlide(state, (slide) => ({
            ...slide,
            elements: slide.elements.filter((el) => el.id !== elementId),
          })),
          selectedObject: { type: 'slide' },
        })),

      deleteElements: (elementIds) =>
        set((state) => ({
          ...updateCurrentSlide(state, (slide) => ({
            ...slide,
            elements: slide.elements.filter((el) => !elementIds.includes(el.id)),
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

      moveElementsBy: (elementIds, dx, dy) =>
        set((state) => {
          const currentSlide = state.presentation.slides[state.currentSlideIndex];
          // Collect syncIds of moved elements
          const syncIds = new Set<string>();
          for (const el of currentSlide.elements) {
            if (elementIds.includes(el.id) && el.syncId) syncIds.add(el.syncId);
          }

          if (syncIds.size > 0) {
            // Sync move across all slides
            const slides = state.presentation.slides.map((slide) => ({
              ...slide,
              elements: slide.elements.map((el) => {
                if (!elementIds.includes(el.id) && !(el.syncId && syncIds.has(el.syncId))) return el;
                if (el.type === 'arrow') {
                  return { ...el, x1: el.x1 + dx, y1: el.y1 + dy, x2: el.x2 + dx, y2: el.y2 + dy };
                }
                return { ...el, position: { ...el.position, x: el.position.x + dx, y: el.position.y + dy } };
              }),
            }));
            return { presentation: { ...state.presentation, slides }, isDirty: true };
          }

          return updateCurrentSlide(state, (slide) => ({
            ...slide,
            elements: slide.elements.map((el) => {
              if (!elementIds.includes(el.id)) return el;
              if (el.type === 'arrow') {
                return { ...el, x1: el.x1 + dx, y1: el.y1 + dy, x2: el.x2 + dx, y2: el.y2 + dy };
              }
              return { ...el, position: { ...el.position, x: el.position.x + dx, y: el.position.y + dy } };
            }),
          }));
        }),

      toggleSelectElement: (id) =>
        set((state) => {
          const sel = state.selectedObject;
          if (!sel || sel.type === 'slide') {
            return { selectedObject: { type: 'element', id } };
          }
          if (sel.type === 'element') {
            if (sel.id === id) return { selectedObject: { type: 'slide' } };
            return { selectedObject: { type: 'multi', ids: [sel.id, id] } };
          }
          if (sel.type === 'multi') {
            const ids = sel.ids.includes(id) ? sel.ids.filter((i) => i !== id) : [...sel.ids, id];
            if (ids.length === 0) return { selectedObject: { type: 'slide' } };
            if (ids.length === 1) return { selectedObject: { type: 'element', id: ids[0] } };
            return { selectedObject: { type: 'multi', ids } };
          }
          return {};
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
      limit: 100,
      equality: (past, current) =>
        JSON.stringify(past) === JSON.stringify(current),
    }
  )
);

// Helper: pause undo tracking (call before continuous operations like drags)
export function pauseUndo() {
  usePresentationStore.temporal.getState().pause();
}

// Helper: resume undo tracking (call when operation completes)
export function resumeUndo() {
  usePresentationStore.temporal.getState().resume();
}

// ============================================================================
// SQLite incremental write-through
// ============================================================================
// Zustand is the interaction layer. SQLite is the persistence layer.
// Changes are tracked via dirty sets and flushed incrementally — only
// modified elements/slides are written, preserving temporal history.
//
// During drag: Zustand updates only (no SQLite writes).
// On pointerup / text commit / explicit save: flush dirty items to SQLite.

let sqliteDbPath: string | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

// Dirty tracking: which items need to be written to SQLite
const dirtyElements = new Set<string>();    // element IDs whose data changed
const dirtySlides = new Set<string>();      // slide IDs whose metadata changed
let dirtyPresentation = false;              // config/title changed

// Structural changes tracked explicitly
const addedSlides = new Map<string, { position: number; layout: string; groupId?: string }>();
const deletedSlides = new Set<string>();
const addedElements = new Map<string, { slideId: string; element: any; zOrder: number }>();
const deletedElements = new Map<string, string>();  // elementId → slideId it was removed from

/** Mark an element as dirty (will be flushed to SQLite) */
export function markElementDirty(elementId: string) {
  if (!sqliteDbPath) return;
  dirtyElements.add(elementId);
  scheduleFlush();
}

/** Mark a slide as dirty */
export function markSlideDirty(slideId: string) {
  if (!sqliteDbPath) return;
  dirtySlides.add(slideId);
  scheduleFlush();
}

/** Mark presentation metadata as dirty */
export function markPresentationDirty() {
  if (!sqliteDbPath) return;
  dirtyPresentation = true;
  scheduleFlush();
}

/** Force an immediate flush (called on explicit save, pointerup, text commit) */
export async function flushToSqlite(): Promise<void> {
  if (!sqliteDbPath) return;
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }

  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const state = usePresentationStore.getState();

    // Structural changes: add/delete slides and elements
    for (const slideId of deletedSlides) {
      try { await invoke('db_delete_slide', { slideId }); } catch (e) { console.warn('delete slide failed:', e); }
    }
    deletedSlides.clear();

    for (const [slideId, info] of addedSlides) {
      try {
        await invoke('db_add_slide', { id: slideId, position: info.position, layout: info.layout, groupId: info.groupId || null });
      } catch (e) { console.warn('add slide failed:', e); }
    }
    addedSlides.clear();

    for (const [elementId, slideId] of deletedElements) {
      try {
        await invoke('db_remove_element_from_slide', { slideId, elementId });
      } catch (e) { console.warn('remove element failed:', e); }
    }
    deletedElements.clear();

    for (const [_key, info] of addedElements) {
      try {
        const { linkId, syncId, _syncId, _linkId, ...data } = info.element as any;
        await invoke('db_add_element', {
          slideId: info.slideId,
          elementId: info.element.id,
          elementType: info.element.type,
          data: JSON.stringify(data),
          linkId: linkId || null,
          zOrder: info.zOrder,
        });
      } catch (e) { console.warn('add element failed:', e); }
    }
    addedElements.clear();

    // Incremental: only write dirty items
    if (dirtyPresentation) {
      await invoke('db_update_presentation', { key: 'title', value: state.presentation.title });
      await invoke('db_update_presentation', { key: 'config', value: JSON.stringify(state.presentation.config) });
      dirtyPresentation = false;
    }

    for (const elementId of dirtyElements) {
      // Find the element in the current state
      for (const slide of state.presentation.slides) {
        const el = slide.elements.find((e) => e.id === elementId);
        if (el) {
          const { linkId, syncId, _syncId, _linkId, ...data } = el as any;
          await invoke('db_update_element', {
            id: elementId,
            data: JSON.stringify(data),
            linkId: linkId || null,
          });
          break;
        }
      }
    }
    dirtyElements.clear();

    // Slide metadata changes (layout, notes, groupId)
    for (const slideId of dirtySlides) {
      const slide = state.presentation.slides.find((s) => s.id === slideId);
      if (slide) {
        await invoke('db_update_slide', {
          slideId,
          layout: slide.layout || null,
          notes: slide.notes || null,
          groupId: slide.groupId || null,
        });
      }
    }
    dirtySlides.clear();

  } catch (e) {
    console.error('SQLite flush failed:', e);
    // Don't wipe history on failure — just log and retry next flush
  }
}

/** Debounced flush — called when dirty items accumulate */
function scheduleFlush() {
  if (!sqliteDbPath) return;
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(async () => {
    await flushToSqlite();
    // Periodic WAL checkpoint
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('db_checkpoint');
    } catch { /* ignore */ }
  }, 1000); // 1s debounce
}

/** Open a .eigendeck SQLite file and load its contents into the store */
export async function openSqliteProject(dbPath: string): Promise<void> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('db_open', { path: dbPath });
    const json = await invoke<string>('db_export_json');
    const presentation: Presentation = JSON.parse(json);
    sqliteDbPath = dbPath;
    // Clear any dirty state
    dirtyElements.clear();
    dirtySlides.clear();
    dirtyPresentation = false;
    addedSlides.clear();
    deletedSlides.clear();
    addedElements.clear();
    deletedElements.clear();
    const store = usePresentationStore.getState();
    store.setPresentation(presentation);
    store.setProjectPath(dbPath.replace(/\.eigendeck$/, ''));
  } catch (e) {
    console.error('Failed to open SQLite project:', e);
    throw e;
  }
}

/** Close the SQLite DB, checkpointing WAL */
export async function closeSqliteProject(): Promise<void> {
  if (!sqliteDbPath) return;
  try {
    await flushToSqlite();
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('db_close');
    sqliteDbPath = null;
  } catch (e) {
    console.error('Failed to close SQLite project:', e);
  }
}

/** Check if a SQLite DB is currently open */
export function isSqliteOpen(): boolean {
  return sqliteDbPath !== null;
}

/** Set the SQLite DB path (used by saveProject when saving for the first time) */
export function setSqliteDbPath(path: string) {
  sqliteDbPath = path;
  dirtyElements.clear();
  dirtySlides.clear();
  dirtyPresentation = false;
  addedSlides.clear();
  deletedSlides.clear();
  addedElements.clear();
  deletedElements.clear();
}

// ============================================================================
// Auto-detect changes via subscriber
// ============================================================================
// Compare previous and current presentation to find what changed,
// then mark dirty items for incremental flush.

let prevPresentation: Presentation | null = null;

usePresentationStore.subscribe((state) => {
  if (!sqliteDbPath) return;
  const curr = state.presentation;
  if (curr === prevPresentation) return;

  if (!prevPresentation) {
    // First load — don't treat as dirty
    prevPresentation = curr;
    return;
  }

  const prev = prevPresentation;
  prevPresentation = curr;

  // Detect presentation metadata changes
  if (prev.title !== curr.title || JSON.stringify(prev.config) !== JSON.stringify(curr.config)) {
    markPresentationDirty();
  }

  // Detect added/deleted slides
  const prevSlideIds = new Set(prev.slides.map((s) => s.id));
  const currSlideIds = new Set(curr.slides.map((s) => s.id));

  for (const cs of curr.slides) {
    if (!prevSlideIds.has(cs.id)) {
      // New slide added
      const idx = curr.slides.indexOf(cs);
      addedSlides.set(cs.id, { position: idx, layout: cs.layout || 'default', groupId: cs.groupId });
      // All elements on this slide are new
      for (let j = 0; j < cs.elements.length; j++) {
        addedElements.set(cs.elements[j].id, { slideId: cs.id, element: cs.elements[j], zOrder: j });
      }
      scheduleFlush();
    }
  }

  for (const ps of prev.slides) {
    if (!currSlideIds.has(ps.id)) {
      // Slide deleted
      deletedSlides.add(ps.id);
      scheduleFlush();
    }
  }

  // Detect per-slide changes (only for slides that exist in both)
  for (const cs of curr.slides) {
    const ps = prev.slides.find((s) => s.id === cs.id);
    if (!ps) continue;

    // Slide metadata
    if (ps.layout !== cs.layout || ps.notes !== cs.notes || ps.groupId !== cs.groupId) {
      markSlideDirty(cs.id);
    }

    // Element changes
    if (ps.elements !== cs.elements) {
      const prevElIds = new Set(ps.elements.map((e) => e.id));
      const currElIds = new Set(cs.elements.map((e) => e.id));

      // New elements added to this slide
      for (let j = 0; j < cs.elements.length; j++) {
        const el = cs.elements[j];
        if (!prevElIds.has(el.id)) {
          addedElements.set(el.id, { slideId: cs.id, element: el, zOrder: j });
          scheduleFlush();
        }
      }

      // Elements removed from this slide
      for (const pel of ps.elements) {
        if (!currElIds.has(pel.id)) {
          deletedElements.set(pel.id, cs.id);
          scheduleFlush();
        }
      }

      // Elements that changed (same ID, different data)
      for (let j = 0; j < cs.elements.length; j++) {
        const cel = cs.elements[j];
        if (prevElIds.has(cel.id)) {
          const pel = ps.elements.find((e) => e.id === cel.id);
          if (pel && pel !== cel) {
            markElementDirty(cel.id);
          }
        }
      }
    }
  }
});
