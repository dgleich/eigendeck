// Slide group helpers — shared by the app/types (src/types/presentation.ts
// re-exports these) AND the .mjs export/CLI paths (exportCore.mjs, printLayer.ts),
// so the exported website/PDF number build-slides the same way the editor and
// present mode do. These read only `slide.groupId`, so they take a minimal
// structural slide shape and need no other types (keeps this dependency-free and
// out of a circular import with presentation.ts).

/** Get the display slide number for a given slide index (groups share a number). */
export function getSlideNumber(slides, index) {
  let num = 0;
  for (let i = 0; i <= index; i++) {
    const slide = slides[i];
    const prev = i > 0 ? slides[i - 1] : null;
    // Increment number if this slide starts a new group or has no group
    if (!slide.groupId || !prev || prev.groupId !== slide.groupId) {
      num++;
    }
  }
  return num;
}

/** Check if a slide is a child (not the first) in its group. */
export function isGroupChild(slides, index) {
  const slide = slides[index];
  if (!slide.groupId) return false;
  if (index === 0) return false;
  return slides[index - 1].groupId === slide.groupId;
}

/** Get all slide indices in the same group. */
export function getGroupIndices(slides, index) {
  const slide = slides[index];
  if (!slide.groupId) return [index];
  return slides.reduce((acc, s, i) => {
    if (s.groupId === slide.groupId) acc.push(i);
    return acc;
  }, []);
}
