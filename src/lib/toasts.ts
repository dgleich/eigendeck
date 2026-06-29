// Lightweight non-modal toast/snackbar system.
//
// Mount <ToastHost /> once at app root. Anywhere in the codebase:
//
//   showToast({
//     message: 'Save the presentation to enable file watching.',
//     kind: 'warning',
//     action: { label: 'Save', onClick: () => saveProject() },
//   });
//
// Toasts auto-dismiss after `ttl` ms (default 6000; 0 = sticky).
// Users can dismiss manually via the × button. Stacks at the bottom-
// center of the window.
//
// Simple subscribe pattern (no Zustand dep) — toast lifetime is short
// and the surface area doesn't justify integrating with the store.

export type ToastKind = 'info' | 'warning' | 'error' | 'success';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface Toast {
  id: string;
  message: string;
  kind: ToastKind;
  action?: ToastAction;
}

export interface ToastOptions {
  message: string;
  kind?: ToastKind;
  action?: ToastAction;
  /** Auto-dismiss after N ms. 0 = sticky (no auto-dismiss). Default 6000. */
  ttl?: number;
  /** Optional dedup key. Subsequent showToast() calls with the same key
   *  replace the existing toast in place instead of stacking. */
  key?: string;
}

type Listener = (toasts: Toast[]) => void;
const listeners = new Set<Listener>();
const toasts: Toast[] = [];
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function notify(): void {
  const snapshot = [...toasts];
  for (const l of listeners) l(snapshot);
}

export function subscribeToasts(l: Listener): () => void {
  listeners.add(l);
  l([...toasts]);
  return () => { listeners.delete(l); };
}

export function showToast(opts: ToastOptions): string {
  const id = opts.key ?? crypto.randomUUID();
  const ttl = opts.ttl ?? 6000;
  const toast: Toast = {
    id,
    message: opts.message,
    kind: opts.kind ?? 'info',
    action: opts.action,
  };

  // Dedup by key/id — replace in place rather than stack a duplicate.
  const existingIdx = toasts.findIndex((t) => t.id === id);
  if (existingIdx >= 0) {
    toasts[existingIdx] = toast;
  } else {
    toasts.push(toast);
  }

  // Reset any pending timer for this id and schedule a new dismissal.
  const existingTimer = timers.get(id);
  if (existingTimer) clearTimeout(existingTimer);
  if (ttl > 0) {
    timers.set(id, setTimeout(() => dismissToast(id), ttl));
  }

  notify();
  return id;
}

export function dismissToast(id: string): void {
  const i = toasts.findIndex((t) => t.id === id);
  if (i < 0) return;
  toasts.splice(i, 1);
  const t = timers.get(id);
  if (t) { clearTimeout(t); timers.delete(id); }
  notify();
}
