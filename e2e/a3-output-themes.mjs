// a3 bug-hunt: notebook OUTPUT rendering readability across themes.
// Opens a deck (theme baked in via E2E_DECK) whose notebook has STORED outputs
// of every kind (stdout, stderr, error/traceback, text/plain, text/html pandas
// table, svg, markdown incl. inline+fenced code). Reads getComputedStyle in the
// REAL WebKit (var() resolves) and asserts each output's text is READABLE against
// the slide background (contrast ratio), catching hardcoded colors that vanish
// on dark/black. E2E_THEME just labels the run.
//
// Kernel-free: outputs are baked into the .ipynb, so no jupyter server needed.
const BASE = process.env.E2E_BASE || 'http://127.0.0.1:4444';
const APP = process.env.E2E_APP, DECK = process.env.E2E_DECK;
const THEME = process.env.E2E_THEME || '?';
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function post(p, b) { const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }); const t = await r.text(); try { return JSON.parse(t) } catch { return t } }
async function execSync(sid, s) { return (await post(`/session/${sid}/execute/sync`, { script: s, args: [] }))?.value }
async function dom(sid) { return String(await execSync(sid, "return document.body?document.body.textContent:''") || ''); }
async function open() { for (let i = 0; i < 12; i++) { const j = await post('/session', { capabilities: { alwaysMatch: { 'tauri:options': { application: APP, args: [DECK] } } } }); if (j?.value?.sessionId) return j.value.sessionId; await sleep(1000); } return null; }
async function waitSeam(sid) { for (let i = 0; i < 25; i++) { await sleep(800); if (await execSync(sid, "return !!(window.__eigendeck&&window.__eigendeck.store.getState().projectPath)")) return true; } return false; }
async function pollDom(sid, needle, ms = 20000) { for (let t = 0; t < ms; t += 500) { if ((await dom(sid)).includes(needle)) return true; await sleep(500); } return false; }
const fail = (m) => { console.error(`A3THEME_FAIL[${THEME}] ` + m); process.exit(1); };

// sRGB relative luminance + WCAG contrast ratio.
function parseRGB(s) { const m = String(s).match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(',').map(x => parseFloat(x)); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; }
function lum({ r, g, b }) { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); }
function contrast(fg, bg) { const L1 = lum(fg), L2 = lum(bg); const a = Math.max(L1, L2), b = Math.min(L1, L2); return (a + 0.05) / (b + 0.05); }
// If fg has alpha < 1, composite it over bg first (translucent text on a panel).
function composite(fg, bg) { const a = fg.a ?? 1; if (a >= 1) return fg; return { r: fg.r * a + bg.r * (1 - a), g: fg.g * a + bg.g * (1 - a), b: fg.b * a + bg.b * (1 - a) }; }

const MIN_CONTRAST = 2.5;   // generous floor: below this text is effectively unreadable

(async () => {
  const sid = await open(); if (!sid) fail('no session');
  if (!await waitSeam(sid)) fail('no seam');
  if (!await pollDom(sid, 'STDOUT_LINE')) fail('notebook outputs never rendered (no STDOUT_LINE)');
  // Wait for async-sanitized blocks (pandas table, svg) + markdown (marked).
  await pollDom(sid, 'PANDAS_CELL', 8000);
  await pollDom(sid, 'MD_HEADING', 8000);
  await sleep(800);

  // For each target, return computed color + the EFFECTIVE background it sits on
  // (walk up until a non-transparent bg). The probe composites + computes contrast.
  const probe = await execSync(sid, `
    function effBg(el){
      let n = el;
      while(n){
        const c = getComputedStyle(n).backgroundColor;
        const m = c && c.match(/rgba?\\(([^)]+)\\)/);
        if(m){ const p=m[1].split(',').map(parseFloat); const a=p.length>3?p[3]:1; if(a>0.999) return c; }
        n = n.parentElement;
      }
      // fall back to the slide/frame bg
      const f = document.querySelector('.nb-frame');
      return f ? getComputedStyle(f).backgroundColor : 'rgb(255,255,255)';
    }
    function grab(sel){
      const el = document.querySelector(sel);
      if(!el) return null;
      const cs = getComputedStyle(el);
      return { color: cs.color, bg: effBg(el), text: (el.textContent||'').slice(0,40) };
    }
    // For elements whose OWN bg is a translucent panel (stderr/error), report that too.
    function grabPanel(sel){
      const el = document.querySelector(sel);
      if(!el) return null;
      const cs = getComputedStyle(el);
      return { color: cs.color, ownBg: cs.backgroundColor, bg: effBg(el.parentElement||el), text:(el.textContent||'').slice(0,40) };
    }
    const frameBg = (function(){ const f=document.querySelector('.nb-frame'); return f?getComputedStyle(f).backgroundColor:null; })();
    return JSON.stringify({
      frameBg,
      stdout:   grab('.nb-stream.nb-stdout'),
      stderr:   grabPanel('.nb-stream.nb-stderr'),
      error:    grabPanel('.nb-error'),
      plain:    grab('.nb-plain'),
      htmlTable:grab('.nb-html'),
      htmlTd:   grab('.nb-html td'),
      svg:      grab('.nb-image svg text') || grab('.nb-image'),
      mdHeading:grab('.nb-markdown h1'),
      mdBody:   grab('.nb-markdown p'),
      mdInline: grab('.nb-markdown p code'),
      mdFenced: grab('.nb-markdown pre'),
      prompt:   grab('.nb-cell-prompt'),
    });
  `);
  if (!probe) fail('probe script returned nothing');
  let data; try { data = JSON.parse(probe); } catch (e) { fail('bad probe json: ' + probe); }

  const frameBg = parseRGB(data.frameBg) || { r: 255, g: 255, b: 255, a: 1 };
  const results = [];
  const bugs = [];
  // The exec-count prompt gutter (.nb-cell-prompt) is INTENTIONALLY faint (a hint
  // to the presenter, per notebook.css) and is not "output" — exclude it from the
  // readability gate so a legit design choice isn't flagged as a bug.
  const SKIP = new Set(['prompt']);
  for (const [k, v] of Object.entries(data)) {
    if (k === 'frameBg' || SKIP.has(k) || !v || !v.color) continue;
    const fg = parseRGB(v.color);
    if (!fg) { results.push(`${k}: UNPARSEABLE color ${v.color}`); continue; }
    // Background the text visually sits on. For panels use own translucent bg over frame.
    let bg;
    if (v.ownBg) {
      const own = parseRGB(v.ownBg);
      const under = parseRGB(v.bg) || frameBg;
      bg = own && (own.a ?? 1) < 1 ? composite(own, under) : (own || under);
    } else {
      bg = parseRGB(v.bg) || frameBg;
    }
    const fgc = composite(fg, bg);
    const cr = contrast(fgc, bg);
    const tag = cr < MIN_CONTRAST ? 'LOW-CONTRAST' : 'ok';
    results.push(`${k}: color=${v.color} bg~=rgb(${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)}) contrast=${cr.toFixed(2)} ${tag}`);
    if (cr < MIN_CONTRAST) bugs.push({ k, color: v.color, contrast: cr.toFixed(2), bg: `rgb(${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)})`, text: v.text });
  }

  console.log(`A3THEME_REPORT[${THEME}] frameBg=${data.frameBg}`);
  for (const line of results) console.log('  ' + line);

  await fetch(`${BASE}/session/${sid}`, { method: 'DELETE' }).catch(() => {});
  if (bugs.length) {
    console.error(`A3THEME_FAIL[${THEME}] ${bugs.length} low-contrast output(s):`);
    for (const b of bugs) console.error(`  ${b.k}: ${b.color} on ${b.bg} => contrast ${b.contrast} (text="${b.text}")`);
    process.exit(1);
  }
  console.log(`A3THEME_PASS[${THEME}] all notebook outputs readable`);
  process.exit(0);
})();
