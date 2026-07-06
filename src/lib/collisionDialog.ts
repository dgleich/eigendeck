// Module-level subscribe pattern for the "asset has silently changed
// since first add" awareness dialog.
//
// Fired when a user re-inserts an asset (drag-drop or file picker) whose
// path already exists in the project AND the existing asset's current
// bytes differ from its ORIGINAL bytes (oldest version in history). The
// user-visible surprise the dialog surfaces: file-watching silently
// updated their existing copy when the source file changed on disk;
// they may not have noticed.
//
// User picks one of two intents:
//   'accept' : "I understand and want the auto-updating behavior."
//              Existing asset stays as-is (silently-updated bytes);
//              new element is added pointing at it; same outcome as if
//              the dialog had never appeared. The dialog is FYI in this
//              path.
//   'revert' : "I want to revert the existing copy to its original and
//              add this as a separate new asset; disable auto-updating
//              for this presentation." Existing asset's original bytes
//              are restored (old element shows the originally-added
//              version again); a NEW asset is created with the bytes
//              being inserted now; presentation auto-reload set to OFF.
//   'cancel' : Esc / outside-click. Abort the insertion entirely. No
//              visible button — paternalism cap; users expect Esc to
//              get out of a modal.
//
// See docs/ASSETS.md → "Path collision dialog" for the design.

export type CollisionChoice = 'accept' | 'revert' | 'cancel';

export interface CollisionRequest {
  /** Path label of the asset (e.g. 'images/chart.svg'). */
  path: string;
  /** 1-based slide numbers where the existing asset is currently used
   *  (per getSlideNumber). May be a single slide or several. Used to
   *  render the "added on slide X" / "added on slides 2 and 7" copy. */
  slideNumbers: number[];
  /** Did the EXISTING embedded copy already change from what was first added
   *  (current hash != original hash)? True = a watcher auto-update already
   *  happened (the "…which has already happened" framing). False = the embedded
   *  copy is still the original (untrusted/unwatched deck), so the divergence is
   *  only in the NEW file being added — the message must NOT claim an update
   *  already occurred. */
  existingChanged: boolean;
}

interface PendingRequest extends CollisionRequest {
  id: number;
  resolve: (choice: CollisionChoice) => void;
}

let pending: PendingRequest | null = null;
let nextId = 1;
const subscribers = new Set<(req: PendingRequest | null) => void>();

/** Show the dialog. Caller awaits a Promise resolving to the choice. */
export function showCollisionDialog(req: CollisionRequest): Promise<CollisionChoice> {
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

/** Component subscribes to be notified when the pending request changes. */
export function subscribeCollisionDialog(cb: (req: PendingRequest | null) => void): () => void {
  subscribers.add(cb);
  cb(pending);
  return () => { subscribers.delete(cb); };
}

function emit() {
  for (const cb of subscribers) cb(pending);
}
