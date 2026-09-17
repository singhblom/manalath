import { Database } from 'bun:sqlite';

export const db = new Database(process.env.DB_PATH ?? 'manalath.sqlite', { create: true });
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS oauth_state (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS oauth_session (
    did        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  -- Browser cookie sessions: an opaque id mapped to the logged-in DID.
  CREATE TABLE IF NOT EXISTS web_session (
    sid        TEXT PRIMARY KEY,
    did        TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
`);

/** Small JSON key/value store over one table, matching the shape the OAuth client expects. */
export function jsonStore<T>(table: 'oauth_state' | 'oauth_session', keyCol: string, tsCol: string) {
  const get = db.query<{ value: string }, [string]>(`SELECT value FROM ${table} WHERE ${keyCol} = ?`);
  const set = db.query(`INSERT INTO ${table} (${keyCol}, value, ${tsCol}) VALUES (?, ?, ?)
                        ON CONFLICT(${keyCol}) DO UPDATE SET value = excluded.value, ${tsCol} = excluded.${tsCol}`);
  const del = db.query(`DELETE FROM ${table} WHERE ${keyCol} = ?`);
  return {
    async get(key: string): Promise<T | undefined> {
      const row = get.get(key);
      return row ? (JSON.parse(row.value) as T) : undefined;
    },
    async set(key: string, value: T): Promise<void> {
      set.run(key, JSON.stringify(value), Date.now());
    },
    async del(key: string): Promise<void> {
      del.run(key);
    },
  };
}

export const webSessions = {
  create(did: string): string {
    const sid = crypto.randomUUID();
    db.query('INSERT INTO web_session (sid, did, created_at) VALUES (?, ?, ?)').run(sid, did, Date.now());
    return sid;
  },
  lookup(sid: string): string | undefined {
    return db.query<{ did: string }, [string]>('SELECT did FROM web_session WHERE sid = ?').get(sid)?.did;
  },
  destroy(sid: string) {
    db.query('DELETE FROM web_session WHERE sid = ?').run(sid);
  },
};

// Authorization flows that never completed can be dropped after an hour.
setInterval(() => {
  db.query('DELETE FROM oauth_state WHERE created_at < ?').run(Date.now() - 3600_000);
}, 600_000).unref();
