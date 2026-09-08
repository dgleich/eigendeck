#!/usr/bin/env python3
"""
Generate an interlinked HTML coverage visualization of the WHOLE source tree.

Inputs (line-level coverage in lcov format):
  - coverage-e2e/lcov.info        frontend (unified vitest + e2e), SF paths repo-relative (src/...)
  - $HOME/rust-lcov.info (or arg) Rust unit `cargo llvm-cov --lib` output

Output (default: coverage-viz/):
  - index.html          overview: totals, a treemap sized by executable lines &
                        colored by coverage, and a sortable per-file table.
  - files/<mangled>.html   one page per source file: stats + share-of-codebase
                        header, the full source with every line colored
                        (grey = non-executable, green = covered, red = uncovered),
                        and clickable import/imported-by links between files.

Line classification:
  covered      line has a DA record with hits > 0        (green)
  uncovered    line has a DA record with hits == 0        (red)
  ineligible   line NOT in the coverage map (comment/blank/type/brace)  (grey)
  A file absent from every lcov is "not instrumented": its code-ish lines are
  counted as uncovered (heuristic), the rest grey, and it's badged as such.

Usage: python3 scripts/gen_coverage_viz.py [rust-lcov.info]
"""
import os, re, html, json, sys
from collections import defaultdict

REPO = os.environ.get("REPO_ROOT", "/work")
OUT = os.path.join(REPO, "coverage-viz")
FILES_DIR = os.path.join(OUT, "files")
FRONT_LCOV = os.path.join(REPO, "coverage-e2e", "lcov.info")
RUST_LCOV = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.expanduser("~"), "rust-lcov.info")

# ── lcov parsing ────────────────────────────────────────────────────────────
def norm_path(p, rust):
    p = p.strip()
    if p.startswith(REPO + "/"):
        p = p[len(REPO) + 1:]
    if rust:
        # llvm-cov may emit crate-relative 'src/lib.rs' or 'src-tauri/src/lib.rs'
        if p.startswith("src-tauri/"):
            return p
        if p.startswith("src/"):
            return "src-tauri/" + p
        # absolute leftovers
        i = p.find("src-tauri/")
        if i >= 0:
            return p[i:]
    return p

def parse_lcov(path, rust=False):
    data = {}
    if not os.path.exists(path):
        return data
    cur = None
    with open(path, errors="replace") as f:
        for line in f:
            line = line.rstrip("\n")
            if line.startswith("SF:"):
                cur = norm_path(line[3:], rust)
                data.setdefault(cur, {})
            elif line.startswith("DA:") and cur is not None:
                a, _, b = line[3:].partition(",")
                try:
                    ln = int(a); hits = int(b.split(",")[0])
                except ValueError:
                    continue
                d = data[cur]
                d[ln] = max(d.get(ln, 0), hits)
            elif line == "end_of_record":
                cur = None
    return data

# ── source universe ─────────────────────────────────────────────────────────
def list_sources():
    files = []
    # frontend
    for root, _, names in os.walk(os.path.join(REPO, "src")):
        for n in names:
            if not n.endswith((".ts", ".tsx", ".mjs")):
                continue
            if ".test." in n or n.endswith((".d.ts", ".d.mts")) or "__mocks__" in root:
                continue
            files.append(os.path.relpath(os.path.join(root, n), REPO))
    # rust
    for root, _, names in os.walk(os.path.join(REPO, "src-tauri", "src")):
        for n in names:
            if n.endswith(".rs"):
                files.append(os.path.relpath(os.path.join(root, n), REPO))
    return sorted(set(files))

CODEISH = re.compile(r"[A-Za-z0-9]")
def is_codeish(s):
    t = s.strip()
    if not t:
        return False
    if t.startswith(("//", "/*", "*", "*/", "#", "///", "//!")):
        return False
    if t in ("{", "}", "(", ")", "};", ");", "},", "],", "]", "[", "})", "});"):
        return False
    return bool(CODEISH.search(t))

def lang_of(path):
    if path.endswith(".rs"):
        return "rust"
    return "ts"

# ── import extraction (interlinking) ────────────────────────────────────────
IMP_RE = re.compile(r"""(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|require\(\s*['"]([^'"]+)['"]\s*\)""")
MOD_RE = re.compile(r"^\s*(?:pub\s+)?mod\s+([A-Za-z0-9_]+)\s*;")
TS_EXTS = [".ts", ".tsx", ".mjs", ".js"]

def resolve_ts(spec, from_path):
    if not spec.startswith("."):
        return None  # bare specifier / package
    base = os.path.normpath(os.path.join(os.path.dirname(from_path), spec))
    cands = [base + e for e in TS_EXTS] + [os.path.join(base, "index" + e) for e in TS_EXTS]
    # allow spec that already has an extension
    cands = [base] + cands
    for c in cands:
        rc = os.path.relpath(os.path.join(REPO, c), REPO) if not os.path.isabs(c) else c
        full = os.path.join(REPO, rc)
        if os.path.isfile(full):
            return rc
    return None

def resolve_mod(name, from_path):
    d = os.path.dirname(from_path)
    for c in (os.path.join(d, name + ".rs"), os.path.join(d, name, "mod.rs")):
        if os.path.isfile(os.path.join(REPO, c)):
            return c
    return None

def extract_imports(path, lines):
    lang = lang_of(path)
    per_line = {}   # line_idx(1-based) -> target relpath
    targets = set()
    if lang == "ts":
        for i, ln in enumerate(lines, 1):
            m = IMP_RE.search(ln)
            if not m:
                continue
            spec = next((g for g in m.groups() if g), None)
            if not spec:
                continue
            tgt = resolve_ts(spec, path)
            if tgt:
                per_line[i] = tgt
                targets.add(tgt)
    else:
        for i, ln in enumerate(lines, 1):
            m = MOD_RE.match(ln)
            if m:
                tgt = resolve_mod(m.group(1), path)
                if tgt:
                    per_line[i] = tgt
                    targets.add(tgt)
    return per_line, targets

# ── build model ─────────────────────────────────────────────────────────────
def mangle(path):
    return path.replace("/", "__").replace(".", "_") + ".html"

def classify(path, cov_map):
    full = os.path.join(REPO, path)
    try:
        with open(full, errors="replace") as f:
            src = f.read().split("\n")
    except OSError:
        src = []
    if src and src[-1] == "":
        src = src[:-1]  # drop trailing empty from final newline
    dam = cov_map.get(path)
    instrumented = dam is not None
    kinds = []   # per line: 'cov' | 'unc' | 'nil'
    covered = uncov = execu = 0
    for i, line in enumerate(src, 1):
        if instrumented:
            if i in dam:
                if dam[i] > 0:
                    kinds.append("cov"); covered += 1; execu += 1
                else:
                    kinds.append("unc"); uncov += 1; execu += 1
            else:
                kinds.append("nil")
        else:
            if is_codeish(line):
                kinds.append("unc"); uncov += 1; execu += 1
            else:
                kinds.append("nil")
    return src, kinds, dict(raw=len(src), execu=execu, covered=covered,
                            uncov=uncov, instrumented=instrumented)

def main():
    cov = {}
    cov.update(parse_lcov(FRONT_LCOV, rust=False))
    cov.update(parse_lcov(RUST_LCOV, rust=True))
    sources = list_sources()
    # include any lcov file that exists on disk but wasn't walked (safety)
    for p in cov:
        if os.path.isfile(os.path.join(REPO, p)) and p not in sources:
            sources.append(p)
    sources = sorted(set(sources))

    os.makedirs(FILES_DIR, exist_ok=True)
    files = {}
    imported_by = defaultdict(set)
    for p in sources:
        src, kinds, st = classify(p, cov)
        per_line, targets = extract_imports(p, src)
        for t in targets:
            imported_by[t].add(p)
        files[p] = dict(src=src, kinds=kinds, st=st, imports=per_line, targets=targets)

    total_raw = sum(f["st"]["raw"] for f in files.values())
    total_exec = sum(f["st"]["execu"] for f in files.values())
    total_cov = sum(f["st"]["covered"] for f in files.values())

    # per-file pages
    for p, f in files.items():
        write_file_page(p, f, imported_by.get(p, set()), files, total_raw)
    write_index(files, imported_by, total_raw, total_exec, total_cov)
    write_css()
    write_js()
    print(f"files: {len(files)}  raw {total_raw}  exec {total_exec}  covered {total_cov} "
          f"({100*total_cov/total_exec:.1f}%)  → {OUT}/index.html")

# ── rendering ────────────────────────────────────────────────────────────────
def pct(c, e):
    return (100.0 * c / e) if e else 0.0

def color_for(frac):
    # red (0) -> amber (.5) -> green (1)
    if frac <= 0.5:
        t = frac / 0.5
        r, g, b = 210, int(60 + 150 * t), 60
    else:
        t = (frac - 0.5) / 0.5
        r, g, b = int(210 - 150 * t), int(210 - 40 * t), 60
    return f"rgb({r},{g},{b})"

def bar_html(st):
    raw = st["raw"] or 1
    cov = st["covered"]; unc = st["uncov"]; nil = raw - cov - unc
    def w(n): return f"{100.0*n/raw:.3f}%"
    return (f'<span class="bar">'
            f'<span class="seg cov" style="width:{w(cov)}"></span>'
            f'<span class="seg unc" style="width:{w(unc)}"></span>'
            f'<span class="seg nil" style="width:{w(nil)}"></span></span>')

def write_file_page(path, f, imported_by, files, total_raw):
    st = f["st"]
    p_html = html.escape(path)
    share = 100.0 * st["raw"] / total_raw if total_raw else 0
    covpct = pct(st["covered"], st["execu"])
    badge = "" if st["instrumented"] else '<span class="badge warn">not instrumented · 0%</span>'
    # imports out
    outs = sorted(set(f["targets"]))
    outs_html = " ".join(f'<a href="{mangle(t)}">{html.escape(os.path.basename(t))}</a>' for t in outs) or "<i>none</i>"
    ins = sorted(imported_by)
    ins_html = " ".join(f'<a href="{mangle(t)}">{html.escape(os.path.basename(t))}</a>' for t in ins) or "<i>none</i>"

    rows = []
    kinds = f["kinds"]; src = f["src"]; imps = f["imports"]
    for i, line in enumerate(src, 1):
        k = kinds[i - 1]
        code = html.escape(line) if line else "&nbsp;"
        link = ""
        if i in imps:
            tgt = imps[i]
            link = f'<a class="jump" href="{mangle(tgt)}" title="{html.escape(tgt)}">→ {html.escape(os.path.basename(tgt))}</a>'
        rows.append(f'<tr class="{k}"><td class="ln">{i}</td><td class="code">{code}{link}</td></tr>')
    body = "\n".join(rows)

    doc = f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{p_html} · coverage</title><link rel="stylesheet" href="../style.css"></head><body>
<header class="fhead">
  <div class="crumb"><a href="../index.html">◂ overview</a></div>
  <h1>{p_html} {badge}</h1>
  <div class="stats">
    <span class="stat"><b>{covpct:.0f}%</b> covered</span>
    <span class="stat">{st['covered']}/{st['execu']} executable</span>
    <span class="stat unc-txt">{st['uncov']} uncovered</span>
    <span class="stat">{st['raw']} raw lines</span>
    <span class="stat">{share:.2f}% of codebase</span>
  </div>
  {bar_html(st)}
  <div class="links"><span>imports:</span> {outs_html}</div>
  <div class="links"><span>imported by:</span> {ins_html}</div>
</header>
<table class="src">{body}</table>
</body></html>"""
    with open(os.path.join(FILES_DIR, mangle(path)), "w") as out:
        out.write(doc)

def write_index(files, imported_by, total_raw, total_exec, total_cov):
    # split fe / rust
    def is_rust(p): return p.startswith("src-tauri/")
    fe = {p: f for p, f in files.items() if not is_rust(p)}
    rs = {p: f for p, f in files.items() if is_rust(p)}
    def agg(d):
        raw = sum(f["st"]["raw"] for f in d.values())
        ex = sum(f["st"]["execu"] for f in d.values())
        cv = sum(f["st"]["covered"] for f in d.values())
        return raw, ex, cv
    fe_raw, fe_ex, fe_cv = agg(fe)
    rs_raw, rs_ex, rs_cv = agg(rs)

    # treemap + table data
    tm = []
    for p, f in files.items():
        st = f["st"]
        if st["execu"] == 0:
            continue
        tm.append(dict(p=p, href="files/" + mangle(p), v=st["execu"],
                       cov=round(pct(st["covered"], st["execu"]) / 100.0, 4),
                       raw=st["raw"], unc=st["uncov"]))
    tm.sort(key=lambda x: -x["v"])

    # directory rollup
    dirs = defaultdict(lambda: [0, 0, 0, 0])  # raw, exec, cov, unc
    for p, f in files.items():
        d = os.path.dirname(p)
        st = f["st"]
        dirs[d][0] += st["raw"]; dirs[d][1] += st["execu"]
        dirs[d][2] += st["covered"]; dirs[d][3] += st["uncov"]
    drows = []
    for d, (raw, ex, cv, un) in sorted(dirs.items(), key=lambda kv: -kv[1][3]):
        drows.append(f'<tr><td class="path">{html.escape(d)}/</td><td>{raw}</td>'
                     f'<td>{ex}</td><td><b>{pct(cv,ex):.0f}%</b></td>'
                     f'<td class="unc-txt">{un}</td></tr>')

    # file table rows
    frows = []
    for x in sorted(files.items(), key=lambda kv: -kv[1]["st"]["uncov"]):
        p, f = x
        st = f["st"]
        cp = pct(st["covered"], st["execu"])
        share = 100.0 * st["raw"] / total_raw if total_raw else 0
        badge = "" if st["instrumented"] else ' <span class="mini-badge">n/i</span>'
        frows.append(
            f'<tr data-unc="{st["uncov"]}" data-cov="{cp:.1f}" data-raw="{st["raw"]}" data-exec="{st["execu"]}">'
            f'<td class="path"><a href="files/{mangle(p)}">{html.escape(p)}</a>{badge}</td>'
            f'<td class="num">{st["raw"]}</td><td class="num">{st["execu"]}</td>'
            f'<td class="num"><b>{cp:.0f}%</b></td><td class="num unc-txt">{st["uncov"]}</td>'
            f'<td class="num">{share:.2f}%</td><td class="barcell">{bar_html(st)}</td></tr>')

    overall = pct(total_cov, total_exec)
    tm_json = json.dumps(tm)
    doc = f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Eigendeck source coverage</title><link rel="stylesheet" href="style.css"></head><body class="index">
<header class="ihead">
  <h1>Eigendeck source coverage</h1>
  <p class="sub">Every source line classified: <span class="key cov">covered</span>,
    <span class="key unc">uncovered</span>, <span class="key nil">non-executable</span>.
    Coverage % is over executable lines only.</p>
  <div class="cards">
    <div class="card big"><div class="pctbig" style="color:{color_for(overall/100)}">{overall:.1f}%</div>
      <div class="lbl">executable lines covered</div>
      <div class="sub2">{total_cov:,} / {total_exec:,} executable · {total_raw:,} raw LOC</div></div>
    <div class="card"><div class="pct">{pct(fe_cv,fe_ex):.1f}%</div><div class="lbl">frontend (TS/TSX)</div>
      <div class="sub2">{fe_cv:,}/{fe_ex:,} exec · {fe_raw:,} LOC</div></div>
    <div class="card"><div class="pct">{pct(rs_cv,rs_ex):.1f}%</div><div class="lbl">Rust</div>
      <div class="sub2">{rs_cv:,}/{rs_ex:,} exec · {rs_raw:,} LOC</div></div>
    <div class="card"><div class="pct unc-txt">{total_exec-total_cov:,}</div><div class="lbl">uncovered exec lines</div>
      <div class="sub2">the red mass below</div></div>
  </div>
</header>

<section>
  <h2>Treemap <span class="hint">— each tile is a file, sized by executable lines, colored by coverage (red → green). Click to open.</span></h2>
  <div id="treemap"></div>
</section>

<section>
  <h2>By directory <span class="hint">— sorted by uncovered lines</span></h2>
  <table class="tbl"><thead><tr><th>directory</th><th>raw</th><th>exec</th><th>cov%</th><th>uncov</th></tr></thead>
  <tbody>{''.join(drows)}</tbody></table>
</section>

<section>
  <h2>By file</h2>
  <div class="sortbar">sort:
    <button data-k="unc" class="on">most uncovered</button>
    <button data-k="cov">lowest %</button>
    <button data-k="raw">largest</button>
    <button data-k="path">path</button></div>
  <table class="tbl files" id="ftbl"><thead><tr><th>file</th><th>raw</th><th>exec</th><th>cov%</th>
    <th>uncov</th><th>share</th><th>coverage</th></tr></thead>
  <tbody>{''.join(frows)}</tbody></table>
</section>

<script>window.TM = {tm_json};</script>
<script src="app.js"></script>
</body></html>"""
    with open(os.path.join(OUT, "index.html"), "w") as out:
        out.write(doc)

def write_css():
    css = """
:root{--bg:#0f1116;--panel:#171a21;--ink:#d6dae2;--mut:#8b93a1;--line:#232833;
  --cov:#2f9e44;--unc:#e03131;--nil:#2b303b;--covbg:#12331d;--uncbg:#3a1414;}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 system-ui,-apple-system,Segoe UI,sans-serif}
a{color:#74b1ff;text-decoration:none}a:hover{text-decoration:underline}
h1{font-size:18px;margin:0 0 6px}h2{font-size:15px;margin:26px 0 10px;font-weight:600}
.hint,.sub{color:var(--mut);font-weight:400;font-size:12.5px}
.unc-txt{color:#ff8787}
/* index */
.index{padding:24px 28px 60px;max-width:1200px;margin:0 auto}
.ihead h1{font-size:22px}
.cards{display:flex;gap:14px;flex-wrap:wrap;margin-top:16px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:14px 18px;min-width:150px}
.card.big{min-width:230px}
.pctbig{font-size:44px;font-weight:800;line-height:1}
.pct{font-size:30px;font-weight:800}
.lbl{color:var(--mut);font-size:12px;margin-top:4px}
.sub2{color:var(--mut);font-size:11.5px;margin-top:6px}
.key{padding:1px 7px;border-radius:5px;font-size:12px}
.key.cov{background:var(--covbg);color:#69db7c}.key.unc{background:var(--uncbg);color:#ff8787}
.key.nil{background:var(--nil);color:var(--mut)}
#treemap{position:relative;width:100%;border:1px solid var(--line);border-radius:8px;overflow:hidden;background:#0b0d12}
.cell{position:absolute;overflow:hidden;border:1px solid rgba(0,0,0,.35);color:#0b0d12;font-size:10.5px;
  display:flex;align-items:flex-start;padding:2px 3px}
.cell span{white-space:nowrap;text-shadow:0 1px 0 rgba(255,255,255,.25);font-weight:600}
.cell:hover{outline:2px solid #fff;z-index:2;text-decoration:none}
.tbl{width:100%;border-collapse:collapse;font-size:12.5px}
.tbl th{text-align:right;color:var(--mut);font-weight:600;border-bottom:1px solid var(--line);padding:6px 8px;position:sticky;top:0;background:var(--bg)}
.tbl th:first-child{text-align:left}
.tbl td{padding:5px 8px;border-bottom:1px solid #1c212b}
.tbl td.path,.tbl td.path a{text-align:left}
.tbl .num{text-align:right;font-variant-numeric:tabular-nums}
.mini-badge{background:#3a2a10;color:#ffb861;font-size:10px;padding:0 5px;border-radius:4px}
.sortbar{color:var(--mut);font-size:12px;margin-bottom:8px}
.sortbar button{background:var(--panel);color:var(--ink);border:1px solid var(--line);border-radius:6px;
  padding:3px 9px;margin-left:6px;cursor:pointer;font-size:12px}
.sortbar button.on{border-color:#74b1ff;color:#cfe0ff}
.barcell{width:200px}
.bar{display:inline-flex;width:100%;height:11px;border-radius:3px;overflow:hidden;background:var(--nil);vertical-align:middle}
.seg{display:inline-block;height:100%}.seg.cov{background:var(--cov)}.seg.unc{background:var(--unc)}.seg.nil{background:transparent}
/* file page */
.fhead{padding:16px 20px;border-bottom:1px solid var(--line);position:sticky;top:0;background:var(--bg);z-index:5}
.crumb{font-size:12px;margin-bottom:6px}
.badge{font-size:11px;padding:1px 8px;border-radius:5px;vertical-align:middle}
.badge.warn{background:#3a2a10;color:#ffb861}
.stats{display:flex;gap:16px;flex-wrap:wrap;color:var(--mut);font-size:12.5px;margin:8px 0}
.stat b{color:var(--ink);font-size:14px}
.fhead .bar{max-width:520px;margin:4px 0 10px}
.links{font-size:12px;color:var(--mut);margin-top:3px}.links span{display:inline-block;min-width:92px;color:var(--mut)}
.links a{margin-right:8px}
table.src{border-collapse:collapse;width:100%;font:12.5px/1.55 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
table.src td.ln{width:1%;text-align:right;color:#5a6272;padding:0 12px 0 14px;user-select:none;white-space:nowrap;border-right:1px solid var(--line)}
table.src td.code{padding:0 12px;white-space:pre-wrap;word-break:break-word}
table.src tr.cov td.code{background:var(--covbg)}
table.src tr.unc td.code{background:var(--uncbg)}
table.src tr.cov td.ln{background:rgba(47,158,68,.15)}
table.src tr.unc td.ln{background:rgba(224,49,49,.16);color:#ff8787}
table.src tr.nil td.code{color:#7b8494}
.jump{margin-left:14px;font-size:11px;color:#9aa4ff;background:#1b2030;padding:0 6px;border-radius:4px}
"""
    with open(os.path.join(OUT, "style.css"), "w") as f:
        f.write(css)

JS = r"""
'use strict';
function colorFor(f){
  var r,g,b;
  if(f<=0.5){ var t=f/0.5; r=210; g=Math.round(60+150*t); b=60; }
  else { var t=(f-0.5)/0.5; r=Math.round(210-150*t); g=Math.round(210-40*t); b=60; }
  return 'rgb('+r+','+g+','+b+')';
}
// Canonical squarified treemap (Bruls, Huizing, van Wijk).
// `items` each carry a pre-scaled area `a` (sum(a) == w*h).
function squarify(items, x, y, w, h){
  var res=[], rect={x:x,y:y,w:w,h:h}, row=[], q=items.slice();
  function sum(rw){ var s=0; for(var i=0;i<rw.length;i++) s+=rw[i].a; return s; }
  function worst(rw, side){
    if(!rw.length) return Infinity;
    var s=sum(rw), mx=-Infinity, mn=Infinity;
    for(var i=0;i<rw.length;i++){ var a=rw[i].a; if(a>mx)mx=a; if(a<mn)mn=a; }
    return Math.max(side*side*mx/(s*s), s*s/(side*side*mn));
  }
  function layout(rw, rc){
    var s=sum(rw);
    if(rc.w>=rc.h){
      var cw=s/rc.h, yy=rc.y;
      for(var i=0;i<rw.length;i++){ var dh=rw[i].a/cw; res.push(Object.assign({},rw[i],{x:rc.x,y:yy,w:cw,h:dh})); yy+=dh; }
      return {x:rc.x+cw,y:rc.y,w:rc.w-cw,h:rc.h};
    } else {
      var rh=s/rc.w, xx=rc.x;
      for(var i=0;i<rw.length;i++){ var dw=rw[i].a/rh; res.push(Object.assign({},rw[i],{x:xx,y:rc.y,w:dw,h:rh})); xx+=dw; }
      return {x:rc.x,y:rc.y+rh,w:rc.w,h:rc.h-rh};
    }
  }
  while(q.length){
    var side=Math.min(rect.w,rect.h), d=q[0];
    if(row.length===0){ row.push(d); q.shift(); continue; }
    if(worst(row,side) >= worst(row.concat([d]),side)){ row.push(d); q.shift(); }
    else { rect=layout(row,rect); row=[]; }
  }
  if(row.length) layout(row,rect);
  return res;
}
function drawTreemap(){
  var el=document.getElementById('treemap');
  if(!el) return;
  var W=el.clientWidth||900, H=560;
  el.style.height=H+'px';
  var total=0; for(var i=0;i<TM.length;i++) total+=TM[i].v;
  var scale=(W*H)/total;
  var items=TM.map(function(d){ return Object.assign({},d,{a:d.v*scale}); });
  var laid=squarify(items,0,0,W,H);
  el.innerHTML='';
  for(var i=0;i<laid.length;i++){
    var d=laid[i];
    if(d.w<0.5||d.h<0.5) continue;
    var a=document.createElement('a');
    a.href=d.href; a.className='cell';
    a.title=d.p+'\n'+(d.cov*100).toFixed(0)+'% covered · '+d.unc+' uncovered · '+d.v+' exec lines';
    a.style.cssText='left:'+d.x+'px;top:'+d.y+'px;width:'+d.w+'px;height:'+d.h+'px;background:'+colorFor(d.cov);
    if(d.w>46&&d.h>16){ var s=document.createElement('span'); s.textContent=d.p.split('/').pop(); a.appendChild(s); }
    el.appendChild(a);
  }
}
drawTreemap();
window.addEventListener('resize',function(){ clearTimeout(window._t); window._t=setTimeout(drawTreemap,150); });
// sortable file table
var tb=document.querySelector('#ftbl tbody');
document.querySelectorAll('.sortbar button').forEach(function(b){
  b.onclick=function(){
    document.querySelectorAll('.sortbar button').forEach(function(x){ x.classList.remove('on'); });
    b.classList.add('on');
    var k=b.dataset.k, rows=Array.prototype.slice.call(tb.children);
    rows.sort(function(r1,r2){
      if(k==='path') return r1.querySelector('.path').textContent.localeCompare(r2.querySelector('.path').textContent);
      if(k==='cov') return (+r1.dataset.cov)-(+r2.dataset.cov);
      return (+r2.dataset[k])-(+r1.dataset[k]);
    });
    rows.forEach(function(r){ tb.appendChild(r); });
  };
});
"""

def write_js():
    with open(os.path.join(OUT, "app.js"), "w") as f:
        f.write(JS)

if __name__ == "__main__":
    main()
