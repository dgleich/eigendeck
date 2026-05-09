#!/usr/bin/env node
/**
 * One-shot script to download text fonts for all packages into public/fonts/<id>/.
 * Run this once when adding/updating fonts; the resulting files are committed
 * to the repo so end users don't need to re-download.
 *
 * Output naming convention:
 *   public/fonts/<id>/regular.{ttf,otf}
 *   public/fonts/<id>/bold.{ttf,otf}
 *   public/fonts/<id>/italic.{ttf,otf}
 *   public/fonts/<id>/bold-italic.{ttf,otf}
 *   public/fonts/<id>/variable.ttf  (variable fonts)
 *   public/fonts/<id>/variable-italic.ttf  (variable italic, if separate file)
 *   public/fonts/<id>/narrow-regular.ttf  (ptsans only)
 *   public/fonts/<id>/narrow-bold.ttf
 */

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const PUBLIC_FONTS = resolve(REPO_ROOT, 'public/fonts');
const TMP = tmpdir();

function log(m) { process.stdout.write(`[fonts] ${m}\n`); }

function curl(url, out) {
  log(`  → ${url.slice(0, 80)}${url.length > 80 ? '...' : ''}`);
  execSync(`curl -sL -o "${out}" "${url}" --max-time 90`, { stdio: 'inherit' });
}

async function downloadDirect(id, files) {
  const dir = join(PUBLIC_FONTS, id);
  mkdirSync(dir, { recursive: true });
  for (const [name, url] of Object.entries(files)) {
    const out = join(dir, name);
    if (existsSync(out)) { log(`  ✓ ${id}/${name} (cached)`); continue; }
    curl(url, out);
    log(`  ✓ ${id}/${name}`);
  }
}

function extractFromZip(id, zipPath, mappings) {
  // mappings: { 'regular.otf': 'path/inside/zip/Foo-Regular.otf', ... }
  const dir = join(PUBLIC_FONTS, id);
  mkdirSync(dir, { recursive: true });
  // Use Python to extract
  const pyScript = `
import zipfile, sys, os
z = zipfile.ZipFile('${zipPath}')
for outname, inname in ${JSON.stringify(mappings)}.items():
    out = os.path.join('${dir}', outname)
    if os.path.exists(out):
        print(f"  ✓ ${id}/{outname} (cached)")
        continue
    try:
        data = z.read(inname)
        with open(out, 'wb') as f:
            f.write(data)
        print(f"  ✓ ${id}/{outname}")
    except KeyError:
        print(f"  ✗ ${id}/{outname} (missing in zip: {inname})", file=sys.stderr)
`;
  execSync(`python3 -c "${pyScript.replace(/"/g, '\\"')}"`, { stdio: 'inherit' });
}

// ============================================================
// Direct downloads (Google Fonts mirror + Shantell Sans github)
// ============================================================

await downloadDirect('ptsans', {
  // Already in public/fonts/ but with old names. Skip (handled below by copy step).
});

await downloadDirect('noto-sans', {
  'variable.ttf': 'https://raw.githubusercontent.com/google/fonts/main/ofl/notosans/NotoSans%5Bwdth%2Cwght%5D.ttf',
  'variable-italic.ttf': 'https://raw.githubusercontent.com/google/fonts/main/ofl/notosans/NotoSans-Italic%5Bwdth%2Cwght%5D.ttf',
  'OFL.txt': 'https://raw.githubusercontent.com/google/fonts/main/ofl/notosans/OFL.txt',
});

await downloadDirect('source-sans', {
  'variable.ttf': 'https://raw.githubusercontent.com/google/fonts/main/ofl/sourcesans3/SourceSans3%5Bwght%5D.ttf',
  'variable-italic.ttf': 'https://raw.githubusercontent.com/google/fonts/main/ofl/sourcesans3/SourceSans3-Italic%5Bwght%5D.ttf',
  'OFL.txt': 'https://raw.githubusercontent.com/google/fonts/main/ofl/sourcesans3/OFL.txt',
});

await downloadDirect('source-code', {
  'variable.ttf': 'https://raw.githubusercontent.com/google/fonts/main/ofl/sourcecodepro/SourceCodePro%5Bwght%5D.ttf',
  'variable-italic.ttf': 'https://raw.githubusercontent.com/google/fonts/main/ofl/sourcecodepro/SourceCodePro-Italic%5Bwght%5D.ttf',
  'OFL.txt': 'https://raw.githubusercontent.com/google/fonts/main/ofl/sourcecodepro/OFL.txt',
});

await downloadDirect('shantell', {
  'variable.ttf': 'https://raw.githubusercontent.com/google/fonts/main/ofl/shantellsans/ShantellSans%5BBNCE%2CINFM%2CSPAC%2Cwght%5D.ttf',
  'variable-italic.ttf': 'https://raw.githubusercontent.com/google/fonts/main/ofl/shantellsans/ShantellSans-Italic%5BBNCE%2CINFM%2CSPAC%2Cwght%5D.ttf',
  'OFL.txt': 'https://raw.githubusercontent.com/google/fonts/main/ofl/shantellsans/OFL.txt',
});

// ============================================================
// Libertinus (zip extraction)
// ============================================================

const libZip = join(TMP, 'libertinus.zip');
if (!existsSync(libZip)) {
  log('Downloading Libertinus zip...');
  curl('https://github.com/alerque/libertinus/releases/download/v7.051/Libertinus-7.051.zip', libZip);
}

extractFromZip('libertinus', libZip, {
  'regular.otf': 'Libertinus-7.051/static/OTF/LibertinusSerif-Regular.otf',
  'bold.otf': 'Libertinus-7.051/static/OTF/LibertinusSerif-Bold.otf',
  'italic.otf': 'Libertinus-7.051/static/OTF/LibertinusSerif-Italic.otf',
  'bold-italic.otf': 'Libertinus-7.051/static/OTF/LibertinusSerif-BoldItalic.otf',
});

extractFromZip('libertinus-sans', libZip, {
  'regular.otf': 'Libertinus-7.051/static/OTF/LibertinusSans-Regular.otf',
  'bold.otf': 'Libertinus-7.051/static/OTF/LibertinusSans-Bold.otf',
  'italic.otf': 'Libertinus-7.051/static/OTF/LibertinusSans-Italic.otf',
  // No BoldItalic in static/OTF — STATUS.md notes mathjax-fonts uses Italic as fallback
});

// ============================================================
// CMU Unicode (zip extraction)
// ============================================================

const cmuZip = join(TMP, 'cmu.zip');
if (!existsSync(cmuZip)) {
  log('Downloading CMU Unicode zip...');
  curl('https://mirrors.ctan.org/fonts/cm-unicode.zip', cmuZip);
}

// CMU Sans Serif (used by lm-sans)
extractFromZip('lm-sans', cmuZip, {
  'regular.otf': 'cm-unicode/fonts/otf/cmunss.otf',
  'bold.otf': 'cm-unicode/fonts/otf/cmunsx.otf',
  'italic.otf': 'cm-unicode/fonts/otf/cmunsi.otf',
  'bold-italic.otf': 'cm-unicode/fonts/otf/cmunso.otf',
});

// CMU Concrete (used by concrete-euler)
extractFromZip('concrete-euler', cmuZip, {
  'regular.otf': 'cm-unicode/fonts/otf/cmunorm.otf',
  'bold.otf': 'cm-unicode/fonts/otf/cmunobx.otf',
  'italic.otf': 'cm-unicode/fonts/otf/cmunoti.otf',
  'bold-italic.otf': 'cm-unicode/fonts/otf/cmunobi.otf',
});

// ============================================================
// PT Sans — copy from existing public/fonts/ to new structure
// ============================================================

const ptDir = join(PUBLIC_FONTS, 'ptsans');
mkdirSync(ptDir, { recursive: true });
const ptMap = {
  'pt-sans-regular.ttf': 'regular.ttf',
  'pt-sans-bold.ttf': 'bold.ttf',
  'pt-sans-italic.ttf': 'italic.ttf',
  'pt-sans-narrow-regular.ttf': 'narrow-regular.ttf',
  'pt-sans-narrow-bold.ttf': 'narrow-bold.ttf',
};
for (const [src, dst] of Object.entries(ptMap)) {
  const srcPath = join(PUBLIC_FONTS, src);
  const dstPath = join(ptDir, dst);
  if (existsSync(srcPath) && !existsSync(dstPath)) {
    writeFileSync(dstPath, readFileSync(srcPath));
    log(`  ✓ ptsans/${dst} (from existing)`);
  } else if (existsSync(dstPath)) {
    log(`  ✓ ptsans/${dst} (cached)`);
  }
}

log('All fonts downloaded.');
