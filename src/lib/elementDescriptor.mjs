// Per-type element DESCRIPTOR — the single place that knows what each element
// TYPE is (its box + resolved visual values + content spec), independent of HOW
// it's painted. Per-target ADAPTERS consume a descriptor and specialize the
// emit form (React node / HTML string), the wrapper (editor DraggableBox /
// bare / absolute div), and how heavy types degrade (live iframe / cached
// preview / placeholder).
//
// Goal: ONE rendering path with specializations, not k parallel switches — so a
// new element type or a render tweak happens in one place and can't drift across
// the editor / present / thumbnail / HTML-export / print targets.
//
// Pure + `.mjs` (no TS, no React) so BOTH the HTML export (exportCore.mjs, shared
// with the CLI) and the React renderers can import it. The resolved slide
// background is passed IN, because each target obtains it differently (editor:
// a prop; others: resolveTheme()/themeBackground()).
//
// Migration: types are moved onto this path incrementally; cover is first.

/** cover — a reveal mask filled with the slide background; an explicit color wins. */
export function describeCover(el, resolvedSlideBg) {
  return { kind: 'cover', box: el.position, background: el.color || resolvedSlideBg };
}
