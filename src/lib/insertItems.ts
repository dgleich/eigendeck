// Single source of truth for the "insertable element" actions.
//
// Both the editor toolbar (the "+ Title / + Body / …" buttons) and the
// native macOS "Insert" menu are driven from this list. The toolbar
// hides any item whose id is in the `hiddenToolbarItems` preference; the
// Insert menu ALWAYS shows everything (that's the whole point — toolbar
// customization never removes an action, it just declutters the toolbar).
//
// The actual handlers live in App.tsx (`runInsert`) because they need
// component context (store, file dialogs, the video modal). This module
// is metadata only: stable ids, labels, tooltips, and toolbar grouping.

export type InsertGroup = 'text' | 'objects' | 'embeds';

export interface InsertItem {
  /** Stable id. Used as the toolbar-visibility key AND, prefixed with
   *  `insert-`, as the native menu item id. Never rename without a
   *  migration — it's persisted in the hiddenToolbarItems preference. */
  id: string;
  /** Toolbar button text (rendered as "+ {label}"). */
  label: string;
  /** Button tooltip / accessibility title. */
  tooltip: string;
  /** Toolbar group — items render in groups separated by a divider. */
  group: InsertGroup;
}

export const INSERT_ITEMS: InsertItem[] = [
  // text
  { id: 'title',    label: 'Title',    tooltip: 'Add title text',                                   group: 'text' },
  { id: 'body',     label: 'Body',     tooltip: 'Add body text',                                    group: 'text' },
  { id: 'textbox',  label: 'Text',     tooltip: 'Add text box',                                     group: 'text' },
  { id: 'note',     label: 'Note',     tooltip: 'Add annotation (small, blue, italic)',             group: 'text' },
  { id: 'footnote', label: 'Footnote', tooltip: 'Add footnote (small, grey, narrow)',               group: 'text' },
  { id: 'card',     label: 'Card',     tooltip: 'Add a titled card (rounded, shadowed, themed tint)', group: 'text' },
  // objects
  { id: 'arrow',    label: 'Arrow',    tooltip: 'Add arrow',                                        group: 'objects' },
  { id: 'cover',    label: 'Cover',    tooltip: 'Add cover-up rectangle (white)',                   group: 'objects' },
  { id: 'image',    label: 'Image',    tooltip: 'Add image / vector / PDF from file',               group: 'objects' },
  { id: 'hype',     label: 'Hype',     tooltip: 'Add a Hype sticky note (yellow, Shantell)',        group: 'objects' },
  // embeds
  { id: 'demo',     label: 'Demo',     tooltip: 'Add demo HTML',                                    group: 'embeds' },
  { id: 'notebook', label: 'Notebook', tooltip: 'Add Jupyter notebook',                             group: 'embeds' },
  { id: 'video',    label: 'Video',    tooltip: 'Add a movie — file or URL (YouTube/Vimeo/PeerTube)', group: 'embeds' },
];

export const INSERT_GROUP_ORDER: InsertGroup[] = ['text', 'objects', 'embeds'];
