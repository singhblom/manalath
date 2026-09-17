import { db } from '../db.js';
import type { MatchConfig, MatchEvent, Result } from '@manalath/shared/match.ts';

db.exec(`
  CREATE TABLE IF NOT EXISTS matches (
    id          TEXT PRIMARY KEY,
    config      TEXT NOT NULL,           -- MatchConfig JSON
    seats       TEXT NOT NULL,           -- SeatInfo[2] JSON
    created_at  INTEGER NOT NULL,
    started_at  INTEGER,                 -- both seats present; clocks start here
    result      TEXT,                    -- Result JSON once finished
    match_ref   TEXT,                    -- strongRef JSON of the top.manalath.match record
    accept_ref  TEXT                     -- strongRef JSON of the top.manalath.accept record
  );
  CREATE TABLE IF NOT EXISTS match_events (
    match_id    TEXT NOT NULL REFERENCES matches(id),
    seq         INTEGER NOT NULL,
    event       TEXT NOT NULL,           -- MatchEvent JSON
    PRIMARY KEY (match_id, seq)
  );
  -- One row per event successfully written to a player's repo as an top.manalath.move.
  CREATE TABLE IF NOT EXISTS record_writes (
    match_id    TEXT NOT NULL REFERENCES matches(id),
    seq         INTEGER NOT NULL,
    uri         TEXT NOT NULL,
    cid         TEXT NOT NULL,
    written_at  INTEGER NOT NULL,
    PRIMARY KEY (match_id, seq)
  );
  CREATE TABLE IF NOT EXISTS players (
    did          TEXT PRIMARY KEY,
    handle       TEXT,
    display_name TEXT,
    avatar       TEXT,
    updated_at   INTEGER NOT NULL
  );
`);
for (const col of ['display_name', 'avatar']) {
  const has = db.query<{ name: string }, []>('PRAGMA table_info(players)').all().some((c) => c.name === col);
  if (!has) db.exec(`ALTER TABLE players ADD COLUMN ${col} TEXT`);
}
// Columns added after the first dev databases were created.
for (const col of ['match_ref', 'accept_ref']) {
  const has = db.query<{ name: string }, []>('PRAGMA table_info(matches)').all().some((c) => c.name === col);
  if (!has) db.exec(`ALTER TABLE matches ADD COLUMN ${col} TEXT`);
}

export type StrongRef = { uri: string; cid: string };

/** Who sits in a seat. `token` is the join secret; `did` is bound when a logged-in player claims it. */
export type SeatInfo = { token: string; did: string | null; name: string; handle?: string | null; avatar?: string | null; joined: boolean };

export type MatchRow = {
  id: string;
  config: MatchConfig;
  seats: [SeatInfo, SeatInfo];
  createdAt: number;
  startedAt: number | null;
  result: Result | null;
  matchRef: StrongRef | null;
  acceptRef: StrongRef | null;
  events: MatchEvent[];
};

type Raw = { id: string; config: string; seats: string; created_at: number; started_at: number | null; result: string | null; match_ref: string | null; accept_ref: string | null };

const q = {
  insert: db.query('INSERT INTO matches (id, config, seats, created_at, started_at, result, match_ref, accept_ref) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'),
  get: db.query<Raw, [string]>('SELECT * FROM matches WHERE id = ?'),
  events: db.query<{ event: string }, [string]>('SELECT event FROM match_events WHERE match_id = ? ORDER BY seq'),
  seats: db.query('UPDATE matches SET seats = ?, started_at = ? WHERE id = ?'),
  result: db.query('UPDATE matches SET result = ? WHERE id = ?'),
  matchRef: db.query('UPDATE matches SET match_ref = ? WHERE id = ?'),
  acceptRef: db.query('UPDATE matches SET accept_ref = ? WHERE id = ?'),
  event: db.query('INSERT INTO match_events (match_id, seq, event) VALUES (?, ?, ?)'),
  count: db.query<{ n: number }, [string]>('SELECT COUNT(*) AS n FROM match_events WHERE match_id = ?'),
  recent: db.query<Raw, []>('SELECT * FROM matches ORDER BY created_at DESC LIMIT 50'),
  forPlayer: db.query<Raw, [string, string]>(
    `SELECT * FROM matches WHERE json_extract(seats, '$[0].did') = ? OR json_extract(seats, '$[1].did') = ? ORDER BY created_at DESC LIMIT 30`),
  unsynced: db.query<{ id: string }, []>(
    `SELECT m.id FROM matches m WHERE m.started_at IS NOT NULL AND
       (SELECT COUNT(*) FROM match_events e WHERE e.match_id = m.id) > (SELECT COUNT(*) FROM record_writes w WHERE w.match_id = m.id)`),
  writes: db.query<{ seq: number; uri: string; cid: string }, [string]>('SELECT seq, uri, cid FROM record_writes WHERE match_id = ? ORDER BY seq'),
  write: db.query('INSERT INTO record_writes (match_id, seq, uri, cid, written_at) VALUES (?, ?, ?, ?, ?)'),
  player: db.query<{ handle: string | null; display_name: string | null; avatar: string | null; updated_at: number }, [string]>('SELECT handle, display_name, avatar, updated_at FROM players WHERE did = ?'),
  upsertPlayer: db.query(`INSERT INTO players (did, handle, display_name, avatar, updated_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(did) DO UPDATE SET handle = excluded.handle, display_name = excluded.display_name, avatar = excluded.avatar, updated_at = excluded.updated_at`),
};

const parse = (r: Raw, events: MatchEvent[]): MatchRow => ({
  id: r.id,
  config: JSON.parse(r.config),
  seats: JSON.parse(r.seats),
  createdAt: r.created_at,
  startedAt: r.started_at,
  result: r.result ? JSON.parse(r.result) : null,
  matchRef: r.match_ref ? JSON.parse(r.match_ref) : null,
  acceptRef: r.accept_ref ? JSON.parse(r.accept_ref) : null,
  events,
});

export const matchStore = {
  create(row: Omit<MatchRow, 'events'>) {
    q.insert.run(row.id, JSON.stringify(row.config), JSON.stringify(row.seats), row.createdAt, row.startedAt, row.result ? JSON.stringify(row.result) : null,
      row.matchRef ? JSON.stringify(row.matchRef) : null, row.acceptRef ? JSON.stringify(row.acceptRef) : null);
  },
  load(id: string): MatchRow | undefined {
    const r = q.get.get(id);
    if (!r) return undefined;
    return parse(r, q.events.all(id).map((e) => JSON.parse(e.event)));
  },
  saveSeats(id: string, seats: [SeatInfo, SeatInfo], startedAt: number | null) {
    q.seats.run(JSON.stringify(seats), startedAt, id);
  },
  appendEvents: db.transaction((id: string, events: MatchEvent[], result: Result | null) => {
    let seq = q.count.get(id)!.n;
    for (const e of events) q.event.run(id, seq++, JSON.stringify(e));
    if (result) q.result.run(JSON.stringify(result), id);
  }),
  setMatchRef: (id: string, ref: StrongRef) => q.matchRef.run(JSON.stringify(ref), id),
  setAcceptRef: (id: string, ref: StrongRef) => q.acceptRef.run(JSON.stringify(ref), id),
  writes: (id: string) => q.writes.all(id),
  recordWrite: (id: string, seq: number, ref: StrongRef) => q.write.run(id, seq, ref.uri, ref.cid, Date.now()),
  unsynced: () => q.unsynced.all().map((r) => r.id),
  recent: () => q.recent.all().map((r) => parse(r, [])),
  forPlayer: (did: string) => q.forPlayer.all(did, did).map((r) => parse(r, [])),
  eventCount: (id: string) => q.count.get(id)!.n,
  player(did: string) {
    const r = q.player.get(did);
    return r ? { handle: r.handle, displayName: r.display_name, avatar: r.avatar, updatedAt: r.updated_at } : undefined;
  },
  savePlayer: (did: string, p: { handle: string | null; displayName: string | null; avatar: string | null }) =>
    q.upsertPlayer.run(did, p.handle, p.displayName, p.avatar, Date.now()),
};
