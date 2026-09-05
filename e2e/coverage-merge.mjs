// Merge the per-page Istanbul maps collected from the instrumented e2e run
// ($COV_NYC_DIR/*.json) into one coverage map and emit a report. Optionally folds
// in the vitest map (coverage/coverage-final.json, needs the 'json' reporter) for a
// UNIFIED frontend number: jsdom unit + real-WebKitGTK e2e.
//
//   node e2e/coverage-merge.mjs
//   COV_WITH_VITEST=1 node e2e/coverage-merge.mjs
import libCoverage from 'istanbul-lib-coverage';
import { createContext } from 'istanbul-lib-report';
import reports from 'istanbul-reports';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

const NYC = resolve(process.env.COV_NYC_DIR || '.nyc_output');
const OUT = resolve(process.env.COV_REPORT_DIR || 'coverage-e2e');
const map = libCoverage.createCoverageMap({});

let n = 0;
if (existsSync(NYC)) {
  for (const f of readdirSync(NYC).filter((f) => f.endsWith('.json'))) {
    try { map.merge(JSON.parse(readFileSync(join(NYC, f), 'utf8'))); n++; }
    catch (e) { console.error(`skip ${f}: ${e}`); }
  }
}
if (n === 0) { console.error(`no coverage maps in ${NYC}`); process.exit(1); }

let foldedVitest = false;
const vitestJson = resolve('coverage/coverage-final.json');
if (process.env.COV_WITH_VITEST === '1' && existsSync(vitestJson)) {
  try { map.merge(JSON.parse(readFileSync(vitestJson, 'utf8'))); foldedVitest = true; }
  catch (e) { console.error(`vitest fold skipped: ${e}`); }
}

const ctx = createContext({ coverageMap: map, dir: OUT });
reports.create('text-summary').execute(ctx);
reports.create('lcov').execute(ctx);
reports.create('html').execute(ctx);

const s = map.getCoverageSummary();
console.log(`\nmerged ${n} e2e page map(s)${foldedVitest ? ' + vitest' : ''} over ${map.files().length} files`);
console.log(`  lines ${s.lines.pct}%  statements ${s.statements.pct}%  functions ${s.functions.pct}%  branches ${s.branches.pct}%`);
console.log(`  report → ${OUT}/ (lcov.info + html)`);
