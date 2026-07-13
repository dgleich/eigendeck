// Assembles every *.html snippet in this directory into a single gallery deck
// (examples-html-elements/gallery.eigendeck) — one small html element per snippet,
// laid out on one slide, so you can view them all in the app. Reproducible:
//
//   node examples-html-elements/build-gallery.mjs
//   E2E_CLI=/path/to/eigendeck-cli node examples-html-elements/build-gallery.mjs
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));

// Fixed slots (slide space 1920×1080) — the thermometer is tall/interactive.
const SLOTS = {
  'thermometer.html': { x: 110, y: 250, width: 470, height: 500 },
  'letter-reveal.html': { x: 640, y: 300, width: 600, height: 300 },
  'progress-ring.html': { x: 1320, y: 260, width: 460, height: 420 },
  'typewriter.html': { x: 110, y: 800, width: 820, height: 200 },
  'shimmer.html': { x: 990, y: 770, width: 810, height: 260 },
};

const files = readdirSync(dir).filter((f) => f.endsWith('.html')).sort();
const elements = [{ id: 't', type: 'text', preset: 'title', html: 'HTML element snippets',
  position: { x: 80, y: 60, width: 1760, height: 110 } }];

for (const f of files) {
  const html = readFileSync(join(dir, f), 'utf8');
  const meta = html.match(/<!--\s*eigendeck-html-element([\s\S]*?)-->/);
  const interactive = !!(meta && /\binteractive\b/.test(meta[1]));
  const slot = SLOTS[f] || { x: 110, y: 250, width: 600, height: 400 };
  elements.push({ id: f.replace('.html', ''), type: 'html', background: 'transparent',
    ...(interactive ? { interactive: true } : {}), position: slot, html });
}

const deck = { title: 'HTML element snippets', theme: 'black',
  config: { width: 1920, height: 1080 },
  slides: [{ id: 's0', layout: 'default', notes: '', theme: 'black', elements }] };

const jsonPath = join(tmpdir(), 'html-el-gallery.json');
writeFileSync(jsonPath, JSON.stringify(deck, null, 2));
const deckPath = join(dir, 'gallery.eigendeck');
const cli = process.env.E2E_CLI
  || ['/tmp/el-target/debug/eigendeck-cli', '/work/src-tauri/target/debug/eigendeck-cli']
    .find((p) => { try { execFileSync(p, ['--help'], { stdio: 'ignore' }); return true; } catch { return false; } });
if (!cli) { console.error('No eigendeck-cli — set E2E_CLI'); process.exit(1); }
try { execFileSync('rm', ['-f', deckPath, `${deckPath}-wal`, `${deckPath}-shm`]); } catch { /* fresh */ }
execFileSync(cli, [deckPath, 'import', 'json', jsonPath], { stdio: 'inherit' });
console.log(`built ${deckPath} from ${files.length} snippets: ${files.join(', ')}`);
