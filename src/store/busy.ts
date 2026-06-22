// Global "busy" indicator for operations that can take more than a moment —
// importing a large video/image/PDF (reading the file + embedding it in the
// deck), etc. A single message at a time; the most recent wins.
//
// Use `withBusy(message, fn)`: the overlay only appears after a short delay so
// quick operations don't flash a spinner, and it's always cleared when the
// operation settles (success OR throw). Pair with <BusyOverlay/> (mounted once
// at the app root) to render it.
import { create } from 'zustand';

interface BusyState {
  message: string | null;
  setMessage: (m: string | null) => void;
}

export const useBusyStore = create<BusyState>((set) => ({
  message: null,
  setMessage: (message) => set({ message }),
}));

/**
 * Run `fn` behind the global busy overlay. The overlay appears only if `fn`
 * is still running after `delayMs` (default 400ms) — so sub-second operations
 * never flash a spinner — and is always cleared when `fn` settles.
 */
export async function withBusy<T>(
  message: string,
  fn: () => Promise<T>,
  delayMs = 400,
): Promise<T> {
  const timer = setTimeout(() => useBusyStore.getState().setMessage(message), delayMs);
  try {
    return await fn();
  } finally {
    clearTimeout(timer);
    useBusyStore.getState().setMessage(null);
  }
}
