import { createHash, randomUUID } from 'node:crypto';

const allowed = new Set(['id', 'status', 'intent', 'purchase_units', 'reference_id', 'payments', 'captures',
  'amount', 'currency_code', 'value', 'final_capture', 'create_time', 'update_time', 'name',
  'details', 'issue', 'debug_id', 'resource', 'event_type', 'supplementary_data', 'related_ids', 'order_id']);

export function redact(value, key = '') {
  if (Array.isArray(value)) return value.map(item => redact(item, key));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).filter(([k, v]) => allowed.has(k) && !(k === 'name' && typeof v !== 'string')).map(([k, v]) => [k, redact(v, k)]));
  }
  return typeof value === 'string' ? value.slice(0, 200) : value;
}

export function evidence(session, kind, data) {
  const event = {
    id: randomUUID(), traceId: session.traceId, orderId: session.orderId || null,
    at: new Date().toISOString(), kind, provenance: session.mode === 'sandbox' ? 'sandbox' : 'synthetic_rehearsal',
    ...data,
  };
  session.events.push(event);
  return event;
}

export function responseEvent(session, result, operation, started, requestId, extra = {}) {
  const body = redact(result.body);
  return evidence(session, 'response', {
    operation, method: operation === 'get' ? 'GET' : 'POST',
    path: operation === 'create' ? '/v2/checkout/orders' : `/v2/checkout/orders/${session.orderId}${operation === 'capture' ? '/capture' : ''}`,
    httpStatus: result.status, response: body, debugId: result.debugId || null,
    responseHash: createHash('sha256').update(JSON.stringify(body)).digest('hex'),
    startedAt: started, durationMs: Date.now() - Date.parse(started), requestId: requestId || null, ...extra,
  });
}

export function captures(body) {
  return (body?.purchase_units || []).flatMap(unit => unit.payments?.captures || []);
}

export function paymentState(session) {
  const refs = [];
  const requestIndex = session.events.findLastIndex(e => e.kind === 'capture_requested' && e.orderId === session.orderId && e.traceId === session.traceId);
  const request = session.events[requestIndex];
  let answered = !request;
  const completed = new Map();
  const failedIds = new Set();
  let failed = false, pending = false, conflict = false, latestOrder = null;
  for (const [index, e] of session.events.entries()) {
    if (e.kind !== 'response' || e.operation === 'create') continue;
    if (!['get', 'capture'].includes(e.operation)) continue;
    if (e.orderId !== session.orderId || e.traceId !== session.traceId) { conflict = true; continue; }
    const body = e.response;
    const success = e.httpStatus >= 200 && e.httpStatus < 300;
    if (success && body?.id !== session.orderId) { conflict = true; continue; }
    if (success) {
      latestOrder = e;
      const cs = captures(body);
      for (const c of cs) {
        if (c.status === 'COMPLETED') {
          const unit = body.purchase_units.find(u => u.payments?.captures?.some(x => x.id === c.id));
          if (!c.id || c.amount?.value !== session.amount || c.amount?.currency_code !== 'USD' || unit?.reference_id !== session.id) conflict = true;
          else {
            completed.set(c.id, e.id); refs.push(e.id);
            if (index > requestIndex && (e.operation === 'get' || e.requestId === request?.requestId)) answered = true;
          }
        } else if (['DECLINED', 'FAILED'].includes(c.status)) {
          failedIds.add(c.id); failed = true; refs.push(e.id);
          if (index > requestIndex && (e.operation === 'get' || e.requestId === request?.requestId)) answered = true;
        } else { pending = true; refs.push(e.id); }
      }
      if (body.status === 'COMPLETED' && !cs.length) conflict = true;
    }
    if (e.operation === 'capture' && e.httpStatus === 422) {
      const issues = body?.details?.map(d => d.issue) || [];
      if (issues.includes('ORDER_NOT_APPROVED')) {
        failed = true; refs.push(e.id);
        if (index > requestIndex && e.requestId === request?.requestId) answered = true;
      }
    }
  }
  if ([...completed.keys()].some(id => failedIds.has(id)) || completed.size > 1) conflict = true;
  if (conflict) return { state: 'unresolved', reason: 'The evidence does not agree on this transaction.', evidenceIds: [...new Set(refs)], captureId: null };
  if (!answered) {
    const current = session.events.slice(requestIndex).filter(e =>
      e.orderId === session.orderId && e.traceId === session.traceId && (
        e.id === request.id ||
        e.kind === 'transport_error' && e.requestId === request.requestId ||
        e.kind === 'response' && e.operation === 'get'
      ));
    return { state: 'unresolved', reason: 'The latest capture attempt has no definitive outcome. Reconcile the order before deciding what to do.',
      captureId: null, evidenceIds: current.map(e => e.id) };
  }
  if (completed.size === 1 && !pending) return { state: 'captured', reason: 'A completed capture matches this order, amount and checkout.', captureId: [...completed.keys()][0], evidenceIds: [...new Set(refs)] };
  if (pending) return { state: 'unresolved', reason: 'A capture is pending or has an unrecognised state.', evidenceIds: [...new Set(refs)], captureId: null };
  if (failed) return { state: 'failed', reason: 'The capture was rejected. No completed capture is present in the available evidence.', evidenceIds: [...new Set(refs)], captureId: null };
  return { state: 'unresolved', reason: 'There is no matching completed capture or definitive capture rejection.', evidenceIds: latestOrder ? [latestOrder.id] : [], captureId: null };
}

export function investigationFacts(session) {
  const state = paymentState(session);
  const duplicate = session.events.find(e => e.kind === 'webhook_duplicate');
  const lost = session.events.find(e => e.kind === 'transport_injected');
  const facts = [];
  for (const id of state.evidenceIds) {
    const e = session.events.find(e => e.id === id);
    facts.push({ id, type: e.kind === 'response' ? 'payment' : e.kind === 'capture_requested' ? 'capture_attempt' : 'response_unavailable', state: state.state, response: e.response, operation: e.operation, httpStatus: e.httpStatus, provenance: e.provenance });
  }
  if (lost) facts.push({ id: lost.id, type: 'lost_response', state: state.state, provenance: 'injected_transport', response: { status: 'Response deliberately withheld from checkout' } });
  if (duplicate) facts.push({ id: duplicate.id, type: 'duplicate_webhook', state: state.state, provenance: duplicate.provenance, response: { id: duplicate.eventId, status: 'Duplicate delivery ignored' } });
  return { ...state, duplicate: Boolean(duplicate), facts };
}
