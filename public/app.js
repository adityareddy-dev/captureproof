const $ = id => document.getElementById(id);
let active = null;
let settings = {};
let busy = false;
const labels = { 'lost-response': 'Investigate a capture response', 'duplicate-webhook': 'Investigate repeated delivery', 'failed-capture': 'Investigate a capture rejection' };
const names = { response: 'PayPal response', capture_requested: 'Capture requested by merchant', transport_injected: 'Injected loss after capture response', transport_error: 'Response unavailable', merchant_effect: 'Merchant receipt recorded', webhook_replay: 'Local webhook delivery replay', webhook_duplicate: 'Duplicate delivery ignored', approval_rehearsal: 'Rehearsal buyer approval', webhook_verified: 'PayPal webhook verified' };

function node(tag, text, className) { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (className) e.className = className; return e; }
async function api(path, data) {
  const response = await fetch(path, data === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CaptureProof': 'local' }, body: JSON.stringify(data) });
  const body = await response.json(); if (!response.ok) throw new Error(body.error); return body;
}
async function run(work) {
  if (busy) return;
  busy = true; $('error').hidden = true;
  document.querySelectorAll('button').forEach(b => { b.disabled = true; });
  try { await work(); } catch (error) { $('error').textContent = error.message; $('error').hidden = false; }
  finally { busy = false; document.querySelectorAll('button').forEach(b => { b.disabled = false; }); }
}
function notice() {
  $('notice').textContent = (active?.mode || $('mode').value) === 'rehearsal'
    ? 'SYNTHETIC REHEARSAL · Responses and buyer approval are simulated locally. This is not sandbox evidence.'
    : 'PAYPAL SANDBOX · Test funds only. Transport faults and local webhook replays are labelled separately.';
}
function citations(ids) {
  const div = node('div', undefined, 'citations');
  for (const id of ids || []) {
    const event = active.events.find(e => e.id === id); if (!event) continue;
    const a = node('a', `${event.operation ? event.operation.toUpperCase() : 'TRACE'} · ${id.slice(0, 6)}`); a.href = `#e-${id}`;
    a.onclick = () => { const detail = $(`e-${id}`).querySelector('details'); if (detail) detail.open = true; };
    div.append(a);
  }
  return div;
}
function renderAnalysis() {
  const div = $('analysis'); div.replaceChildren();
  const result = active.investigation; if (!result) return;
  const currentIds = new Set(active.events.map(e => e.id));
  if (result.state !== active.state.state || result.evidenceVersion !== active.events.length || (result.evidenceIds || []).some(id => !currentIds.has(id))) { div.append(node('p', 'Evidence changed. Investigate again for a current explanation.')); return; }
  div.append(node('div', result.source === 'model' ? `${result.model} · ${result.provenance}` : 'TRANSACTION CHECKS · Model explanation unavailable', 'source'));
  for (const finding of result.findings) { const item = node('div', undefined, 'finding'); item.append(node('p', finding.explanation), citations(finding.evidenceIds)); div.append(item); }
  const next = { do_not_capture: 'Do not repeat the payment. The matching capture is complete.', approve_then_recover: 'Buyer approval is needed. Then explicitly request recovery.', reconcile: 'Reconcile the order. There is not enough evidence for another capture.' };
  div.append(node('div', next[active.state.state === 'captured' ? 'do_not_capture' : active.state.state === 'failed' ? 'approve_then_recover' : 'reconcile'], 'decision'));
  if (result.notice) div.append(node('p', result.notice, 'fine'));
}
function renderTimeline() {
  const timeline = $('timeline'); timeline.replaceChildren();
  for (const event of active.events) {
    const item = node('article', undefined, `timeline-event ${event.httpStatus >= 400 || event.kind.startsWith('transport') ? 'warning' : event.kind === 'merchant_effect' ? 'good' : ''}`); item.id = `e-${event.id}`;
    const head = node('div', undefined, 'event-heading');
    head.append(node('span', event.kind === 'response' ? `${event.method} ${event.operation === 'create' ? 'Create order' : event.operation === 'get' ? 'Read order state' : 'Capture order'} · ${event.httpStatus}` : names[event.kind] || event.kind, 'event-title'), node('time', new Date(event.at).toLocaleTimeString([], { hour12: false }), 'event-time'));
    item.append(head, node('div', `${event.provenance.replaceAll('_', ' ')}${event.durationMs !== undefined ? ` · ${event.durationMs} ms` : ''}`, 'event-meta'));
    if (event.message) item.append(node('p', event.message, 'event-note'));
    if (event.kind === 'response' && event.deliveredToCheckout === false) item.append(node('p', 'Gateway evidence only. This response was withheld from the merchant checkout.', 'event-note'));
    const details = node('details'); details.append(node('summary', event.response ? 'Inspect response and trace' : 'Inspect trace event'), node('pre', JSON.stringify(event, null, 2))); item.append(details); timeline.append(item);
  }
  $('event-count').textContent = `${active.events.length} events`;
}
function button(text, action, data = {}) { const b = node('button', text); b.onclick = () => run(async () => show(await api(`/api/checkouts/${active.id}/${action}`, data))); return b; }
function renderActions() {
  const div = $('buttons'); div.replaceChildren();
  if (!active.orderId) {
    $('action-help').textContent = 'No order was created. Check access and start a new checkout.';
    return;
  }
  const state = active.state.state;
  const delivered = active.events.some(e => e.kind === 'transport_injected' || e.kind === 'transport_error' && e.operation === 'capture');
  const latestOrder = active.events.findLast(e => e.operation === 'get' && ['response', 'transport_error'].includes(e.kind));
  const approved = latestOrder?.httpStatus === 200 && latestOrder.response?.status === 'APPROVED';
  const rehearsal = active.mode === 'rehearsal';
  $('action-help').textContent = state === 'captured'
    ? active.effects.length ? 'A matching completed capture exists. One receipt is recorded. Another capture is blocked.' : 'The gateway recorded a completed capture, but the checkout lost its response. Reconcile to record the receipt without another capture.'
    : delivered ? 'The checkout timed out. Reconcile the order before deciding what to do.'
    : state === 'failed' ? approved ? 'Buyer approval is recorded for the same order. Request recovery to complete the checkout.' : rehearsal ? 'The request was rejected before approval. Simulate buyer approval, then request recovery.' : 'The request was rejected before approval. Approve the same order in the PayPal tab, then check buyer approval here.'
    : approved ? 'Buyer approval is recorded. Capture explicitly to continue the selected case.'
    : active.fixture === 'failed-capture' ? 'Try capture before approval to record the rejection. No payment can complete until the buyer approves.'
    : rehearsal ? 'Simulate buyer approval first. Then capture to continue the selected case.' : 'Open buyer approval in a separate PayPal tab. Return here and check buyer approval before capture.';
  if (state !== 'captured') {
    if (rehearsal && !approved && (!active.initialUsed || state === 'failed') && (active.fixture !== 'failed-capture' || state === 'failed')) div.append(button('Simulate buyer approval', 'approve'));
    if (!rehearsal && !approved && active.approvalUrl) { const a = node('a', 'Open PayPal sandbox buyer approval ↗'); a.href = active.approvalUrl; a.target = '_blank'; a.rel = 'noopener noreferrer'; div.append(a); }
    if (!active.initialUsed && (approved || active.fixture === 'failed-capture')) div.append(button(active.fixture === 'failed-capture' && !approved ? 'Try capture before approval' : rehearsal ? 'Simulate $12.00 capture' : 'Capture $12.00 in test funds', 'capture', { confirm: 'capture-sandbox-payment' }));
    if (state === 'failed' && approved && !active.recoveryUsed) div.append(button(rehearsal ? 'Recover: simulate capture' : 'Recover: capture approved sandbox order', 'capture', { confirm: 'capture-sandbox-payment', recover: true }));
  }
  div.append(button(!rehearsal && !approved && state !== 'captured' && !delivered ? 'Check buyer approval' : 'Reconcile order state', 'reconcile'));
  if (active.fixture === 'duplicate-webhook' && state === 'captured') div.append(button('Replay the same delivery twice locally', 'duplicate'));
}
async function show(session) {
  active = session; history.replaceState(null, '', `/?checkout=${session.id}`);
  $('mode').value = session.mode; $('fixture').value = session.fixture;
  $('empty').hidden = true; $('checkout').hidden = false;
  $('title').textContent = labels[session.fixture]; $('order').textContent = session.orderId || 'Order unavailable';
  $('payment').textContent = session.state.state === 'captured' ? 'Captured' : session.state.state === 'failed' ? 'Request failed' : 'Unresolved';
  $('payment').className = `badge ${session.state.state}`;
  $('effects').textContent = `${session.effects.length} recorded`;
  $('amount-context').textContent = session.mode === 'rehearsal' ? 'USD · synthetic' : 'USD · sandbox';
  $('trace').textContent = `Trace ${session.traceId.slice(0, 16)} · one checkout, one order`;
  $('export').href = `/api/checkouts/${session.id}/export`; $('export').download = `${session.fixture}-${session.id}.json`;
  notice(); renderTimeline(); renderAnalysis(); renderActions(); await recent();
}
async function recent() {
  const sessions = await api('/api/checkouts'); $('recent').replaceChildren();
  for (const s of sessions.slice(0, 5)) { const b = node('button', s.fixture.replaceAll('-', ' '), 'recent-item'); b.append(node('small', `${s.mode} · ${s.state.state} · ${s.id.slice(0, 6)}`)); b.onclick = () => run(async () => show(await api(`/api/checkouts/${s.id}`))); $('recent').append(b); }
}
$('create').onclick = () => run(async () => { if ($('mode').value === 'sandbox' && !settings.sandbox) throw new Error('PayPal sandbox credentials are missing. Use rehearsal while access is resolved.'); await show(await api('/api/checkouts', { mode: $('mode').value, fixture: $('fixture').value })); });
$('mode').onchange = () => { if (!active) notice(); };
$('ask-form').onsubmit = e => { e.preventDefault(); run(async () => { const b = $('ask'); b.textContent = 'Reading the evidence…'; try { await show(await api(`/api/checkouts/${active.id}/investigate`, { question: $('question').value })); } finally { b.textContent = 'Investigate this checkout ↗'; } }); };
await run(async () => {
  settings = await api('/api/config'); $('access').textContent = settings.sandbox ? 'Sandbox configured' : 'Rehearsal · sandbox access needed';
  const id = new URLSearchParams(location.search).get('checkout'); if (id) await show(await api(`/api/checkouts/${encodeURIComponent(id)}`)); else await recent();
});
