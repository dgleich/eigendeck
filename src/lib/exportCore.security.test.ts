// Security: the HTML export is a self-contained, often HOSTED artifact, so untrusted
// deck values must not produce active content. Two layers (audit C-2 export path):
//   1. the export ENTRY normalizes (sanitizes text html, drops out-of-shape elements);
//   2. the export BUILDER escapes its own interpolations (absBox geometry, media urls,
//      backgrounds) so attribute-context payloads can't break out even pre-normalize.
import { describe, it, expect } from 'vitest';
// @ts-ignore — pure JS module shared with the CLI tool
import { buildExportHtml, escExportAttr } from './exportCore.mjs';
import { normalizeUntrustedPresentation } from './normalizePresentation';
import type { Presentation, SlideElement } from '../types/presentation';

const ONE_PX_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

async function build(pres: Presentation): Promise<string> {
  return buildExportHtml({
    presentation: pres,
    readFile: async () => new Uint8Array([1, 2, 3, 4]),
    readTextFile: async () => '<html><head></head><body>demo</body></html>',
    getElementPreview: async () => ONE_PX_PNG,
  });
}

const slide = (el: SlideElement) => ({ id: `s-${(el as { id?: string }).id}`, elements: [el], notes: '' });
const pres = (els: SlideElement[]): Presentation => ({
  title: 'x', theme: 'white', slides: els.map(slide),
  config: { transition: 'slide', backgroundTransition: 'fade', width: 1920, height: 1080 },
} as unknown as Presentation);

const TAG = 'onerror=EXPORT_XSS';

describe('escExportAttr', () => {
  it('neutralizes breakout chars, leaves legit values', () => {
    expect(escExportAttr('0px"><img>')).toBe('0px&quot;&gt;&lt;img&gt;');
    expect(escExportAttr('https://youtu.be/x')).toBe('https://youtu.be/x');
    expect(escExportAttr(48)).toBe('48');
  });
});

describe('export sink escaping (pre-normalize attribute-context payloads)', () => {
  it('escapes a breakout in geometry / video url / background', async () => {
    const html = await build(pres([
      { id: 'g', type: 'text', preset: 'body', html: 'hi',
        position: { x: `10px"><img src=x ${TAG}>` as unknown as number, y: 10, width: 100, height: 50 } } as unknown as SlideElement,
      { id: 'v', type: 'video', kind: 'embed', provider: 'youtube',
        url: `https://x"><img src=x ${TAG}>`,
        position: { x: 10, y: 200, width: 100, height: 50 } } as unknown as SlideElement,
    ]));
    expect(html).not.toContain(`<img src=x ${TAG}`); // no injected tag
    expect(html).not.toContain(TAG.replace('=', '=') + '>'); // no live handler
    expect(html).toContain('&lt;img'); // survives only as inert text
  });
});

describe('export entry normalize (text html + out-of-shape properties)', () => {
  it('sanitizes text html so a crafted deck cannot emit active content', async () => {
    const p = pres([
      { id: 't', type: 'text', preset: 'body',
        html: `<b>ok</b><img src=x ${TAG}>`,
        position: { x: 10, y: 10, width: 100, height: 50 } } as unknown as SlideElement,
    ]);
    normalizeUntrustedPresentation(p);        // what export-cli.ts / fileOps now do
    const html = await build(p);
    expect(html).not.toContain(`<img src=x ${TAG}`);
    expect(html).toContain('ok'); // the legit part is kept
  });

  it('a javascript: video url is not emitted as an active href/src', async () => {
    const html = await build(pres([
      { id: 'jv', type: 'video', kind: 'embed', provider: 'other',
        url: 'javascript:alert(document.domain)',
        position: { x: 10, y: 10, width: 100, height: 50 } } as unknown as SlideElement,
    ]));
    expect(html).not.toContain('javascript:'); // no active href/src survives the URL policy
  });

  it('drops a text element with a breakout fontFamily', async () => {
    const p = pres([
      { id: 'f', type: 'text', preset: 'body', html: 'gone',
        fontFamily: `sans"><img ${TAG}>`,
        position: { x: 10, y: 10, width: 100, height: 50 } } as unknown as SlideElement,
    ]);
    const dropped = normalizeUntrustedPresentation(p);
    expect(dropped).toBe(1);
    const html = await build(p);
    expect(html).not.toContain(`<img ${TAG}`);
  });
});
