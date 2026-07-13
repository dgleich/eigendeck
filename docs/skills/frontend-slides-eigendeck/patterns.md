# Slide patterns (copy-paste)

Ready-to-use slide bodies for the `html` element. Each is the FULL `html` field:
an inline `<style>` + the markup, authored at **1920×1080**, self-contained (system
fonts, CSS gradients, inline SVG — no script, no network). Share one palette across
the deck via the `:root` custom properties. Reusable keyframes are at the bottom —
paste them into each slide's `<style>` (or repeat; iframes don't share styles).

Font stacks that read as "designed" without a web font:
- Display/sans: `system-ui, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`
- Editorial serif: `'Iowan Old Style', 'Palatino Linotype', Georgia, serif`
- Mono/code: `ui-monospace, 'SF Mono', 'Cascadia Code', Menlo, monospace`
For a specific brand face, embed it as a `data:` URI — see `fonts.md`.

---

## Hero

```html
<style>
  :root{--bg:#0a0a0f;--accent:#7c3aed;--accent2:#ec4899;--muted:#94a3b8}
  *{margin:0;box-sizing:border-box}
  .slide{height:100%;background:radial-gradient(circle at 18% 20%,#211b4e,transparent 55%),var(--bg);
    color:#fff;font-family:system-ui,sans-serif;display:flex;flex-direction:column;justify-content:center;
    padding:130px;position:relative;overflow:hidden}
  .aurora{position:absolute;inset:-45%;background:conic-gradient(from 0deg,var(--accent),var(--accent2),#38bdf8,var(--accent));
    filter:blur(130px);opacity:.4;animation:spin 20s linear infinite}
  .kicker{font-size:28px;letter-spacing:.32em;text-transform:uppercase;color:var(--accent2);font-weight:700;
    position:relative;opacity:0;transform:translateY(28px);animation:rise .8s .1s forwards}
  h1{font-size:158px;line-height:.94;font-weight:800;letter-spacing:-.03em;position:relative;
    background:linear-gradient(120deg,#fff 30%,#c4b5fd);-webkit-background-clip:text;background-clip:text;color:transparent;
    opacity:0;transform:translateY(28px);animation:rise .9s .25s forwards}
  p{font-size:34px;line-height:1.4;color:var(--muted);max-width:64%;margin-top:34px;position:relative;
    opacity:0;transform:translateY(28px);animation:rise .9s .4s forwards}
  @keyframes spin{to{transform:rotate(360deg)}}
  @keyframes rise{to{opacity:1;transform:none}}
</style>
<div class="slide"><div class="aurora"></div>
  <div class="kicker">Your kicker</div>
  <h1>Big bold<br>headline.</h1>
  <p>One-sentence subtitle that sets up the talk.</p>
</div>
```

## Section divider

```html
<style>
  :root{--bg:#0a0a0f;--accent:#7c3aed}
  *{margin:0;box-sizing:border-box}
  .slide{height:100%;background:var(--bg);color:#fff;font-family:system-ui,sans-serif;
    display:flex;align-items:center;gap:60px;padding:130px;position:relative;overflow:hidden}
  .num{font-size:340px;font-weight:800;line-height:1;letter-spacing:-.04em;
    background:linear-gradient(160deg,var(--accent),#38bdf8);-webkit-background-clip:text;background-clip:text;color:transparent;opacity:.9}
  .t{font-size:96px;font-weight:800;letter-spacing:-.02em}
  .t small{display:block;font-size:30px;font-weight:600;letter-spacing:.2em;text-transform:uppercase;color:#64748b;margin-bottom:18px}
</style>
<div class="slide"><div class="num">02</div>
  <div class="t"><small>Part two</small>How it works</div>
</div>
```

## Stat grid (3-up)

```html
<style>
  :root{--bg:#0a0a0f;--accent:#22d3ee;--muted:#94a3b8}
  *{margin:0;box-sizing:border-box}
  .slide{height:100%;background:var(--bg);color:#fff;font-family:system-ui,sans-serif;
    display:flex;flex-direction:column;justify-content:center;padding:120px;gap:56px}
  h2{font-size:84px;font-weight:800;letter-spacing:-.02em}
  .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:36px}
  .card{background:linear-gradient(160deg,#141420,#0d0d16);border:1px solid #24243a;border-radius:28px;
    padding:48px;position:relative;overflow:hidden}
  .card::before{content:'';position:absolute;inset:0 0 auto 0;height:4px;background:linear-gradient(90deg,var(--accent),transparent)}
  .stat{font-size:96px;font-weight:800;letter-spacing:-.03em;
    background:linear-gradient(120deg,#fff,var(--accent));-webkit-background-clip:text;background-clip:text;color:transparent}
  .lab{font-size:26px;color:var(--muted);margin-top:10px}
</style>
<div class="slide"><h2>By the numbers</h2>
  <div class="grid">
    <div class="card"><div class="stat">2.4×</div><div class="lab">faster than baseline</div></div>
    <div class="card"><div class="stat">98%</div><div class="lab">cache hit rate</div></div>
    <div class="card"><div class="stat">10 yr</div><div class="lab">a single HTML file lasts</div></div>
  </div>
</div>
```

## Quote

```html
<style>
  :root{--bg:#0a0a0f;--accent:#f472b6}
  *{margin:0;box-sizing:border-box}
  .slide{height:100%;background:radial-gradient(circle at 80% 15%,#2a1030,transparent 50%),var(--bg);
    color:#fff;font-family:'Iowan Old Style',Georgia,serif;display:flex;flex-direction:column;justify-content:center;padding:160px;position:relative}
  .mark{font-size:280px;line-height:.6;color:var(--accent);opacity:.35;font-family:Georgia,serif}
  blockquote{font-size:64px;line-height:1.25;font-weight:500;max-width:80%;margin-top:-40px}
  .by{font-family:system-ui,sans-serif;font-size:28px;color:#94a3b8;margin-top:44px;letter-spacing:.04em}
</style>
<div class="slide"><div class="mark">“</div>
  <blockquote>Dependencies are debt. A single HTML file will work in ten years.</blockquote>
  <div class="by">— design principle</div>
</div>
```

## Comparison table

```html
<style>
  :root{--bg:#0a0a0f;--accent:#34d399}
  *{margin:0;box-sizing:border-box}
  .slide{height:100%;background:var(--bg);color:#e5e7eb;font-family:system-ui,sans-serif;
    display:flex;flex-direction:column;justify-content:center;padding:120px;gap:44px}
  h2{font-size:80px;font-weight:800;letter-spacing:-.02em;color:#fff}
  table{width:100%;border-collapse:collapse;font-size:30px}
  thead th{text-align:left;padding:24px 28px;background:linear-gradient(90deg,#12241d,#0d0d16);
    color:#fff;font-size:24px;letter-spacing:.12em;text-transform:uppercase}
  td{padding:24px 28px;border-top:1px solid #1f2937}
  tbody tr:nth-child(even){background:#0e0e18}
  .win{color:var(--accent);font-weight:700}
  td:not(:first-child){text-align:right;font-variant-numeric:tabular-nums;font-family:ui-monospace,monospace}
</style>
<div class="slide"><h2>Where it lands</h2>
  <table>
    <thead><tr><th>Capability</th><th>Static HTML</th><th>Our element</th></tr></thead>
    <tbody>
      <tr><td>Gradients · SVG · @keyframes</td><td class="win">✓</td><td class="win">✓</td></tr>
      <tr><td>Runs JavaScript</td><td class="win">✓</td><td>— (by design)</td></tr>
      <tr><td>Loads remote fonts/images</td><td class="win">✓</td><td>data: only</td></tr>
      <tr><td>Contained / safe to share</td><td>—</td><td class="win">✓ sandboxed</td></tr>
    </tbody>
  </table>
</div>
```

## Closing

```html
<style>
  :root{--bg:#0a0a0f;--accent:#7c3aed;--accent2:#ec4899}
  *{margin:0;box-sizing:border-box}
  .slide{height:100%;background:var(--bg);color:#fff;font-family:system-ui,sans-serif;
    display:flex;flex-direction:column;align-items:center;justify-content:center;gap:40px;position:relative;overflow:hidden}
  .mesh{position:absolute;inset:0;background:
    radial-gradient(circle at 20% 30%,rgba(124,58,237,.25),transparent 40%),
    radial-gradient(circle at 80% 70%,rgba(236,72,153,.25),transparent 40%);animation:drift 16s ease-in-out infinite alternate}
  h1{font-size:120px;font-weight:800;letter-spacing:-.03em;position:relative;
    background:linear-gradient(120deg,#fff,#c4b5fd);-webkit-background-clip:text;background-clip:text;color:transparent}
  .badges{display:flex;gap:18px;position:relative}
  .b{padding:14px 30px;border:1px solid #2b2b44;border-radius:999px;font-size:24px;color:#cbd5e1}
  @keyframes drift{to{transform:translate(40px,-30px) scale(1.1)}}
</style>
<div class="slide"><div class="mesh"></div>
  <h1>Thank you.</h1>
  <div class="badges"><span class="b">sandboxed</span><span class="b">no script</span><span class="b">no network</span></div>
</div>
```

---

## Reusable keyframes

```css
@keyframes rise{to{opacity:1;transform:none}}         /* entrance: start at opacity:0; translateY(28px) */
@keyframes spin{to{transform:rotate(360deg)}}          /* ambient aurora */
@keyframes drift{to{transform:translate(40px,-30px) scale(1.1)}}
@keyframes shimmer{to{background-position:200% 0}}     /* on a linear-gradient bg, background-size:200% */
```

## Interactive (opt-in) — native controls, no JS

Set `"interactive": true` on the element. Pure-CSS interactivity via `:checked` /
`:hover` / `<details>` / `<input type=range>`. Example — a radio-driven fill (the
thermometer pattern): hidden radios PRECEDE the target (the `~` sibling combinator
only matches following siblings), and `:checked` drives a CSS property:

```html
<style>
  .lv{display:none}
  #a:checked~.stage .fill{height:25%}
  #b:checked~.stage .fill{height:60%}
  #c:checked~.stage .fill{height:95%}
  .fill{transition:height .6s cubic-bezier(.34,1.56,.64,1)}
</style>
<input type="radio" name="lvl" id="a"><input type="radio" name="lvl" id="b" checked><input type="radio" name="lvl" id="c">
<div class="stage">… <div class="fill"></div> …
  <label for="a">low</label><label for="b">mid</label><label for="c">high</label>
</div>
```
