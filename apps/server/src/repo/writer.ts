// Repo writer: mirrors accepted match events into the players' ATProto repos.
//
// The live game never waits for this. Each match has a serial queue; every event becomes one
// top.manalath.move record in the mover's repo, chained to the previous record by strong ref.
// Failures back off and retry; on startup every match with unwritten events is resumed.
import { ids, Match, Accept, Move } from '@manalath/shared/lex.ts';
import type { MatchEvent } from '@manalath/shared/match.ts';
import { agentFor, type OAuthClient } from '../auth.js';
import { matchStore, type MatchRow, type StrongRef } from '../match/store.js';
import type { LiveMatch } from '../match/live.js';

const MAX_BACKOFF = 5 * 60_000;

export type CreateRecord = (did: string, collection: string, record: Record<string, unknown>) => Promise<StrongRef>;

export class RepoWriter {
  private running = new Set<string>();
  private pending = new Set<string>();
  private backoff = new Map<string, number>();
  private create: CreateRecord;

  constructor(oauth: OAuthClient | null, create?: CreateRecord) {
    this.create = create ?? (async (did, collection, record) => {
      if (!oauth) throw new Error('no OAuth client');
      const agent = await agentFor(oauth, did);
      if (!agent) throw new Error(`no OAuth session for ${did}`);
      const t0 = performance.now();
      const res = await agent.com.atproto.repo.createRecord({ repo: did, collection, record });
      console.log(`[writer] ${collection} -> ${res.data.uri} (${Math.round(performance.now() - t0)} ms)`);
      return { uri: res.data.uri, cid: res.data.cid };
    });
  }

  /** Resolves once no sync is running or pending (for tests). */
  async idle() {
    while (this.running.size || this.pending.size) await Bun.sleep(10);
  }

  /** Hook for the match registry: any change to a live match schedules a sync. */
  onMatch = (m: LiveMatch, kind: 'seats' | 'start' | 'events') => {
    if (kind === 'seats' && m.startedAt === null) return; // nothing to write before the start
    this.enqueue(m.id);
  };

  /** Resume matches that still have unwritten events, e.g. after a restart. */
  resumeAll() {
    for (const id of matchStore.unsynced()) this.enqueue(id);
  }

  enqueue(id: string) {
    if (this.running.has(id)) { this.pending.add(id); return; }
    this.running.add(id);
    this.drain(id)
      .then((ok) => {
        this.running.delete(id);
        // On failure the backoff timer owns the retry; anything queued meanwhile is picked up then.
        if (!ok) this.pending.delete(id);
        else if (this.pending.delete(id)) this.enqueue(id);
      });
  }

  /** Sync one match. Resolves true on success, false if a retry has been scheduled. */
  private async drain(id: string): Promise<boolean> {
    const row = matchStore.load(id);
    if (!row || row.startedAt === null) return true;
    try {
      await this.sync(row);
      this.backoff.delete(id);
      return true;
    } catch (err) {
      const wait = Math.min(MAX_BACKOFF, (this.backoff.get(id) ?? 1000) * 2);
      this.backoff.set(id, wait);
      console.warn(`[writer ${id}] ${(err as Error).message}; retrying in ${wait / 1000}s`);
      setTimeout(() => this.enqueue(id), wait).unref?.();
      return false;
    }
  }

  private async sync(row: MatchRow) {
    const [s0, s1] = row.seats;
    // Match and accept records first; moves need the match ref.
    if (!row.matchRef) {
      if (!s0.did) return; // anonymous challenger: nothing can be written for this match
      const record = {
        $type: ids.TopManalathMatch,
        ...(s1.did ? { opponent: s1.did } : {}),
        firstMover: 'challenger',
        rules: { boardRadius: 4 },
        ...(row.config.timeControl ? { timeControl: row.config.timeControl } : {}),
        rated: !!row.config.rated,
        createdAt: new Date(row.createdAt).toISOString(),
      };
      assertValid(Match.validateRecord(record));
      row.matchRef = await this.create(s0.did, ids.TopManalathMatch, record);
      matchStore.setMatchRef(row.id, row.matchRef);
    }
    if (!row.acceptRef && s1.did) {
      const record = { $type: ids.TopManalathAccept, match: row.matchRef, createdAt: new Date(row.startedAt!).toISOString() };
      assertValid(Accept.validateRecord(record));
      row.acceptRef = await this.create(s1.did, ids.TopManalathAccept, record);
      matchStore.setAcceptRef(row.id, row.acceptRef);
    }

    const written = matchStore.writes(row.id);
    let prev: StrongRef | null = written.length ? { uri: written.at(-1)!.uri, cid: written.at(-1)!.cid } : null;
    for (let seq = written.length; seq < row.events.length; seq++) {
      const ev = row.events[seq];
      const did = row.seats[ev.seat].did;
      if (!did) throw new Error(`seat ${ev.seat} has no DID; cannot write ply ${ev.ply}`);
      const record = moveRecord(row.matchRef, ev, prev);
      assertValid(Move.validateRecord(record));
      const ref = await this.create(did, ids.TopManalathMove, record);
      matchStore.recordWrite(row.id, seq, ref);
      prev = ref;
    }
  }
}

export function moveRecord(match: StrongRef, ev: MatchEvent, prev: StrongRef | null) {
  const a = ev.action;
  const action = a.type === 'place'
    ? { $type: `${ids.TopManalathMove}#place`, q: a.q, r: a.r, color: a.color }
    : { $type: `${ids.TopManalathMove}#${a.type}` };
  return {
    $type: ids.TopManalathMove,
    match,
    ply: ev.ply,
    ...(prev ? { prev } : {}),
    action,
    ...(ev.clocks ? { clock: { remainingMs: ev.clocks[ev.seat] } } : {}),
    createdAt: new Date(ev.at).toISOString(),
  };
}

function assertValid(r: { success: boolean; error?: Error }) {
  if (!r.success) throw new Error(`record failed lexicon validation: ${r.error?.message}`);
}
