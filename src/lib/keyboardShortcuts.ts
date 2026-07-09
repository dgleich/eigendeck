// Pure helpers for editor keyboard shortcuts, split out so the mapping is unit
// testable independent of the DOM keydown plumbing in App.tsx.

/** Arrow-key nudge delta for a selected element. 1px, or 10px with Shift
 *  (Keynote/Sketch convention). Returns null for non-arrow keys. */
export function nudgeDelta(key: string, shiftKey: boolean): { dx: number; dy: number } | null {
  const step = shiftKey ? 10 : 1;
  switch (key) {
    case 'ArrowLeft': return { dx: -step, dy: 0 };
    case 'ArrowRight': return { dx: step, dy: 0 };
    case 'ArrowUp': return { dx: 0, dy: -step };
    case 'ArrowDown': return { dx: 0, dy: step };
    default: return null;
  }
}

/** Z-order direction for Cmd+] / Cmd+[ (Shift → all the way to front/back).
 *  Returns null for other keys. */
export function zOrderDirection(key: string, shiftKey: boolean): 'top' | 'up' | 'down' | 'bottom' | null {
  if (key === ']') return shiftKey ? 'top' : 'up';
  if (key === '[') return shiftKey ? 'bottom' : 'down';
  return null;
}
