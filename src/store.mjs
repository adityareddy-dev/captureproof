import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export class Store {
  constructor(path = ':memory:') {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS effects (session_id TEXT PRIMARY KEY, capture_id TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS webhooks (session_id TEXT, event_id TEXT, PRIMARY KEY(session_id, event_id));`);
  }
  save(session) {
    this.db.prepare('INSERT INTO sessions VALUES (?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(session.id, JSON.stringify(session));
  }
  get(id) {
    const row = this.db.prepare('SELECT body FROM sessions WHERE id=?').get(id);
    if (!row) throw Object.assign(new Error('Checkout not found.'), { status: 404 });
    return JSON.parse(row.body);
  }
  list() { return this.db.prepare('SELECT body FROM sessions ORDER BY rowid DESC LIMIT 40').all().map(row => JSON.parse(row.body)); }
  fulfill(sessionId, captureId) {
    return this.db.prepare('INSERT OR IGNORE INTO effects VALUES (?,?)').run(sessionId, captureId).changes === 1;
  }
  effects(sessionId) { return this.db.prepare('SELECT capture_id FROM effects WHERE session_id=?').all(sessionId); }
  webhook(sessionId, eventId) {
    return this.db.prepare('INSERT OR IGNORE INTO webhooks VALUES (?,?)').run(sessionId, eventId).changes === 1;
  }
  close() { this.db.close(); }
}
