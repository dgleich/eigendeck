// Structural slide shape — these helpers read only `groupId`, so they accept any
// Slide[] (Slide is assignable to this) without importing the Slide type (which
// would be a circular import, since presentation.ts re-exports from here).
type GroupSlide = { groupId?: string };

/** Get the display slide number for a given slide index (groups share a number). */
export function getSlideNumber(slides: GroupSlide[], index: number): number;

/** Check if a slide is a child (not the first) in its group. */
export function isGroupChild(slides: GroupSlide[], index: number): boolean;

/** Get all slide indices in the same group. */
export function getGroupIndices(slides: GroupSlide[], index: number): number[];
