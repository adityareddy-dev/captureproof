const base = 'https://api-m.sandbox.paypal.com';

export class PayPal {
  constructor(config, fetcher = fetch) { this.config = config; this.fetch = fetcher; this.token = null; this.expires = 0; }
  async auth() {
    if (!this.config.clientId || !this.config.secret) throw new Error('PayPal sandbox credentials are missing.');
    if (this.token && this.expires > Date.now()) return this.token;
    const response = await this.fetch(`${base}/v1/oauth2/token`, {
      method: 'POST', signal: AbortSignal.timeout(15000),
      headers: { Authorization: `Basic ${Buffer.from(`${this.config.clientId}:${this.config.secret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
    });
    if (!response.ok) throw new Error(`PayPal sandbox authentication returned HTTP ${response.status}.`);
    const data = await response.json();
    if (!data.access_token) throw new Error('PayPal did not return an access token.');
    this.token = data.access_token; this.expires = Date.now() + Math.max(0, data.expires_in - 60) * 1000;
    return this.token;
  }
  async request(path, method = 'GET', body, requestId) {
    const token = await this.auth();
    const response = await this.fetch(base + path, {
      method, signal: AbortSignal.timeout(20000), redirect: 'error',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'return=representation', ...(requestId ? { 'PayPal-Request-Id': requestId } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    let data;
    try { data = await response.json(); } catch { throw new Error('PayPal returned an unreadable response. Reconcile before any other action.'); }
    return { status: response.status, body: data, debugId: response.headers.get('paypal-debug-id') };
  }
  create(session, requestId) {
    return this.request('/v2/checkout/orders', 'POST', {
      intent: 'CAPTURE', purchase_units: [{ reference_id: session.id, amount: { currency_code: 'USD', value: session.amount } }],
      payment_source: { paypal: { experience_context: {
        shipping_preference: 'NO_SHIPPING', user_action: 'PAY_NOW',
        return_url: `http://localhost:${this.config.port}/?checkout=${session.id}&approved=1`,
        cancel_url: `http://localhost:${this.config.port}/?checkout=${session.id}&cancelled=1`,
      } } },
    }, requestId);
  }
  get(id) { return this.request(`/v2/checkout/orders/${encodeURIComponent(id)}`); }
  capture(id, requestId) { return this.request(`/v2/checkout/orders/${encodeURIComponent(id)}/capture`, 'POST', {}, requestId); }
  verify(headers, event) {
    if (!this.config.webhookId) throw new Error('PayPal webhook verification is not configured.');
    return this.request('/v1/notifications/verify-webhook-signature', 'POST', {
      auth_algo: headers['paypal-auth-algo'], cert_url: headers['paypal-cert-url'],
      transmission_id: headers['paypal-transmission-id'], transmission_sig: headers['paypal-transmission-sig'],
      transmission_time: headers['paypal-transmission-time'], webhook_id: this.config.webhookId, webhook_event: event,
    });
  }
}
