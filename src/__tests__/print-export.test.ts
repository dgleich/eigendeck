import { describe, it, expect } from 'vitest';
import { renderSlideForPrint } from '../App';
import type { Slide } from '../types/presentation';

function makeSlide(overrides: Partial<Slide> = {}): Slide {
  return {
    id: 'test-slide',
    notes: '',
    elements: [],
    ...overrides,
  };
}

function countTag(html: string, tag: string) {
  const opens = (html.match(new RegExp(`<${tag}[\\s>]`, 'gi')) || []).length;
  const closes = (html.match(new RegExp(`</${tag}>`, 'gi')) || []).length;
  return { opens, closes };
}

describe('renderSlideForPrint', () => {
  const emptyCache = new Map<string, string>();

  it('renders an empty slide', () => {
    const html = renderSlideForPrint(makeSlide(), 'white', emptyCache);
    expect(html).toContain('print-slide');
    expect(html).toContain('1920px');
    expect(html).toContain('1080px');
    expect(html).toContain('background:#ffffff');
  });

  it('renders text with theme colors', () => {
    const html = renderSlideForPrint(makeSlide({
      elements: [{
        id: 'e1', type: 'text', preset: 'title', html: 'Hello World',
        position: { x: 80, y: 20, width: 1760, height: 200 },
      }],
    }), 'white', emptyCache);
    expect(html).toContain('Hello World');
    expect(html).toContain('#222222'); // white theme heading color
  });

  it('renders dark theme', () => {
    const html = renderSlideForPrint(makeSlide({
      theme: 'dark',
      elements: [{
        id: 'e1', type: 'text', preset: 'body', html: 'Dark text',
        position: { x: 80, y: 200, width: 1760, height: 800 },
      }],
    }), 'white', emptyCache);
    expect(html).toContain('background:#1a1a2e');
    expect(html).toContain('#e8e8e8'); // dark theme text color
  });

  it('renders vertical alignment', () => {
    const html = renderSlideForPrint(makeSlide({
      elements: [{
        id: 'e1', type: 'text', preset: 'title', html: 'Centered',
        position: { x: 80, y: 20, width: 1760, height: 200 },
        verticalAlign: 'middle',
      }],
    }), 'white', emptyCache);
    expect(html).toContain('justify-content:center');
  });

  it('renders image from cache (keyed by assetId)', () => {
    const cache = new Map([['asset-A', 'data:image/png;base64,cached']]);
    const html = renderSlideForPrint(makeSlide({
      elements: [{
        id: 'e1', type: 'image', assetId: 'asset-A',
        position: { x: 100, y: 100, width: 400, height: 300 },
      }],
    }), 'white', cache);
    expect(html).toContain('data:image/png;base64,cached');
    expect(html).toContain('object-fit:contain');
  });

  it('skips image with no cached entry (no element rendered)', () => {
    const html = renderSlideForPrint(makeSlide({
      elements: [{
        id: 'e1', type: 'image', assetId: 'asset-missing',
        position: { x: 100, y: 100, width: 400, height: 300 },
      }],
    }), 'white', emptyCache);
    expect(html).not.toContain('<img');
  });

  it('renders arrow', () => {
    const html = renderSlideForPrint(makeSlide({
      elements: [{
        id: 'e1', type: 'arrow',
        x1: 100, y1: 100, x2: 500, y2: 300,
        color: '#e53e3e', strokeWidth: 4, headSize: 16,
        position: { x: 0, y: 0, width: 0, height: 0 },
      }],
    }), 'white', emptyCache);
    expect(html).toContain('<svg');
    expect(html).toContain('<line');
    expect(html).toContain('<polygon');
    expect(html).toContain('#e53e3e');
  });

  it('renders cover with theme background', () => {
    const html = renderSlideForPrint(makeSlide({
      elements: [{
        id: 'e1', type: 'cover',
        position: { x: 0, y: 0, width: 1920, height: 1080 },
      }],
    }), 'white', emptyCache);
    expect(html).toContain('background:#ffffff');
  });

  it('renders demo placeholder', () => {
    const html = renderSlideForPrint(makeSlide({
      elements: [{
        id: 'e1', type: 'demo', assetId: 'asset-demo',
        position: { x: 80, y: 200, width: 1760, height: 700 },
      }],
    }), 'white', emptyCache);
    expect(html).toContain('Interactive Demo');
    expect(html).toContain('dashed');
  });

  it('renders demo-piece placeholder', () => {
    const html = renderSlideForPrint(makeSlide({
      elements: [{
        id: 'e1', type: 'demo-piece', assetId: 'asset-demo', piece: 'graph',
        position: { x: 80, y: 200, width: 800, height: 600 },
      }],
    }), 'white', emptyCache);
    expect(html).toContain('Interactive Demo');
  });

  it('has balanced div tags', () => {
    const cache = new Map([['asset-x', 'data:image/png;base64,x']]);
    const html = renderSlideForPrint(makeSlide({
      elements: [
        { id: 'e1', type: 'text', preset: 'title', html: '<div style="text-align:center;">Title</div>', position: { x: 80, y: 20, width: 1760, height: 200 }, verticalAlign: 'bottom' },
        { id: 'e2', type: 'text', preset: 'body', html: 'Body', position: { x: 80, y: 215, width: 1760, height: 765 }, verticalAlign: 'middle' },
        { id: 'e3', type: 'image', assetId: 'asset-x', position: { x: 100, y: 100, width: 200, height: 200 } },
        { id: 'e4', type: 'cover', position: { x: 0, y: 0, width: 100, height: 100 } },
        { id: 'e5', type: 'demo', assetId: 'asset-demo', position: { x: 0, y: 0, width: 100, height: 100 } },
      ],
    }), 'white', cache);
    const { opens, closes } = countTag(html, 'div');
    expect(opens).toBe(closes);
  });

  it('renders multiple element types without breaking HTML', () => {
    const cache = new Map([['asset-x', 'data:image/png;base64,x']]);
    const html = renderSlideForPrint(makeSlide({
      elements: [
        { id: 'e1', type: 'text', preset: 'title', html: 'Title', position: { x: 80, y: 20, width: 1760, height: 200 } },
        { id: 'e2', type: 'text', preset: 'body', html: 'Body', position: { x: 80, y: 215, width: 1760, height: 765 } },
        { id: 'e3', type: 'arrow', x1: 100, y1: 100, x2: 500, y2: 300, position: { x: 0, y: 0, width: 0, height: 0 } },
        { id: 'e4', type: 'image', assetId: 'asset-x', position: { x: 100, y: 500, width: 200, height: 200 } },
      ],
    }), 'dark', cache);
    expect(html).toContain('Title');
    expect(html).toContain('Body');
    expect(html).toContain('<svg');
    expect(html).toContain('<img');
    expect(html).toContain('background:#1a1a2e');
  });
});
