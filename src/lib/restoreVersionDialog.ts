// Modal dialog for choosing the scope of a version-restore when the
// asset is shared across multiple elements (slides).
//
// Solo-asset case skips the dialog — caller uses a plain confirm()
// since there's no scope ambiguity. This dialog only fires when the
// asset is bound by more than one element and the user needs to
// decide whether the restore affects just THIS slide (fork) or
// every slide using the asset (in-place restore on the shared id).
//
// See docs/ASSETS.md → "Per-asset tri-state on shared assets" for
// the broader pattern and rationale.

export type RestoreScope = 'this-only' | 'all' | 'cancel';

export interface RestoreRequest {
  /** Human-readable name to show in the dialog title (path label). */
  imageName: string;
  /** Friendly time label for the target version, e.g. "3 hours ago". */
  whenLabel: string;
  /** How many elements (across all slides) currently use this asset. */
  usageCount: number;
}

interface PendingRequest extends RestoreRequest {
  id: number;
  resolve: (choice: RestoreScope) => void;
}

let pending: PendingRequest | null = null;
let nextId = 1;
const subscribers = new Set<(req: PendingRequest | null) => void>();

export function showRestoreVersionDialog(req: RestoreRequest): Promise<RestoreScope> {
  return new Promise((resolve) => {
    pending = {
      ...req,
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

export function subscribeRestoreVersionDialog(
  cb: (req: PendingRequest | null) => void,
): () => void {
  subscribers.add(cb);
  cb(pending);
  return () => { subscribers.delete(cb); };
}

function emit() {
  for (const cb of subscribers) cb(pending);
}
