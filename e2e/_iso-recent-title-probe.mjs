// Repro/verify: changing the title + saving should update the recent-projects
// entry's title (localStorage 'eigendeck-recent-projects'), not keep the open-time one.
import { openApp, waitSeam, exec, execA, sleep, quit } from './_ui.mjs';
const APP = process.env.E2E_APP, DECK = process.env.E2E_DECK;
const NEW = 'RECENT_TITLE_MARKER';

const sid = await openApp(APP, DECK); if (!sid || !await waitSeam(sid)) { console.error('open'); process.exit(1); }
const path = await exec(sid, "return window.__eigendeck.store.getState().projectPath");
await exec(sid, `window.__eigendeck.store.getState().setTitle(${JSON.stringify(NEW)});`);
const saved = await execA(sid, "const d=arguments[arguments.length-1];window.__eigendeck.save().then(()=>d('ok')).catch(e=>d('ERR'+String(e)));");
await sleep(400);
// dump the whole recent list + find the entry for this deck (keyed by FULL path)
const dump = await exec(sid, `
  const list = JSON.parse(localStorage.getItem('eigendeck-recent-projects') || '[]');
  const full = window.__eigendeck.store.getState().projectPath + '.eigendeck';
  const base = full.split('/').pop();
  return JSON.stringify({
    all: list.map(r => ({ path: r.path, title: r.title })),
    full,
    entryTitle: (list.find(r => r.path === full) || {}).title ?? '__NO_ENTRY__',
    dupes: list.filter(r => (r.path.split('/').pop()) === base).length,
  });`);
await quit(sid);
const d = JSON.parse(dump);
console.log(`save=${saved} projectPath=${JSON.stringify(path)}`);
console.log('recent list:', JSON.stringify(d.all));
if (d.entryTitle !== NEW) { console.error(`RECENT_FAIL: entry at ${d.full} has title ${JSON.stringify(d.entryTitle)}, expected ${JSON.stringify(NEW)}`); process.exit(2); }
if (d.dupes !== 1) { console.error(`RECENT_FAIL: expected exactly 1 recent entry for the deck, found ${d.dupes} (duplicate?)`); process.exit(3); }
console.log('RECENT_PASS: save updates the recent entry title (full-path key, no duplicate)');
process.exit(0);
