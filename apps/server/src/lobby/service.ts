import { ids, Match, Accept } from '@manalath/shared/lex.ts';
import type { TimeControl } from '@manalath/shared/match.ts';
import { resolveFirstMover, type FirstMover } from '@manalath/shared/lobby.ts';
import { challengeStore, type Challenge } from './store.js';
import { matches } from '../match/registry.js';
import { matchStore, type StrongRef } from '../match/store.js';

/** The repo operations the lobby needs, injectable so tests need no PDS. */
export type Repo = {
  create(did: string, collection: string, record: Record<string, unknown>): Promise<StrongRef>;
  delete(did: string, collection: string, rkey: string): Promise<void>;
  /** Public profile for a DID. */
  profile(did: string): Promise<{ name: string; handle: string | null; avatar: string | null }>;
};

export class LobbyError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** The DID this server writes as `arbiter` on challenges it hosts; unset means self-reported games. */
export const ARBITER_DID = process.env.ARBITER_DID || null;

export class LobbyService {
  constructor(private repo: Repo, private arbiter: string | null = ARBITER_DID) {}

  /** Publish a challenge: a top.manalath.match record in the challenger's repo. */
  async create(did: string, opts: { timeControl: TimeControl | null; opponent: string | null; firstMover: FirstMover; rated?: boolean; rematchOf?: string }): Promise<Challenge> {
    const rated = opts.rated ?? false;
    // Untimed games have no way to end when a player walks away, so they cannot count.
    if (rated && !opts.timeControl) throw new LobbyError(400, 'rated games need a clock');
    const createdAt = Date.now();
    const record = {
      $type: ids.TopManalathMatch,
      ...(opts.opponent ? { opponent: opts.opponent } : {}),
      firstMover: opts.firstMover,
      rules: { boardRadius: 4 },
      ...(opts.timeControl ? { timeControl: opts.timeControl } : {}),
      rated,
      ...(this.arbiter ? { arbiter: this.arbiter } : {}),
      createdAt: new Date(createdAt).toISOString(),
    };
    const v = Match.validateRecord(record);
    if (!v.success) throw new LobbyError(400, `invalid challenge: ${v.error?.message}`);
    const ref = await this.repo.create(did, ids.TopManalathMatch, record);
    challengeStore.insert({ ...ref, challenger: did, opponent: opts.opponent, firstMover: opts.firstMover, timeControl: opts.timeControl, createdAt, rematchOf: opts.rematchOf ?? null, rated });
    return challengeStore.get(ref.uri)!;
  }

  /**
   * Offer a rematch of a finished game: a direct challenge to the other player with the same
   * clock, and the player who moved second last time moving first. Idempotent per match.
   */
  async rematch(did: string, matchId: string): Promise<Challenge> {
    const existing = challengeStore.rematchOf(matchId);
    if (existing) return existing;
    const row = matchStore.load(matchId);
    if (!row) throw new LobbyError(404, 'no such match');
    if (!row.result) throw new LobbyError(409, 'the game is not over');
    const seat = row.seats.findIndex((s) => s.did === did);
    if (seat < 0) throw new LobbyError(403, 'you did not play this game');
    const other = row.seats[1 - seat].did;
    if (!other) throw new LobbyError(409, 'the other seat has no account');
    return this.create(did, { timeControl: row.config.timeControl, opponent: other, firstMover: seat === 1 ? 'challenger' : 'opponent', rated: !!row.config.rated, rematchOf: matchId });
  }

  rematchOf(matchId: string) {
    return challengeStore.rematchOf(matchId);
  }

  /**
   * Accept a challenge. First accept wins: the row is claimed synchronously before the accept
   * record is written, so a second accepter gets 409 even while the first write is in flight.
   */
  async accept(did: string, uri: string): Promise<string> {
    const c = challengeStore.get(uri);
    if (!c) throw new LobbyError(404, 'no such challenge');
    if (c.opponent && c.opponent !== did) throw new LobbyError(403, 'that challenge is for someone else');
    if (c.status === 'accepted' && c.matchId) throw new LobbyError(409, 'already accepted');
    if (!challengeStore.claim(uri)) throw new LobbyError(409, 'someone else got there first');
    try {
      const matchRef: StrongRef = { uri: c.uri, cid: c.cid };
      const record = { $type: ids.TopManalathAccept, match: matchRef, createdAt: new Date().toISOString() };
      const v = Accept.validateRecord(record);
      if (!v.success) throw new LobbyError(500, `invalid accept: ${v.error?.message}`);
      const acceptRef = await this.repo.create(did, ids.TopManalathAccept, record);

      const first = resolveFirstMover(c.firstMover, acceptRef.cid);
      const challenger = { did: c.challenger, ...(await this.repo.profile(c.challenger)) };
      const opponent = { did, ...(await this.repo.profile(did)) };
      const [s0, s1] = first === 'challenger' ? [challenger, opponent] : [opponent, challenger];
      const m = matches.create({ timeControl: c.timeControl, startPly: 0, rated: c.rated }, s0, s1, { matchRef, acceptRef });
      challengeStore.accepted(uri, m.id);
      return m.id;
    } catch (err) {
      challengeStore.release(uri);
      throw err;
    }
  }

  /** Withdraw an open challenge: delete the record and mark it cancelled. */
  async cancel(did: string, uri: string) {
    const c = challengeStore.get(uri);
    if (!c) throw new LobbyError(404, 'no such challenge');
    if (c.challenger !== did) throw new LobbyError(403, 'not your challenge');
    if (!challengeStore.cancel(uri)) throw new LobbyError(409, 'challenge is no longer open');
    await this.repo.delete(did, ids.TopManalathMatch, uri.split('/').pop()!);
  }

  async visible(me: string | null) {
    const rows = challengeStore.visible(me);
    const cache = new Map<string, Promise<{ name: string; handle: string | null; avatar: string | null }>>();
    const prof = (d: string) => { if (!cache.has(d)) cache.set(d, this.repo.profile(d)); return cache.get(d)!; };
    return Promise.all(rows.map(async (c) => ({
      ...c,
      challengerProfile: await prof(c.challenger),
      opponentProfile: c.opponent ? await prof(c.opponent) : null,
    })));
  }
}
