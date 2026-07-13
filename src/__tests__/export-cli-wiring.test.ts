import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * #85 caller-wiring guard. `buildExportHtml` (exportCore) is driven by an options
 * bag wired DIFFERENTLY by its three callers — a capability the renderer consumes
 * must be wired in the app export (fileOps) AND the CLI export (export-cli). This
 * source-parity test pins the CLI wiring so a future edit can't silently drop a
 * callback the app passes (the #85 bug class: CLI omitting getElementPreview, and
 * later fontFacesCss — CLI-exported non-PT-Sans decks rendered in a fallback face).
 *
 * It reads the source (export-cli can't be imported without a Tauri `invoke`
 * stub) and asserts each shared capability is threaded into buildExportHtml.
 */
describe('export-cli buildExportHtml wiring (#85 parity)', () => {
  const src = readFileSync(resolve(__dirname, '../export-cli.ts'), 'utf-8');

  // Capabilities the CLI export MUST wire (headless-renderable ones the app also
  // passes). renderTextElement / renderNotebookElement / demoThemeVarsCss are
  // deliberately app-only (need the iframe pool / live render) — NOT listed here.
  for (const cap of [
    'readFile', 'readTextFile', 'renderMath', 'applyMathPreamble',
    'getElementPreview', 'resolveMathBundle', 'resolveFont', 'fontFacesCss',
  ]) {
    it(`wires ${cap}`, () => {
      expect(src).toContain(cap);
    });
  }

  it('embeds fonts via buildEmbeddedFontFacesCSS (so CLI decks carry their fonts)', () => {
    expect(src).toContain('buildEmbeddedFontFacesCSS');
  });
});
