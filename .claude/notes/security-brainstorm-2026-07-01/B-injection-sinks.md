# B. Injection sinks (HTML/SVG sanitization)

Deck-controlled HTML/SVG reaches `dangerouslySetInnerHTML` unsanitized in several
places.

- Route **every** `dangerouslySetInnerHTML` through one sanitizer (DOMPurify or an
  extended `sanitizeRichText`), at **ingest** AND at the sink.
- Audit that all sinks actually use it — LinkOverlay / SpeakerView / HistoryPanel
  currently bypass it.
- **Notebook `text/html` outputs**: choose — sanitize (lose interactive widgets
  like Plotly/Bokeh) OR iframe-isolate them (keep interactivity, isolated).
- SVG sanitizer for `image/svg+xml` outputs AND the `math_cache` SVG splice
  (strip `script`, `on*`, `foreignObject`, `href`/`xlink:href` `javascript:`/`data:`).
- Don't trust deck-supplied `math_cache` at all: re-render from tex, or sanitize
  the cached SVG (sanitizing is cheaper; MathJax output is script-free so it's
  transparent).
- Sanitize `marked()` markdown output; consider disabling raw-HTML in markdown.

Feature note: only the interactive-notebook-HTML case has a real tradeoff; SVG/math/
markdown/text sanitization is effectively invisible.
