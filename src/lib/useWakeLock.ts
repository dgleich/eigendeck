import { useEffect } from 'react';

/**
 * Hold a **Screen Wake Lock** while `active` (i.e. during Present mode) so the
 * display doesn't sleep and the screensaver doesn't start mid-talk (#179).
 *
 * Best-effort + feature-detected: silently no-ops where the API is missing (older
 * WebViews). The OS releases the lock whenever the document becomes hidden (the
 * user switches apps), so we re-acquire on `visibilitychange` while still active.
 * A rejected request (not visible / low battery) is ignored — this is a nicety,
 * never a hard failure.
 */
export function useScreenWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active || typeof navigator === 'undefined' || !navigator.wakeLock) return;

    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;

    const acquire = async (): Promise<void> => {
      if (cancelled || sentinel || document.visibilityState !== 'visible') return;
      try {
        const s = await navigator.wakeLock.request('screen');
        if (cancelled) { void s.release().catch(() => {}); return; }
        sentinel = s;
        // The OS can drop the lock on its own — clear our handle so the next
        // visibilitychange re-acquires it.
        s.addEventListener('release', () => { if (sentinel === s) sentinel = null; });
      } catch {
        /* request rejected — best-effort, ignore */
      }
    };
    const onVisibility = (): void => { if (document.visibilityState === 'visible') void acquire(); };

    void acquire();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
      void sentinel?.release().catch(() => {});
      sentinel = null;
    };
  }, [active]);
}
