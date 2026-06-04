// Notebook's registration with the element lifecycle registry. Wires the
// notebook overlay (the eigendeck recording) into the generic free / resync /
// merge transitions so the store stays free of notebook-specific imports.
// Called once at app boot (see App.tsx).

import { registerElementLifecycle } from '../../lib/elementLifecycle';
import {
  cloneOverlay, applyLinkOverlay, discardOverlay, loadOverlayFor,
} from '../../lib/useOverlay';
import { isOverlayEmpty } from '../../lib/notebookOverlay';

export function registerNotebookLifecycle(): void {
  registerElementLifecycle('notebook', {
    // Freeing a synced notebook: keep the freed instance a private copy of the
    // group's recording (the still-synced instances keep the original).
    onFree(el, freedId) {
      if (el.syncId) return cloneOverlay(el.syncId, freedId);
    },

    // Re-syncing: the element rejoins its group, adopting the group's shared
    // recording — drop its private fork so it doesn't shadow the group's.
    onResync(el) {
      if (el._syncId && el._syncId !== el.id) return discardOverlay(el.id);
    },

    // Merging two notebooks under one group: the merged element can keep only
    // ONE recording. Honour an explicit user choice, else keep whichever side
    // actually has one (source wins a tie). The losing recording is discarded.
    async onMerge({ source, target, sharedSyncId, keep }) {
      const sourceKey = source.syncId ?? source.id;
      const targetKey = target.syncId ?? target.id;
      let keepKey: string | null;
      if (keep === 'source') keepKey = sourceKey;
      else if (keep === 'target') keepKey = targetKey;
      else {
        const sHas = !isOverlayEmpty(await loadOverlayFor(sourceKey));
        const tHas = !isOverlayEmpty(await loadOverlayFor(targetKey));
        keepKey = sHas ? sourceKey : (tHas ? targetKey : null);
      }
      await applyLinkOverlay({ sourceKey, targetKey, newKey: sharedSyncId }, keepKey);
    },
  });
}
