// "Re-enabling auto-reload — what about existing assets?" dialog.
//
// Fires when the user toggles per-presentation auto-reload from
// effectively-OFF to effectively-ON (e.g. Inspector → Presentation →
// Auto-reload Assets → Never to Always). The intermediate moment
// matters because the user previously opted out; we don't want a
// casual toggle to surprise them by suddenly auto-updating every
// pre-existing asset.
//
// User picks one of two intents:
//   'new-only'  : keep existing assets at their current bytes; watcher
//                 resumes only for assets inserted from now on.
//                 Implementation: walk every asset with auto_reload=null
//                 and set it to 'off', so the cascade ('off' wins over
//                 per-pres 'on') keeps them quiet.
//   'rescan-all': existing assets resume watching; trigger a scan
//                 immediately to catch up on disk drift that happened
//                 while OFF mode was active.
//   'cancel'    : Esc / outside-click. Don't change anything — keep
//                 per-pres at OFF.

export type ReenableChoice = 'new-only' | 'rescan-all' | 'cancel';

interface PendingRequest {
  id: number;
  resolve: (choice: ReenableChoice) => void;
}

let pending: PendingRequest | null = null;
let nextId = 1;
const subscribers = new Set<(req: PendingRequest | null) => void>();

export function showReenableWatchingDialog(): Promise<ReenableChoice> {
  return new Promise((resolve) => {
    pending = {
      id: nextId++,
      resolve: (choice) => {
        pending = null;
        emit();
        resolve(choice);
      },
    };
    emit();
  });
}

export function subscribeReenableWatchingDialog(
  cb: (req: PendingRequest | null) => void,
): () => void {
  subscribers.add(cb);
  cb(pending);
  return () => { subscribers.delete(cb); };
}

function emit() {
  for (const cb of subscribers) cb(pending);
}
