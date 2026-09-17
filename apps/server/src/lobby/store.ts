import { db } from '../db.js';
import type { TimeControl } from '@manalath/shared/match.ts';
import type { FirstMover } from '@manalath/shared/lobby.ts';

db.exec(`
  CREATE TABLE IF NOT EXISTS challenges (
    uri          TEXT PRIMARY KEY,        -- at-uri of the top.manalath.match record
    cid          TEXT NOT NULL,
    challenger   TEXT NOT NULL,           -- did
    opponent     TEXT,                    -- did, or NULL for an open challenge
    first_mover  TEXT NOT NULL,
    time_control TEXT,                    -- JSON or NULL for untimed
    created_at   INTEGER NOT NULL,
    status       TEXT NOT NULL,           -- open | accepting | accepted | cancelled
    match_id     TEXT,
    rematch_of   TEXT,                    -- match id this challenge is a rematch of
    rated        INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS challenges_status ON challenges(status, created_at);
`);
for (const [col, decl] of [['rematch_of', 'TEXT'], ['rated', 'INTEGER NOT NULL DEFAULT 0']]) {
  if (!db.query<{ name: string }, []>('PRAGMA table_info(challenges)').all().some((c) => c.name === col)) db.exec(`ALTER TABLE challenges ADD COLUMN ${col} ${decl}`);
}

export type Challenge = {
  uri: string;
  cid: string;
  challenger: string;
  opponent: string | null;
  firstMover: FirstMover;
  timeControl: TimeControl | null;
  createdAt: number;
  status: 'open' | 'accepting' | 'accepted' | 'cancelled';
  matchId: string | null;
  rematchOf: string | null;
  rated: boolean;
};

type Raw = { uri: string; cid: string; challenger: string; opponent: string | null; first_mover: string; time_control: string | null; created_at: number; status: string; match_id: string | null; rematch_of: string | null; rated: number };

const parse = (r: Raw): Challenge => ({
  uri: r.uri, cid: r.cid, challenger: r.challenger, opponent: r.opponent,
  firstMover: r.first_mover as FirstMover,
  timeControl: r.time_control ? JSON.parse(r.time_control) : null,
  createdAt: r.created_at, status: r.status as Challenge['status'], matchId: r.match_id, rematchOf: r.rematch_of, rated: r.rated === 1,
});

const q = {
  insert: db.query('INSERT INTO challenges (uri, cid, challenger, opponent, first_mover, time_control, created_at, status, rematch_of, rated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'),
  rematch: db.query<Raw, [string]>(`SELECT * FROM challenges WHERE rematch_of = ? AND status != 'cancelled' ORDER BY created_at DESC LIMIT 1`),
  get: db.query<Raw, [string]>('SELECT * FROM challenges WHERE uri = ?'),
  // Everything still open, plus anything of mine or for me that recently resolved (so the lobby can redirect).
  visible: db.query<Raw, [string, string, number]>(
    `SELECT * FROM challenges WHERE rematch_of IS NULL AND (status IN ('open', 'accepting') OR ((challenger = ? OR opponent = ?) AND created_at > ?)) ORDER BY created_at DESC LIMIT 100`),
  claim: db.query(`UPDATE challenges SET status = 'accepting' WHERE uri = ? AND status = 'open'`),
  release: db.query(`UPDATE challenges SET status = 'open' WHERE uri = ? AND status = 'accepting'`),
  accepted: db.query(`UPDATE challenges SET status = 'accepted', match_id = ? WHERE uri = ?`),
  cancel: db.query(`UPDATE challenges SET status = 'cancelled' WHERE uri = ? AND status = 'open'`),
};

export const challengeStore = {
  insert(c: Omit<Challenge, 'status' | 'matchId'>) {
    q.insert.run(c.uri, c.cid, c.challenger, c.opponent, c.firstMover, c.timeControl ? JSON.stringify(c.timeControl) : null, c.createdAt, 'open', c.rematchOf, c.rated ? 1 : 0);
  },
  rematchOf: (matchId: string) => { const r = q.rematch.get(matchId); return r ? parse(r) : undefined; },
  get: (uri: string) => { const r = q.get.get(uri); return r ? parse(r) : undefined; },
  visible: (me: string | null) => q.visible.all(me ?? '', me ?? '', Date.now() - 24 * 3600_000).map(parse),
  /** Atomically move an open challenge to `accepting`. Returns false if someone else got there first. */
  claim: (uri: string) => q.claim.run(uri).changes === 1,
  release: (uri: string) => q.release.run(uri),
  accepted: (uri: string, matchId: string) => q.accepted.run(matchId, uri),
  cancel: (uri: string) => q.cancel.run(uri).changes === 1,
};
