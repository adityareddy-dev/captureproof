import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.mjs';
import { Rehearsal } from '../src/rehearsal.mjs';
import { Checkout } from '../src/checkout.mjs';
import { paymentState, investigationFacts } from '../src/evidence.mjs';
import { validateInvestigation, investigate } from '../src/assistant.mjs';

const confirm = { confirm: 'capture-sandbox-payment' };
async function loseRecovery(checkout, remote) {
  const s = await checkout.create('rehearsal', 'failed-capture');
  await checkout.capture(s.id, confirm);
  await checkout.approve(s.id);
  const capture = remote.capture.bind(remote);
  remote.capture = async (...args) => { await capture(...args); throw new Error('Recovery response lost'); };
  return checkout.capture(s.id, { ...confirm, recover: true });
}

test('recovery response loss supersedes rejection across restart until reconciliation', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'captureproof-recovery-'));
  const path = join(dir, 'state.sqlite');
  let store = new Store(path);
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  const remote = new Rehearsal();
  let checkout = new Checkout(store, {}, remote);
  const lost = await loseRecovery(checkout, remote);
  const current = paymentState(lost);
  assert.equal(current.state, 'unresolved');
  const request = lost.events.findLast(e => e.kind === 'capture_requested');
  assert.ok(current.evidenceIds.includes(request.id));
  assert.ok(!current.evidenceIds.includes(lost.events.find(e => e.httpStatus === 422).id));
  const get = remote.get.bind(remote);
  remote.get = async id => {
    const result = await get(id);
    result.body.status = 'APPROVED'; delete result.body.purchase_units[0].payments;
    return result;
  };
  assert.equal(paymentState(await checkout.reconcile(lost.id)).state, 'unresolved');
  assert.equal(store.effects(lost.id).length, 0);
  remote.get = get;
  for (let restart = 0; restart < 2; restart++) {
    const saved = store.get(lost.id);
    assert.equal(paymentState(saved).state, 'unresolved');
    const analysis = await investigate(saved, 'Was recovery paid? Should I capture again?', {});
    assert.equal(analysis.state, 'unresolved');
    assert.equal(analysis.nextStep, 'reconcile');
    assert.equal(store.effects(lost.id).length, 0);
    await assert.rejects(checkout.capture(lost.id, { ...confirm, recover: true }), /may already exist/);
    store.close(); store = new Store(path); checkout = new Checkout(store, {}, remote);
  }
  const reconciled = await checkout.reconcile(lost.id);
  assert.equal(paymentState(reconciled).state, 'captured');
  const analysis = await investigate(reconciled, 'Should I capture again?', {});
  assert.equal(analysis.nextStep, 'do_not_capture');
  await checkout.reconcile(lost.id);
  assert.equal(store.effects(lost.id).length, 1);
  assert.equal(remote.captureCalls, 2);
});

test('contradictory free answers are omitted and findings need matching evidence', async t => {
  const store = new Store(); t.after(() => store.close());
  const remote = new Rehearsal();
  const checkout = new Checkout(store, {}, remote);
  const lost = await loseRecovery(checkout, remote);
  const packet = investigationFacts(lost);
  const safe = { state: 'unresolved', nextStep: 'reconcile', findings: [{ evidenceIds: packet.evidenceIds, explanation: 'The latest capture attempt has no definitive outcome.' }], questionAnswer: 'The buyer paid successfully. Repeat the capture now.' };
  assert.equal(validateInvestigation(safe, packet).questionAnswer, undefined);
  for (const text of ['The buyer paid successfully.', 'Repeat the capture now.', 'The outcome is unknown. The buyer paid successfully.', 'No transport fault occurred, but the buyer paid successfully.', 'No completed capture exists. Try again.', 'The outcome is unknown but the buyer paid successfully.', 'No completed capture exists, but the payment settled.', 'You can submit a second capture.', 'You may capture the order.']) {
    assert.throws(() => validateInvestigation({ ...safe, findings: [{ explanation: text, evidenceIds: packet.evidenceIds }] }, packet), text);
  }
  const cfg = { geminiKey: 'private-test-key', freeModel: true, model: 'test-model' };
  const fetcher = output => async () => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(output) }] } }] }) });
  const accepted = await investigate(lost, 'Should I capture again?', cfg, fetcher(safe));
  assert.equal(accepted.source, 'model');
  assert.equal(accepted.questionAnswer, undefined);
  const rejected = await investigate(lost, 'Should I capture again?', cfg, fetcher({ ...safe, findings: [{ explanation: safe.questionAnswer, evidenceIds: packet.evidenceIds }] }));
  assert.equal(rejected.source, 'deterministic');
  assert.equal(rejected.nextStep, 'reconcile');
  const recovered = await checkout.reconcile(lost.id);
  const paid = investigationFacts(recovered);
  const payment = paid.facts.find(f => f.operation === 'get' && f.response?.status === 'COMPLETED');
  const oldRejection = paid.facts.find(f => f.httpStatus === 422);
  const answer = { state: 'captured', nextStep: 'do_not_capture', findings: [{ explanation: 'A completed capture matches the checkout.', evidenceIds: [payment.id] }] };
  assert.doesNotThrow(() => validateInvestigation(answer, paid));
  assert.throws(() => validateInvestigation({ ...answer, findings: [{ ...answer.findings[0], evidenceIds: [oldRejection.id] }] }, paid));
  assert.equal(remote.captureCalls, 2);
});
