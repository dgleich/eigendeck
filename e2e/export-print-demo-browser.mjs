// #109 FUNCTIONAL check (real browser): open the interactive HTML export in
// headless chromium and prove the LIVE demo actually boots and runs WITH the
// print layer present — the thing David flagged ("does the printable HTML break
// the demos?"). The export's demo iframe is sandboxed opaque-origin and posts
// {type:'demo-report',text:'DEMO-RAN'} to its parent (the top export document);
// a listener on the top window receives it. We also poke every iframe with
// {type:'request-demo-report'} in case the boot-time post fired before we listened.
//
// Not part of run-all.sh (that gate is WebKitGTK-only); run standalone after
// producing the export via export-print-demo-probe.mjs:
//   node e2e/export-print-demo-browser.mjs /tmp/export-print-demo.html
import { chromium } from '/home/claude/.npm/_npx/9833c18b2d85bc59/node_modules/playwright/index.mjs';

const file = process.argv[2] || '/tmp/export-print-demo.html';
const url = 'file://' + file;
const fail = m => { console.error('BROWSERDEMO_FAIL:', m); process.exit(1); };

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--no-sandbox'] });
const page = await browser.newPage();
const consoleErrs = [];
page.on('console', m => { if (m.type() === 'error') consoleErrs.push(m.text()); });
page.on('pageerror', e => consoleErrs.push('pageerror: ' + e.message));

// Install the collector BEFORE any script runs, so a boot-time demo-report isn't missed.
await page.addInitScript(() => {
  window.__reports = [];
  window.addEventListener('message', e => {
    const d = e.data;
    if (d && d.__eigendeck === 1 && d.type === 'demo-report') window.__reports.push(String(d.text));
  });
});
await page.goto(url, { waitUntil: 'load' });

// The export shows only the active slide; our demo is on slide 1 (already active).
// Give the sandboxed iframe time to boot, then request a fresh report as a fallback.
let reports = [];
for (let i = 0; i < 20; i++) {
  await page.waitForTimeout(300);
  reports = await page.evaluate(() => {
    document.querySelectorAll('#viewport iframe').forEach(f => {
      try { f.contentWindow.postMessage({ __eigendeck: 1, type: 'request-demo-report' }, '*'); } catch (e) {}
    });
    return window.__reports;
  });
  if (reports.includes('DEMO-RAN')) break;
}

// Sanity: both layers really are in the loaded DOM (not just the source string).
const dom = await page.evaluate(() => ({
  screen: !!document.querySelector('.eig-screen-layer #viewport'),
  print: !!document.querySelector('.eig-print-layer'),
  viewportIframes: document.querySelectorAll('#viewport iframe').length,
}));
if (!dom.screen) fail('loaded DOM has no .eig-screen-layer #viewport');
if (!dom.print) fail('loaded DOM has no .eig-print-layer');
console.log(`  loaded DOM: screen+print layers present, ${dom.viewportIframes} live iframe(s) in #viewport`);

await browser.close();

if (!reports.includes('DEMO-RAN'))
  fail(`live demo did NOT self-report in the export (got ${JSON.stringify(reports)}) — print layer broke the demo`);
const realErrs = consoleErrs.filter(e => !/favicon|net::ERR_FILE_NOT_FOUND.*favicon/i.test(e));
if (realErrs.length) console.log(`  (page console errors, non-fatal: ${realErrs.slice(0, 3).join(' | ')})`);
console.log('BROWSERDEMO_PASS: the live demo boots and runs in the interactive export WITH the print layer (#109)');
process.exit(0);
