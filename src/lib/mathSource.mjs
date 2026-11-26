// The "Typeset math" setting and the \$ escape (#208), shared by every path that
// renders a text element: editor, present, thumbnails, HTML and PDF export, the CLI
// export and the clipboard.
//
// Resolution follows the global pref → deck pref → element pref pattern: the global
// "Typeset math" pref seeds presentation.config.typesetMath when a deck is created
// (createSeededPresentation), and an element's own typesetMath, when set, overrides
// the deck. A deck without the field (every deck made before this setting) typesets,
// so turning the global pref off never changes an existing deck.
//
// Rather than teach every math finder about the setting, each render path passes the
// element's html through mathSourceHtml first. A dollar that must stay literal (an
// escaped \$, or any dollar when typesetting is off) becomes the &#36; entity: it
// displays as "$", and no math finder can mistake it for a delimiter. Inside math,
// texFromHtml maps &#36; back to \$ (TeX's own dollar), so $\$5$ still renders.

/** Whether a text element's $..$ and $$..$$ are typeset. */
export function effectiveTypesetMath(element, config) {
  if (element && typeof element.typesetMath === 'boolean') return element.typesetMath;
  if (config && typeof config.typesetMath === 'boolean') return config.typesetMath;
  return true;
}

/** The html a math finder should see. With typesetting on, only escaped dollars are
 *  made literal; with it off, every dollar is. Dollars inside tags are untouched. */
export function mathSourceHtml(html, typeset) {
  if (typeof html !== 'string') return '';
  if (!html.includes('$')) return html;
  let out = '';
  let i = 0;
  while (i < html.length) {
    const ch = html[i];
    if (ch === '<') {
      const end = html.indexOf('>', i);
      if (end !== -1) { out += html.slice(i, end + 1); i = end + 1; continue; }
    }
    if (ch === '\\' && html[i + 1] === '$') { out += '&#36;'; i += 2; continue; }
    if (ch === '$' && !typeset) { out += '&#36;'; i += 1; continue; }
    out += ch;
    i += 1;
  }
  return out;
}

/** mathSourceHtml for a text element, with its setting resolved against the deck. */
export function elementMathHtml(element, config) {
  return mathSourceHtml(element && element.html, effectiveTypesetMath(element, config));
}

/** Plain-text counterpart (alt text, clipboard text): the escape becomes a plain "$". */
export function mathSourcePlain(text) {
  return typeof text === 'string' ? text.replace(/\\\$/g, '$') : '';
}
