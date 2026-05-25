// Module-level subscribe pattern for the path-collision dialog.
//
// Fired when a user inserts an asset (drag-drop or file picker) whose
// path label already exists in the project with different bytes. The
// dialog asks the user to pick:
//   - 'update' : reuse existing asset_id, new bytes become current
//                version, other elements bound to the same asset also
//                change
//   - 'new'    : fresh asset_id, same path label, new element binds to
//                the new asset; older elements unaffected
//   - 'cancel' : abort the insertion entirely
//
// See docs/ASSETS.md → "Path collision dialog" for the design.
//
// Behaviorally similar to confirm() — caller awaits a Promise. Single
// dialog at a time (subsequent calls queue; rare in practice since
// insertions happen one at a time).

export type CollisionChoice = 'update' | 'new' | 'cancel';

export interface CollisionRequest {
  /** Path label colliding with an existing asset. */
  path: string;
  /** existing asset's external_path (source file on disk, if known). */
  existingExternalPath: string | null;
  /** How many elements across this presentation reference the existing asset. */
  usageCount: number;
  /** How many distinct slides contain those elements. */
  slideCount: number;
}

interface PendingRequest extends CollisionRequest {
  id: number;
  resolve: (choice: CollisionChoice, rememberForSession: boolean) => void;
}

let pending: PendingRequest | null = null;
let nextId = 1;
const subscribers = new Set<(req: PendingRequest | null) => void>();

// Session-wide remembered choice (cleared on app restart — not persisted).
// When set, future calls auto-resolve to this choice without showing UI.
let sessionRemembered: CollisionChoice | null = null;

/** Show the dialog (or auto-resolve from session memory). */
export function showCollisionDialog(req: CollisionRequest): Promise<CollisionChoice> {
  if (sessionRemembered) return Promise.resolve(sessionRemembered);
  return new Promise((resolve) => {
    pending = {
      ...req,
      id: nextId++,
      resolve: (choice, remember) => {
        if (remember && choice !== 'cancel') sessionRemembered = choice;
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

/** Test/dev helper: clear the session-remembered choice. */
export function clearSessionMemory() {
  sessionRemembered = null;
}
