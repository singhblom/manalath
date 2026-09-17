// Ratings as this appview derives them. The table is a cache of a pure function over the finished
// rated matches (see @manalath/shared/ratings.ts): it is rebuilt from scratch whenever a rated
// game finishes, so ordering never depends on when a result happened to arrive. Today the input is
// the server's own match table; the Jetstream indexer will feed the same fold from repo records.
import { db } from '../db.js';
import '../match/store.js'; // creates the matches tables the queries below prepare against
import type { LiveMatch } from '../match/live.js';
import type { Result } from '@manalath/shared/match.ts';
import { computeRatings, currentRd, rank, unrated, RATING_ALGORITHM, type Rating, type RatedGame, type RatingChange } from '@manalath/shared/ratings.ts';

db.exec(`
  CREATE TABLE IF NOT EXISTS ratings (
    did            TEXT PRIMARY KEY,
    rating         REAL NOT NULL,
    rd             REAL NOT NULL,
    vol            REAL NOT NULL,
    games          INTEGER NOT NULL,
    last_played_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS rating_changes (
    match_id  TEXT NOT NULL,
    seat      INTEGER NOT NULL,
    before    TEXT NOT NULL,             -- Rating JSON
    after     TEXT NOT NULL,             -- Rating JSON
    PRIMARY KEY (match_id, seat)
  );
`);

type RatingRow = { did: string; rating: number; rd: number; vol: number; games: number; last_played_at: number | null };

const q = {
  // Finished rated matches between two distinct accounts; finish time is the last event's server time.
  ratedGames: db.query<{ id: string; seats: string; result: string; finished_at: number }, []>(`
    SELECT m.id, m.seats, m.result,
           (SELECT MAX(json_extract(e.event, '$.at')) FROM match_events e WHERE e.match_id = m.id) AS finished_at
    FROM matches m
    WHERE m.result IS NOT NULL AND json_extract(m.config, '$.rated') = 1
      AND json_extract(m.seats, '$[0].did') IS NOT NULL AND json_extract(m.seats, '$[1].did') IS NOT NULL
      AND json_extract(m.seats, '$[0].did') != json_extract(m.seats, '$[1].did')`),
  clearRatings: db.query('DELETE FROM ratings'),
  clearChanges: db.query('DELETE FROM rating_changes'),
  insertRating: db.query('INSERT INTO ratings (did, rating, rd, vol, games, last_played_at) VALUES (?, ?, ?, ?, ?, ?)'),
  insertChange: db.query('INSERT INTO rating_changes (match_id, seat, before, after) VALUES (?, ?, ?, ?)'),
  get: db.query<RatingRow, [string]>('SELECT * FROM ratings WHERE did = ?'),
  top: db.query<RatingRow, [number]>('SELECT * FROM ratings ORDER BY rating DESC LIMIT ?'),
  changes: db.query<{ seat: number; before: string; after: string }, [string]>('SELECT seat, before, after FROM rating_changes WHERE match_id = ? ORDER BY seat'),
};

const toRating = (r: RatingRow): Rating => ({ rating: r.rating, rd: r.rd, vol: r.vol, games: r.games, lastPlayedAt: r.last_played_at });

/** The public shape (top.manalath.defs#playerRating): integers only, deviation as of `now`. */
export type PlayerRating = {
  did: string;
  rating: number;
  deviation: number;
  games: number;
  rank?: string;
  provisional: boolean;
  lastPlayedAt?: string;
  algorithm: string;
};

export function publicRating(did: string, r: Rating, now = Date.now()): PlayerRating {
  const rd = currentRd(r, now);
  const rk = rank({ rating: Math.round(r.rating), rd, games: r.games }); // rank from the rounded value so 1499.6 shows as 1500 and 6k
  return {
    did,
    rating: Math.round(r.rating),
    deviation: Math.round(rd),
    games: r.games,
    ...(rk ? { rank: rk.grade } : {}),
    provisional: rk?.provisional ?? true,
    ...(r.lastPlayedAt != null ? { lastPlayedAt: new Date(r.lastPlayedAt).toISOString() } : {}),
    algorithm: RATING_ALGORITHM,
  };
}

export const ratingService = {
  /** Rebuild the whole table from the finished rated matches. Cheap at this scale; always deterministic. */
  recompute: db.transaction(() => {
    const games: RatedGame[] = q.ratedGames.all().map((r) => {
      const seats = JSON.parse(r.seats) as { did: string }[];
      const result = JSON.parse(r.result) as Result;
      return { id: r.id, players: [seats[0].did, seats[1].did], winner: result.winner, finishedAt: r.finished_at };
    });
    const { ratings, changes } = computeRatings(games);
    q.clearRatings.run();
    q.clearChanges.run();
    for (const [did, r] of ratings) q.insertRating.run(did, r.rating, r.rd, r.vol, r.games, r.lastPlayedAt);
    for (const [id, [a, b]] of changes) {
      q.insertChange.run(id, 0, JSON.stringify(a.before), JSON.stringify(a.after));
      q.insertChange.run(id, 1, JSON.stringify(b.before), JSON.stringify(b.after));
    }
    return ratings.size;
  }),

  /** Registry hook: refresh once a rated game ends. */
  onMatch(m: LiveMatch, kind: 'seats' | 'start' | 'events') {
    if (kind === 'events' && m.finished && m.config.rated) ratingService.recompute();
  },

  get(did: string): Rating {
    const r = q.get.get(did);
    return r ? toRating(r) : unrated();
  },

  player: (did: string, now = Date.now()) => publicRating(did, ratingService.get(did), now),

  leaderboard(limit = 25, now = Date.now()): PlayerRating[] {
    return q.top.all(limit).map((r) => publicRating(r.did, toRating(r), now));
  },

  /** Before/after for both seats of a finished rated match, or null if it was not rated. */
  changes(matchId: string): [RatingChange, RatingChange] | null {
    const rows = q.changes.all(matchId);
    if (rows.length !== 2) return null;
    return rows.map((r) => ({ before: JSON.parse(r.before), after: JSON.parse(r.after) })) as [RatingChange, RatingChange];
  },

  /** Rating info to attach to a live match snapshot: each seat's current standing and, once over, the change. */
  forMatch(m: LiveMatch, now = Date.now()) {
    const seats = m.seats.map((s) => (s.did ? ratingService.player(s.did, now) : null));
    const change = m.finished ? ratingService.changes(m.id) : null;
    return {
      rated: !!m.config.rated,
      seats,
      change: change?.map((c) => ({ before: Math.round(c.before.rating), after: Math.round(c.after.rating), rank: rank({ ...c.after, rating: Math.round(c.after.rating) })?.label ?? null })) ?? null,
    };
  },

  /** DIDs that appear in the lobby response, mapped to their public rating. */
  many(dids: Iterable<string>, now = Date.now()) {
    const out: Record<string, PlayerRating> = {};
    for (const did of new Set(dids)) out[did] = ratingService.player(did, now);
    return out;
  },
};
