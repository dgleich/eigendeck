#!/usr/bin/env python3
"""
Generate an interlinked HTML coverage visualization of the WHOLE source tree.

Inputs:
  - coverage-e2e-only/coverage-final.json   frontend e2e Istanbul map (statementMap
      + counts). Build it clean (no vitest fold, which would double the map) with:
      COV_REPORT_DIR=coverage-e2e-only node e2e/coverage-merge.mjs
  - coverage/coverage-final.json            frontend vitest (jsdom) Istanbul map.
      Per file we color from whichever of the two covers it more (coherent, not
      unioned — their statement maps differ).
  - coverage-rust-e2e.lcov (or argv[1])     Rust lcov. For the full picture it is
      the UNION of two llvm-cov runs (concatenate them — parse_lcov merges dup SF
      blocks by max-per-line):
        bash e2e/cli-coverage.sh gitignore/rust-lcov-cli.info   # lib + cli.rs (workflows)
        bash e2e/coverage-run.sh                                # + app invoke-handlers
        cat coverage-rust-e2e.lcov gitignore/rust-lcov-cli.info > coverage-rust-e2e.lcov
      cli.rs comes from the CLI workflows; storage.rs/fscmds.rs from the app e2e;
      lib.rs/clip.rs/pdf.rs stay low (native menu / macOS / pdfium — no headless).

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

Usage: python3 scripts/gen_coverage_viz.py [rust-lcov]   (output: coverage-viz/, gitignored)
"""
import os, re, html, json, sys
from collections import defaultdict

# Repo root = parent of scripts/. REPO_ROOT overrides for out-of-tree runs.
REPO = os.environ.get("REPO_ROOT") or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(REPO, "coverage-viz")
FILES_DIR = os.path.join(OUT, "files")
FRONT_LCOV = os.path.join(REPO, "coverage-e2e", "lcov.info")
# Rust lcov: argv[1], else the file coverage-run.sh writes at the repo root.
RUST_LCOV = sys.argv[1] if len(sys.argv) > 1 else os.path.join(REPO, "coverage-rust-e2e.lcov")

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

def read_src(path):
    try:
        with open(os.path.join(REPO, path), errors="replace") as f:
            src = f.read().split("\n")
    except OSError:
        src = []
    if src and src[-1] == "":
        src = src[:-1]   # drop trailing empty from the final newline
    return src

def snap_to_code(line1, src):
    """The instrumented build remaps statement positions through a line-granular
    source map, so a statement's recorded start often lands on the comment/blank
    line just ABOVE the real code (observed offset +1..+4). Snap forward (then a
    little back) to the nearest code-ish line so coverage colors code, not comments."""
    n = len(src)
    if 1 <= line1 <= n and is_codeish(src[line1 - 1]):
        return line1
    for j in range(line1 + 1, line1 + 6):
        if 1 <= j <= n and is_codeish(src[j - 1]):
            return j
    for j in range(line1 - 1, line1 - 4, -1):
        if 1 <= j <= n and is_codeish(src[j - 1]):
            return j
    return line1

def _mark(status, ln, covered):
    prev = status.get(ln)
    if prev == "cov":            # already fully covered wins
        return
    if covered:
        # a covered hit upgrades unc/part/None -> but if it was unc, it's partial
        status[ln] = "part" if prev in ("unc", "part") else "cov"
    else:
        status[ln] = "part" if prev == "cov" else ("part" if prev == "part" else "unc")

def _span(loc, src, n):
    st = (loc or {}).get("start", {}); en = (loc or {}).get("end", {})
    l0 = st.get("line")
    if l0 is None:
        return None
    l0 = snap_to_code(l0, src)
    l1 = en.get("line")
    if l1 is None or l1 < l0:
        l1 = l0
    return [l0, min(max(l1, l0), n or l0)]

def classify_frontend(path, entry):
    """Color from the Istanbul statementMap/branchMap. Positions are snapped to the
    nearest code line (the build remaps through a line-granular source map), only
    LEAF statements are painted (a statement containing no other — so a covered
    function/block body doesn't paint its whole span green), and comments/blanks
    are gated to grey. A line touched by both a covered and an uncovered unit is
    'partial'."""
    src = read_src(path); n = len(src)
    sm = entry.get("statementMap", {}); s = entry.get("s", {})
    spans = []   # [l0, l1, covered]
    ids = list(sm.keys())
    for sid in ids:
        sp = _span(sm[sid], src, n)
        if sp:
            spans.append([sp[0], sp[1], s.get(sid, 0) > 0])
    # leaf = contains no other statement strictly inside it
    m = len(spans)
    leaves = []
    if m <= 4000:
        for i in range(m):
            a = spans[i]; leaf = True
            for j in range(m):
                if i != j:
                    b0, b1, _ = spans[j]
                    if a[0] <= b0 and b1 <= a[1] and (a[0] < b0 or b1 < a[1]):
                        leaf = False; break
            if leaf:
                leaves.append(a)
    else:
        leaves = spans
    cov_set = set(); unc_set = set()
    for l0, l1, covd in leaves:
        tgt = cov_set if covd else unc_set
        for ln in range(l0, l1 + 1):
            tgt.add(ln)
    kinds = []
    for i, line in enumerate(src, 1):
        incov = i in cov_set; inunc = i in unc_set
        if (not (incov or inunc)) or not is_codeish(line):   # gate comments/blanks
            kinds.append("nil")
        elif incov and inunc:
            kinds.append("part")
        elif incov:
            kinds.append("cov")
        else:
            kinds.append("unc")
    # The NUMBER is the true Istanbul statement coverage (matches vitest/nyc); the
    # line coloring above is illustrative (leaf spans, positions snapped ±lines).
    stmt_tot = sum(1 for sid in sm if sm[sid].get("start", {}).get("line") is not None)
    stmt_cov = sum(1 for sid in sm if s.get(sid, 0) > 0
                   and sm[sid].get("start", {}).get("line") is not None)
    return src, kinds, dict(raw=len(src), execu=stmt_tot, covered=stmt_cov, partial=0,
                            uncov=stmt_tot - stmt_cov, instrumented=True, metric="statements")

def classify_rust(path, dam):
    """Rust llvm-cov line counts are region-precise, so use them directly. A line
    like `)?;` reading 0 means the `?` error path was never taken — real info."""
    src = read_src(path)
    instrumented = dam is not None
    kinds = []
    for i, line in enumerate(src, 1):
        code = is_codeish(line)
        if instrumented and i in dam and code:   # gate: never COLOR a comment/blank/brace
            kinds.append("cov" if dam[i] > 0 else "unc")
        elif instrumented:
            kinds.append("nil")
        elif code:
            kinds.append("unc")                  # not instrumented at all -> all code red
        else:
            kinds.append("nil")
    # NUMBER matches llvm-cov exactly (all DA lines, not the gated colored subset);
    # the coloring above just keeps brace/comment lines neutral.
    if instrumented:
        execu = len(dam); cov = sum(1 for v in dam.values() if v > 0)
    else:
        execu = sum(1 for k in kinds if k in ("cov", "unc")); cov = 0
    return src, kinds, dict(raw=len(src), execu=execu, covered=cov, partial=0,
                            uncov=execu - cov, instrumented=instrumented, metric="lines")

def classify(path, ist, rust_da):
    if lang_of(path) == "rust":
        return classify_rust(path, rust_da.get(path))
    entry = ist.get(path)
    if entry is not None:
        return classify_frontend(path, entry)
    # frontend file never loaded by any test: heuristic all-red
    src = read_src(path)
    kinds = []; unc = 0
    for line in src:
        if is_codeish(line):
            kinds.append("unc"); unc += 1
        else:
            kinds.append("nil")
    return src, kinds, dict(raw=len(src), execu=unc, covered=0, partial=0,
                            uncov=unc, instrumented=False, metric="line")

def _load_ist_json(relpath):
    import json as _json
    p = os.path.join(REPO, relpath)
    if not os.path.exists(p):
        return {}
    raw = _json.load(open(p, errors="replace"))
    out = {}
    for k, v in raw.items():
        rk = k[len(REPO) + 1:] if k.startswith(REPO + "/") else k
        out[rk] = v
    return out

def _ncov(entry):
    s = entry.get("s", {})
    return sum(1 for i in s if s[i] > 0)

def load_istanbul():
    """Per file, pick the more-covering of two COHERENT single-instrumentation maps:
    the e2e run (coverage-e2e-only, all 169 page maps share one statement map, so
    they sum cleanly) and the vitest unit run. We must NOT union them at the
    statement level — their statement maps differ, so istanbul concatenates rather
    than sums, doubling the map and smearing vitest's ~0%-covered app statements
    over everything. App/render files win from e2e; pure-logic utils from vitest."""
    e2e = _load_ist_json(os.path.join("coverage-e2e-only", "coverage-final.json"))
    vit = _load_ist_json(os.path.join("coverage", "coverage-final.json"))
    out = {}
    for k in set(e2e) | set(vit):
        a, b = e2e.get(k), vit.get(k)
        if a and b:
            out[k] = a if _ncov(a) >= _ncov(b) else b
        else:
            out[k] = a or b
    return out

def main():
    ist = load_istanbul()                        # frontend statement maps (exact)
    rust_da = parse_lcov(RUST_LCOV, rust=True)    # rust llvm-cov line counts (precise)
    sources = list_sources()
    for p in list(ist) + list(rust_da):
        if os.path.isfile(os.path.join(REPO, p)) and p not in sources:
            sources.append(p)
    sources = sorted(set(sources))

    os.makedirs(FILES_DIR, exist_ok=True)
    files = {}
    imported_by = defaultdict(set)
    for p in sources:
        src, kinds, st = classify(p, ist, rust_da)
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
    # Bar is a pure coverage ratio over executable units (matches the %).
    ex = st["execu"] or 1
    cov = st["covered"]; part = st.get("partial", 0); unc = ex - cov - part
    def w(n): return f"{100.0*n/ex:.3f}%"
    return (f'<span class="bar">'
            f'<span class="seg cov" style="width:{w(cov)}"></span>'
            f'<span class="seg part" style="width:{w(part)}"></span>'
            f'<span class="seg unc" style="width:{w(unc)}"></span></span>')

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
    <span class="stat">{st['covered']}/{st['execu']} {st.get('metric','units')}</span>
    <span class="stat unc-txt">{st['uncov']} uncovered</span>
    <span class="stat">{st['raw']} raw lines</span>
    <span class="stat">{share:.2f}% of codebase</span>
  </div>
  {bar_html(st)}
  <div class="metricnote">{'Istanbul <b>statement</b> coverage (exact). Line colors are illustrative — positions snapped ±lines; comments/blanks are grey.' if st.get('metric')=='statements' else 'llvm-cov <b>line</b> coverage (region-precise). A red <code>)?;</code> = the <code>?</code> error path was never taken.'}</div>
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
    <span class="key part">partial</span>, <span class="key unc">uncovered</span>,
    <span class="key nil">non-executable</span>. Coverage % is over executable lines only.</p>
  <p class="sub">Frontend lines are colored from the Istanbul <b>statement map</b>
    (exact counts; positions snapped to the nearest code line, since the instrumented
    build remaps through a line-granular source map). Rust lines are llvm-cov
    region-precise — a red <code>)?;</code> means the <code>?</code> error path was
    never taken. The per-file % is exact; individual line positions on the frontend
    are approximate.</p>
  <div class="cards">
    <div class="card big"><div class="pctbig" style="color:{color_for(overall/100)}">{overall:.1f}%</div>
      <div class="lbl">executable units covered</div>
      <div class="sub2">{total_cov:,} / {total_exec:,} units · {total_raw:,} raw LOC<br>
        <span class="tiny">frontend = statements, Rust = lines</span></div></div>
    <div class="card"><div class="pct">{pct(fe_cv,fe_ex):.1f}%</div><div class="lbl">frontend statements</div>
      <div class="sub2">{fe_cv:,}/{fe_ex:,} stmts · {fe_raw:,} LOC</div></div>
    <div class="card"><div class="pct">{pct(rs_cv,rs_ex):.1f}%</div><div class="lbl">Rust lines</div>
      <div class="sub2">{rs_cv:,}/{rs_ex:,} lines · {rs_raw:,} LOC</div></div>
    <div class="card"><div class="pct unc-txt">{total_exec-total_cov:,}</div><div class="lbl">uncovered units</div>
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
  --cov:#2f9e44;--unc:#e03131;--part:#d9a520;--nil:#2b303b;
  --covbg:#12331d;--uncbg:#3a1414;--partbg:#37300f;}
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
.key.part{background:var(--partbg);color:#f2c94c}.key.nil{background:var(--nil);color:var(--mut)}
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
.seg{display:inline-block;height:100%}.seg.cov{background:var(--cov)}.seg.part{background:var(--part)}.seg.unc{background:var(--unc)}.seg.nil{background:transparent}
/* file page */
.fhead{padding:16px 20px;border-bottom:1px solid var(--line);position:sticky;top:0;background:var(--bg);z-index:5}
.crumb{font-size:12px;margin-bottom:6px}
.badge{font-size:11px;padding:1px 8px;border-radius:5px;vertical-align:middle}
.badge.warn{background:#3a2a10;color:#ffb861}
.stats{display:flex;gap:16px;flex-wrap:wrap;color:var(--mut);font-size:12.5px;margin:8px 0}
.stat b{color:var(--ink);font-size:14px}
.metricnote{color:var(--mut);font-size:11.5px;margin:6px 0 2px}
.metricnote code{background:#20242e;padding:0 4px;border-radius:3px}
.tiny{font-size:10.5px;color:var(--mut)}
.fhead .bar{max-width:520px;margin:4px 0 10px}
.links{font-size:12px;color:var(--mut);margin-top:3px}.links span{display:inline-block;min-width:92px;color:var(--mut)}
.links a{margin-right:8px}
table.src{border-collapse:collapse;width:100%;font:12.5px/1.55 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
table.src td.ln{width:1%;text-align:right;color:#5a6272;padding:0 12px 0 14px;user-select:none;white-space:nowrap;border-right:1px solid var(--line)}
table.src td.code{padding:0 12px;white-space:pre-wrap;word-break:break-word}
table.src tr.cov td.code{background:var(--covbg)}
table.src tr.unc td.code{background:var(--uncbg)}
table.src tr.part td.code{background:var(--partbg)}
table.src tr.cov td.ln{background:rgba(47,158,68,.15)}
table.src tr.unc td.ln{background:rgba(224,49,49,.16);color:#ff8787}
table.src tr.part td.ln{background:rgba(217,165,32,.16);color:#f2c94c}
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
    a.title=d.p+'\n'+(d.cov*100).toFixed(0)+'% covered · '+d.unc+' uncovered · '+d.v+' units';
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
