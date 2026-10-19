import { createContext, useContext } from 'react';

/** Whether the notebook's controls may show hover tooltips. NotebookContent turns
 *  them off in present mode: there the cursor is the presenter's pointer, and a
 *  `title` makes WebKit draw a native tooltip over what is being pointed at (#203). */
export const NotebookTooltips = createContext(true);

/** Props for a control's description: a `title` (tooltip) in the editor, an
 *  `aria-label` (same text, no tooltip) while presenting. */
export function useTip(text: string): { title: string } | { 'aria-label': string } {
  return useContext(NotebookTooltips) ? { title: text } : { 'aria-label': text };
}
