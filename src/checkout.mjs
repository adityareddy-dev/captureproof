import { randomUUID } from 'node:crypto';
import { evidence, responseEvent, paymentState, captures } from './evidence.mjs';

export const fixtures = ['lost-response', 'duplicate-webhook', 'failed-capture'];
const fail = message => Object.assign(new Error(message), { status: 409 });

export class Checkout {
  constructor(store, sandbox, rehearsal) { this.store = store; this.sandbox = sandbox; this.rehearsal = rehearsal; this.busy = new Set(); }
  adapter(s) { if (s.mode === 'rehearsal') { this.rehearsal.restore(s); return this.rehearsal; } return this.sandbox; }
  async locked(id, work) {
    if (this.busy.has(id)) throw fail('An action is already running for this checkout.');
    this.busy.add(id);
    try { return await work(this.store.get(id)); } finally { this.busy.delete(id); }
  }
  async create(mode, fixture) {
    if (!['sandbox', 'rehearsal'].includes(mode) || !fixtures.includes(fixture)) throw Object.assign(new Error('Choose one of the three fixtures.'), { status: 400 });
    const s = { id: randomUUID(), traceId: randomUUID().replaceAll('-', ''), createdAt: new Date().toISOString(),
      mode, fixture, amount: '12.00', events: [], orderId: null, approvalUrl: null, attempt: null, recoveryUsed: false, initialUsed: false };
    this.store.save(s);
    const started = new Date().toISOString(); const requestId = randomUUID();
    let result;
    try { result = await this.adapter(s).create(s, requestId); }
    catch { evidence(s, 'transport_error', { operation: 'create', message: 'Order creation did not return a readable response. Start a new checkout to continue.' }); this.store.save(s); return s; }
    if (result.status >= 200 && result.status < 300 && /^[A-Z0-9]{1,36}$/.test(result.body.id)) s.orderId = result.body.id;
    responseEvent(s, result, 'create', started, requestId);
    const approval = result.body.links?.find(l => ['approve', 'payer-action'].includes(l.rel));
    if (approval) {
      try { const url = new URL(approval.href); if (url.protocol === 'https:' && url.hostname === 'www.sandbox.paypal.com') s.approvalUrl = url.href; } catch {}
    }
    this.store.save(s); return s;
  }
  async readOrder(s) {
    const started = new Date().toISOString();
    try {
      const result = await this.adapter(s).get(s.orderId);
      const e = responseEvent(s, result, 'get', started);
      this.store.save(s);
      return { result, event: e };
    } catch {
      evidence(s, 'transport_error', { operation: 'get', message: 'Order lookup failed. Payment state remains unresolved.' }); this.store.save(s);
      return null;
    }
  }
  applyEffect(s) {
    const state = paymentState(s);
    if (state.state === 'captured' && this.store.fulfill(s.id, state.captureId)) {
      evidence(s, 'merchant_effect', { captureId: state.captureId, message: 'Receipt recorded once for this checkout.' });
    }
    this.store.save(s);
  }
  async reconcile(id) {
    return this.locked(id, async s => { await this.readOrder(s); this.applyEffect(s); return s; });
  }
  async approve(id) {
    return this.locked(id, async s => {
      if (s.mode !== 'rehearsal') throw fail('Approve this order in the PayPal sandbox buyer window.');
      if (paymentState(s).state === 'captured') throw fail('This checkout is already captured.');
      await this.adapter(s).approve(s.orderId);
      evidence(s, 'approval_rehearsal', { message: 'Buyer approval simulated locally. No sandbox request.' });
      await this.readOrder(s); return s;
    });
  }
  async capture(id, { confirm, recover = false } = {}) {
    if (confirm !== 'capture-sandbox-payment') throw fail('Explicit capture confirmation is required.');
    return this.locked(id, async s => {
      if (!s.orderId) throw fail('There is no order to capture.');
      if (s.attempt?.state === 'sent') throw fail('A capture may already exist. Reconcile this checkout. Another capture is blocked.');
      if ((!recover && s.initialUsed) || (recover && s.recoveryUsed)) throw fail('This action was already used. Reconcile this checkout.');
      const previous = paymentState(s);
      if (previous.state === 'captured') throw fail('This payment is captured. Another capture is blocked.');
      if (recover && previous.state !== 'failed') throw fail('Recovery needs a definitive capture rejection and fresh order evidence.');
      const fresh = await this.readOrder(s);
      if (!fresh || fresh.result.status !== 200) throw fail('Fresh order evidence is unavailable. Capture is blocked.');
      const body = fresh.result.body;
      const units = body.purchase_units || [];
      const valid = body.id === s.orderId && units.length === 1 && units[0].reference_id === s.id && units[0].amount?.value === s.amount && units[0].amount?.currency_code === 'USD';
      if (!valid || captures(body).length || body.status === 'COMPLETED' || paymentState(s).state === 'captured') {
        this.applyEffect(s); throw fail('The order is captured, has capture evidence, or does not match this checkout. Another capture is blocked.');
      }
      const demonstrateRejection = !recover && s.fixture === 'failed-capture' && ['CREATED', 'PAYER_ACTION_REQUIRED'].includes(body.status);
      if (body.status !== 'APPROVED' && !demonstrateRejection) throw fail('The buyer must approve this order first.');
      if (recover && body.status !== 'APPROVED') throw fail('The buyer must approve this order before recovery.');
      if (recover) s.recoveryUsed = true; else s.initialUsed = true;
      const requestId = randomUUID();
      s.attempt = { requestId, state: 'sent', recovery: recover };
      evidence(s, 'capture_requested', { requestId, explicitUserAction: true, recovery: recover });
      this.store.save(s);
      const started = new Date().toISOString();
      let result;
      try { result = await this.adapter(s).capture(s.orderId, requestId); }
      catch {
        evidence(s, 'transport_error', { operation: 'capture', requestId, message: 'Capture response unavailable. Do not repeat the payment. Reconcile first.' });
        this.store.save(s); return s;
      }
      const lost = !recover && s.fixture === 'lost-response' && result.status >= 200 && result.status < 300;
      responseEvent(s, result, 'capture', started, requestId, { deliveredToCheckout: !lost });
      if (lost) {
        evidence(s, 'transport_injected', { requestId, provenance: 'injected_transport', message: 'Successful response deliberately withheld from checkout. The gateway response is preserved for inspection.' });
        this.store.save(s); return s;
      }
      const issue = result.body.details?.map(d => d.issue) || [];
      s.attempt.state = result.status === 422 && issue.includes('ORDER_NOT_APPROVED') ? 'rejected' : 'sent';
      if (paymentState(s).state === 'captured') { s.attempt.state = 'completed'; this.applyEffect(s); }
      this.store.save(s); return s;
    });
  }
  async duplicate(id) {
    return this.locked(id, async s => {
      const state = paymentState(s);
      if (s.fixture !== 'duplicate-webhook' || state.state !== 'captured') throw fail('Capture the duplicate webhook fixture first.');
      const eventId = `REPLAY-${s.orderId}-${state.captureId}`;
      for (let n = 0; n < 2; n++) {
        const first = this.store.webhook(s.id, eventId);
        evidence(s, first ? 'webhook_replay' : 'webhook_duplicate', {
          eventId, captureId: state.captureId, provenance: 'local_webhook_replay',
          message: first ? 'Local delivery replay from the capture evidence. This is not a PayPal webhook.' : 'Second local delivery ignored. No additional receipt.',
        });
        this.applyEffect(s);
      }
      this.store.save(s); return s;
    });
  }
  async webhook(headers, body) {
    const id = body.resource?.supplementary_data?.related_ids?.order_id;
    const session = this.store.list().find(s => s.mode === 'sandbox' && s.orderId === id);
    if (!session || typeof body.id !== 'string' || body.event_type !== 'PAYMENT.CAPTURE.COMPLETED') throw fail('This webhook does not match a sandbox checkout.');
    return this.locked(session.id, async s => {
      const verified = await this.sandbox.verify(headers, body);
      if (verified.status !== 200 || verified.body.verification_status !== 'SUCCESS') throw Object.assign(new Error('Webhook signature verification failed.'), { status: 400 });
      const first = this.store.webhook(s.id, body.id);
      evidence(s, first ? 'webhook_verified' : 'webhook_duplicate', { eventId: body.id, captureId: body.resource.id, verification: 'SUCCESS' });
      await this.readOrder(s);
      this.applyEffect(s); return s;
    });
  }
}
