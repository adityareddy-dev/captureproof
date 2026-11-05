import { randomUUID } from 'node:crypto';

export class Rehearsal {
  constructor() { this.orders = new Map(); this.captureCalls = 0; }
  restore(session) {
    if (!this.orders.has(session.orderId)) {
      const last = [...session.events].reverse().find(e => e.kind === 'response' && e.httpStatus < 300 && e.response?.id === session.orderId);
      if (last) this.orders.set(session.orderId, structuredClone(last.response));
    }
  }
  async create(session) {
    const body = { id: `REHEARSAL${randomUUID().replaceAll('-', '').slice(0, 18).toUpperCase()}`, status: 'CREATED', purchase_units: [{ reference_id: session.id, amount: { value: session.amount, currency_code: 'USD' } }] };
    this.orders.set(body.id, body);
    return { status: 201, body: structuredClone(body) };
  }
  async approve(id) { this.orders.get(id).status = 'APPROVED'; }
  async get(id) { return { status: 200, body: structuredClone(this.orders.get(id)) }; }
  async capture(id) {
    this.captureCalls++;
    const order = this.orders.get(id);
    if (order.status !== 'APPROVED') return { status: 422, body: { name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'ORDER_NOT_APPROVED' }] } };
    order.status = 'COMPLETED';
    order.purchase_units[0].payments = { captures: [{ id: `TESTCAPTURE${this.captureCalls}`, status: 'COMPLETED', amount: { value: '12.00', currency_code: 'USD' } }] };
    return { status: 201, body: structuredClone(order) };
  }
}
