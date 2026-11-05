import { test } from 'node:test';
import assert from 'node:assert/strict';
import { application } from '../src/server.mjs';
import { Store } from '../src/store.mjs';

test('HTTP core path, evidence export and local request protections', async t => {
  const cfg = { port: 0, model: 'unused', freeModel: false };
  const app = application(cfg, new Store());
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve)); cfg.port = app.server.address().port;
  t.after(() => { app.server.close(); app.store.close(); });
  const base = `http://127.0.0.1:${cfg.port}`;
  const headers = { Origin: base, 'Content-Type': 'application/json', 'X-CaptureProof': 'local' };
  const post = async (path, data, h = headers) => fetch(base + path, { method: 'POST', headers: h, body: JSON.stringify(data) });
  const page = await fetch(base); assert.equal(page.status, 200); assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  const hostile = await post('/api/checkouts', { mode: 'rehearsal', fixture: 'lost-response' }, { ...headers, Origin: 'https://other.example' }); assert.equal(hostile.status, 403);
  const noConfirmation = await post('/api/checkouts', { mode: 'rehearsal', fixture: 'lost-response' }, { 'Content-Type': 'application/json' }); assert.equal(noConfirmation.status, 403);
  const response = await post('/api/checkouts', { mode: 'rehearsal', fixture: 'failed-capture' }); assert.equal(response.status, 201); const s = await response.json();
  const capture = await post(`/api/checkouts/${s.id}/capture`, { confirm: 'capture-sandbox-payment' }); assert.equal(capture.status, 200); assert.equal((await capture.json()).state.state, 'failed');
  const analysis = await post(`/api/checkouts/${s.id}/investigate`, { question: 'What happened?' }); assert.equal((await analysis.json()).investigation.source, 'deterministic');
  const exported = await (await fetch(`${base}/api/checkouts/${s.id}/export`)).json(); assert.equal(exported.format, 'captureproof-evidence-v1'); assert.ok(exported.checkout.events.every(e => e.provenance === 'synthetic_rehearsal'));
});
