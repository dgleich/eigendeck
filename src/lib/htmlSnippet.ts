// Validate an HTML-element snippet before inserting it (#137). Snippets are just
// self-contained HTML fragments (see examples-html-elements/), so "Insert HTML
// Element from File…" — and, later, a "download from an online repo" flow — need a
// gate that rejects cruddy input: not-HTML, scripts (won't run in the sandbox),
// and remote resource references (blocked by the CSP). This is a UX guard, NOT a
// security boundary — the real containment is the no-`allow-scripts` sandbox + CSP
// applied to `el.html` in every render path; a snippet that slipped past this still
// executes nothing. This function is PURE (no Tauri / DOM deps) so it can guard both
// the local file picker and any remote fetch.
import { stripVarsManifest } from './htmlVars.mjs';

export interface SnippetCheck {
  ok: boolean;
  /** The snippet HTML to use as the element's `html` field (unchanged on success). */
  html: string;
  /** Whether the metadata comment marked it interactive (needs pointer events). */
  interactive: boolean;
  /** Human-readable reasons it was rejected (empty when ok). */
  problems: string[];
}

// Snippets should be small. 2 MB leaves room for a modest inline data: image while
// still rejecting "someone handed me a whole web page / a binary".
const MAX_BYTES = 2_000_000;

// A remote resource reference the sandbox CSP would block (http/https/protocol-
// relative) in a load context: src / srcset / CSS url() / @import / <link href>.
const REMOTE_PATTERNS: RegExp[] = [
  /\bsrc\s*=\s*["']?\s*(?:https?:)?\/\//i,
  /\bsrcset\s*=\s*["']?\s*(?:https?:)?\/\//i,
  /url\(\s*["']?\s*(?:https?:)?\/\//i,
  /@import\s+(?:url\(\s*)?["']?\s*(?:https?:)?\/\//i,
  /<link\b[^>]*\bhref\s*=\s*["']?\s*(?:https?:)?\/\//i,
];

/** Read the interactive flag from the `<!-- eigendeck-html-element … interactive -->`
 *  metadata comment, if present. */
export function snippetIsInteractive(raw: string): boolean {
  const m = raw.match(/<!--\s*eigendeck-html-element\b([\s\S]*?)-->/i);
  return !!(m && /\binteractive\b/i.test(m[1]));
}

export function validateHtmlSnippet(raw: unknown): SnippetCheck {
  const problems: string[] = [];
  const html = typeof raw === 'string' ? raw : '';
  const trimmed = html.trim();

  if (!trimmed) {
    problems.push('The file is empty.');
    return { ok: false, html, interactive: false, problems };
  }
  if (html.length > MAX_BYTES) {
    problems.push(`Too large (${(html.length / 1e6).toFixed(1)} MB, max 2 MB) — snippets should be small; embed a big image as a real image element instead.`);
  }
  // Must actually be HTML — at least one element tag.
  if (!/<([a-z][a-z0-9-]*)\b[^>]*>/i.test(trimmed)) {
    problems.push('This doesn’t look like HTML — no elements were found.');
  }
  // The variables manifest (`<script type="application/eigendeck-vars+json">`, #138)
  // is a non-executing data island — strip it before the script check so it's exempt
  // while real scripts still trip the gate.
  if (/<script[\s>/]/i.test(stripVarsManifest(html))) {
    problems.push('Contains a <script> — scripts don’t run in the sandbox. Use CSS animation or native form controls instead.');
  }
  if (/<[a-z][^>]*\son[a-z]+\s*=/i.test(html)) {
    problems.push('Contains inline event handlers (onclick, onerror, …) — they don’t run in the sandbox.');
  }
  if (REMOTE_PATTERNS.some((re) => re.test(html))) {
    problems.push('References remote resources (http/https). The sandbox blocks the network — embed images and fonts as data: URIs.');
  }

  return { ok: problems.length === 0, html, interactive: snippetIsInteractive(html), problems };
}
