import { beforeEach, describe, expect, it } from 'vitest';
import { usePresentationStore } from './presentation';
import { createDefaultPresentation } from '../types/presentation';
import type { SlideElement } from '../types/presentation';

/** Tiny deterministic generator: failures print a seed + complete operation trace. */
function rng(seed: number) {
  let x = seed >>> 0;
  return (n: number) => {
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    return n > 0 ? (x >>> 0) % n : 0;
  };
}

function assertStructuralInvariants(trace: string[]) {
  const { presentation, currentSlideIndex } = usePresentationStore.getState();
  const fail = (message: string) => `${message}\ntrace:\n${trace.join('\n')}`;

  expect(presentation.slides.length, fail('deck lost every slide')).toBeGreaterThan(0);
  expect(currentSlideIndex, fail('current slide index is negative')).toBeGreaterThanOrEqual(0);
  expect(currentSlideIndex, fail('current slide index is out of range')).toBeLessThan(presentation.slides.length);

  const slideIds = presentation.slides.map((s) => s.id);
  expect(new Set(slideIds).size, fail('duplicate slide id')).toBe(slideIds.length);

  for (const slide of presentation.slides) {
    const ids = slide.elements.map((el) => el.id);
    expect(new Set(ids).size, fail(`duplicate element id within slide ${slide.id}`)).toBe(ids.length);
    for (const el of slide.elements) {
      for (const [key, value] of Object.entries(el.position)) {
        expect(Number.isFinite(value), fail(`${el.id}.position.${key} is not finite`)).toBe(true);
      }
      if (el.type === 'arrow') {
        for (const key of ['x1', 'y1', 'x2', 'y2'] as const) {
          expect(Number.isFinite(el[key]), fail(`${el.id}.${key} is not finite`)).toBe(true);
        }
      }
    }
  }
}

describe('presentation store generated state machine', () => {
  beforeEach(() => {
    usePresentationStore.setState({
      presentation: createDefaultPresentation(), currentSlideIndex: 0,
      isPresenting: false, isDirty: false, projectPath: null,
      selectedObject: { type: 'slide' },
    });
    usePresentationStore.temporal.getState().clear();
  });

  const slide = (id: string, groupId?: string) => ({
    id, notes: '', elements: [], ...(groupId ? { groupId } : {}),
  });

  it('a divider splits a build operationally, moving one half does not gather the other half', () => {
    usePresentationStore.setState({
      presentation: { ...createDefaultPresentation(), slides: [
        slide('A', 'g'), slide('B', 'g'), slide('X'), slide('C', 'g'), slide('D', 'g'), slide('Y'),
      ] },
      currentSlideIndex: 3,
    });
    usePresentationStore.getState().moveSlide(3, 5); // drag C: move only contiguous [C,D]
    expect(usePresentationStore.getState().presentation.slides.map((s) => s.id))
      .toEqual(['A', 'B', 'X', 'Y', 'C', 'D']);
  });

  it('moving the divider away naturally rejoins the two halves', () => {
    usePresentationStore.setState({
      presentation: { ...createDefaultPresentation(), slides: [
        slide('A', 'g'), slide('B', 'g'), slide('X'), slide('C', 'g'), slide('D', 'g'),
      ] },
      currentSlideIndex: 2,
    });
    usePresentationStore.getState().moveSlide(2, 4); // [A,B,C,D,X]
    const afterJoin = usePresentationStore.getState().presentation.slides;
    expect(afterJoin.map((s) => s.id)).toEqual(['A', 'B', 'C', 'D', 'X']);
    // Once adjacent, dragging C moves the whole rejoined [A,B,C,D] build.
    usePresentationStore.getState().moveSlide(2, 4);
    expect(usePresentationStore.getState().presentation.slides.map((s) => s.id))
      .toEqual(['X', 'A', 'B', 'C', 'D']);
  });

  for (const seed of [1, 7, 23, 101, 0x5eed, 0xc0ffee]) {
    it(`preserves structural invariants across generated edits (seed ${seed})`, () => {
      const pick = rng(seed);
      const trace: string[] = [`seed=${seed}`];
      let nextElement = 0;

      for (let step = 0; step < 160; step++) {
        const before = usePresentationStore.getState();
        const slides = before.presentation.slides;
        const current = slides[before.currentSlideIndex];
        const op = pick(11);

        switch (op) {
          case 0:
            trace.push(`${step}: addSlide @${before.currentSlideIndex}`);
            before.addSlide();
            break;
          case 1: {
            const index = pick(slides.length);
            trace.push(`${step}: duplicateSlide ${index}`);
            before.duplicateSlide(index);
            break;
          }
          case 2:
            trace.push(`${step}: addBuildSlide @${before.currentSlideIndex}`);
            before.addBuildSlide();
            break;
          case 3: {
            const index = pick(slides.length);
            trace.push(`${step}: deleteSlide ${index}`);
            before.deleteSlide(index);
            break;
          }
          case 4: {
            const from = pick(slides.length), to = pick(slides.length);
            trace.push(`${step}: moveSlide ${from}->${to}`);
            before.moveSlide(from, to);
            break;
          }
          case 5: {
            const index = pick(slides.length);
            trace.push(`${step}: selectSlide ${index}`);
            before.selectSlide(index);
            break;
          }
          case 6: {
            const id = `generated-${seed}-${nextElement++}`;
            const element: SlideElement = {
              id, type: 'text', preset: 'textbox', html: id,
              position: { x: pick(1800), y: pick(1000), width: 100 + pick(400), height: 40 + pick(200) },
            };
            trace.push(`${step}: addElement ${id} @${before.currentSlideIndex}`);
            before.addElement(element);
            break;
          }
          case 7: {
            if (!current.elements.length) break;
            const el = current.elements[pick(current.elements.length)];
            trace.push(`${step}: deleteElement ${el.id} @${before.currentSlideIndex}`);
            before.deleteElement(el.id);
            break;
          }
          case 8: {
            if (!current.elements.length) break;
            const el = current.elements[pick(current.elements.length)];
            const directions = ['top', 'up', 'down', 'bottom'] as const;
            const direction = directions[pick(directions.length)];
            trace.push(`${step}: moveElementZ ${el.id} ${direction}`);
            before.moveElementZ(el.id, direction);
            break;
          }
          case 9: {
            if (!current.elements.length) break;
            const el = current.elements[pick(current.elements.length)];
            const dx = pick(81) - 40, dy = pick(81) - 40;
            trace.push(`${step}: moveElementsBy ${el.id} ${dx},${dy}`);
            before.moveElementsBy([el.id], dx, dy);
            break;
          }
          case 10: {
            if (!current.elements.length) break;
            const el = current.elements[pick(current.elements.length)];
            trace.push(`${step}: updateElement ${el.id}`);
            before.updateElement(el.id, { position: { ...el.position, width: el.position.width + 1 } });
            break;
          }
        }

        assertStructuralInvariants(trace);
      }
    });
  }
});
