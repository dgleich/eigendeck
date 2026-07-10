// Registry of pending notebook-overlay flushers.
//
// Each `useOverlay()` instance persists its overlay (the sidecar holding
// cellEdits + cellOutputs) via its OWN 800ms debounced flush. That flush is
// independent of the deck save, so a deck saved or closed within ~800ms of an
// edit/run could drop the overlay (#123). Each hook registers its flush here so
// the save path (flushToSqlite) and the close/quit path can FORCE any pending
// overlay to disk immediately, bypassing the debounce.
//
// Plain module (no React / no store import) so both the hook and the store can
// depend on it without a cycle.

type Flusher = () => Promise<void>;

const flushers = new Set<Flusher>();

/** Register a flush fn; returns an unregister fn for effect cleanup. */
export function registerOverlayFlush(fn: Flusher): () => void {
  flushers.add(fn);
  return () => { flushers.delete(fn); };
}

/**
 * Force every registered overlay to flush now. Each flusher is a no-op when
 * nothing changed, so this is cheap to call on every save/autosave. Per-flusher
 * errors are swallowed so one bad overlay can't block the deck save.
 */
export async function flushAllOverlays(): Promise<void> {
  await Promise.all([...flushers].map((f) => f().catch((e) => {
    console.warn('overlay flush failed during forced flush:', e);
  })));
}
