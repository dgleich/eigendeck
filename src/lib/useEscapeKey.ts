import { useEffect, useRef } from 'react';

// Close-on-Escape for in-app "fake" modals (not native dialogs, so they need
// their own key handling — #120). Listens at the window in the CAPTURE phase
// while `active`, so Escape dismisses the modal regardless of which child has
// focus (e.g. an autoFocus text input that would otherwise swallow it) and
// before the editor's own Escape handling runs. Only re-subscribes when
// `active` toggles; the latest callback is read via a ref.
export function useEscapeKey(active: boolean, onEscape: () => void): void {
  const cb = useRef(onEscape);
  cb.current = onEscape;
  useEffect(() => {
    if (!active) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        cb.current();
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [active]);
}
