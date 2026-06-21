// Markdown cell — renders via `marked`. The marked output is
// trusted HTML for the same reason as MimeRender's text/html branch:
// it's the user's own notebook content.
//
// marked is lazy-imported so decks without notebooks don't pay the
// cost. Module-level dynamic import means the import promise is
// shared across all notebook cells in the app, not per-mount.

import { useEffect, useState } from 'react';
import { MarkdownCell as MarkdownCellT } from '../../lib/notebookFormat';

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
      if (!cancelled) setHtml(out);
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
