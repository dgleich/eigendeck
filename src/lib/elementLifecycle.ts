// Per-element-type lifecycle hooks for the sync/link transitions. Lets a
// specific element type (notably `notebook`) customize what happens when it is
// freed, re-synced, or merged with another element — without the store needing
// to import that type's code. Types register at app boot
// (registerNotebookLifecycle in components/notebook/notebookLifecycle.ts); the
// store calls the type-agnostic run* dispatchers.
//
// Hooks may be async and are fired BEFORE the store flips the relevant fields,
// so they can seed in-memory caches synchronously (the clone-on-unsync
// contract: cloneOverlay seeds its cache before its first await, so a
// void-fired hook shows no empty flash on the next render).

import type { SlideElement } from '../types/presentation';

export interface MergeContext {
  /** Element on the current slide being linked. */
  source: SlideElement;
  /** Element on another slide it links to. */
  target: SlideElement;
  /** The shared syncId the merged element will live under. */
  sharedSyncId: string;
  /** Which side's type-specific state to keep: 'auto' decides by content,
   *  'source'/'target' is an explicit (e.g. user-chosen) winner. */
  keep: 'auto' | 'source' | 'target';
}

export interface ElementLifecycleHooks {
  /** A synced element is being freed; `freedId` becomes its standalone key. */
  onFree?(el: SlideElement, freedId: string): void | Promise<void>;
  /** A freed element is rejoining its remembered group. */
  onResync?(el: SlideElement): void | Promise<void>;
  /** Two elements are merging under one group. */
  onMerge?(ctx: MergeContext): void | Promise<void>;
  /** `copy` was just created from `source` (duplicate / paste). Carry
   *  type-specific state across — e.g. clone a notebook's recording — so a copy
   *  keeps everything intact. Should no-op when the copy SHARES the source's
   *  group (same overlay key), which it can detect via the keys. */
  onCopy?(source: SlideElement, copy: SlideElement): void | Promise<void>;
}

const registry = new Map<string, ElementLifecycleHooks>();

export function registerElementLifecycle(type: string, hooks: ElementLifecycleHooks): void {
  registry.set(type, hooks);
}

/** Test/teardown helper — drop all registrations. */
export function clearElementLifecycle(): void {
  registry.clear();
}

export function runFreeHook(el: SlideElement, freedId: string): void | Promise<void> {
  return registry.get(el.type)?.onFree?.(el, freedId);
}

export function runResyncHook(el: SlideElement): void | Promise<void> {
  return registry.get(el.type)?.onResync?.(el);
}

export function runCopyHook(source: SlideElement, copy: SlideElement): void | Promise<void> {
  return registry.get(source.type)?.onCopy?.(source, copy);
}

/** Run the merge hook for each DISTINCT type among source/target (so a hook
 *  that reconciles both sides — e.g. notebook overlays — runs exactly once). */
export async function runMergeHook(ctx: MergeContext): Promise<void> {
  const types = new Set([ctx.source.type, ctx.target.type]);
  for (const t of types) {
    await registry.get(t)?.onMerge?.(ctx);
  }
}
