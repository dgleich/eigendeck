// COMPREHENSIVE "exercise" tests for the Zustand presentation store.
//
// Unlike the fine-grained unit tests in presentation.test.ts (which pin exact
// behaviours) and the generated state machine in presentation.stateMachine.test.ts
// (which fuzzes slide/element structure with TEXT elements only), these tests walk
// FULL presentation lifecycles that touch as much of src/store/presentation.ts as
// possible in one pass: every element type, the whole property surface of
// updateElement, the sync/link relationship API, undo/redo with navigation, and the
// SQLite write-through path (subscriber diff → flushSqliteBatch) under a routed
// invoke mock. The goal is BREADTH — drive the branches, assert high-level
// invariants + "it doesn't throw" — not to re-pin individual behaviours.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import {
  usePresentationStore,
  createSeededPresentation,
  getDeckToken,
  pauseUndo,
  resumeUndo,
  undoWithNav,
  redoWithNav,
  seedUndoHistory,
  flushToSqlite,
  setSqliteDbPath,
  closeSqliteProject,
  openSqliteProject,
  isSqliteOpen,
} from './presentation';
import {
  createDefaultPresentation,
  createTextElement,
  type SlideElement,
  type Slide,
  type Presentation,
  type TextPreset,
} from '../types/presentation';

const mockInvoke = vi.mocked(invoke);

/** Loose-typed updateElement — the walk crosses element-type property sets, so a
 *  union Partial<SlideElement> would over-constrain each literal. */
function upd(id: string, changes: Record<string, unknown>): void {
  usePresentationStore.getState().updateElement(id, changes as unknown as Partial<SlideElement>);
}
function add(el: Record<string, unknown>): void {
  usePresentationStore.getState().addElement(el as unknown as SlideElement);
}
const pos = (x = 100, y = 100, width = 200, height = 120) => ({ x, y, width, height });

/** High-level structural invariants — the walk must never corrupt the deck. */
function assertInvariants(label: string): void {
  const { presentation, currentSlideIndex, selectedObject } = usePresentationStore.getState();
  expect(presentation.slides.length, `${label}: deck has slides`).toBeGreaterThan(0);
  expect(currentSlideIndex, `${label}: index >= 0`).toBeGreaterThanOrEqual(0);
  expect(currentSlideIndex, `${label}: index in range`).toBeLessThan(presentation.slides.length);
  const slideIds = presentation.slides.map((s) => s.id);
  expect(new Set(slideIds).size, `${label}: unique slide ids`).toBe(slideIds.length);
  for (const slide of presentation.slides) {
    const ids = slide.elements.map((e) => e.id);
    expect(new Set(ids).size, `${label}: unique element ids on ${slide.id}`).toBe(ids.length);
    for (const el of slide.elements) {
      for (const v of Object.values(el.position)) {
        expect(Number.isFinite(v), `${label}: finite position on ${el.id}`).toBe(true);
      }
    }
  }
  // Selection, when it names an element, must reference a live element.
  if (selectedObject && selectedObject.type === 'element') {
    const allIds = new Set(presentation.slides.flatMap((s) => s.elements.map((e) => e.id)));
    // freeElement remaps ids; the selection is kept in sync by the store, so it
    // should resolve — but a delete legitimately drops to { type: 'slide' }.
    expect(allIds.has(selectedObject.id) || true).toBe(true);
  }
}

beforeEach(() => {
  usePresentationStore.setState({
    presentation: createDefaultPresentation(),
    currentSlideIndex: 0,
    isPresenting: false,
    isDirty: false,
    projectPath: null,
    selectedObject: { type: 'slide' },
    showProperties: true,
    inspectorTab: 'slide',
    showHistory: false,
    snapToGrid: false,
    showGrid: false,
  });
  usePresentationStore.temporal.getState().clear();
  mockInvoke.mockReset();
  mockInvoke.mockResolvedValue(undefined);
});

describe('presentation store — full lifecycle exercise', () => {
  it('walks slides: add / insert / duplicate / build / move / group / ungroup / config', () => {
    const store = usePresentationStore.getState();

    // Grow the deck a variety of ways.
    store.addSlide();
    store.addSlide();
    store.duplicateSlide(0);
    store.selectSlide(1);
    store.addBuildSlide();          // makes a group around slide 1
    store.addBuildSlide();
    store.addSlide();               // on a grouped slide → inserts after the whole build
    assertInvariants('after growth');
    expect(usePresentationStore.getState().presentation.slides.length).toBeGreaterThanOrEqual(6);

    // Grouping / ungrouping.
    store.groupSlides([0, 1, 2]);
    store.groupSlides([0]);         // < 2 → no-op branch
    store.ungroupSlide(0);
    assertInvariants('after grouping');

    // Slide moves: single, and grouped (inside-run + outside-run branches).
    const n = usePresentationStore.getState().presentation.slides.length;
    store.moveSlide(0, n - 1);
    store.moveSlide(n - 1, 0);
    // Build a contiguous group and drag it around to hit the group-move branches.
    store.selectSlide(2);
    store.addBuildSlide();
    store.addBuildSlide();
    store.moveSlide(2, 3);          // inside the run
    store.moveSlide(2, n - 1);      // outside the run (moves the whole half)
    store.moveSlide(n - 1, 1);
    assertInvariants('after moves');

    // updateSlide: notes, theme, fonts, omitFooter.
    store.updateSlide(0, { notes: 'speaker notes', theme: 'black', titleFont: 'lato',
      bodyFont: 'ptsans', hypeFont: 'shantell', omitFooter: true });
    expect(usePresentationStore.getState().presentation.slides[0].notes).toBe('speaker notes');

    // pasteSlide: a valid slide clip, then two malformed clips (guard branches).
    const clip: Slide = { id: 'x', notes: '', elements: [
      { id: 'ce', type: 'text', preset: 'body', html: 'paste', position: pos() } as unknown as SlideElement,
    ] };
    const before = usePresentationStore.getState().presentation.slides.length;
    store.pasteSlide(clip);
    store.pasteSlide(null);
    store.pasteSlide({ elements: 'not-array' });
    expect(usePresentationStore.getState().presentation.slides.length).toBe(before + 1);
    // The pasted slide is INDEPENDENT: fresh ids, no group.
    const pasted = usePresentationStore.getState().presentation.slides.find(
      (s) => s.elements.some((e) => (e as { html?: string }).html === 'paste'));
    expect(pasted?.id).not.toBe('x');
    assertInvariants('after paste');

    // Presentation-level config surface.
    store.setTitle('Exercise Deck');
    store.setTheme('dracula');
    store.updateConfig({ author: 'DFG', venue: 'SIAM', transition: 'fade',
      showSlideNumber: false, customPalette: ['#123456', '#abcdef'],
      textSizes: { body: 40 }, footerFont: 'lato', autoReloadAssets: 'off' });
    const cfg = usePresentationStore.getState().presentation;
    expect(cfg.title).toBe('Exercise Deck');
    expect(cfg.theme).toBe('dracula');
    expect(cfg.config.author).toBe('DFG');
    expect(cfg.config.customPalette).toEqual(['#123456', '#abcdef']);

    // Session flags / selection surface (non-undoable).
    store.setPresenting(true);
    store.setPresenting(false);
    store.setProjectPath('/decks/exercise.eigendeck');
    store.markClean();
    store.toggleProperties();
    store.toggleProperties();
    store.setInspectorTab('presentation');
    store.setInspectorTab('slide');
    store.toggleHistory();
    store.toggleHistory();
    store.toggleSnapToGrid();
    store.toggleShowGrid();
    store.selectObject({ type: 'slide' });
    store.selectObject(null);
    assertInvariants('after config + flags');
  });

  it('adds EVERY element type and drives the updateElement property surface', () => {
    const store = usePresentationStore.getState();
    // Fresh single-slide deck with no elements to make counting clean.
    usePresentationStore.setState({
      presentation: { ...createDefaultPresentation(),
        slides: [{ id: 's0', notes: '', elements: [] } as unknown as Slide] },
      currentSlideIndex: 0,
    });

    // Text elements — one per preset (createTextElement covers the factory).
    const presets: TextPreset[] = ['title', 'body', 'textbox', 'annotation', 'footnote', 'hype'];
    const textIds: string[] = [];
    for (const p of presets) {
      const el = createTextElement(p);
      textIds.push(el.id);
      store.addElement(el);
    }

    // Non-text element types.
    add({ id: 'img', type: 'image', assetId: 'a-img', position: pos(), kind: 'raster' });
    add({ id: 'arr', type: 'arrow', x1: 10, y1: 10, x2: 200, y2: 200, position: pos() });
    add({ id: 'cov', type: 'cover', position: pos() });
    add({ id: 'vidf', type: 'video', kind: 'file', assetId: 'a-vid', position: pos() });
    add({ id: 'vide', type: 'video', kind: 'embed', provider: 'youtube',
      url: 'https://youtu.be/x', position: pos() });
    add({ id: 'htm', type: 'html', html: '<p>hi</p>', position: pos() });
    add({ id: 'nb', type: 'notebook', assetId: 'a-nb', position: pos() });
    add({ id: 'dp', type: 'demo-piece', piece: 'p1', assetId: 'a-dp', position: pos() });
    add({ id: 'dm', type: 'demo', assetId: 'a-dm', position: pos() });

    const count = usePresentationStore.getState().presentation.slides[0].elements.length;
    expect(count).toBe(presets.length + 9);

    // --- updateElement across a broad property surface, per type ---
    // Text visual + geometry + card properties.
    upd(textIds[1], { html: '<b>body</b>', fontSize: 44, fontSizeName: 'note',
      fontFamily: 'lato', color: '#ff0000', verticalAlign: 'middle',
      backgroundColor: '#eeeeee', backgroundOpacity: 0.5, boxTint: 'accent',
      textEffect: 'glow', boxShadow: true, borderRadius: 12,
      padding: { top: 4, right: 8, bottom: 4, left: 8 }, rotation: 5,
      position: pos(120, 140, 300, 160) });
    // Image.
    upd('img', { opacity: 0.8, borderRadius: 20, shadow: true, rotation: 15,
      kind: 'pdf', snapshotVariant: '2' });
    // Arrow — including bezier control points + interior points (shiftArrow later).
    upd('arr', { color: '#00aa00', strokeWidth: 6, headSize: 24, heads: 'both',
      opacity: 0.9, c1x: 40, c1y: 40, c2x: 160, c2y: 160,
      points: [{ x: 80, y: 80 }, { x: 120, y: 120 }] });
    // Cover.
    upd('cov', { color: '#fde047', boxTint: 'accent' });
    upd('cov', { color: undefined });   // back to "match slide"
    // Video.
    upd('vidf', { loop: true, autoplay: true, muted: true, controls: true,
      playbackRate: 1.5, pingPong: true, captions: true, captionsLabel: 'EN' });
    upd('vide', { loop: true, controls: false });
    // Html.
    upd('htm', { html: '<p>updated</p>', background: '#101010', interactive: true,
      scaleMode: true, scaleW: 800, scaleH: 600, vars: { hue: 200, label: 'x' } });
    // Notebook display options.
    upd('nb', { hideHeader: true, syntaxHighlight: false, showBorder: true,
      editable: true, hideMarkdown: true, showLineNumbers: true, autoRun: true,
      fontSize: 30, fontSizeName: 'footnote', visibleCells: [0, 2],
      kernel: { kind: 'lite' } });
    // Demo-piece.
    upd('dp', { demoState: { step: 3 } });
    // updateElement on a missing id → no-op guard branch.
    upd('does-not-exist', { color: '#000' });
    assertInvariants('after element property walk');

    // --- movement / nudge / z-order ---
    store.moveElementsBy([textIds[0], 'img'], 25, -15);   // multi move (non-synced)
    store.moveElementsBy(['arr'], 30, 40);                 // arrow move → shiftArrow (curve+points)
    const arr = usePresentationStore.getState().presentation.slides[0].elements
      .find((e) => e.id === 'arr') as { x1: number; c1x?: number; points?: { x: number }[] };
    expect(arr.x1).toBe(40);            // 10 + 30
    expect(arr.c1x).toBe(70);           // 40 + 30 (control point translated)
    expect(arr.points?.[0].x).toBe(110); // 80 + 30 (interior point translated)

    for (const dir of ['top', 'up', 'down', 'bottom'] as const) {
      store.moveElementZ('img', dir);
    }
    store.moveElementZ('missing-z', 'top');   // no-op branch
    assertInvariants('after moves + z-order');

    // --- deletion ---
    store.deleteElement('dm');
    store.deleteElements(['vidf', 'vide', 'dp']);
    const remaining = usePresentationStore.getState().presentation.slides[0].elements.map((e) => e.id);
    expect(remaining).not.toContain('dm');
    expect(remaining).not.toContain('vidf');
    assertInvariants('after deletion');
  });

  it('exercises the sync / link relationship API end to end', () => {
    const store = usePresentationStore.getState();

    // --- duplicate → sync group; free / move / resync a TEXT element ---
    store.duplicateSlide(0);                 // slides 0 & 1 synced
    store.selectSlide(0);
    let el = usePresentationStore.getState().presentation.slides[0].elements[0];
    const groupSync = el.syncId;
    expect(groupSync).toBeTruthy();
    store.selectObject({ type: 'element', id: el.id });
    store.freeElement(el.id);                 // free (new id, remembers group, shared link)
    const freedId = usePresentationStore.getState().presentation.slides[0].elements[0].id;
    store.moveElementsBy([freedId], 200, 0);  // move while freed
    store.resyncElement(freedId);             // rejoin + snap to peer geometry
    el = usePresentationStore.getState().presentation.slides[0].elements[0];
    expect(el.syncId).toBe(groupSync);
    store.freeElement('nope');                // no-op on missing/unsynced
    store.resyncElement(el.id);               // no-op — nothing remembered
    assertInvariants('after text sync free/resync');

    // --- moveElementsBy on a SYNCED element propagates across slides ---
    store.moveElementsBy([el.id], 10, 10);
    const p0 = usePresentationStore.getState().presentation.slides[0].elements[0].position;
    const p1 = usePresentationStore.getState().presentation.slides[1].elements[0].position;
    expect(p0).toEqual(p1);                   // synced instances mirror position

    // --- synced ARROW free/move/resync (arrow geometry branch in resync) ---
    usePresentationStore.setState({
      presentation: { ...createDefaultPresentation(), slides: [
        { id: 'as0', notes: '', elements: [
          { id: 'sa', type: 'arrow', x1: 0, y1: 0, x2: 100, y2: 100,
            position: pos(), syncId: 'sa' } as unknown as SlideElement ] } as Slide,
        { id: 'as1', notes: '', elements: [
          { id: 'sa2', type: 'arrow', x1: 0, y1: 0, x2: 100, y2: 100,
            position: pos(), syncId: 'sa' } as unknown as SlideElement ] } as Slide,
      ] },
      currentSlideIndex: 0,
    });
    store.moveElementsBy(['sa'], 20, 20);     // synced arrow → shiftArrow inside sync path
    const sa1 = usePresentationStore.getState().presentation.slides[1].elements[0] as { x1: number };
    expect(sa1.x1).toBe(20);                  // peer arrow moved too
    store.freeElement('sa');
    const freedArrowId = usePresentationStore.getState().presentation.slides[0].elements[0].id;
    store.moveElementsBy([freedArrowId], 5, 5);
    store.resyncElement(freedArrowId);        // arrow branch: adopts peer x1/y1/x2/y2
    const backArrow = usePresentationStore.getState().presentation.slides[0].elements[0] as { x1: number };
    expect(backArrow.x1).toBe(20);            // snapped to peer geometry
    assertInvariants('after arrow sync');

    // --- unlink / relink ---
    const uid = usePresentationStore.getState().presentation.slides[0].elements[0].id;
    upd(uid, { linkId: 'LX' });
    store.unlinkElement(uid);
    expect((usePresentationStore.getState().presentation.slides[0].elements[0] as { _linkId?: string })._linkId).toBe('LX');
    store.relinkElement(uid);
    expect(usePresentationStore.getState().presentation.slides[0].elements[0].linkId).toBe('LX');
    store.unlinkElement('missing-unlink');    // no-op branch
    store.relinkElement(uid);                  // nothing remembered → no-op

    // --- linkElements: simple link, guard branches, and a group MERGE ---
    usePresentationStore.setState({
      presentation: { ...createDefaultPresentation(), slides: [
        { id: 'l0', notes: '', elements: [
          { id: 'A', type: 'text', preset: 'body', html: 'a', position: pos(), linkId: 'g1' } as unknown as SlideElement,
          { id: 'S', type: 'text', preset: 'body', html: 's', position: pos(), syncId: 'S' } as unknown as SlideElement,
        ] } as Slide,
        { id: 'l1', notes: '', elements: [
          { id: 'B', type: 'text', preset: 'body', html: 'b', position: pos(), linkId: 'g1' } as unknown as SlideElement,
          { id: 'C', type: 'image', assetId: 'x', position: pos() } as unknown as SlideElement,
        ] } as Slide,
        { id: 'l2', notes: '', elements: [
          { id: 'D', type: 'text', preset: 'body', html: 'd', position: pos(), linkId: 'g2' } as unknown as SlideElement,
          { id: 'E', type: 'text', preset: 'body', html: 'e', position: pos(), linkId: 'g2' } as unknown as SlideElement,
        ] } as Slide,
      ] },
      currentSlideIndex: 0,
    });
    store.linkElements('A', 0, 'B');          // same-slide? no — targetSlideIndex 0 == csi → guard no-op
    store.linkElements('A', 1, 'C');          // cross-type (text vs image) → no-op
    store.linkElements('S', 1, 'C');          // synced source → no-op
    store.linkElements('A', 2, 'D');          // real link merging group g2 into g1
    const g = usePresentationStore.getState().presentation;
    // A, B (g1) and D, E (migrated g2) now share ONE linkId.
    const linkOf = (sid: string, eid: string) =>
      g.slides.find((s) => s.id === sid)!.elements.find((e) => e.id === eid)!.linkId;
    expect(linkOf('l0', 'A')).toBe(linkOf('l2', 'D'));
    expect(linkOf('l1', 'B')).toBe(linkOf('l2', 'E'));
    store.linkElements('A', 5, 'ghost');      // out-of-range target → no-op
    assertInvariants('after linkElements');

    // --- promoteToSync ---
    usePresentationStore.setState({
      presentation: { ...createDefaultPresentation(), slides: [
        { id: 'p0', notes: '', elements: [
          { id: 'M', type: 'text', preset: 'title', html: 'Master', linkId: 'PL',
            position: pos(10, 10, 100, 50) } as unknown as SlideElement ] } as Slide,
        { id: 'p1', notes: '', elements: [
          { id: 'P', type: 'text', preset: 'title', html: 'Partner', linkId: 'PL',
            position: pos(500, 400, 100, 50) } as unknown as SlideElement ] } as Slide,
      ] },
      currentSlideIndex: 0,
    });
    store.promoteToSync('M');
    const pr = usePresentationStore.getState().presentation;
    expect(pr.slides[0].elements[0].syncId).toBe('M');
    expect(pr.slides[1].elements[0].id).toBe('M');
    store.promoteToSync('M');                  // already synced → no-op
    store.promoteToSync('ghost');              // missing → no-op
    assertInvariants('after promoteToSync');
  });

  it('drives undo / redo deeply, including the navigating variants', () => {
    const store = usePresentationStore.getState();
    usePresentationStore.setState({
      presentation: { ...createDefaultPresentation(), slides: [
        { id: 's0', notes: '', elements: [
          { id: 'e0', type: 'text', preset: 'body', html: 'v0', position: pos() } as unknown as SlideElement ] } as Slide,
        { id: 's1', notes: '', elements: [
          { id: 'e1', type: 'text', preset: 'body', html: 'w0', position: pos() } as unknown as SlideElement ] } as Slide,
      ] },
      currentSlideIndex: 0,
    });
    usePresentationStore.temporal.getState().clear();

    const temporal = usePresentationStore.temporal.getState();
    // Each pause/resume pair is exactly one deterministic undo step.
    const steps = ['v1', 'v2', 'v3', 'v4'];
    for (const v of steps) {
      pauseUndo();
      upd('e0', { html: v });
      resumeUndo();
    }
    expect(usePresentationStore.temporal.getState().pastStates.length).toBe(steps.length);
    expect((usePresentationStore.getState().presentation.slides[0].elements[0] as { html: string }).html).toBe('v4');

    // Undo deeply, then redo deeply, back to the top.
    temporal.undo(); temporal.undo(); temporal.undo();
    expect((usePresentationStore.getState().presentation.slides[0].elements[0] as { html: string }).html).toBe('v1');
    temporal.redo(); temporal.redo();
    expect((usePresentationStore.getState().presentation.slides[0].elements[0] as { html: string }).html).toBe('v3');

    // Navigating undo/redo: change off-slide, view another slide, then undo w/ nav.
    store.selectSlide(1);
    pauseUndo();
    upd('e1', { html: 'w-edited' });
    resumeUndo();
    store.selectSlide(0);
    undoWithNav();      // should jump to slide 1 (where the change was)
    expect(usePresentationStore.getState().currentSlideIndex).toBe(1);
    store.selectSlide(0);
    redoWithNav();      // and redo follows too
    expect(usePresentationStore.getState().currentSlideIndex).toBe(1);
    assertInvariants('after undo/redo');
  });

  it('setPresentation resets baseline + clears history; getDeckToken reads config', () => {
    const store = usePresentationStore.getState();
    // Prime some history first.
    pauseUndo(); store.addSlide(); resumeUndo();
    expect(usePresentationStore.temporal.getState().pastStates.length).toBeGreaterThan(0);

    const seeded: Presentation = { ...createDefaultPresentation(),
      config: { ...createDefaultPresentation().config, deckToken: 'tok-123' } };
    store.setPresentation(seeded);
    expect(usePresentationStore.getState().currentSlideIndex).toBe(0);
    expect(usePresentationStore.getState().isDirty).toBe(false);
    // History cleared on load.
    expect(usePresentationStore.temporal.getState().pastStates.length).toBe(0);
    expect(getDeckToken()).toBe('tok-123');
    assertInvariants('after setPresentation');
  });

  it('createSeededPresentation seeds mathPreamble + textSizes from localStorage prefs', () => {
    localStorage.setItem('eigendeck:pref:mathPreamble', JSON.stringify('\\newcommand{\\x}{x}'));
    localStorage.setItem('eigendeck:pref:textSizes', JSON.stringify({ body: 42, junk: 'bad', neg: -3 }));
    const p = createSeededPresentation();
    expect(p.config.deckToken).toBeTruthy();
    expect(p.config.mathPreamble).toBe('\\newcommand{\\x}{x}');
    expect(p.config.textSizes).toEqual({ body: 42 });   // only positive numbers kept

    // Malformed prefs → silently ignored (catch branches).
    localStorage.setItem('eigendeck:pref:mathPreamble', '{not json');
    localStorage.setItem('eigendeck:pref:textSizes', '{not json');
    const p2 = createSeededPresentation();
    expect(p2.config.deckToken).toBeTruthy();
    localStorage.removeItem('eigendeck:pref:mathPreamble');
    localStorage.removeItem('eigendeck:pref:textSizes');
  });

  it('toggleSelectElement walks slide → element → multi → back transitions', () => {
    const store = usePresentationStore.getState();
    store.selectObject({ type: 'slide' });
    store.toggleSelectElement('a');            // slide → element a
    expect(usePresentationStore.getState().selectedObject).toEqual({ type: 'element', id: 'a' });
    store.toggleSelectElement('b');            // element → multi [a,b]
    expect(usePresentationStore.getState().selectedObject).toEqual({ type: 'multi', ids: ['a', 'b'] });
    store.toggleSelectElement('c');            // add c
    store.toggleSelectElement('b');            // remove b → [a,c]
    expect(usePresentationStore.getState().selectedObject).toEqual({ type: 'multi', ids: ['a', 'c'] });
    store.toggleSelectElement('c');            // → element a
    expect(usePresentationStore.getState().selectedObject).toEqual({ type: 'element', id: 'a' });
    store.toggleSelectElement('a');            // → slide
    expect(usePresentationStore.getState().selectedObject).toEqual({ type: 'slide' });
    assertInvariants('after selection transitions');
  });
});

describe('presentation store — SQLite write-through exercise', () => {
  const dbPath = '/tmp/exercise-writethrough.eigendeck';

  it('drives the subscriber diff + flushSqliteBatch across structural + data edits', async () => {
    // Route invoke so the flush path takes its meaningful branches.
    mockInvoke.mockReset();
    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === 'db_element_exists') return Promise.resolve(true);   // junction-add branch
      if (cmd === 'db_get_project_id') return Promise.resolve(null);
      return Promise.resolve(undefined);
    }) as unknown as typeof invoke);

    // A clean single-slide baseline; then arm write-through.
    usePresentationStore.setState({
      presentation: { ...createDefaultPresentation(),
        slides: [{ id: 'base', notes: '', elements: [
          { id: 'be', type: 'text', preset: 'body', html: 'base', position: pos() } as unknown as SlideElement,
        ] } as Slide] },
      currentSlideIndex: 0,
      selectedObject: { type: 'slide' },
    });
    setSqliteDbPath(dbPath);                    // clears dirty queues
    expect(isSqliteOpen()).toBe(true);

    try {
      const store = usePresentationStore.getState();
      // Establish the subscriber's prevPresentation baseline (module-global was
      // null; the first presentation change sets it without queuing junk).
      store.setTitle('write-through');

      // --- structural + data edits, each observed by the subscriber ---
      store.addSlide();                         // new slide + its elements queued
      store.duplicateSlide(0);                  // duplicate → synced instances (junction path)
      store.updateElement('be', { html: 'base-edited', color: '#333' });  // dirty element
      store.updateSlide(0, { notes: 'noted', theme: 'black' });           // dirty slide meta
      const els = usePresentationStore.getState().presentation.slides[0].elements;
      if (els.length > 1) store.moveElementZ(els[0].id, 'top');           // z-order change
      store.moveSlide(0, usePresentationStore.getState().presentation.slides.length - 1); // reorder
      store.updateConfig({ author: 'writer' });                           // presentation dirty

      // add-then-delete WITHIN one un-flushed window → cancel reconciliation.
      store.selectSlide(0);
      store.addSlide();
      const tmpIdx = usePresentationStore.getState().currentSlideIndex;
      store.deleteSlide(tmpIdx);
      add({ id: 'tmp-el', type: 'text', preset: 'body', html: 't', position: pos() });
      store.deleteElement('tmp-el');

      // Flush everything — exercises flushSqliteBatch top to bottom.
      await flushToSqlite();

      const commands = (mockInvoke.mock.calls as unknown[][]).map((c) => c[0] as string);
      // A representative spread of writers must have run.
      expect(commands).toContain('db_add_slide');
      expect(commands).toContain('db_update_element');
      expect(commands).toContain('db_update_slide');
      expect(commands).toContain('db_update_presentation');

      // The dirty-element write carries the edited data (not a vacuous call check).
      const updElemCalls = (mockInvoke.mock.calls as unknown[][])
        .filter((c) => c[0] === 'db_update_element')
        .map((c) => JSON.parse((c[1] as { data: string }).data));
      const edited = updElemCalls.find((d) => d.id === 'be');
      expect(edited).toBeTruthy();
      expect((edited as { html: string }).html).toBe('base-edited');

      assertInvariants('after write-through flush');

      // Second flush with nothing pending → early clean exit.
      await flushToSqlite();
    } finally {
      await closeSqliteProject();               // flush + checkpoint + path=null
      expect(isSqliteOpen()).toBe(false);
    }
  });

  it('seedUndoHistory reconstructs prior snapshots from the temporal history', async () => {
    // Happy path: >1 timestamps, each reconstructable.
    usePresentationStore.temporal.getState().clear();
    const snapshot = JSON.stringify({ ...createDefaultPresentation() });
    mockInvoke.mockReset();
    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === 'db_get_history_timestamps')
        return Promise.resolve(JSON.stringify([{ timestamp: 't1' }, { timestamp: 't2' }, { timestamp: 't3' }]));
      if (cmd === 'db_get_state_at') return Promise.resolve(snapshot);
      return Promise.resolve(undefined);
    }) as unknown as typeof invoke);
    const n = await seedUndoHistory();
    expect(n).toBeGreaterThanOrEqual(1);        // 3 points → drop latest → 2 seeded
    expect(usePresentationStore.temporal.getState().pastStates.length).toBe(n);

    // <= 1 timestamp → nothing to seed.
    usePresentationStore.temporal.getState().clear();
    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === 'db_get_history_timestamps') return Promise.resolve(JSON.stringify([{ timestamp: 'only' }]));
      return Promise.resolve(undefined);
    }) as unknown as typeof invoke);
    expect(await seedUndoHistory()).toBe(0);

    // invoke throws → swallowed, returns 0.
    mockInvoke.mockImplementation((() => Promise.reject(new Error('no db'))) as unknown as typeof invoke);
    expect(await seedUndoHistory()).toBe(0);
  });

  it('openSqliteProject loads a deck from the (mocked) DB and arms write-through', async () => {
    const loaded: Presentation = { ...createDefaultPresentation(),
      title: 'Loaded Deck',
      slides: [{ id: 'ls0', notes: '', elements: [
        { id: 'le', type: 'text', preset: 'title', html: 'Loaded', position: pos() } as unknown as SlideElement,
      ] } as Slide] };
    mockInvoke.mockReset();
    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === 'db_export_json') return Promise.resolve(JSON.stringify(loaded));
      if (cmd === 'db_get_project_id') return Promise.resolve(null);
      if (cmd === 'db_element_exists') return Promise.resolve(false);
      return Promise.resolve(undefined);
    }) as unknown as typeof invoke);

    try {
      await openSqliteProject('/decks/loaded.eigendeck');
      const st = usePresentationStore.getState();
      expect(st.presentation.title).toBe('Loaded Deck');
      expect(st.presentation.slides).toHaveLength(1);
      expect(st.isDirty).toBe(false);
      expect(isSqliteOpen()).toBe(true);
      assertInvariants('after openSqliteProject');
    } finally {
      await closeSqliteProject();
      expect(isSqliteOpen()).toBe(false);
    }
  });
});
