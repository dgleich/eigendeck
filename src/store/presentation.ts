import { create } from 'zustand';
import { temporal } from 'zundo';
import {
  Presentation,
  Slide,
  SlideElement,
  createDefaultPresentation,
  createBlankSlide,
} from '../types/presentation';
import {
  IDENTITY_KEYS, resyncDelta, unlinkDelta, relinkDelta, linkPairDeltas,
  pruneOrphanedGroups,
} from '../lib/syncLink';
import { runFreeHook, runResyncHook, runMergeHook } from '../lib/elementLifecycle';
import { flushAllOverlays } from '../lib/overlayFlushRegistry';

export type SelectedObject =
  | { type: 'slide' }
  | { type: 'element'; id: string }
  | { type: 'multi'; ids: string[] }
  | null;

// Which inspector context is showing: the whole deck, the current slide, or the
// selected element. Selecting an element auto-focuses 'element'; the segmented
// switcher and the Slide menu set it directly.
export type InspectorTab = 'presentation' | 'slide' | 'element';

interface PresentationState {
  presentation: Presentation;
  currentSlideIndex: number;
  isPresenting: boolean;
  isDirty: boolean;
  projectPath: string | null;
  selectedObject: SelectedObject;
  showProperties: boolean;
  inspectorTab: InspectorTab;
  showHistory: boolean;
  // Editor-only alignment grid. Session state (default off, toggled from the
  // View menu); the grid SPACING is a persisted app preference (gridSpacing).
  // Never affects present/export.
  snapToGrid: boolean;
  showGrid: boolean;

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
  /** Paste a COPIED slide (from the clipboard's slide flavor) as a new,
   *  INDEPENDENT slide after the current slide/build group: fresh slide + element
   *  ids, no sync/link, no group membership. (⌘V of a slide clip — distinct from
   *  ⌘D duplicate, which links for builds.) */
  pasteSlide: (slide: unknown) => void;
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

  // Sync / link relationships (the single API; UI must not hand-build deltas)
  /** Free a synced element on the current slide (remembers the group). */
  freeElement: (elementId: string) => void;
  /** Re-sync a freed element back into its remembered group. */
  resyncElement: (elementId: string) => void;
  /** Unlink an animated element (remembers the link). */
  unlinkElement: (elementId: string) => void;
  /** Re-link a previously-unlinked element. */
  relinkElement: (elementId: string) => void;
  /** Establish an ANIMATION link (linkId) between a source element on the
   *  current slide and a target on another slide. Non-destructive: sets a
   *  shared linkId on both, leaves syncId/content/position alone. One undo
   *  step. Does NOT sync/merge — that's a separate, destructive operation. */
  linkElements: (sourceId: string, targetSlideIndex: number, targetId: string) => void;
  /** Promote an animation-linked element to a SYNC: the clicked element becomes
   *  the master, and every linked instance on other slides becomes the SAME
   *  element (one entry — shared id/content/position), keeping the master's
   *  recording. DESTRUCTIVE: the partners' separate positions/content/recordings
   *  are discarded. The opt-in upgrade from link → sync. */
  promoteToSync: (elementId: string) => void;

  // Selection
  selectObject: (obj: SelectedObject) => void;
  toggleSelectElement: (id: string) => void;
  toggleProperties: () => void;
  setInspectorTab: (tab: InspectorTab) => void;
  toggleHistory: () => void;
  toggleSnapToGrid: () => void;
  toggleShowGrid: () => void;
}

/** Translate an arrow by (dx, dy) — endpoints AND any Bézier control points, so a
 *  curved arrow keeps its shape when moved (#129). Absent controls stay absent. */
function shiftArrow(el: Extract<SlideElement, { type: 'arrow' }>, dx: number, dy: number) {
  const out = { ...el, x1: el.x1 + dx, y1: el.y1 + dy, x2: el.x2 + dx, y2: el.y2 + dy };
  if (el.c1x != null) out.c1x = el.c1x + dx;
  if (el.c1y != null) out.c1y = el.c1y + dy;
  if (el.c2x != null) out.c2x = el.c2x + dx;
  if (el.c2y != null) out.c2y = el.c2y + dy;
  if (el.points) out.points = el.points.map((p) => ({ x: p.x + dx, y: p.y + dy }));
  return out;
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

/** Build a fresh presentation with global-pref seeding applied.
 *  Used both by the Zustand store's cold-start initial state AND by
 *  fileOps.createProject (Cmd+N) — they MUST stay in sync, so the
 *  seeding logic lives in one place.
 *
 *  Currently seeds: presentation.config.mathPreamble (from the global
 *  mathPreamble pref). Add new "seed from global" fields here, not at
 *  the call sites.
 *
 *  Direct localStorage read (not the preferences module) because the
 *  Zustand initializer runs at module eval time, before React is
 *  mounted, and the preferences module is React-hook-based. Same key
 *  + JSON encoding as src/lib/preferences.ts uses. */
export function createSeededPresentation(): Presentation {
  const pres = createDefaultPresentation();
  // Stamp a deck-identity token: this deck is being CREATED locally (File → New /
  // scratch / cold start), so it's eligible for author-trust. The trust ledger keys
  // on this token; a received deck's token won't be in the local ledger. See
  // docs/ASSETS-SECURITY.md. (Marking the deck trusted in the ledger happens at the
  // create call site when global watching is on — this only mints the identity.)
  pres.config.deckToken = crypto.randomUUID();
  try {
    const v = localStorage.getItem('eigendeck:pref:mathPreamble');
    if (v) {
      const preamble = JSON.parse(v);
      if (typeof preamble === 'string' && preamble) {
        pres.config.mathPreamble = preamble;
      }
    }
  } catch { /* ignore */ }
  try {
    // Seed deck-level type scale from the global pref. Empty/missing
    // keys fall back to DEFAULT_TEXT_SIZES at render time — we only
    // store an override if the pref has one. Carrying only the
    // non-empty entries keeps PresentationConfig.textSizes undefined
    // when the user hasn't customized anything globally.
    const v = localStorage.getItem('eigendeck:pref:textSizes');
    if (v) {
      const parsed = JSON.parse(v);
      if (parsed && typeof parsed === 'object' && Object.keys(parsed).length) {
        const cleaned: Record<string, number> = {};
        for (const [k, val] of Object.entries(parsed)) {
          if (typeof val === 'number' && val > 0) cleaned[k] = val;
        }
        if (Object.keys(cleaned).length) {
          pres.config.textSizes = cleaned as Presentation['config']['textSizes'];
        }
      }
    }
  } catch { /* ignore */ }
  return pres;
}

// Undo debounce helpers must be declared BEFORE the store creation:
// zundo's `handleSet` factory is invoked synchronously during
// `temporal(...)` setup, which runs at module-init time. Declaring
// these afterwards left them in the TDZ ("Cannot access uninitialized
// variable") and the whole app failed to boot.
const UNDO_DEBOUNCE_MS = 200;
const UNDO_LIMIT = 100;

/** Leading-edge debounce: first call fires immediately, subsequent
 *  calls within `ms` are dropped, then the gate resets after `ms`
 *  of idle. The right semantic for "collapse a burst of state
 *  changes into one undo step recording the PRE-burst state." */
function debounceUndoSnapshot<F extends (...args: never[]) => void>(fn: F, ms: number): F {
  let lastFire = 0;
  return ((...args: Parameters<F>) => {
    const now = performance.now();
    if (now - lastFire >= ms) {
      lastFire = now;
      fn(...args);
    }
  }) as F;
}

// The inspector's open/closed state is a persisted preference (#145) so ⌘I / the View
// toggle is remembered across launches. Direct localStorage read/write with the same
// key + encoding as src/lib/preferences.ts (`showInspector`, default true) — the store
// initializer runs at module-eval before React, so we don't use the hook-based module.
const INSPECTOR_PREF_KEY = 'eigendeck:pref:showInspector';
function readShowInspector(): boolean {
  try {
    const v = localStorage.getItem(INSPECTOR_PREF_KEY);
    return v === null ? true : JSON.parse(v) === true;
  } catch {
    return true;
  }
}
function writeShowInspector(v: boolean): void {
  try {
    localStorage.setItem(INSPECTOR_PREF_KEY, JSON.stringify(v));
  } catch {
    /* no localStorage (headless) — nothing to persist */
  }
}

export const usePresentationStore = create<PresentationState>()(
  temporal(
    (set, get) => ({
      presentation: createSeededPresentation(),
      currentSlideIndex: 0,
      isPresenting: false,
      isDirty: false,
      projectPath: null,
      selectedObject: { type: 'slide' },
      showProperties: readShowInspector(),
      inspectorTab: 'slide',
      showHistory: false,
      snapToGrid: false,
      showGrid: false,

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
          // Insert after the current slide — but if it's part of a build (a run
          // of slides sharing a groupId), insert after the WHOLE build so the new
          // blank slide doesn't land mid-sequence and break the animation/
          // numbering (#165). Same contiguous-group skip as duplicateSlide.
          let insertAt = state.currentSlideIndex + 1;
          const groupId = slides[state.currentSlideIndex]?.groupId;
          if (groupId) {
            while (insertAt < slides.length && slides[insertAt].groupId === groupId) insertAt++;
          }
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
          const filtered = state.presentation.slides.filter((_, i) => i !== index);
          // Strip syncId/linkId left orphaned (sole member) by the removal, so a
          // duplicate-then-delete leaves the original genuinely un-synced.
          const slides = pruneOrphanedGroups(filtered);
          const newIndex = Math.min(index, slides.length - 1);
          return {
            presentation: { ...state.presentation, slides },
            currentSlideIndex: newIndex,
            // Land the selection squarely on the neighbour slide, so it's clear
            // what's selected and a repeated Delete has a slide to act on (#124).
            selectedObject: { type: 'slide' },
            isDirty: true,
          };
        }),

      duplicateSlide: (index) =>
        set((state) => {
          const slides = [...state.presentation.slides];
          const original = slides[index];
          // Set up linkIds for animation, and syncIds for content sync.
          // syncId defaults to the element's OWN id so the sync group's
          // identity (and thus the shared notebook-overlay key, syncId??id)
          // is stable across duplicate → save → Save As. Synced instances
          // are the SAME thing: they share one overlay (B2).
          // Clear _syncId/_linkId to sever old sync groups.
          const updatedOriginalElements = original.elements.map((el) => {
            const linkId = el.linkId || crypto.randomUUID();
            const syncId = el.syncId || el.id;
            return { ...el, linkId, syncId, _syncId: undefined, _linkId: undefined };
          });
          slides[index] = { ...original, elements: updatedOriginalElements };
          const copy: Slide = {
            ...JSON.parse(JSON.stringify(slides[index])),
            id: crypto.randomUUID(),
            elements: updatedOriginalElements.map((el) => ({
              ...JSON.parse(JSON.stringify(el)),
              id: crypto.randomUUID(),
              // linkId and syncId preserved from original → shares its overlay
            })),
          };
          // If the slide is part of a group, insert after the last slide in the group
          let insertAt = index + 1;
          const groupId = original.groupId;
          if (groupId) {
            while (insertAt < slides.length && slides[insertAt].groupId === groupId) insertAt++;
          }
          slides.splice(insertAt, 0, copy);
          return {
            presentation: { ...state.presentation, slides },
            currentSlideIndex: insertAt,
            isDirty: true,
          };
        }),

      pasteSlide: (slideJson) =>
        set((state) => {
          if (!slideJson || typeof slideJson !== 'object' || !Array.isArray((slideJson as Slide).elements)) {
            return state;
          }
          const src = slideJson as Slide;
          const slides = [...state.presentation.slides];
          const cur = state.currentSlideIndex;
          // Insert after the current slide, or after the end of the current build
          // group (so a paste never splits a group).
          let insertAt = cur + 1;
          const curGroup = slides[cur]?.groupId;
          if (curGroup) {
            while (insertAt < slides.length && slides[insertAt].groupId === curGroup) insertAt++;
          }
          // INDEPENDENT copy: fresh slide + element ids, no sync/link (a paste is
          // its own thing, not a build step — that's ⌘D), no group membership.
          // assetIds are preserved (they resolve same-deck; cross-deck assets that
          // aren't present come in broken — the clip carries JSON, not bytes; #167).
          const copy: Slide = {
            ...JSON.parse(JSON.stringify(src)),
            id: crypto.randomUUID(),
            groupId: undefined,
            elements: (src.elements || []).map((el) => ({
              ...JSON.parse(JSON.stringify(el)),
              id: crypto.randomUUID(),
              linkId: undefined, syncId: undefined, _linkId: undefined, _syncId: undefined,
            })),
          };
          slides.splice(insertAt, 0, copy);
          return {
            presentation: { ...state.presentation, slides },
            currentSlideIndex: insertAt,
            isDirty: true,
            selectedObject: { type: 'slide' },
          };
        }),

      moveSlide: (from, to) =>
        set((state) => {
          const slides = [...state.presentation.slides];
          const slide = slides[from];

          // A build is the CONTIGUOUS run around the dragged slide. A standalone
          // slide may split one groupId into two runs; those halves operate
          // independently until the divider moves away, at which point adjacency
          // naturally rejoins them. Never collect same-id slides across a gap.
          let runStart = from;
          let runEnd = from;
          if (slide.groupId) {
            while (runStart > 0 && slides[runStart - 1].groupId === slide.groupId) runStart--;
            while (runEnd + 1 < slides.length && slides[runEnd + 1].groupId === slide.groupId) runEnd++;
          }

          // Reorder a slide only when the drop remains inside its contiguous run.
          if (slide.groupId && to >= runStart && to <= runEnd) {
            const [moved] = slides.splice(from, 1);
            slides.splice(to, 0, moved);
            return {
              presentation: { ...state.presentation, slides },
              currentSlideIndex: to,
              isDirty: true,
            };
          }

          // Moving outside the run moves only that contiguous build half.
          if (slide.groupId) {
            const groupSlides = slides.slice(runStart, runEnd + 1);
            const otherSlides = [...slides.slice(0, runStart), ...slides.slice(runEnd + 1)];

            // Compute target position in the "others" array.
            let adjustedTo = to;
            if (to > runEnd) {
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

          // Ensure original elements have linkIds and syncIds. syncId
          // defaults to the element's own id so synced instances share one
          // notebook overlay (keyed by syncId??id) across save/Save As.
          const updatedElements = original.elements.map((el) => {
            const linkId = el.linkId || crypto.randomUUID();
            return { ...el, linkId, syncId: el.syncId || el.id };
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
              // linkId + syncId preserved from original → shares its overlay
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

      updateElement: (elementId, changes) => {
        set((state) => {
          // The element is usually on the current slide, but a commit can fire
          // AFTER the slide changed: a text edit commits on UNMOUNT, so clicking
          // "New Slide" moves currentSlideIndex to the new blank slide first, then
          // the old element unmounts and commits. Target the element's OWN slide
          // (ids are unique across the deck) so the edit lands there instead of
          // no-oping on the new slide and being lost (#177).
          let ownIndex = state.currentSlideIndex;
          let element = state.presentation.slides[ownIndex]?.elements.find((el) => el.id === elementId);
          if (!element) {
            ownIndex = state.presentation.slides.findIndex((s) => s.elements.some((el) => el.id === elementId));
            element = ownIndex >= 0 ? state.presentation.slides[ownIndex].elements.find((el) => el.id === elementId) : undefined;
          }
          if (!element) return updateCurrentSlide(state, (s) => s); // truly gone — no-op

          // Apply changes to the target element
          const updatedElement = { ...element, ...changes } as SlideElement;

          // If element has syncId, propagate changes across all slides.
          // Synced instances are the SAME element (one shared DB row), so
          // EVERY data change propagates — not a hand-picked subset. That
          // covers content (html, position), styling, and notebook display
          // options (hideHeader, syntaxHighlight, hideMarkdown, showBorder,
          // editable, fontSize/fontSizeName, visibleCells, …). Strip only
          // identity / sync-linkage so we never clobber per-instance ids.
          const syncId = updatedElement.syncId;
          if (syncId) {
            // Only DATA changes propagate to synced peers — strip identity /
            // linkage so each instance keeps its own ids (IDENTITY_KEYS is the
            // single source of truth, shared with the delta helpers).
            const identity: readonly string[] = IDENTITY_KEYS;
            const syncChanges = Object.fromEntries(
              Object.entries(changes).filter(([k]) => !identity.includes(k))
            ) as Partial<SlideElement>;

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

          // No sync — update the element's OWN slide (ownIndex), which may differ
          // from currentSlideIndex when a commit fires after the slide changed (#177).
          const slides = [...state.presentation.slides];
          slides[ownIndex] = {
            ...slides[ownIndex],
            elements: slides[ownIndex].elements.map((el) =>
              el.id === elementId ? updatedElement : el
            ),
          };
          return { presentation: { ...state.presentation, slides }, isDirty: true };
        });
      },

      // --- sync / link relationships -------------------------------------
      // Thin wrappers: find the element on the current slide, compute the
      // delta with the shared helpers, route through updateElement (so they
      // inherit sync-propagation, dirty tracking and undo coalescing). The
      // single API the UI calls — no more hand-built {syncId,_syncId,…} deltas.
      freeElement: (elementId) => {
        const st = get();
        const csi = st.currentSlideIndex;
        const el = st.presentation.slides[csi]?.elements.find((e) => e.id === elementId);
        if (!el || !el.syncId) return;   // only a synced element can be freed
        const oldSyncId = el.syncId;
        // Give the freed instance its OWN id so it persists as its own DB row.
        // A sync group is ONE shared row; after reload its instances share the
        // canonical id, so without a fresh id the freed frame can't be written
        // separately and collapses back into the group on save (the S5c bug).
        const newId = crypto.randomUUID();
        // Ensure the freed frame and its (former) sync peers share ONE animation
        // linkId so duplicate→free→move→animate works even for sync groups not
        // created by duplicate (which already seeds one). Reuse any existing.
        const sharedLinkId = el.linkId
          || st.presentation.slides.flatMap((s) => s.elements)
               .find((e) => e.syncId === oldSyncId && e.linkId)?.linkId
          || crypto.randomUUID();
        // Type hook (notebook clone-on-unsync) fires before the flip, onto the
        // freed instance's NEW key, so it can seed caches synchronously.
        void runFreeHook(el, newId);
        set((state) => ({
          presentation: {
            ...state.presentation,
            slides: state.presentation.slides.map((slide, idx) => ({
              ...slide,
              elements: slide.elements.map((e) => {
                // Only the instance on the CURRENT slide is freed. Scope by
                // slide index, not id alone — after a reload synced instances
                // SHARE the canonical id, so `e.id === elementId` would match
                // (and wrongly free) every mirror.
                if (idx === csi && e.id === elementId) {
                  return { ...e, id: newId, syncId: undefined,
                    _syncId: oldSyncId, linkId: sharedLinkId } as SlideElement;
                }
                // Still-synced peers (other slides) get the same (dormant)
                // linkId so they animate with the freed frame; no-op if shared.
                if (idx !== csi && e.syncId === oldSyncId && e.linkId !== sharedLinkId) {
                  return { ...e, linkId: sharedLinkId } as SlideElement;
                }
                return e;
              }),
            })),
          },
          selectedObject: (() => {
            const sel = state.selectedObject;
            if (!sel) return sel;
            if (sel.type === 'element' && sel.id === elementId) return { type: 'element' as const, id: newId };
            if (sel.type === 'multi' && sel.ids.includes(elementId))
              return { type: 'multi' as const, ids: sel.ids.map((i: string) => i === elementId ? newId : i) };
            return sel;
          })(),
          isDirty: true,
        }));
      },
      resyncElement: (elementId) => {
        const st = get();
        const el = st.presentation.slides[st.currentSlideIndex]
          ?.elements.find((e) => e.id === elementId);
        if (!el || !el._syncId) return;
        const syncId = el._syncId;
        // Snap to the group's geometry: re-syncing means "this is the same
        // element again", so it ADOPTS a still-synced peer's position (the move
        // made while freed is discarded — to keep it, stay freed). Without this
        // the group ends up at two different positions (the S2 bug).
        const peer = st.presentation.slides.flatMap((s) => s.elements)
          .find((e) => e.id !== elementId && e.syncId === syncId);
        const geom: Partial<SlideElement> = peer
          ? (peer.type === 'arrow' && el.type === 'arrow'
              ? { x1: peer.x1, y1: peer.y1, x2: peer.x2, y2: peer.y2,
                  c1x: peer.c1x, c1y: peer.c1y, c2x: peer.c2x, c2y: peer.c2y, points: peer.points } as Partial<SlideElement>
              : { position: { ...peer.position } } as Partial<SlideElement>)
          : {};
        void runResyncHook(el);
        get().updateElement(elementId, { ...resyncDelta(el), ...geom } as Partial<SlideElement>);
      },
      unlinkElement: (elementId) => {
        const el = get().presentation.slides[get().currentSlideIndex]
          ?.elements.find((e) => e.id === elementId);
        if (!el) return;
        const delta = unlinkDelta(el);
        if (Object.keys(delta).length) get().updateElement(elementId, delta);
      },
      relinkElement: (elementId) => {
        const el = get().presentation.slides[get().currentSlideIndex]
          ?.elements.find((e) => e.id === elementId);
        if (!el) return;
        const delta = relinkDelta(el);
        if (Object.keys(delta).length) get().updateElement(elementId, delta);
      },
      linkElements: (sourceId, targetSlideIndex, targetId) => {
        const st = get();
        const source = st.presentation.slides[st.currentSlideIndex]
          ?.elements.find((e) => e.id === sourceId);
        const target = st.presentation.slides[targetSlideIndex]
          ?.elements.find((e) => e.id === targetId);
        if (!source || !target) return;
        // Links are cross-slide, SAME-TYPE, and NEVER on a synced element.
        //  - same-slide: nothing to animate between.
        //  - cross-type: a later promote could replace one type with another
        //    (e.g. a text box overwriting a notebook + its recording).
        //  - synced: sync and link are mutually exclusive — a synced element
        //    shares ONE position across slides, so there's no delta to animate.
        // The picker/badge enforce these; guard here too (also covers paste).
        const csi = st.currentSlideIndex;
        if (csi === targetSlideIndex) return;
        if (source.type !== target.type) return;
        if (source.syncId || target.syncId) return;
        // ANIMATION link only — NON-destructive. Both sides get a shared linkId
        // (the #30-symmetric delta); syncId is left untouched, so the elements
        // stay separate (own position/content/recording) and the presenter
        // animates between them. "L" must NOT sync/merge — that's destructive
        // and only the duplicate junction model produces a clean single entry.
        const { delta, mergeIds } = linkPairDeltas(source, target);
        // Re-point the two endpoints AND every member of any group being merged
        // in, so sequential links from one anchor build a single group rather
        // than stranding the anchor's earlier partner (#S9).
        const migrate = new Set(mergeIds);
        // One set() = one undo step; via set() (not setPresentation) so undo
        // history survives.
        set((state) => ({
          presentation: {
            ...state.presentation,
            slides: state.presentation.slides.map((slide, idx) => ({
              ...slide,
              elements: slide.elements.map((el) => {
                const isEndpoint = (idx === csi && el.id === sourceId)
                  || (idx === targetSlideIndex && el.id === targetId);
                if (isEndpoint || (el.linkId && migrate.has(el.linkId))) {
                  return { ...el, ...delta } as SlideElement;
                }
                return el;
              }),
            })),
          },
          isDirty: true,
        }));
      },
      promoteToSync: (elementId) => {
        const st = get();
        // The master may be on ANY slide (the chooser can pick a copy from a
        // different slide as the one to keep).
        const master = st.presentation.slides
          .flatMap((s) => s.elements).find((e) => e.id === elementId);
        if (!master || !master.linkId || master.syncId) return;  // only linked, not-yet-synced
        const linkId = master.linkId;
        const masterId = master.id;
        // Reconcile type-specific state: the master wins, each linked partner's
        // (e.g. notebook recording) is discarded. Reuses the merge hook with
        // keep='source' (the master). Fire before the flip.
        for (const slide of st.presentation.slides) {
          for (const p of slide.elements) {
            if (p.linkId === linkId && p.id !== masterId) {
              void runMergeHook({ source: master, target: p, sharedSyncId: masterId, keep: 'source' });
            }
          }
        }
        // Collapse to ONE entry: the master gets syncId = its own id, and every
        // linked instance on other slides BECOMES the master (same id, content,
        // position) so save writes one row + junctions. Destructive: partners'
        // own position/content are replaced by the master's.
        set((state) => ({
          presentation: {
            ...state.presentation,
            slides: state.presentation.slides.map((slide) => ({
              ...slide,
              elements: slide.elements.map((el) => {
                if (el.id === masterId) return { ...el, syncId: masterId } as SlideElement;
                if (el.linkId === linkId) {
                  return { ...master, syncId: masterId, linkId } as SlideElement;
                }
                return el;
              }),
            })),
          },
          isDirty: true,
        }));
      },

      deleteElement: (elementId) =>
        set((state) => {
          const removed = updateCurrentSlide(state, (slide) => ({
            ...slide,
            elements: slide.elements.filter((el) => el.id !== elementId),
          }));
          // Prune across ALL slides — a sync/link partner may be on another slide.
          const slides = pruneOrphanedGroups(removed.presentation!.slides);
          return {
            presentation: { ...removed.presentation!, slides },
            isDirty: true,
            selectedObject: { type: 'slide' },
          };
        }),

      deleteElements: (elementIds) =>
        set((state) => {
          const removed = updateCurrentSlide(state, (slide) => ({
            ...slide,
            elements: slide.elements.filter((el) => !elementIds.includes(el.id)),
          }));
          const slides = pruneOrphanedGroups(removed.presentation!.slides);
          return {
            presentation: { ...removed.presentation!, slides },
            isDirty: true,
            selectedObject: { type: 'slide' },
          };
        }),

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
          // Collect syncIds of moved elements. Position is governed by syncId:
          // synced instances mirror position (move one → move all). Independent
          // position (for animation) comes from FREEING an element (removing its
          // syncId), not from a linkId — duplicated elements carry a linkId yet
          // must stay position-synced until freed.
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
                  return shiftArrow(el, dx, dy);
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
                return shiftArrow(el, dx, dy);
              }
              return { ...el, position: { ...el.position, x: el.position.x + dx, y: el.position.y + dy } };
            }),
          }));
        }),

      toggleSelectElement: (id) =>
        set((state) => {
          const sel = state.selectedObject;
          // Focus the Element tab whenever a selection remains; fall back to
          // Slide when the toggle clears the selection.
          const withTab = (selectedObject: SelectedObject) => ({
            selectedObject,
            inspectorTab:
              selectedObject && (selectedObject.type === 'element' || selectedObject.type === 'multi')
                ? ('element' as InspectorTab)
                : (state.inspectorTab === 'element' ? ('slide' as InspectorTab) : state.inspectorTab),
          });
          if (!sel || sel.type === 'slide') {
            return withTab({ type: 'element', id });
          }
          if (sel.type === 'element') {
            if (sel.id === id) return withTab({ type: 'slide' });
            return withTab({ type: 'multi', ids: [sel.id, id] });
          }
          if (sel.type === 'multi') {
            const ids = sel.ids.includes(id) ? sel.ids.filter((i) => i !== id) : [...sel.ids, id];
            if (ids.length === 0) return withTab({ type: 'slide' });
            if (ids.length === 1) return withTab({ type: 'element', id: ids[0] });
            return withTab({ type: 'multi', ids });
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

      selectObject: (selectedObject) =>
        set((state) => ({
          selectedObject,
          // Element/multi selection focuses the Element tab; clearing to the
          // slide pulls a stale Element tab back to Slide but leaves Presentation
          // alone (so the deck inspector stays put while you click around).
          inspectorTab:
            selectedObject && (selectedObject.type === 'element' || selectedObject.type === 'multi')
              ? 'element'
              : state.inspectorTab === 'element' ? 'slide' : state.inspectorTab,
        })),
      setInspectorTab: (inspectorTab) => set({ inspectorTab }),
      toggleProperties: () =>
        set((state) => {
          const showProperties = !state.showProperties;
          writeShowInspector(showProperties); // persist so it's remembered next launch
          return { showProperties };
        }),
      toggleHistory: () =>
        set((state) => ({ showHistory: !state.showHistory })),
      toggleSnapToGrid: () =>
        set((state) => ({ snapToGrid: !state.snapToGrid })),
      toggleShowGrid: () =>
        set((state) => ({ showGrid: !state.showGrid })),
    }),
    {
      partialize: (state) => ({
        presentation: state.presentation,
      }),
      limit: UNDO_LIMIT,
      equality: (past, current) =>
        JSON.stringify(past) === JSON.stringify(current),
      // Coalesce rapid-fire set() calls into a single undo entry.
      //
      // Without this: composite actions that loop over N elements (e.g.
      // PropertiesPanel's align-left forEach, multi-select moves,
      // syncId propagation that doesn't batch, slider drags firing
      // many onChange events) each created N separate undo entries.
      // The user hit Cmd-Z expecting one logical undo and only got
      // ONE-Nth of it back — what felt like "erratic skips."
      //
      // handleSet is zundo's snapshot-push hook. Wrapping it in a
      // leading-edge debounce means: the FIRST set() in a burst
      // creates a snapshot of the PRE-burst state; subsequent set()s
      // within UNDO_DEBOUNCE_MS update current state but don't push
      // new entries. After UNDO_DEBOUNCE_MS of inactivity the
      // debounce resets, so the next user action starts a fresh
      // undoable group. Net: one undo step per "logical action."
      //
      // Trade: typing in a property field at slower-than-200ms cadence
      // produces multiple undo entries (one per pause). That matches
      // expected behavior in most editors. Continuous mouse drags
      // (canvas element move/resize) already use pauseUndo/resumeUndo
      // explicitly and are unaffected.
      handleSet: (handleSet) => debounceUndoSnapshot(handleSet, UNDO_DEBOUNCE_MS),
    }
  )
);

// Helper: pause undo tracking (call before continuous operations like drags)
// Undo "transaction" for a continuous gesture (drag, resize, slider) so it
// becomes EXACTLY ONE undo step. pause() alone is not enough: zundo records the
// pre-change state only when a tracked set() fires, so pausing BEFORE the first
// change means the pre-gesture state is never captured — undo then reverted the
// PREVIOUS action too (e.g. dragging a freshly-added element then Cmd-Z deleted
// it; #55). So we snapshot the pre-gesture state ourselves and push it as one
// entry on resume. Ref-counted so nested pause/resume is safe.
let undoTxnSnapshot: { presentation: Presentation } | null = null;
let undoTxnDepth = 0;

/** The current deck's asset-security token (the stable id trust/approvals are keyed
 *  by), or undefined for a legacy/untrusted deck. One accessor so the many read sites
 *  don't each spell out the store path (and drift on optional-chaining). */
export function getDeckToken(): string | undefined {
  return usePresentationStore.getState().presentation.config.deckToken;
}

export function pauseUndo() {
  if (undoTxnDepth === 0) {
    undoTxnSnapshot = { presentation: usePresentationStore.getState().presentation };
    usePresentationStore.temporal.getState().pause();
  }
  undoTxnDepth++;
}

// Resume undo tracking (call when the gesture completes). Records the pre-gesture
// snapshot as a single undo entry (unless nothing actually changed).
export function resumeUndo() {
  if (undoTxnDepth === 0) return;
  undoTxnDepth--;
  if (undoTxnDepth > 0) return;
  const temporal = usePresentationStore.temporal;
  temporal.getState().resume();
  const pre = undoTxnSnapshot;
  undoTxnSnapshot = null;
  if (!pre) return;
  const cur = usePresentationStore.getState().presentation;
  // No-op gesture (e.g. click without drag) → don't push an empty undo step.
  if (JSON.stringify(pre.presentation) === JSON.stringify(cur)) return;
  temporal.setState({
    pastStates: [...temporal.getState().pastStates, pre].slice(-UNDO_LIMIT),
    futureStates: [],  // a fresh action invalidates the redo stack
  });
}

// Undo/redo that FOLLOWS the change: if the reverted edit is on a different
// slide than the one you're viewing, jump to it so the change is visible. A
// silent off-slide undo looks like a no-op and invites over-undoing. Stays put
// when the current slide itself changed (you already see it) or nothing visible
// changed (e.g. a config-only edit).
function firstChangedSlide(before: Slide[], after: Slide[]): number | null {
  const n = Math.max(before.length, after.length);
  for (let i = 0; i < n; i++) {
    if (JSON.stringify(before[i]) !== JSON.stringify(after[i])) return i;
  }
  return null;
}

function followUndoChange(beforeSlides: Slide[], curIdx: number): void {
  const st = usePresentationStore.getState();
  const after = st.presentation.slides;
  // The slide you're on changed → you already see it, don't yank focus.
  if (JSON.stringify(beforeSlides[curIdx]) !== JSON.stringify(after[curIdx])) return;
  const changed = firstChangedSlide(beforeSlides, after);
  if (changed === null) return;
  const target = Math.max(0, Math.min(changed, after.length - 1));
  if (target !== curIdx) st.selectSlide(target);
}

export function undoWithNav(): void {
  const before = usePresentationStore.getState().presentation.slides;
  const cur = usePresentationStore.getState().currentSlideIndex;
  usePresentationStore.temporal.getState().undo();
  followUndoChange(before, cur);
}

export function redoWithNav(): void {
  const before = usePresentationStore.getState().presentation.slides;
  const cur = usePresentationStore.getState().currentSlideIndex;
  usePresentationStore.temporal.getState().redo();
  followUndoChange(before, cur);
}

// Cross-session undo: prime zundo's pastStates from the deck's persisted edit
// history. The bitemporal schema versions every save, and the backend can
// reconstruct the deck as-of any past timestamp (db_get_state_at), so we walk
// the recorded edit points (db_get_history_timestamps) and build undo snapshots.
// The most recent timestamp is the loaded (current) state, so pastStates are the
// ones BEFORE it. Capped so a long history doesn't blow up open time / memory.
const UNDO_SEED_LIMIT = 40;

export async function seedUndoHistory(): Promise<number> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    // Reconstructed history is a SECOND deck-content ingress, separate from the
    // on-open normalize — so it must run the SAME boundary. Otherwise a crafted deck
    // can hide executable markup (onerror=/js: URLs) or a breakout property
    // (fontFamily/color) in an old temporal row that the current-content normalize
    // never sees; pressing Undo would install it into a raw dangerouslySetInnerHTML
    // sink in the privileged frame (stored XSS). Normalize each snapshot before seeding.
    const { normalizeUntrustedPresentation } = await import('../lib/normalizePresentation');
    const raw = await invoke<string>('db_get_history_timestamps');
    const points = JSON.parse(raw) as { timestamp: string }[];
    if (!Array.isArray(points) || points.length <= 1) return 0;
    // Drop the latest (== current state); keep the most recent N prior points.
    const prior = points.slice(0, -1).slice(-UNDO_SEED_LIMIT);
    const snapshots: { presentation: Presentation }[] = [];
    for (const p of prior) {
      try {
        const pres = JSON.parse(await invoke<string>('db_get_state_at', { at: p.timestamp })) as Presentation;
        if (pres && Array.isArray(pres.slides)) {
          normalizeUntrustedPresentation(pres);
          snapshots.push({ presentation: pres });
        }
      } catch { /* skip an unreconstructable point */ }
    }
    if (snapshots.length === 0) return 0;
    // Only seed if nothing has been recorded yet (don't clobber live edits the
    // user made in the brief window before this async warmup finished).
    const t = usePresentationStore.temporal.getState();
    if (t.pastStates.length > 0) return 0;
    usePresentationStore.temporal.setState({ pastStates: snapshots, futureStates: [] });
    return snapshots.length;
  } catch {
    return 0;
  }
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
const dirtyZOrder = new Set<string>();      // slide IDs whose element z-order changed
let dirtyPresentation = false;              // config/title changed

// Structural changes tracked explicitly.
// Element maps are keyed PER JUNCTION — `${slideId}\0${instanceId}` — not by
// element id alone, because a synced element appears on several slides under
// ONE shared id (after a save/reopen all instances share the canonical id).
// Keying by id alone would let two instances collide; keying by (slide,id)
// addresses each junction distinctly, which is what add/delete operate on.
const jkey = (slideId: string, elementId: string) => `${slideId} ${elementId}`;
const addedSlides = new Map<string, { position: number; groupId?: string }>();
const deletedSlides = new Set<string>();
const addedElements = new Map<string, { slideId: string; element: any; zOrder: number }>();
// junction key → the slide + the CANONICAL row id (syncId ?? id) whose
// slide_elements junction must be closed. A duplicated synced instance has a
// fresh in-session id but its DB junction is under the canonical id, so we
// must remove by canonical, not by the in-session instance id.
const deletedElements = new Map<string, { slideId: string; junctionId: string }>();

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

/** The presentation-level rows written to the `presentation` KV table. SINGLE
 *  SOURCE for both the flush (which writes them) and the change-detector (which
 *  diffs them) — deriving both from here is what stops a field from being
 *  persisted-but-not-detected, or detected-but-not-written, ever again (the deck
 *  `theme` bug: it was in the model + stored as a row, but missing from BOTH the
 *  flush and the diff, so it silently never saved). Add a new standalone row HERE,
 *  once, and both paths pick it up. `config` is the catch-all JSON blob, so most
 *  new presentation fields ride along inside it automatically. */
export function presentationRows(p: Pick<Presentation, 'title' | 'theme' | 'config'>): Record<string, string> {
  return {
    title: p.title,
    theme: p.theme,
    config: JSON.stringify(p.config),
  };
}

/** Persisted per-slide metadata — the SINGLE SOURCE for both the slide flush write
 *  and the slide change-detector (same rationale as presentationRows). `notes` and
 *  `groupId` are columns; the rest ride in the slide `config` JSON. Add a new
 *  per-slide override HERE, once, and both the write and the dirty-diff pick it up. */
export function slideMeta(s: Slide): { notes: string; groupId: string; config: Record<string, string | boolean> } {
  const config: Record<string, string | boolean> = {};
  if (s.theme) config.theme = s.theme;
  if (s.titleFont) config.titleFont = s.titleFont;
  if (s.bodyFont) config.bodyFont = s.bodyFont;
  if (s.hypeFont) config.hypeFont = s.hypeFont;
  if (s.omitFooter) config.omitFooter = true; // #135 — only when set (absence = footer shown)
  return { notes: s.notes || '', groupId: s.groupId || '', config };
}

/** Force an immediate flush (called on explicit save, pointerup, text commit) */
export async function flushToSqlite(): Promise<void> {
  if (!sqliteDbPath) return;
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }

  // Force any pending notebook overlays to disk as part of the same save, so a
  // deck saved/autosaved within the overlay's 800ms debounce can't drop it
  // (#123). No-op when no overlay changed.
  await flushAllOverlays();

  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const state = usePresentationStore.getState();

    // --- Reconcile structural add/delete that CANCEL within this one flush ---
    // A never-flushed row (queued in addedSlides/addedElements) has no DB row, so its
    // DELETE is always a no-op → always drop the delete. The only decision is whether to
    // keep the ADD, and that must follow the FINAL state, not mere queue membership:
    //   - absent from the final state → genuine create-then-delete → cancel the add
    //     (e.g. delete a freshly-duplicated mirror / its slide — must not resurrect;
    //     dca9005 / #65), and
    //   - present in the final state → undo→redo churned a still-present row into both
    //     queues → KEEP the add so it gets written (dropping it here silently lost the
    //     row on save — #185).
    const finalSlideIds = new Set(state.presentation.slides.map((s) => s.id));
    const finalElemKeys = new Set<string>();
    for (const s of state.presentation.slides)
      for (const el of s.elements) finalElemKeys.add(jkey(s.id, el.id));

    for (const slideId of [...deletedSlides]) {
      if (addedSlides.has(slideId)) {
        deletedSlides.delete(slideId);
        if (!finalSlideIds.has(slideId)) {
          addedSlides.delete(slideId);
          // …and any element junctions queued onto that never-persisted slide.
          for (const k of [...addedElements.keys()]) {
            if (addedElements.get(k)!.slideId === slideId) addedElements.delete(k);
          }
        }
      }
    }
    for (const k of [...deletedElements.keys()]) {
      if (addedElements.has(k)) {
        deletedElements.delete(k);
        if (!finalElemKeys.has(k)) addedElements.delete(k);
      }
    }

    // Structural changes: delete slides + element junctions first, then add.
    for (const slideId of deletedSlides) {
      try { await invoke('db_delete_slide', { slideId }); } catch (e) { console.warn('delete slide failed:', e); }
    }
    deletedSlides.clear();

    for (const [slideId, info] of addedSlides) {
      try {
        await invoke('db_add_slide', { id: slideId, position: info.position, groupId: info.groupId || null });
      } catch (e) { console.warn('add slide failed:', e); }
    }
    addedSlides.clear();

    // Close junctions by the CANONICAL row id (syncId ?? id). A duplicated
    // synced instance has a fresh in-session id but its DB junction was written
    // under the canonical id, so removing by the instance id would miss the
    // junction and the element would resurrect on reload.
    for (const { slideId, junctionId } of deletedElements.values()) {
      try {
        await invoke('db_remove_element_from_slide', { slideId, elementId: junctionId });
      } catch (e) { console.warn('remove element failed:', e); }
    }
    deletedElements.clear();

    // Added elements in TWO passes so junctions never precede their row:
    //   pass 1 — instances that OWN their row (canonical === own id) → db_add_element
    //   pass 2 — synced instances → a slide_elements junction to the canonical row
    // The canonical row id for a synced instance is its syncId (the original's
    // id; preserved across duplicate/save). A junction is written only when
    // that row exists (created this flush, or already persisted); otherwise the
    // canonical instance was deleted, so THIS instance is promoted to the row.
    const flushSyncCanonical = new Map<string, string>();  // syncId → row id that exists
    const addElementRow = async (el: any, slideId: string, zOrder: number) => {
      // Strip promoted columns (linkId, assetId) and sync metadata from the
      // JSON `data` blob — they're their own columns / reassembled by export.
      const { linkId, syncId: _s, _syncId, _linkId, assetId, src, demoSrc, ...data } = el;
      void src; void _s; void demoSrc;  // intentionally dropped from data JSON
      await invoke('db_add_element', {
        slideId, elementId: el.id, elementType: el.type,
        data: JSON.stringify(data), linkId: linkId || null, assetId: assetId || null, zOrder,
      });
      if (el.syncId) flushSyncCanonical.set(el.syncId, el.id);
    };
    // Use the CURRENT element (not the snapshot captured when it was first
    // added): a sync/link transition after the add but before the flush —
    // free / resync — changes syncId, which decides row-vs-junction. The
    // snapshot would be stale (e.g. a freed-then-resynced instance would be
    // written as a stray row instead of a junction).
    const liveOf = (info: { slideId: string; element: any }) =>
      state.presentation.slides.find((s) => s.id === info.slideId)
        ?.elements.find((e) => e.id === info.element.id) ?? info.element;
    for (const info of addedElements.values()) {
      const el = liveOf(info);
      const canonical = el.syncId ?? el.id;
      if (canonical === el.id) {
        try { await addElementRow(el, info.slideId, info.zOrder); }
        catch (e) { console.warn('add element row failed:', e); }
      }
    }
    for (const info of addedElements.values()) {
      const el = liveOf(info);
      const syncId: string | undefined = el.syncId;
      const canonical = syncId ?? el.id;
      if (canonical === el.id) continue;  // already written as a row in pass 1
      try {
        const rowId = flushSyncCanonical.get(syncId!) ?? canonical;
        const exists = flushSyncCanonical.has(syncId!)
          || (await invoke('db_element_exists', { elementId: rowId }) as boolean);
        if (exists) {
          await invoke('db_add_element_to_slide', {
            slideId: info.slideId, elementId: rowId, zOrder: info.zOrder,
          });
        } else {
          // Canonical row is gone (its instance was deleted this session) →
          // this instance becomes the surviving row for the group.
          await addElementRow(el, info.slideId, info.zOrder);
        }
      } catch (e) { console.warn('add element junction failed:', e); }
    }
    addedElements.clear();

    // Incremental: only write dirty items
    if (dirtyPresentation) {
      for (const [key, value] of Object.entries(presentationRows(state.presentation))) {
        await invoke('db_update_presentation', { key, value });
      }
      dirtyPresentation = false;
    }

    for (const elementId of dirtyElements) {
      // Find the element in the current state
      for (const slide of state.presentation.slides) {
        const el = slide.elements.find((e) => e.id === elementId);
        if (el) {
          // Same strip as the add-element path: promoted columns
          // (linkId, assetId) and sync-related metadata don't go into
          // the JSON blob.
          const { linkId, syncId, _syncId, _linkId, assetId, src, demoSrc, ...data } = el as any;
          void src; void syncId; void demoSrc;  // intentionally dropped from data JSON
          await invoke('db_update_element', {
            id: elementId,
            data: JSON.stringify(data),
            linkId: linkId || null,
            assetId: assetId || null,
          });
          break;
        }
      }
    }
    dirtyElements.clear();

    // Slide metadata changes (notes, groupId, position, config)
    // The `config` JSON holds per-slide overrides (theme + per-preset
    // font slots). Build it from the slide's override fields and pass:
    // - JSON string when there are overrides
    // - empty string to CLEAR overrides (storage maps to NULL column)
    for (const slideId of dirtySlides) {
      const idx = state.presentation.slides.findIndex((s) => s.id === slideId);
      const slide = state.presentation.slides[idx];
      if (slide) {
        const m = slideMeta(slide);
        const config = Object.keys(m.config).length === 0 ? '' : JSON.stringify(m.config);
        await invoke('db_update_slide', {
          slideId,
          position: idx,
          notes: m.notes || null,
          groupId: m.groupId || null,
          config,
        });
      }
    }
    dirtySlides.clear();

    // Z-order changes — update all element positions on affected slides
    for (const slideId of dirtyZOrder) {
      const slide = state.presentation.slides.find((s) => s.id === slideId);
      if (slide) {
        for (let j = 0; j < slide.elements.length; j++) {
          const el = slide.elements[j];
          await invoke('db_update_z_order', {
            slideId,
            // Junctions are keyed by the canonical row id (syncId ?? id); a
            // duplicated synced instance's fresh in-session id has no junction.
            elementId: el.syncId ?? el.id,
            newZOrder: j,
          });
        }
      }
    }
    dirtyZOrder.clear();

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
  const OPEN_LOG = false;  // flip true for openProject phase timings
  const T0 = performance.now();
  const olog = (msg: string): void => {
    if (OPEN_LOG) console.log(`[openProject +${Math.round(performance.now() - T0)}ms] ${msg}`);
  };
  olog(`start ${dbPath.split('/').pop()}`);

  try {
    const { invoke } = await import('@tauri-apps/api/core');

    // Close previous project cleanly (flush pending writes, checkpoint WAL,
    // tear down its file watchers).
    if (sqliteDbPath) {
      const t = performance.now();
      await closeSqliteProject();
      olog(`closed previous project: ${(performance.now() - t).toFixed(0)}ms`);
    }

    // Cancel any pending flush timer from the previous project
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }

    // Disable write-through during load
    sqliteDbPath = null;

    // Clear dirty state
    dirtyElements.clear();
    dirtySlides.clear();
    dirtyZOrder.clear();
    dirtyPresentation = false;
    addedSlides.clear();
    deletedSlides.clear();
    addedElements.clear();
    deletedElements.clear();

    // Clear cached blob URLs from previous project
    const { clearAssetCache } = await import('../lib/demoAssets');
    clearAssetCache();

    // Reset the math-cache warm-up flag so the new project's cached SVGs
    // get loaded into the in-memory pool (and old project's are discarded).
    const { resetMathCacheWarmupFlag } = await import('../lib/mathjaxRenderer');
    resetMathCacheWarmupFlag();

    // Drop the in-session notebook-overlay cache so element ids from
    // the previous deck don't shadow this one.
    const { clearAllOverlayCache } = await import('../lib/useOverlay');
    clearAllOverlayCache();

    // Open new DB and load
    let t = performance.now();
    await invoke('db_open', { path: dbPath });
    olog(`db_open: ${(performance.now() - t).toFixed(0)}ms`);

    t = performance.now();
    const json = await invoke<string>('db_export_json');
    olog(`db_export_json: ${(performance.now() - t).toFixed(0)}ms → ${(json.length / 1024).toFixed(0)}KB JSON`);

    t = performance.now();
    const presentation: Presentation = JSON.parse(json);
    // A valid deck always has ≥1 slide (deleteSlide refuses to remove the last
    // one). A 0-slide deck is an empty/corrupt file; opening it would blank the
    // editor into a black, slide-less void (#103). Reject it BEFORE committing to
    // the store so the current document is left intact and the opener surfaces
    // the error (rethrown below).
    if (!Array.isArray(presentation.slides) || presentation.slides.length === 0) {
      throw new Error('This presentation has no slides — the file is empty or corrupt.');
    }
    olog(`JSON.parse: ${(performance.now() - t).toFixed(0)}ms → ${presentation.slides.length} slides, ${presentation.slides.reduce((n, s) => n + s.elements.length, 0)} elements`);

    // Migrate legacy notebook tokens / baseUrls into the per-machine
    // server registry, then strip them from the deck so future saves
    // don't carry auth artifacts. Mutates `presentation` in place.
    // Idempotent for already-migrated decks.
    try {
      const { migrateLegacyNotebookTokens } = await import('../lib/notebookMigrate');
      if (migrateLegacyNotebookTokens(presentation)) {
        olog('migrated legacy notebook token/baseUrl into jupyterServers registry');
      }
    } catch (e) {
      console.warn('Notebook token migration failed (non-fatal):', e);
    }

    // Normalize untrusted deck content: reduce text html to the toolbar allowlist
    // AND validate element properties (fontFamily/color/geometry) against their
    // known-safe shape, dropping any element outside it. Both html and PROPERTIES
    // reach privileged dangerouslySetInnerHTML sinks, so a JSON-authored / pasted /
    // shared deck must pass through this one boundary (audit H-1 + C-2). Transparent
    // to real decks (see normalizePresentation.decks.test); mutates in place.
    try {
      const { normalizeUntrustedPresentation } = await import('../lib/normalizePresentation');
      const dropped = normalizeUntrustedPresentation(presentation);
      olog(`normalized untrusted content on load${dropped ? ` (dropped ${dropped} unsafe element(s))` : ''}`);
    } catch (e) {
      console.warn('Presentation normalization failed (non-fatal):', e);
    }

    t = performance.now();
    const store = usePresentationStore.getState();
    store.setPresentation(presentation);
    store.setProjectPath(dbPath.replace(/\.eigendeck$/, ''));
    store.markClean();
    olog(`setPresentation + setProjectPath: ${(performance.now() - t).toFixed(0)}ms`);

    // Reset prevPresentation so subscriber doesn't diff against old state
    prevPresentation = presentation;

    // Asset-security: refresh this deck's trust TTL on open (docs/ASSETS-SECURITY.md).
    // No-op for untrusted / received decks (open() only refreshes an effectively-
    // trusted deck). Fire-and-forget — trust state isn't needed to render, and a
    // ledger hiccup must not affect open latency or correctness.
    const deckToken = presentation.config?.deckToken;
    if (deckToken) {
      void (async () => {
        try {
          const { touchOpen } = await import('../lib/trustStore');
          await touchOpen(deckToken);
          // Ledger hygiene: sweep approvals orphaned by edits in a PRIOR session
          // (deletes/re-links that never got a save-time reconcile). See fileOps.
          const { reconcileDeckApprovals, notifyTrustStatusOnOpen } = await import('./fileOps');
          await reconcileDeckApprovals();
          // Non-blocking status nudge: TTL re-confirm, or "N files not watched — Review".
          await notifyTrustStatusOnOpen();
        } catch (e) { console.warn('[openProject] trust touchOpen/reconcile failed (non-fatal):', e); }
      })();
    }

    // NOTE: we deliberately DO NOT prompt on open for an untrusted deck. Per
    // docs/ASSETS-SECURITY.md ("Default to silence — no modal on open, ever;
    // don't train click-through"), an untrusted deck simply renders its embedded
    // snapshot silently. The Trust affordance lives passively in the inspector
    // (where the user is already looking at a linked asset), not as a nag.

    // Enable write-through for the new project
    sqliteDbPath = dbPath;
    olog(`load complete, kicking off async warmups`);

    // Warm the math-SVG cache so previously-rendered expressions don't
    // re-render through the iframe pool on first slide paint.
    const { warmMathCacheFromSqlite } = await import('../lib/mathjaxRenderer');
    void warmMathCacheFromSqlite();

    // Seed the undo stack from the deck's persisted edit history so Cmd+Z works
    // ACROSS sessions (undo back to how the deck looked at earlier saves). The
    // schema is bitemporal, so we reconstruct as-of snapshots. Async + capped.
    void seedUndoHistory();

    // Scan linked assets for disk changes that happened while the file
    // was closed; reload any whose mtime moved. Async + non-blocking —
    // sidebar refreshes via invalidateRenderedAsset as each one completes.
    void (async () => {
      try {
        const { scanForChangedAssets, dirname } = await import('../lib/watcherRegistry');
        const presOverride = presentation.config?.autoReloadAssets ?? null;
        const r = await scanForChangedAssets(dirname(dbPath), presOverride);
        if (r.reloaded > 0) {
          console.log(`[openProject] scan-on-load: reloaded ${r.reloaded}/${r.checked} linked assets`);
        }
      } catch (e) {
        console.warn('[openProject] scan-on-load failed:', e);
      }
    })();
  } catch (e) {
    console.error('Failed to open SQLite project:', e);
    throw e;
  }
}

/** Close the SQLite DB, checkpointing WAL + tearing down file watchers. */
export async function closeSqliteProject(): Promise<void> {
  if (!sqliteDbPath) return;
  try {
    await flushToSqlite();
    const { invoke } = await import('@tauri-apps/api/core');
    // Tear down the watcher registry for the closing project. project_id
    // is the registry key; read it before db_close clears the handle.
    let projectId: string | null = null;
    try { projectId = await invoke<string>('db_get_project_id'); } catch { /* ignore */ }
    if (projectId) {
      const { closeWatcherRegistry } = await import('../lib/watcherRegistry');
      closeWatcherRegistry(projectId);
    }
    // Drop missing-source flags so they don't leak into the next deck (#74).
    const { clearAllMissing } = await import('../lib/missingAssets');
    clearAllMissing();
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

  // Detect presentation metadata changes by diffing the SAME rows the flush writes
  // (presentationRows) — so every persisted row is automatically change-detected;
  // they can't drift apart (that's how the deck theme silently stopped saving).
  if (JSON.stringify(presentationRows(prev)) !== JSON.stringify(presentationRows(curr))) {
    markPresentationDirty();
  }

  // Detect added/deleted slides
  const prevSlideIds = new Set(prev.slides.map((s) => s.id));
  const currSlideIds = new Set(curr.slides.map((s) => s.id));
  let structuralChange = false;

  for (const cs of curr.slides) {
    if (!prevSlideIds.has(cs.id)) {
      // New slide added
      const idx = curr.slides.indexOf(cs);
      addedSlides.set(cs.id, { position: idx, groupId: cs.groupId });
      // All elements on this slide are new
      for (let j = 0; j < cs.elements.length; j++) {
        const el = cs.elements[j];
        addedElements.set(jkey(cs.id, el.id), { slideId: cs.id, element: el, zOrder: j });
      }
      structuralChange = true;
      scheduleFlush();
    }
  }

  for (const ps of prev.slides) {
    if (!currSlideIds.has(ps.id)) {
      // Slide deleted
      deletedSlides.add(ps.id);
      structuralChange = true;
      scheduleFlush();
    }
  }

  // Detect slide reordering OR position shifts from add/delete
  // Any change in the slide ID sequence means positions need updating
  let orderChanged = false;
  if (structuralChange) {
    // Adding/deleting slides shifts positions of subsequent slides
    orderChanged = true;
  } else if (prev.slides.length === curr.slides.length) {
    for (let i = 0; i < curr.slides.length; i++) {
      if (prev.slides[i]?.id !== curr.slides[i]?.id) {
        orderChanged = true;
        break;
      }
    }
  }
  if (orderChanged) {
    // Mark ALL existing slides as dirty so their positions get flushed
    for (const cs of curr.slides) {
      if (prevSlideIds.has(cs.id)) markSlideDirty(cs.id);
    }
  }

  // Detect per-slide changes (only for slides that exist in both)
  for (const cs of curr.slides) {
    const ps = prev.slides.find((s) => s.id === cs.id);
    if (!ps) continue;

    // Slide metadata (notes, groupId, theme, per-preset font overrides): diff the
    // SAME shape the flush writes (slideMeta) so a new override can't be written but
    // not change-detected. Any change → flush dirty so slides.config gets rewritten.
    if (JSON.stringify(slideMeta(ps)) !== JSON.stringify(slideMeta(cs))) {
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
          addedElements.set(jkey(cs.id, el.id), { slideId: cs.id, element: el, zOrder: j });
          scheduleFlush();
        }
      }

      // Elements removed from this slide. Record the CANONICAL row id
      // (syncId ?? id) so the right slide_elements junction is closed even
      // when the instance carried a fresh in-session id (duplicated mirror).
      for (const pel of ps.elements) {
        if (!currElIds.has(pel.id)) {
          deletedElements.set(jkey(cs.id, pel.id), {
            slideId: cs.id, junctionId: (pel as any).syncId ?? pel.id,
          });
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

      // Detect z-order changes (element IDs in different array positions)
      if (ps.elements.length === cs.elements.length) {
        for (let j = 0; j < cs.elements.length; j++) {
          if (ps.elements[j]?.id !== cs.elements[j]?.id) {
            dirtyZOrder.add(cs.id);
            scheduleFlush();
            break;
          }
        }
      }
    }
  }
});
