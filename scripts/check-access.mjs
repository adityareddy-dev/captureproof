import { config } from '../src/config.mjs';
import { PayPal } from '../src/paypal.mjs';

const cfg = config();
const results = { at: new Date().toISOString(), paypal: 'missing_credentials', gemini: 'missing_credentials', model: cfg.model };
if (cfg.clientId && cfg.secret) {
  try { await new PayPal(cfg).auth(); results.paypal = 'sandbox_oauth_succeeded'; }
  catch { results.paypal = 'sandbox_oauth_failed'; }
}
if (cfg.geminiKey && !cfg.freeModel) results.gemini = 'free_tier_not_confirmed';
if (cfg.geminiKey && cfg.freeModel) {
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.model)}:generateContent`, {
      method: 'POST', signal: AbortSignal.timeout(60000), headers: { 'x-goog-api-key': cfg.geminiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: 'Return JSON only: {"access":"ok"}' }] }], generationConfig: { responseMimeType: 'application/json', thinkingConfig: { thinkingLevel: 'low' }, maxOutputTokens: 1000 } }),
    });
    const body = await response.json();
    const text = body.candidates?.[0]?.content?.parts?.filter(p => !p.thought).map(p => p.text || '').join('');
    results.gemini = response.ok && JSON.parse(text).access === 'ok' ? 'free_tier_generation_succeeded' : `http_${response.status}`;
  } catch { results.gemini = 'generation_failed'; }
}
console.log(JSON.stringify(results, null, 2));
if (results.paypal !== 'sandbox_oauth_succeeded' || results.gemini !== 'free_tier_generation_succeeded') process.exitCode = 1;
