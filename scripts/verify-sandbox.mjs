import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { config } from '../src/config.mjs';
import { captures } from '../src/evidence.mjs';

const cfg = config();
const base = `http://localhost:${cfg.port}`;
const destination = resolve(process.argv[2] || 'docs/private/sandbox-evidence');
const fixtures = ['lost-response', 'duplicate-webhook', 'failed-capture'];

async function read(path) {
  const response = await fetch(base + path, { signal: AbortSignal.timeout(10000) });
  assert.equal(response.status, 200, `Evidence lookup returned HTTP ${response.status}.`);
  return response.json();
}

try {
  const sessions = await read('/api/checkouts');
  const bundles = [];
  for (const fixture of fixtures) {
    const session = sessions.find(s => s.mode === 'sandbox' && s.fixture === fixture);
    assert.ok(session, `Complete the ${fixture} fixture in PayPal sandbox first.`);
    const bundle = await read(`/api/checkouts/${session.id}/export`);
    const s = bundle.checkout;
    assert.equal(s.mode, 'sandbox');
    assert.equal(s.state.state, 'captured', `${fixture}: a matching completed capture is required.`);
    assert.equal(s.effects.length, 1, `${fixture}: expected one merchant receipt.`);
    assert.equal(s.effects[0].capture_id, s.state.captureId);
    const responses = s.events.filter(e => e.kind === 'response');
    assert.ok(responses.every(e => e.provenance === 'sandbox' && e.traceId === s.traceId && e.orderId === s.orderId));
    const completed = responses.filter(e => e.operation === 'capture' && e.httpStatus >= 200 && e.httpStatus < 300);
    assert.equal(completed.length, 1, `${fixture}: expected one successful capture response.`);
    assert.ok(completed[0].debugId, `${fixture}: expected a PayPal debug ID.`);
    assert.ok(captures(completed[0].response).some(c => c.id === s.state.captureId && c.status === 'COMPLETED'));
    const requests = s.events.filter(e => e.kind === 'capture_requested');
    assert.ok(requests.every(e => e.explicitUserAction));

    if (fixture === 'lost-response') {
      assert.equal(requests.length, 1);
      assert.equal(completed[0].deliveredToCheckout, false);
      assert.ok(s.events.some(e => e.kind === 'transport_injected' && e.provenance === 'injected_transport'));
      assert.ok(responses.some(e => e.operation === 'get' && e.httpStatus === 200 && s.events.indexOf(e) > s.events.indexOf(completed[0]) && captures(e.response).some(c => c.id === s.state.captureId)));
      assert.equal(s.investigation?.source, 'model', 'Run a model investigation on the reconciled lost-response case.');
      assert.equal(s.investigation.evidenceVersion, s.events.length, 'Investigate again after the last evidence change.');
      assert.equal(s.investigation.nextStep, 'do_not_capture');
      assert.ok(s.investigation.findings.every(f => f.evidenceIds.length && f.evidenceIds.every(id => s.events.some(e => e.id === id))));
    } else if (fixture === 'duplicate-webhook') {
      assert.equal(requests.length, 1);
      assert.ok(s.events.some(e => e.kind === 'webhook_replay' && e.provenance === 'local_webhook_replay'));
      assert.ok(s.events.some(e => e.kind === 'webhook_duplicate' && e.provenance === 'local_webhook_replay'));
    } else {
      const rejected = responses.find(e => e.operation === 'capture' && e.httpStatus === 422 && e.response.details?.some(d => d.issue === 'ORDER_NOT_APPROVED'));
      assert.ok(rejected, 'Expected the actual sandbox ORDER_NOT_APPROVED rejection.');
      assert.equal(requests.length, 2);
      assert.equal(new Set(requests.map(e => e.requestId)).size, 2);
      assert.equal(requests[0].recovery, false);
      assert.equal(requests[1].recovery, true);
      const recoveryIndex = s.events.indexOf(requests[1]);
      const fresh = s.events.slice(0, recoveryIndex).findLast(e => e.kind === 'response' && e.operation === 'get');
      assert.equal(fresh?.response.status, 'APPROVED');
      assert.equal(captures(fresh.response).length, 0);
      assert.ok(s.events.indexOf(rejected) < recoveryIndex && recoveryIndex < s.events.indexOf(completed[0]));
    }
    bundles.push({ fixture, bundle });
  }
  await mkdir(destination, { recursive: true });
  for (const { fixture, bundle } of bundles) await writeFile(resolve(destination, `${fixture}.json`), JSON.stringify(bundle, null, 2) + '\n');
  const report = {
    checkedAt: new Date().toISOString(),
    note: 'Sandbox payment responses with an injected transport fault and local delivery replay labelled separately. This check reads evidence and sends no payment requests.',
    fixtures: bundles.map(({ fixture, bundle: { checkout: s } }) => ({ fixture, checkoutId: s.id, orderId: s.orderId, captureId: s.state.captureId, receipts: s.effects.length, evidenceFile: `${fixture}.json` })),
  };
  await writeFile(resolve(destination, 'verification.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`Verified three sandbox fixtures. Redacted evidence saved to ${destination}.`);
} catch (error) {
  console.error(error instanceof assert.AssertionError ? error.message : 'Could not read the local application. Start CaptureProof before verifying sandbox evidence.');
  process.exitCode = 1;
}
