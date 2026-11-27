// #208 in the REAL app: the "Typeset math" setting (deck → element) and the \$ escape,
// across the editor, the inspector, present mode and the HTML export.
// Deck (fixtures/typeset-math-deck.json, deck typesetMath: true):
//   tm-off  typesetMath:false  "He got a $5 million and $6 million grant."
//   tm-esc  (default)          "It costs \$5, and the slope is $m$."
//   tm-deck (default)          "Energy $x^2 + y^2$ here."
//   tm-on   typesetMath:true   "Always $\lambda_1$ math."
import { openApp, waitSeam, exec, execA, sleep, quit } from './_ui.mjs';
const APP = process.env.E2E_APP, DECK = process.env.E2E_DECK;
const fail = (m) => { console.error('TYPESET_MATH_FAIL:', m); process.exit(1); };

const sid = await openApp(APP, DECK); if (!sid || !await waitSeam(sid)) fail('open/seam');

// Per element: does it hold typeset math (MathJax glyphs carry data-c), and its text.
const state = async (root = '') => JSON.parse(await exec(sid, `
  const out = {};
  for (const id of ['tm-off', 'tm-esc', 'tm-deck', 'tm-on']) {
    const el = document.querySelector('${root} [data-element-id="' + id + '"]');
    out[id] = el ? { math: el.querySelectorAll('[data-c]').length > 0, text: el.textContent.replace(/\\s+/g, ' ').trim() } : null;
  }
  return JSON.stringify(out);`));
const waitFor = async (pred, what, root = '') => {
  let s = null;
  for (let i = 0; i < 40; i++) { s = await state(root); if (pred(s)) return s; await sleep(250); }
  fail(`${what}; last state ${JSON.stringify(s)}`);
};
const expectText = (s, id, sub) => { if (!s[id] || !s[id].text.includes(sub)) fail(`${id} should show ${JSON.stringify(sub)}; got ${JSON.stringify(s[id] && s[id].text)}`); };

// 1. Deck typesets. tm-off is literal; the escaped dollar shows as "$" with $m$ typeset.
let s = await waitFor((s) => s['tm-esc']?.math && s['tm-deck']?.math && s['tm-on']?.math, 'math never rendered in the editor');
if (s['tm-off'].math) fail('tm-off (typesetMath:false) typeset math in the editor');
expectText(s, 'tm-off', 'He got a $5 million and $6 million grant.');
expectText(s, 'tm-esc', 'It costs $5, and the slope is');
if (s['tm-esc'].text.includes('\\')) fail(`tm-esc shows the backslash of its \\$ escape: ${s['tm-esc'].text}`);
console.log('  ✓ editor: element override, \\$ escape and deck default');

// 2. Turn the deck off: default elements go literal, the explicit "yes" keeps typesetting.
await exec(sid, "window.__eigendeck.store.getState().updateConfig({ typesetMath: false }); return 1;");
s = await waitFor((s) => !s['tm-deck'].math && !s['tm-esc'].math, 'deck typesetMath:false did not stop default elements typesetting');
if (!s['tm-on'].math) fail('tm-on (typesetMath:true) stopped typesetting when the deck was turned off');
expectText(s, 'tm-deck', 'Energy $x^2 + y^2$ here.');
expectText(s, 'tm-esc', 'It costs $5, and the slope is $m$.');
console.log('  ✓ editor: deck switch respected, element "yes" still typesets');

// 3. The inspector shows the resolved default for a box without its own value.
const label = await exec(sid, `
  window.__eigendeck.store.getState().selectObject({ type: 'element', id: 'tm-deck' });
  return 1;`) && await (async () => {
  for (let i = 0; i < 20; i++) {
    const v = await exec(sid, `const sel = document.querySelector('select[aria-label="Typeset math in this text box"]');
      return sel ? sel.value + '|' + sel.options[sel.selectedIndex].text : '';`);
    if (v) return v; await sleep(250);
  }
  return '';
})();
if (label !== 'default|Default (no)') fail(`element inspector should read "Default (no)"; got ${JSON.stringify(label)}`);
console.log('  ✓ inspector: Default (no)');

// 4. Present mode follows the same rules.
await exec(sid, "window.__eigendeck.store.getState().setPresenting(true); return 1;");
const pres = JSON.parse(await (async () => {
  for (let i = 0; i < 40; i++) {
    const v = await exec(sid, `const r = document.querySelector('.present-mode'); if (!r) return '';
      const t = r.textContent.replace(/\\s+/g, ' ');
      return t.includes('Energy') ? JSON.stringify({ text: t, math: r.querySelectorAll('[data-c]').length }) : '';`);
    if (v) return v; await sleep(250);
  }
  return JSON.stringify({ text: '', math: 0 });
})());
await exec(sid, "window.__eigendeck.store.getState().setPresenting(false); return 1;");
for (const sub of ['He got a $5 million and $6 million grant.', 'Energy $x^2 + y^2$ here.', 'It costs $5, and the slope is $m$.']) {
  if (!pres.text.includes(sub)) fail(`present mode should show ${JSON.stringify(sub)}; got ${JSON.stringify(pres.text.slice(0, 300))}`);
}
if (pres.math === 0) fail('present mode typeset no math at all (tm-on should still typeset)');
console.log('  ✓ present: literal dollars, tm-on typeset');

// 5. HTML export: literal dollars are exported as &#36;, never as math or a stray backslash.
const html = String(await execA(sid, `const done = arguments[arguments.length - 1];
  window.__eigendeck.exportHtml().then((h) => done(typeof h === 'string' ? h : JSON.stringify(h)), (e) => done('ERR ' + e));`));
if (html.startsWith('ERR')) fail(`export failed: ${html}`);
for (const sub of ['He got a &#36;5 million and &#36;6 million grant.', 'It costs &#36;5, and the slope is &#36;m&#36;.']) {
  if (!html.includes(sub)) fail(`export should contain ${JSON.stringify(sub)}`);
}
// The embedded source deck (<script id="eigendeck-deck">, for re-import) rightly keeps
// the \$ escape; the RENDERED slides must not show it.
const rendered = html.replace(/<script type="application\/json" id="eigendeck-deck">[\s\S]*?<\/script>/, '');
if (rendered.includes('\\$5')) fail('the rendered export shows the raw \\$ escape');
if (!/id="eigendeck-deck">[\s\S]*It costs \\\\\$5/.test(html)) fail('the embedded source deck lost the \\$ escape (re-import would change the text)');
console.log('  ✓ export: literal dollars');

await quit(sid);
console.log('TYPESET_MATH_PASS: element/deck setting and \\$ escape hold in the editor, inspector, present mode and HTML export');
process.exit(0);
