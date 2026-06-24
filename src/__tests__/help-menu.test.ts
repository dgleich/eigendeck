import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * The native Help menu (Rust, src-tauri/src/lib.rs) emits menu ids that App.tsx
 * handles by opening a URL. They're wired across the Rust↔JS boundary, so this
 * pins that they stay in sync: every help-* id built in Rust has a matching JS
 * handler, and the target URLs are the intended ones.
 */
describe('Help menu wiring', () => {
  const rust = readFileSync(resolve(__dirname, '../../src-tauri/src/lib.rs'), 'utf-8');
  const app = readFileSync(resolve(__dirname, '../App.tsx'), 'utf-8');

  it('every Help menu id built in Rust is handled in App.tsx', () => {
    const ids = [...rust.matchAll(/\.id\("(help-[a-z-]+)"\)/g)].map((m) => m[1]);
    expect(ids).toEqual(expect.arrayContaining(['help-learning', 'help-manual', 'help-report-bug']));
    for (const id of ids) {
      expect(app, `App.tsx must handle menu id "${id}"`).toContain(`'${id}'`);
    }
  });

  it('points at the intended destinations', () => {
    expect(app).toContain('https://eigendeck.dev/learning');
    expect(app).toContain('https://eigendeck.dev/manual');
    expect(app).toContain('https://github.com/dgleich/eigendeck/issues');
  });
});
