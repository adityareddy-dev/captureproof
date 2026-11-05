import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { config } from '../src/config.mjs';
import { Store } from '../src/store.mjs';
import { Rehearsal } from '../src/rehearsal.mjs';
import { Checkout } from '../src/checkout.mjs';
import { investigate } from '../src/assistant.mjs';

const cfg = config();
if (!cfg.geminiKey || !cfg.freeModel) throw new Error('Free Gemini access must be configured before this evaluation.');
const store = new Store(); const c = new Checkout(store, {}, new Rehearsal());
const confirm = { confirm: 'capture-sandbox-payment' };
const cases = [];
for (const fixture of ['lost-response', 'duplicate-webhook', 'failed-capture']) {
  const s = await c.create('rehearsal', fixture);
  if (fixture !== 'failed-capture') await c.approve(s.id);
  await c.capture(s.id, confirm);
  if (fixture === 'duplicate-webhook') await c.duplicate(s.id);
  cases.push({ name: fixture, expected: fixture === 'failed-capture' ? 'failed' : 'captured', session: store.get(s.id) });
}
const missing = await c.create('rehearsal', 'lost-response'); await c.approve(missing.id);
cases.push({ name: 'missing-capture-evidence', expected: 'unresolved', session: store.get(missing.id) });
const conflicting = structuredClone(cases[0].session);
const e = structuredClone(conflicting.events.find(e => e.kind === 'response' && e.operation === 'capture'));
e.id = 'conflicting-response'; e.response.purchase_units[0].payments.captures[0].status = 'DECLINED'; conflicting.events.push(e);
cases.push({ name: 'conflicting-capture-evidence', expected: 'unresolved', session: conflicting });
const selected = new Set(process.argv.slice(2));
let report = { at: new Date().toISOString(), model: cfg.model, evidenceOrigin: 'synthetic_rehearsal', cases: [] };
if (selected.size) { try { report = JSON.parse(readFileSync('docs/model-evaluation.json', 'utf8')); } catch {} }
for (const entry of cases) {
  if (selected.size && !selected.has(entry.name)) continue;
  let modelResponse = null;
  const fetcher = async (...args) => { const response = await fetch(...args); if (response.ok) { const data = await response.clone().json(); modelResponse = data.candidates?.[0]?.content?.parts?.filter(p => !p.thought).map(p => p.text || '').join(''); } return response; };
  const result = await investigate(entry.session, 'Was this paid, what caused the failure, and what can I safely do next?', cfg, fetcher);
  const record = { name: entry.name, expected: entry.expected, accepted: result.source === 'model' && result.state === entry.expected,
    at: new Date().toISOString(), safeState: result.state === entry.expected, modelResponse, investigation: result, evidence: entry.session.events };
  report.cases = report.cases.filter(c => c.name !== entry.name);
  report.cases.push(record);
  console.log(`${record.name}: ${record.accepted ? 'accepted model explanation' : 'model unavailable or rejected'}`);
}
mkdirSync('docs', { recursive: true }); writeFileSync('docs/model-evaluation.json', JSON.stringify(report, null, 2) + '\n');
store.close();
if (report.cases.some(c => !c.accepted)) process.exitCode = 1;
