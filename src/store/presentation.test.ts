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

  describe('slide ordering', () => {
    function getSlideIds() {
      return usePresentationStore.getState().presentation.slides.map(s => s.id);
    }

    it('adding slides maintains correct order', () => {
      const store = usePresentationStore.getState();
      const id0 = getSlideIds()[0];
      store.addSlide(); // adds after current (0), so [0, new1]
      const id1 = getSlideIds()[1];
      store.addSlide(); // current is 1, adds after: [0, 1, new2]
      const id2 = getSlideIds()[2];
      expect(getSlideIds()).toEqual([id0, id1, id2]);
      expect(getSlideIds().length).toBe(3);
    });

    it('adding slide in the middle shifts subsequent positions', () => {
      const store = usePresentationStore.getState();
      store.addSlide(); store.addSlide(); // 3 slides: [0, 1, 2]
      const ids = getSlideIds();
      store.selectSlide(0); // select first
      store.addSlide(); // insert after 0: [0, new, 1, 2]
      const newIds = getSlideIds();
      expect(newIds.length).toBe(4);
      expect(newIds[0]).toBe(ids[0]); // first unchanged
      expect(newIds[2]).toBe(ids[1]); // old second is now third
      expect(newIds[3]).toBe(ids[2]); // old third is now fourth
    });

    it('deleting a slide shifts subsequent positions', () => {
      const store = usePresentationStore.getState();
      store.addSlide(); store.addSlide(); // 3 slides
      const ids = getSlideIds();
      store.selectSlide(0);
      store.deleteSlide(0); // delete first: [1, 2]
      const newIds = getSlideIds();
      expect(newIds.length).toBe(2);
      expect(newIds[0]).toBe(ids[1]);
      expect(newIds[1]).toBe(ids[2]);
    });

    it('moving slides produces correct order', () => {
      const store = usePresentationStore.getState();
      store.addSlide(); store.addSlide(); // [A, B, C]
      const [a, b, c] = getSlideIds();
      store.moveSlide(0, 2); // A to end: [B, C, A]
      expect(getSlideIds()).toEqual([b, c, a]);
    });

    it('duplicate + move preserves order', () => {
      const store = usePresentationStore.getState();
      store.addSlide(); // [A, B]
      const [a, b] = getSlideIds();
      store.duplicateSlide(0); // [A, A', B] (duplicate inserts after original)
      const ids = getSlideIds();
      expect(ids.length).toBe(3);
      expect(ids[0]).toBe(a);
      expect(ids[2]).toBe(b);
      const aPrime = ids[1];
      // Move A' to end
      store.moveSlide(1, 2); // [A, B, A']
      const movedIds = getSlideIds();
      expect(movedIds[0]).toBe(a);
      expect(movedIds[1]).toBe(b);
      expect(movedIds[2]).toBe(aPrime);
    });

    it('slide IDs at each position are unique after many operations', () => {
      const store = usePresentationStore.getState();
      // Add several slides
      for (let i = 0; i < 5; i++) store.addSlide();
      // Move some around
      store.moveSlide(0, 3);
      store.moveSlide(4, 1);
      // Delete one
      store.deleteSlide(2);
      // Add another
      store.addSlide();

      const ids = getSlideIds();
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length); // no duplicates
    });
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

  describe('z-order operations', () => {
    beforeEach(() => {
      const store = usePresentationStore.getState();
      store.addElement({ id: 'el-a', type: 'text', preset: 'textbox', html: 'A', position: { x: 0, y: 0, width: 100, height: 50 } });
      store.addElement({ id: 'el-b', type: 'text', preset: 'textbox', html: 'B', position: { x: 0, y: 0, width: 100, height: 50 } });
      store.addElement({ id: 'el-c', type: 'text', preset: 'textbox', html: 'C', position: { x: 0, y: 0, width: 100, height: 50 } });
    });

    function getIds() {
      // Default slide has a title element, we added a, b, c after it
      return usePresentationStore.getState().presentation.slides[0].elements.map((e) => e.id);
    }

    it('bring to front moves element to end of array', () => {
      usePresentationStore.getState().moveElementZ('el-a', 'top');
      const ids = getIds();
      expect(ids[ids.length - 1]).toBe('el-a');
    });

    it('send to back moves element to start of array', () => {
      usePresentationStore.getState().moveElementZ('el-c', 'bottom');
      const ids = getIds();
      expect(ids[0]).toBe('el-c');
    });

    it('bring forward moves element up one position', () => {
      const idsBefore = getIds();
      const idxA = idsBefore.indexOf('el-a');
      usePresentationStore.getState().moveElementZ('el-a', 'up');
      const idsAfter = getIds();
      expect(idsAfter.indexOf('el-a')).toBe(idxA + 1);
    });

    it('send backward moves element down one position', () => {
      const idsBefore = getIds();
      const idxC = idsBefore.indexOf('el-c');
      usePresentationStore.getState().moveElementZ('el-c', 'down');
      const idsAfter = getIds();
      expect(idsAfter.indexOf('el-c')).toBe(idxC - 1);
    });

    it('bring to front at top is a no-op', () => {
      const idsBefore = getIds();
      const last = idsBefore[idsBefore.length - 1];
      usePresentationStore.getState().moveElementZ(last, 'top');
      expect(getIds()).toEqual(idsBefore);
    });

    it('send to back at bottom is a no-op', () => {
      const idsBefore = getIds();
      const first = idsBefore[0];
      usePresentationStore.getState().moveElementZ(first, 'bottom');
      expect(getIds()).toEqual(idsBefore);
    });

    it('z-order change preserves all elements', () => {
      const countBefore = getIds().length;
      usePresentationStore.getState().moveElementZ('el-b', 'top');
      usePresentationStore.getState().moveElementZ('el-a', 'bottom');
      expect(getIds().length).toBe(countBefore);
      expect(getIds()).toContain('el-a');
      expect(getIds()).toContain('el-b');
      expect(getIds()).toContain('el-c');
    });
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

    it('propagates ALL options (e.g. notebook display flags) between synced instances', () => {
      const store = usePresentationStore.getState();
      store.duplicateSlide(0);   // current slide becomes the copy (index 1)
      const cur = usePresentationStore.getState();
      const editEl = cur.presentation.slides[1].elements[0];  // element on the current slide
      // Notebook-style display options — NOT in the old hand-picked sync list.
      store.updateElement(editEl.id, { hideHeader: true, syntaxHighlight: false } as any);
      const after = usePresentationStore.getState();
      const other = after.presentation.slides[0].elements[0];  // the synced original
      expect((other as any).hideHeader).toBe(true);
      expect((other as any).syntaxHighlight).toBe(false);
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

  describe('sync / link relationship actions', () => {
    it('freeElement frees a synced element, gives it a NEW id, remembers the group, seeds a shared link', () => {
      const store = usePresentationStore.getState();
      store.duplicateSlide(0);                 // slides 0 & 1 now synced
      store.selectSlide(0);
      const el = usePresentationStore.getState().presentation.slides[0].elements[0];
      expect(el.syncId).toBeTruthy();
      const oldId = el.id;
      store.freeElement(oldId);
      const freed = usePresentationStore.getState().presentation.slides[0].elements[0];
      expect(freed.syncId).toBeUndefined();
      expect((freed as any)._syncId).toBe(el.syncId);
      // NEW id → the freed frame persists as its own DB row (S5c)
      expect(freed.id).not.toBe(oldId);
      // peer stays synced and shares the freed frame's animation linkId
      const peer = usePresentationStore.getState().presentation.slides[1].elements[0];
      expect(peer.syncId).toBe(el.syncId);
      expect(freed.linkId).toBeTruthy();
      expect(peer.linkId).toBe(freed.linkId);
    });

    it('resyncElement restores a freed element to its group AND snaps to the canonical position (S2)', () => {
      const store = usePresentationStore.getState();
      store.duplicateSlide(0);
      store.selectSlide(0);
      const el = usePresentationStore.getState().presentation.slides[0].elements[0];
      const gid = el.syncId;
      const canonX = el.position.x;
      store.freeElement(el.id);
      // move the freed instance away from the group
      const freedId = usePresentationStore.getState().presentation.slides[0].elements[0].id;
      store.moveElementsBy([freedId], 200, 0);
      expect(usePresentationStore.getState().presentation.slides[0].elements[0].position.x).toBe(canonX + 200);
      // resync → rejoins the group AND snaps back to the peer's (canonical) x
      store.resyncElement(freedId);
      const back = usePresentationStore.getState().presentation.slides[0].elements[0];
      expect(back.syncId).toBe(gid);
      expect((back as any)._syncId).toBeUndefined();
      expect(back.position.x).toBe(canonX);            // snapped; the move is discarded
    });

    it('unlinkElement ALWAYS remembers _linkId (re-linkable)', () => {
      const store = usePresentationStore.getState();
      const id = usePresentationStore.getState().presentation.slides[0].elements[0].id;
      store.updateElement(id, { linkId: 'L1' } as any);
      store.unlinkElement(id);
      const el = usePresentationStore.getState().presentation.slides[0].elements[0];
      expect(el.linkId).toBeUndefined();
      expect((el as any)._linkId).toBe('L1');
    });

    it('relinkElement restores the remembered link', () => {
      const store = usePresentationStore.getState();
      const id = usePresentationStore.getState().presentation.slides[0].elements[0].id;
      store.updateElement(id, { linkId: 'L1' } as any);
      store.unlinkElement(id);
      store.relinkElement(id);
      const el = usePresentationStore.getState().presentation.slides[0].elements[0];
      expect(el.linkId).toBe('L1');
      expect((el as any)._linkId).toBeUndefined();
    });

    it('linkElements is an ANIMATION link only — shared linkId, NEVER syncId', () => {
      const store = usePresentationStore.getState();
      usePresentationStore.setState({
        presentation: {
          ...createDefaultPresentation(),
          slides: [
            { id: 's0', elements: [{ id: 'A', type: 'text', preset: 'body', html: 'a',
              position: { x: 0, y: 0, width: 1, height: 1 }, _linkId: 'oldL' } as any] } as any,
            { id: 's1', elements: [{ id: 'B', type: 'text', preset: 'body', html: 'b',
              position: { x: 9, y: 9, width: 1, height: 1 } } as any] } as any,
          ],
        },
        currentSlideIndex: 0,
      });
      store.linkElements('A', 1, 'B');
      const st = usePresentationStore.getState();
      const a = st.presentation.slides[0].elements[0];
      const b = st.presentation.slides[1].elements[0];
      // Shared linkId on both (#30 symmetry), _linkId cleared.
      expect(a.linkId).toBeTruthy();
      expect(a.linkId).toBe(b.linkId);
      expect((a as any)._linkId).toBeUndefined();
      expect((b as any)._linkId).toBeUndefined();
      // NON-destructive: NOT synced — separate elements keep their own content
      // and position so the presenter can animate between them.
      expect(a.syncId).toBeUndefined();
      expect(b.syncId).toBeUndefined();
      expect((a as any).html).toBe('a');
      expect((b as any).html).toBe('b');
      expect(b.position.x).toBe(9);
    });

    it('linkElements is a NO-OP when either element is synced (sync/link mutually exclusive)', () => {
      const store = usePresentationStore.getState();
      usePresentationStore.setState({
        presentation: {
          ...createDefaultPresentation(),
          slides: [
            { id: 's0', elements: [{ id: 'A', type: 'text', preset: 'body', html: 'a',
              position: { x: 0, y: 0, width: 1, height: 1 }, syncId: 'A' } as any] } as any,
            { id: 's1', elements: [{ id: 'B', type: 'text', preset: 'body', html: 'b',
              position: { x: 9, y: 9, width: 1, height: 1 } } as any] } as any,
          ],
        },
        currentSlideIndex: 0,
      });
      store.linkElements('A', 1, 'B');
      const st = usePresentationStore.getState();
      // A synced source can't animate — no linkId gets set on either side.
      expect(st.presentation.slides[0].elements[0].linkId).toBeUndefined();
      expect(st.presentation.slides[1].elements[0].linkId).toBeUndefined();
    });

    it('duplicate-slide titles stay synced: move + edit propagate to both slides', () => {
      const store = usePresentationStore.getState();
      // A deck with a title on slide 1.
      usePresentationStore.setState({
        presentation: {
          ...createDefaultPresentation(),
          slides: [
            { id: 's1', elements: [{ id: 'title', type: 'text', preset: 'title',
              html: 'Hello', position: { x: 100, y: 100, width: 400, height: 80 } } as any] } as any,
          ],
        },
        currentSlideIndex: 0,
      });

      // Duplicate the slide → the two titles become synced.
      store.duplicateSlide(0);
      let st = usePresentationStore.getState();
      expect(st.presentation.slides).toHaveLength(2);
      const t0 = st.presentation.slides[0].elements[0];
      const t1 = st.presentation.slides[1].elements[0];
      expect(t0.syncId).toBeTruthy();
      expect(t1.syncId).toBe(t0.syncId);            // same sync group

      // Move the title on slide 1 → BOTH slides' titles move (same position).
      store.selectSlide(0);
      store.moveElementsBy([t0.id], 30, 40);
      st = usePresentationStore.getState();
      expect(st.presentation.slides[0].elements[0].position).toMatchObject({ x: 130, y: 140 });
      expect(st.presentation.slides[1].elements[0].position).toMatchObject({ x: 130, y: 140 });

      // Edit the title on slide 1 → it changes on slide 2 too.
      store.updateElement(t0.id, { html: 'Changed' } as any);
      st = usePresentationStore.getState();
      expect((st.presentation.slides[0].elements[0] as any).html).toBe('Changed');
      expect((st.presentation.slides[1].elements[0] as any).html).toBe('Changed');
    });

    it('in-session: editing the COPY propagates to the original (no save needed)', () => {
      const store = usePresentationStore.getState();
      usePresentationStore.setState({
        presentation: {
          ...createDefaultPresentation(),
          slides: [
            { id: 's1', elements: [{ id: 'title', type: 'text', preset: 'title',
              html: 'Hi', position: { x: 100, y: 100, width: 400, height: 80 } } as any] } as any,
          ],
        },
        currentSlideIndex: 0,
      });
      store.duplicateSlide(0);
      // duplicateSlide selects the COPY (slide index 1); the two instances have
      // DIFFERENT ids in-session but a shared syncId.
      let st = usePresentationStore.getState();
      expect(st.currentSlideIndex).toBe(1);
      const orig = st.presentation.slides[0].elements[0];
      const copy = st.presentation.slides[1].elements[0];
      expect(copy.id).not.toBe(orig.id);          // different ids in-session
      expect(copy.syncId).toBe(orig.syncId);       // same sync group

      // Edit + move on the COPY → the ORIGINAL must reflect it immediately,
      // with NO save/reload (pure in-memory propagation).
      store.updateElement(copy.id, { html: 'Edited' } as any);
      store.moveElementsBy([copy.id], 25, 35);
      st = usePresentationStore.getState();
      expect((st.presentation.slides[0].elements[0] as any).html).toBe('Edited');
      expect(st.presentation.slides[0].elements[0].position).toMatchObject({ x: 125, y: 135 });
    });

    it('promoteToSync upgrades an animation link to ONE synced entry (master wins)', () => {
      const store = usePresentationStore.getState();
      usePresentationStore.setState({
        presentation: {
          ...createDefaultPresentation(),
          slides: [
            { id: 's0', elements: [{ id: 'M', type: 'text', preset: 'title', html: 'Master',
              linkId: 'L', position: { x: 10, y: 10, width: 100, height: 50 } } as any] } as any,
            { id: 's1', elements: [{ id: 'P', type: 'text', preset: 'title', html: 'Partner',
              linkId: 'L', position: { x: 500, y: 400, width: 100, height: 50 } } as any] } as any,
          ],
        },
        currentSlideIndex: 0,
      });
      store.promoteToSync('M');
      const st = usePresentationStore.getState();
      const m = st.presentation.slides[0].elements[0];
      const p = st.presentation.slides[1].elements[0];
      // Collapsed to one entry: the partner BECOMES the master (same id) so save
      // writes one row + junctions; both carry syncId = the master's id.
      expect(m.syncId).toBe('M');
      expect(p.id).toBe('M');
      expect(p.syncId).toBe('M');
      // Destructive: the partner adopts the master's content + position.
      expect((p as any).html).toBe('Master');
      expect(p.position).toMatchObject({ x: 10, y: 10 });
      // linkId preserved — still animatable if later freed.
      expect(m.linkId).toBe('L');
      expect(p.linkId).toBe('L');
    });

    it('promoteToSync is a no-op on an already-synced or unlinked element', () => {
      const store = usePresentationStore.getState();
      usePresentationStore.setState({
        presentation: {
          ...createDefaultPresentation(),
          slides: [
            { id: 's0', elements: [{ id: 'X', type: 'text', preset: 'body', html: 'x',
              position: { x: 0, y: 0, width: 1, height: 1 } } as any] } as any,
          ],
        },
        currentSlideIndex: 0,
      });
      store.promoteToSync('X');   // no linkId → nothing happens
      const x = usePresentationStore.getState().presentation.slides[0].elements[0];
      expect(x.syncId).toBeUndefined();
    });

    it('freeElement is a no-op on an un-synced element', () => {
      const store = usePresentationStore.getState();
      const id = usePresentationStore.getState().presentation.slides[0].elements[0].id;
      store.freeElement(id);
      const el = usePresentationStore.getState().presentation.slides[0].elements[0];
      expect(el.syncId).toBeUndefined();
      expect((el as any)._syncId).toBeUndefined();
    });
  });

  describe('HTML well-formedness', () => {
    function countTag(html: string, tag: string): { opens: number; closes: number } {
      const opens = (html.match(new RegExp(`<${tag}[\\s>]`, 'gi')) || []).length;
      const closes = (html.match(new RegExp(`</${tag}>`, 'gi')) || []).length;
      return { opens, closes };
    }

    function isBalanced(html: string): boolean {
      for (const tag of ['div', 'span', 'b', 'i', 'ul', 'ol', 'li']) {
        const { opens, closes } = countTag(html, tag);
        if (opens !== closes) return false;
      }
      return true;
    }

    it('element HTML with balanced tags stays balanced after updateElement', () => {
      const store = usePresentationStore.getState();
      store.addElement({
        id: 'el-html', type: 'text', preset: 'body',
        html: '<div style="text-align: center;"><b>Hello</b> world</div>',
        position: { x: 0, y: 0, width: 100, height: 50 },
      });
      store.updateElement('el-html', {
        html: '<div style="text-align: center;"><b>Updated</b> text</div>',
      } as any);
      const el = usePresentationStore.getState().presentation.slides[0].elements.find(e => e.id === 'el-html');
      expect(el).toBeTruthy();
      expect(isBalanced((el as any).html)).toBe(true);
    });

    it('detects unbalanced div tags', () => {
      expect(isBalanced('<div>unclosed')).toBe(false);
      expect(isBalanced('<div>closed</div>')).toBe(true);
      expect(isBalanced('<div><div>nested</div></div>')).toBe(true);
      expect(isBalanced('<div>extra</div></div>')).toBe(false);
    });

    it('detects unbalanced span tags', () => {
      expect(isBalanced('<span>unclosed')).toBe(false);
      expect(isBalanced('<span>ok</span>')).toBe(true);
      expect(isBalanced('text</span>')).toBe(false);
    });

    it('the broken WebKit pattern is detected as unbalanced', () => {
      // This is the exact pattern that broke exports
      const brokenHtml = '<span style="text-align: center;"><span style="font-weight: 400;">Title</span><br></span>';
      // The outer span has text-align (should be div), but tags are technically balanced here
      expect(isBalanced(brokenHtml)).toBe(true); // tags balance, the bug is semantic not structural

      // This is what our broken regex sanitizer produced
      const regexBroken = '<div style="text-align: center;"><span style="font-weight: 400;">Title</span><br></span>';
      expect(isBalanced(regexBroken)).toBe(false); // div opens, never closes; extra </span>
    });
  });
});

import { pauseUndo, resumeUndo } from './presentation';

describe('undo transactions: pauseUndo/resumeUndo = one step, pre-state preserved (#55)', () => {
  beforeEach(() => {
    usePresentationStore.setState({
      presentation: { ...createDefaultPresentation(), slides: [{ id: 's0', elements: [], notes: '' } as any] },
      currentSlideIndex: 0,
    });
    usePresentationStore.temporal.getState().clear();
  });

  const past = () => usePresentationStore.temporal.getState().pastStates.length;
  const els = () => usePresentationStore.getState().presentation.slides[0].elements;

  it('a paused gesture is ONE undo step and does NOT delete the element', () => {
    // Baseline element at x=100, clean history (clear() after setState isolates
    // the transaction from the debounced add-snapshot).
    usePresentationStore.setState({
      presentation: { ...createDefaultPresentation(), slides: [{ id: 's0', notes: '',
        elements: [{ id: 'a', type: 'text', preset: 'body', html: 'A', position: { x: 100, y: 100, width: 200, height: 80 } }] } as any] },
      currentSlideIndex: 0,
    });
    usePresentationStore.temporal.getState().clear();
    expect(past()).toBe(0);

    // simulate a drag: pause, many position updates, resume
    pauseUndo();
    for (let x = 140; x <= 500; x += 90) {
      usePresentationStore.getState().updateElement('a', { position: { x, y: 100, width: 200, height: 80 } } as any);
    }
    resumeUndo();
    expect(els()[0].position.x).toBe(500);
    expect(past()).toBe(1); // exactly ONE undo entry for the whole gesture

    // undo the drag → element STILL present at the pre-drag position.
    // (The bug this fixes: undo deleted the element / reverted past the add.)
    usePresentationStore.temporal.getState().undo();
    expect(els().find((e) => e.id === 'a')).toBeDefined();
    expect(els()[0].position.x).toBe(100);

    // redo round-trips back to the dragged position
    usePresentationStore.temporal.getState().redo();
    expect(els()[0].position.x).toBe(500);
  });

  it('a no-op gesture (pause/resume with no change) pushes no undo entry', () => {
    usePresentationStore.getState().addElement({ id: 'b', type: 'text', preset: 'body', html: 'B', position: { x: 0, y: 0, width: 10, height: 10 } } as any);
    const before = past();
    pauseUndo();
    resumeUndo(); // nothing changed
    expect(past()).toBe(before);
  });

  it('nested pause/resume records a single step', () => {
    usePresentationStore.getState().addElement({ id: 'c', type: 'text', preset: 'body', html: 'C', position: { x: 0, y: 0, width: 10, height: 10 } } as any);
    const before = past();
    pauseUndo();
    pauseUndo();
    usePresentationStore.getState().updateElement('c', { html: 'C2' } as any);
    resumeUndo();
    resumeUndo();
    expect(past()).toBe(before + 1);
    usePresentationStore.temporal.getState().undo();
    expect((els()[0] as { html?: string }).html).toBe('C');
  });
});

import { undoWithNav, redoWithNav } from './presentation';

describe('undo/redo follows the change to its slide', () => {
  function setup() {
    usePresentationStore.setState({
      presentation: { ...createDefaultPresentation(), slides: [
        { id: 's0', notes: '', elements: [{ id: 'e0', type: 'text', preset: 'body', html: 'zero', position: { x: 0, y: 0, width: 10, height: 10 } }] } as any,
        { id: 's1', notes: '', elements: [{ id: 'e1', type: 'text', preset: 'body', html: 'one', position: { x: 0, y: 0, width: 10, height: 10 } }] } as any,
      ] },
      currentSlideIndex: 0,
    });
    usePresentationStore.temporal.getState().clear();
  }
  const idx = () => usePresentationStore.getState().currentSlideIndex;

  it('jumps to the other slide when the undone change was off-screen', () => {
    setup();
    // change an element on slide 1 (one deterministic undo step)
    usePresentationStore.getState().selectSlide(1);
    pauseUndo();
    usePresentationStore.getState().updateElement('e1', { html: 'one-edited' } as any);
    resumeUndo();
    // navigate back to slide 0, then undo
    usePresentationStore.getState().selectSlide(0);
    expect(idx()).toBe(0);
    undoWithNav();
    expect(idx()).toBe(1); // jumped to the slide whose content was reverted
    expect((usePresentationStore.getState().presentation.slides[1].elements[0] as any).html).toBe('one');

    // redo also follows
    usePresentationStore.getState().selectSlide(0);
    redoWithNav();
    expect(idx()).toBe(1);
    expect((usePresentationStore.getState().presentation.slides[1].elements[0] as any).html).toBe('one-edited');
  });

  it('stays put when the change is on the current slide', () => {
    setup();
    pauseUndo();
    usePresentationStore.getState().updateElement('e0', { html: 'zero-edited' } as any);
    resumeUndo();
    expect(idx()).toBe(0);
    undoWithNav();
    expect(idx()).toBe(0); // current slide changed → no jump
  });
});

describe('alignment grid view flags', () => {
  beforeEach(() => {
    usePresentationStore.setState({ snapToGrid: false, showGrid: false });
  });

  it('defaults both grid flags off', () => {
    const s = usePresentationStore.getState();
    expect(s.snapToGrid).toBe(false);
    expect(s.showGrid).toBe(false);
  });

  it('toggleSnapToGrid flips snapToGrid only', () => {
    usePresentationStore.getState().toggleSnapToGrid();
    expect(usePresentationStore.getState().snapToGrid).toBe(true);
    expect(usePresentationStore.getState().showGrid).toBe(false);
    usePresentationStore.getState().toggleSnapToGrid();
    expect(usePresentationStore.getState().snapToGrid).toBe(false);
  });

  it('toggleShowGrid flips showGrid only', () => {
    usePresentationStore.getState().toggleShowGrid();
    expect(usePresentationStore.getState().showGrid).toBe(true);
    expect(usePresentationStore.getState().snapToGrid).toBe(false);
    usePresentationStore.getState().toggleShowGrid();
    expect(usePresentationStore.getState().showGrid).toBe(false);
  });

  it('grid flags are not undoable (toggling does not create an undo step)', () => {
    const before = usePresentationStore.temporal.getState().pastStates.length;
    usePresentationStore.getState().toggleSnapToGrid();
    usePresentationStore.getState().toggleShowGrid();
    const after = usePresentationStore.temporal.getState().pastStates.length;
    expect(after).toBe(before);
  });
});
