#!/usr/bin/env node
/**
 * Eigendeck font setup.
 *
 * Copies MathJax bundles from sibling mathjax-fonts/ repo into public/mathjax/.
 * Clones the repo if missing.
 *
 * The list of expected packages mirrors src/lib/fonts.ts FONT_PACKAGES.
 * The local ptsans bundle is copied from mathjax-ptsans-bundle/ (in-tree)
 * for now, until ptsans is migrated to mathjax-fonts.
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
    return true;
  }
  log(`Cloning mathjax-fonts into ${MATHJAX_FONTS_DIR}...`);
  try {
    execSync(`git clone --depth 1 ${MATHJAX_FONTS_REPO} "${MATHJAX_FONTS_DIR}"`, {
      stdio: 'inherit',
      cwd: SIBLING_PARENT,
    });
    return true;
  } catch (e) {
    log(`WARN: failed to clone mathjax-fonts (${e.message})`);
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
  if (ensureMathjaxFontsRepo()) {
    for (const id of MATHJAX_FONTS_PACKAGES) {
      const filename = `tex-mml-svg-mathjax-${id}-nosre.js`;
      const src = join(MATHJAX_FONTS_DIR, `mathjax-${id}`, filename);
      if (!existsSync(src)) {
        log(`WARN: missing ${id} nosre bundle at ${src} (run build-all-nosre.cjs)`);
        continue;
      }
      copyBundle(src, join(PUBLIC_MATHJAX, filename), id);
    }
  }

  log('Done.');
}

main();
