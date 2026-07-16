#!/usr/bin/env node
/**
 * Eigendeck font setup.
 *
 * Copies MathJax bundles from sibling mathjax-fonts/ repo into public/mathjax/.
 * Clones the repo if missing.
 *
 * The list of expected packages mirrors src/lib/fonts.ts FONT_PACKAGES.
 * All packages — including PT Sans (the default) — come from mathjax-fonts;
 * the old in-tree mathjax-ptsans-bundle/ is gone.
 */

import { execSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const SIBLING_PARENT = resolve(REPO_ROOT, '..');
// Look for mathjax-fonts as a sibling first, then inside the repo (useful for
// containers/CI where parent dir isn't writable).
const SIBLING_DIR = resolve(SIBLING_PARENT, 'mathjax-fonts');
const IN_REPO_DIR = resolve(REPO_ROOT, 'mathjax-fonts');
const MATHJAX_FONTS_DIR = existsSync(SIBLING_DIR) ? SIBLING_DIR
  : existsSync(IN_REPO_DIR) ? IN_REPO_DIR
  : SIBLING_DIR; // default target if cloning
const PUBLIC_MATHJAX = resolve(REPO_ROOT, 'public/mathjax');

const MATHJAX_FONTS_REPO = 'https://github.com/dgleich/mathjax-fonts.git';
// Pinned commit for reproducible fresh clones. Bump this when moving to a newer
// mathjax-fonts build. An existing sibling clone is used as-is (we only warn if
// its HEAD differs — don't disturb a clone the maintainer develops in).
const MATHJAX_FONTS_COMMIT = '34075ed04fe7db9153772948c2b1e0938fcd63a0';

// Packages to copy from mathjax-fonts. Source is the -nosre.js bundle (no
// SpeechRuleEngine — required for Tauri's restricted WebKit Worker). They are
// copied without renaming, so registry entries reference 'tex-mml-svg-mathjax-<id>-nosre.js'.
// PT Sans (the default) is now sourced here too — migrated off the in-tree
// mathjax-ptsans-bundle so it tracks upstream fixes like everything else.
const MATHJAX_FONTS_PACKAGES = [
  'ptsans',
  'lato',
  'libertinus',
  'libertinus-sans',
  'lm-sans',
  'noto-sans',
  'source-sans',
  'source-code',
  'shantell',
  'concrete-euler',
];

function log(msg) {
  process.stdout.write(`[setup-fonts] ${msg}\n`);
}

function ensureMathjaxFontsRepo() {
  if (existsSync(MATHJAX_FONTS_DIR) && statSync(MATHJAX_FONTS_DIR).isDirectory()) {
    log(`Found mathjax-fonts at ${MATHJAX_FONTS_DIR}`);
    // Use the existing clone as-is (the maintainer may be developing in it), but
    // flag a drift from the pinned commit so reproducible builds are obvious.
    try {
      const head = execSync('git rev-parse HEAD', { cwd: MATHJAX_FONTS_DIR }).toString().trim();
      if (head !== MATHJAX_FONTS_COMMIT) {
        log(`NOTE: mathjax-fonts HEAD ${head.slice(0, 9)} ≠ pinned ${MATHJAX_FONTS_COMMIT.slice(0, 9)} — using the working tree as-is. ` +
            `For the pinned build: (cd "${MATHJAX_FONTS_DIR}" && git checkout ${MATHJAX_FONTS_COMMIT}).`);
      }
    } catch { /* not a git checkout / git unavailable — ignore */ }
    return true;
  }
  log(`Cloning mathjax-fonts @ ${MATHJAX_FONTS_COMMIT.slice(0, 9)} into ${MATHJAX_FONTS_DIR}...`);
  try {
    execSync(`git clone ${MATHJAX_FONTS_REPO} "${MATHJAX_FONTS_DIR}"`, {
      stdio: 'inherit',
      cwd: SIBLING_PARENT,
    });
    execSync(`git checkout ${MATHJAX_FONTS_COMMIT}`, {
      stdio: 'inherit',
      cwd: MATHJAX_FONTS_DIR,
    });
    return true;
  } catch (e) {
    log(`WARN: failed to clone/checkout mathjax-fonts (${e.message})`);
    return false;
  }
}

function copyBundle(src, dest, label) {
  if (!existsSync(src)) {
    log(`WARN: missing ${label} (expected at ${src})`);
    return false;
  }
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(src, dest);
  log(`✓ ${label}`);
  return true;
}

function main() {
  mkdirSync(PUBLIC_MATHJAX, { recursive: true });

  // mathjax-fonts packages — use the -nosre bundles. The full SRE
  // bundles' SpeechRuleEngine startup hangs in iframes (and times out
  // tex2svgPromise calls in the main page too) because it tries to load
  // async resources that the Worker stub can't provide. The nosre builds
  // omit a11y/sre/explorer/menu entirely. They must be built first via:
  //   node mathjax-fonts/mathjax-shantell/build/build-all-nosre.cjs
  //
  // FAIL LOUDLY: every package listed here is REQUIRED. Previously a missing
  // bundle (or a failed clone) only logged a WARN and exited 0 — so a release
  // build would go green and silently ship an app with broken math. Now any
  // missing bundle aborts with a non-zero exit so CI catches it.
  if (!ensureMathjaxFontsRepo()) {
    console.error(`[setup-fonts] FATAL: could not obtain mathjax-fonts (clone failed and no local copy at ${MATHJAX_FONTS_DIR}).`);
    process.exit(1);
  }

  const missing = [];
  for (const id of MATHJAX_FONTS_PACKAGES) {
    const filename = `tex-mml-svg-mathjax-${id}-nosre.js`;
    // New mathjax-fonts layout commits the prebuilt -nosre bundles at the REPO
    // ROOT; older checkouts keep them per-package under mathjax-<id>/. Prefer
    // root, fall back to the subdir.
    const rootSrc = join(MATHJAX_FONTS_DIR, filename);
    const subSrc = join(MATHJAX_FONTS_DIR, `mathjax-${id}`, filename);
    const src = existsSync(rootSrc) ? rootSrc : subSrc;
    if (!existsSync(src) || !copyBundle(src, join(PUBLIC_MATHJAX, filename), id)) {
      missing.push(id);
    }
  }

  if (missing.length) {
    console.error(
      `[setup-fonts] FATAL: ${missing.length} required MathJax bundle(s) missing: ${missing.join(', ')}.\n` +
      `  Each must exist at tex-mml-svg-mathjax-<id>-nosre.js in the mathjax-fonts repo root ` +
      `(or the legacy mathjax-<id>/ subdir). Pull mathjax-fonts (it now commits the ` +
      `prebuilt -nosre bundles), or rebuild via mathjax-shantell/build/build-all-nosre.cjs.`,
    );
    process.exit(1);
  }

  log(`Done — ${MATHJAX_FONTS_PACKAGES.length} MathJax bundles copied.`);

  buildWoff2();
}

// Generate WOFF2 siblings for the bundled TTF/OTF fonts. These shrink the
// demo/export font embed ~60% (opaque-origin demos inline the deck fonts as
// base64 and re-parse them on every mount — docs/perf-report.md, "Demos").
// OPTIONAL: needs uv + fonttools + brotli. If unavailable, src/lib/fonts.ts
// falls back to the raw TTF (larger, still correct), so this must never abort.
function buildWoff2() {
  const tool = join(REPO_ROOT, 'tools', 'build_font_woff2.py');
  if (!existsSync(tool)) return;
  try {
    execSync(`uv run --with fonttools --with brotli "${tool}"`, { stdio: 'inherit', cwd: REPO_ROOT });
  } catch (e) {
    log(`NOTE: skipped WOFF2 font generation (${(e.message || '').split('\n')[0]}). ` +
        `Demo/export fonts fall back to TTF (larger, still correct). Install uv (https://astral.sh/uv) to enable.`);
  }
}

main();
