// HTML-escape a string for embedding in an iframe `srcdoc` attribute. Security-
// relevant (it's what keeps demo/notebook HTML from breaking out of the srcdoc),
// so it lives in ONE place — shared by the HTML export (exportCore.mjs) and the
// notebook export (notebookExport.tsx), which each used to keep their own copy.
export function htmlEscapeForSrcdoc(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
