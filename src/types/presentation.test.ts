import { describe, it, expect } from 'vitest';
import {
  createDefaultPresentation,
  createBlankSlide,
} from './presentation';

describe('presentation types', () => {
  it('createDefaultPresentation returns valid structure', () => {
    const pres = createDefaultPresentation();
    expect(pres.title).toBe('Untitled Presentation');
    expect(pres.theme).toBe('white');
    expect(pres.slides).toHaveLength(1);
    expect(pres.slides[0].type).toBe('text');
    expect(pres.slides[0].id).toBeTruthy();
    expect(pres.config.width).toBe(960);
    expect(pres.config.height).toBe(700);
  });

  it('createBlankSlide generates unique ids', () => {
    const a = createBlankSlide();
    const b = createBlankSlide();
    expect(a.id).not.toBe(b.id);
    expect(a.type).toBe('text');
    expect(a.notes).toBe('');
  });

  it('presentation.json roundtrips through JSON', () => {
    const pres = createDefaultPresentation();
    const json = JSON.stringify(pres);
    const parsed = JSON.parse(json);
    expect(parsed.title).toBe(pres.title);
    expect(parsed.slides).toHaveLength(pres.slides.length);
    expect(parsed.config).toEqual(pres.config);
  });
});
