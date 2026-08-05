// Pure decision for "Select All" (Cmd+A / Edit menu), factored out of App's
// selectAllAction so every branch is unit-tested (the DOM/store side effects stay
// in App). See docs/... — the fix that made Cmd+A select slide ELEMENTS instead
// of the webview's DOM select-all.

export type SelectAllResult =
  | { kind: 'field' }               // focus is in a text field → select its text
  | { kind: 'multi'; ids: string[] } // >1 element on the slide → select them all
  | { kind: 'element'; id: string }  // exactly 1 element → select it
  | { kind: 'slide' };               // no elements → fall back to selecting the slide

/**
 * Given whether a text field is focused and the current slide's element ids,
 * decide what Select All should do. `inField` true short-circuits to the
 * field-text case regardless of elements.
 */
export function selectAllTarget(inField: boolean, elementIds: readonly string[]): SelectAllResult {
  if (inField) return { kind: 'field' };
  if (elementIds.length > 1) return { kind: 'multi', ids: [...elementIds] };
  if (elementIds.length === 1) return { kind: 'element', id: elementIds[0] };
  return { kind: 'slide' };
}
