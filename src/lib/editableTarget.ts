// Is a clipboard/keyboard event happening INSIDE a text editor (a
// contentEditable text element, or an <input>/<textarea>)?
//
// The obvious check — `e.target.closest('[contenteditable="true"]')` — is not
// enough. WebKit (Tauri's engine) can dispatch a KEYBOARD-initiated paste/copy
// (Cmd+V / Cmd+C) with `event.target` set to <body>, NOT the focused editable,
// even while the caret is sitting in a contentEditable. When that happens an
// `e.target`-only guard fails to bail, so a window-level canvas paste handler
// ALSO runs — the user gets BOTH a new element on the canvas AND text inserted
// at the caret (the browser's default paste still targets the focused editable).
// Same failure on copy: an in-edit copy gets treated as a canvas element copy
// and clobbers the clipboard.
//
// The fix: also consult the FOCUS (`document.activeElement`) and the current
// selection anchor, which stay correct regardless of the event target.

/** True iff `node` is, or is inside, a contentEditable / input / textarea. */
export function isEditableNode(node: Node | EventTarget | null | undefined): boolean {
  const el = asElement(node);
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return true;
  // `contenteditable="true"` on the element or any ancestor.
  return !!el.closest?.('[contenteditable="true"]');
}

function asElement(node: Node | EventTarget | null | undefined): Element | null {
  if (!node) return null;
  // Element node.
  if (typeof (node as Element).closest === 'function') return node as Element;
  // Text (or other) node → its parent element.
  const parent = (node as Node).parentElement ?? (node as Node).parentNode;
  return parent && typeof (parent as Element).closest === 'function' ? (parent as Element) : null;
}

/** Minimal shape of the document facts we consult — injectable for tests. */
export interface EditorFocusDoc {
  activeElement: Element | null;
  getSelection?: () => { focusNode: Node | null } | null;
}

/**
 * True when a clipboard/keyboard event should be treated as happening inside a
 * text editor. Checks the event target AND the focused element AND the current
 * selection anchor, so it's correct even when WebKit mis-targets the event to
 * <body> (see file header). `doc` is injectable for testing.
 */
export function eventInTextEditor(
  e: { target?: EventTarget | null },
  doc?: EditorFocusDoc | null,
): boolean {
  if (isEditableNode(e.target ?? null)) return true;
  const d = doc ?? (typeof document !== 'undefined' ? (document as unknown as EditorFocusDoc) : null);
  if (!d) return false;
  if (isEditableNode(d.activeElement)) return true;
  const focusNode = d.getSelection?.()?.focusNode ?? null;
  return isEditableNode(focusNode);
}
