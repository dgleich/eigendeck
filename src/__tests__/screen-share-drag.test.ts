import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Regression for #96 — "can't move the window in Screen-Share Presentation Mode".
 *
 * The screen-share presenter is a chromeless window (no title bar); it's moved
 * via an invisible `data-tauri-drag-region` strip, which calls Tauri's
 * `start_dragging` IPC. That command is NOT in the `core:window:default`
 * permission set, so without an explicit `core:window:allow-start-dragging`
 * grant the drag is silently denied and the window won't move.
 *
 * These two checks pin BOTH halves of the fix: the permission, and the UI strip.
 */
describe('screen-share window dragging (#96)', () => {
  it('grants core:window:allow-start-dragging (so data-tauri-drag-region works)', () => {
    const cap = JSON.parse(
      readFileSync(resolve(__dirname, '../../src-tauri/capabilities/default.json'), 'utf-8'),
    );
    expect(cap.permissions).toContain('core:window:allow-start-dragging');
  });

  it('the windowed presenter renders a data-tauri-drag-region strip', () => {
    const src = readFileSync(resolve(__dirname, '../presenter.tsx'), 'utf-8');
    expect(src).toContain('data-tauri-drag-region');
    // gated on the windowed (screen-share) mode, not the dual-monitor presenter.
    expect(src).toMatch(/windowed\s*&&[\s\S]*data-tauri-drag-region/);
  });
});
