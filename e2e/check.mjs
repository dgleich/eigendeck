// Parameterized WebDriver check. Env:
//   E2E_APP    app binary
//   E2E_DECK   .eigendeck to open via launch arg
//   E2E_EXPECT substring that MUST appear in the DOM
//   E2E_ABSENT (optional) substring that must NOT appear
const BASE = 'http://127.0.0.1:4444';
const APP = process.env.E2E_APP;
const DECK = process.env.E2E_DECK;
const EXPECT = process.env.E2E_EXPECT;
const ABSENT = process.env.E2E_ABSENT || '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function post(path, body) {
  const r = await fetch(BASE + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch { j = t; }
  return { status: r.status, j };
}

let sid;
for (let i = 0; i < 12; i++) {
  try {
    const { j } = await post('/session', {
      capabilities: { alwaysMatch: { 'tauri:options': { application: APP, args: [DECK] } } },
    });
    if (j?.value?.sessionId) { sid = j.value.sessionId; break; }
  } catch { /* retry */ }
  await sleep(1000);
}
if (!sid) { console.error('NO SESSION'); process.exit(2); }

let text = '', okExpect = false;
for (let i = 0; i < 20; i++) {
  await sleep(1000);
  try {
    const { j } = await post(`/session/${sid}/execute/sync`, {
      script: 'return document.body ? document.body.textContent : ""', args: [],
    });
    text = String(j?.value || '');
    if (text.includes(EXPECT)) { okExpect = true; break; }
  } catch { /* retry */ }
}
const okAbsent = !ABSENT || !text.includes(ABSENT);
await fetch(`${BASE}/session/${sid}`, { method: 'DELETE' }).catch(() => {});

if (okExpect && okAbsent) {
  console.log(`E2E_PASS expect="${EXPECT}"` + (ABSENT ? ` absent="${ABSENT}"` : ''));
  process.exit(0);
}
console.error(`E2E_FAIL expect="${EXPECT}"(${okExpect}) absent="${ABSENT}"(${okAbsent})`);
console.error('DOM sample:', text.slice(0, 600));
process.exit(1);
