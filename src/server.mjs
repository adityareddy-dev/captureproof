import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Store } from './store.mjs';
import { config } from './config.mjs';
import { PayPal } from './paypal.mjs';
import { Rehearsal } from './rehearsal.mjs';
import { Checkout, fixtures } from './checkout.mjs';
import { paymentState } from './evidence.mjs';
import { investigate } from './assistant.mjs';

async function readBody(req) {
  let text = '';
  for await (const chunk of req) {
    text += chunk;
    if (text.length > 65536) throw Object.assign(new Error('Request is too large.'), { status: 413 });
  }
  try { return text ? JSON.parse(text) : {}; } catch { throw Object.assign(new Error('Invalid JSON.'), { status: 400 }); }
}

export function application(cfg, store = new Store(cfg.db), sandbox = new PayPal(cfg)) {
  const checkout = new Checkout(store, sandbox, new Rehearsal());
  const modelBusy = new Set();
  const modelLast = new Map();
  const view = s => ({ ...s, state: paymentState(s), effects: store.effects(s.id) });
  const server = createServer(async (req, res) => {
    const send = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(data)); };
    try {
      const url = new URL(req.url, `http://localhost:${cfg.port}`);
      if (![ `localhost:${cfg.port}`, `127.0.0.1:${cfg.port}` ].includes(req.headers.host)) return send(403, { error: 'Local requests only.' });
      const webhook = url.pathname === '/api/webhook';
      if (req.method === 'POST' && !webhook) {
        const allowed = [`http://localhost:${cfg.port}`, `http://127.0.0.1:${cfg.port}`];
        if (!allowed.includes(req.headers.origin) || req.headers['x-captureproof'] !== 'local' || !req.headers['content-type']?.startsWith('application/json')) return send(403, { error: 'Use the local checkout page.' });
      }
      if (req.method === 'GET' && url.pathname === '/api/config') return send(200, { sandbox: Boolean(cfg.clientId && cfg.secret), model: Boolean(cfg.geminiKey && cfg.freeModel), modelName: cfg.model, fixtures });
      if (req.method === 'GET' && url.pathname === '/api/checkouts') return send(200, store.list().map(view));
      if (req.method === 'POST' && url.pathname === '/api/checkouts') { const body = await readBody(req); return send(201, view(await checkout.create(body.mode, body.fixture))); }
      if (req.method === 'POST' && webhook) { const body = await readBody(req); await checkout.webhook(req.headers, body); return send(200, { received: true }); }
      const match = url.pathname.match(/^\/api\/checkouts\/([a-f0-9-]+)(?:\/(reconcile|capture|approve|duplicate|investigate|export))?$/);
      if (match) {
        const [, id, action] = match;
        if (req.method === 'GET' && !action) return send(200, view(store.get(id)));
        if (req.method === 'GET' && action === 'export') {
          const s = store.get(id);
          return send(200, { format: 'captureproof-evidence-v1', exportedAt: new Date().toISOString(), redaction: 'Personal data and credentials omitted. Response hashes cover the retained fields only.', checkout: view(s) });
        }
        if (req.method === 'POST') {
          const body = await readBody(req);
          if (action === 'reconcile') return send(200, view(await checkout.reconcile(id)));
          if (action === 'approve') return send(200, view(await checkout.approve(id)));
          if (action === 'capture') return send(200, view(await checkout.capture(id, body)));
          if (action === 'duplicate') return send(200, view(await checkout.duplicate(id)));
          if (action === 'investigate') {
            if (modelBusy.has(id) || Date.now() - (modelLast.get(id) || 0) < 2000) return send(429, { error: 'Wait a moment before investigating again.' });
            modelBusy.add(id); modelLast.set(id, Date.now());
            try {
              const s = store.get(id); const count = s.events.length;
              const result = await investigate(s, String(body.question || 'Should I repeat the payment?'), cfg);
              const current = store.get(id);
              if (current.events.length !== count) return send(409, { error: 'Payment evidence changed during investigation. Ask again.' });
              current.investigation = { ...result, evidenceVersion: count }; store.save(current); return send(200, view(current));
            } finally { modelBusy.delete(id); }
          }
        }
      }
      const assets = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'] };
      if (req.method === 'GET' && assets[url.pathname]) {
        const [name, type] = assets[url.pathname];
        const content = await readFile(new URL(`../public/${name}`, import.meta.url));
        res.writeHead(200, { 'Content-Type': type, 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'", 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache' }); return res.end(content);
      }
      send(404, { error: 'Not found.' });
    } catch (error) { send(error.status || 500, { error: error.status ? error.message : 'The operation could not finish. Check access and reconcile before continuing.' }); }
  });
  return { server, store, checkout };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const cfg = config();
  const { server } = application(cfg);
  server.listen(cfg.port, '127.0.0.1', () => console.log(`CaptureProof is running at http://localhost:${cfg.port}`));
}
