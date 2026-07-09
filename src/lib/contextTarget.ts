// The element currently targeted by an open context menu (Mac convention: a
// right-click targets + highlights an element WITHOUT changing selection). Kept
// in a tiny external store rather than the Zustand deck store so it's not part
// of undo history and DraggableBox can self-subscribe without prop threading
// through every element-type branch. Cleared when the menu closes.
import { useSyncExternalStore } from 'react';

let target: string | null = null;
const listeners = new Set<() => void>();

export function setContextTarget(id: string | null): void {
  if (target === id) return;
  target = id;
  listeners.forEach((l) => l());
}

export function getContextTarget(): string | null {
  return target;
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

/** Re-renders the caller when the context-target id changes. */
export function useContextTarget(): string | null {
  return useSyncExternalStore(subscribe, getContextTarget, getContextTarget);
}
