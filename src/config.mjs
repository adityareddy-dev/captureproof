import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export function config(env = process.env) {
  const values = { ...env };
  try {
    for (const line of readFileSync(env.CAPTUREPROOF_ENV || join(homedir(), '.hackathons/env'), 'utf8').split('\n')) {
      const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
      if (match && !values[match[1]]) values[match[1]] = match[2].trim().replace(/^(['"])(.*)\1$/, '$2');
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return {
    clientId: values.PAYPAL_CLIENT_ID || '', secret: values.PAYPAL_CLIENT_SECRET || '',
    webhookId: values.PAYPAL_WEBHOOK_ID || '', geminiKey: values.GEMINI_API_KEY || '',
    model: values.GEMINI_MODEL || 'gemini-3.5-flash-lite',
    freeModel: values.GEMINI_FREE_TIER_CONFIRMED === 'yes',
    port: Number(values.PORT || 4317), db: values.CAPTUREPROOF_DB || 'data/captureproof.sqlite',
  };
}
