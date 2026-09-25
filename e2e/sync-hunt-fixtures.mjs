// Build the fixture decks used by e2e/sync-hunt-probe.mjs (bug hunt 2026-09-24).
//
//   node e2e/sync-hunt-fixtures.mjs <outdir> [path/to/eigendeck-cli]
//
// Writes <outdir>/{solo,syncgroup,linked}.eigendeck via `eigendeck-cli import json`.
//   solo      S0 [A, B]   S1 [C]   S2 []                     (no sync, no link)
//   syncgroup S0 [G, X]   S1 [G]   S2 [G, Y]   G synced on all three (linkId L)
//   linked    S0 [P]      S1 [Q]   S2 []       P, Q animation-linked (linkId K)
// Every probe run must use a FRESH copy (the probe edits and saves the deck).
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const out = process.argv[2];
if (!out) { console.error('usage: node e2e/sync-hunt-fixtures.mjs <outdir> [eigendeck-cli]'); process.exit(2); }
const cli = process.argv[3] || join(homedir(), 'el-target/debug/eigendeck-cli');
mkdirSync(out, { recursive: true });

const config = { defaultTitleFont: 'lato', defaultBodyFont: 'lato',
  textSizes: { footnote: 24, note: 32, body: 48, title: 62, hype: 48 } };
const T = (id, x, extra = {}) => ({ id, type: 'text', preset: 'textbox', html: `<div>${id}</div>`, verticalAlign: 'top',
  position: { x, y: 100, width: 300, height: 100 }, ...extra });
const decks = {
  solo: [{ id: 'S0', elements: [T('A', 100), T('B', 400)] }, { id: 'S1', elements: [T('C', 100)] }, { id: 'S2', elements: [] }],
  syncgroup: [
    { id: 'S0', elements: [T('G', 100, { syncId: 'G', linkId: 'L' }), T('X', 500)] },
    { id: 'S1', elements: [T('G', 100, { syncId: 'G', linkId: 'L' })] },
    { id: 'S2', elements: [T('G', 100, { syncId: 'G', linkId: 'L' }), T('Y', 600)] },
  ],
  linked: [{ id: 'S0', elements: [T('P', 100, { linkId: 'K' })] }, { id: 'S1', elements: [T('Q', 700, { linkId: 'K' })] }, { id: 'S2', elements: [] }],
};
for (const [name, slides] of Object.entries(decks)) {
  const json = join(out, `${name}.json`), deck = join(out, `${name}.eigendeck`);
  writeFileSync(json, JSON.stringify({ title: name, theme: 'white', config, slides: slides.map((s) => ({ notes: '', ...s })) }));
  if (existsSync(deck)) rmSync(deck);
  execFileSync(cli, [deck, 'import', 'json', json], { stdio: 'inherit' });
}
console.log(`fixtures written to ${out}`);
