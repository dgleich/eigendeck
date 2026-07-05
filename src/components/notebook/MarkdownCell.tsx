// Markdown cell — renders via `marked`, then DOMPurify. A .eigendeck is
// untrusted shared input and marked() passes raw HTML through, so a markdown cell
// with <img onerror=…> would otherwise run in the privileged window (audit
// C-2/C-5). Markdown is prose (no scripts to preserve), so it's always sanitized
// inline — no iframe needed. See docs/NOTEBOOK-ISOLATION.md.
//
// marked is lazy-imported so decks without notebooks don't pay the
// cost. Module-level dynamic import means the import promise is
// shared across all notebook cells in the app, not per-mount.

import { useEffect, useState } from 'react';
import { MarkdownCell as MarkdownCellT } from '../../lib/notebookFormat';
import { sanitizeHtml } from '../../lib/sanitizeHtml';

type MarkedFn = (s: string) => string | Promise<string>;
let markedPromise: Promise<MarkedFn> | null = null;

export function loadMarked(): Promise<MarkedFn> {
  if (!markedPromise) {
    markedPromise = import('marked').then((m) => {
      const parse = m.marked?.parse ?? m.marked;
      return (s: string) => parse(s);
    });
  }
  return markedPromise;
}

export function MarkdownCell({ cell, prerenderedHtml }: {
  cell: MarkdownCellT;
  /** Pre-rendered markdown HTML (static HTML export, where the async
   *  marked useEffect can't run under renderToStaticMarkup). When set,
   *  it's used directly; when absent, the existing async behavior is
   *  unchanged. */
  prerenderedHtml?: string;
}) {
  const [html, setHtml] = useState<string>(prerenderedHtml ?? '');

  useEffect(() => {
    if (prerenderedHtml != null) return;  // export path — no async render
    let cancelled = false;
    loadMarked().then(async (md) => {
      const out = await md(cell.source);
      const clean = await sanitizeHtml(out);
      if (!cancelled) setHtml(clean);
    });
    return () => { cancelled = true; };
  }, [cell.source, prerenderedHtml]);

  return (
    <div className="nb-cell nb-cell-markdown">
      <div className="nb-cell-prompt" />
      <div
        className="nb-cell-body nb-markdown"
        dangerouslySetInnerHTML={{ __html: prerenderedHtml ?? html }}
      />
    </div>
  );
}
