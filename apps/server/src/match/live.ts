import { MatchState, MatchError, type Action, type MatchConfig, type Seat, type Snapshot } from '@manalath/shared/match.ts';
import { matchStore, type MatchRow, type SeatInfo, type StrongRef } from './store.js';

export type LiveSnapshot = Snapshot & {
  id: string;
  seats: { name: string; did: string | null; handle: string | null; avatar: string | null; joined: boolean }[];
  /** 'waiting' until both seats have joined; then the game's own status. */
  phase: 'waiting' | 'playing' | 'finished';
};

export type MatchListener = (m: LiveMatch, kind: 'seats' | 'start' | 'events') => void;

/**
 * Rebuild state from stored events, stopping at the first one the rules reject instead of
 * refusing to load the match. That should not happen with a single server process, but a stale
 * hot-reloaded instance or a second process on the same database can append a bogus event.
 */
function replayTolerant(row: MatchRow): MatchState {
  const m = new MatchState(row.config, row.startedAt!);
  for (let i = 0; i < row.events.length; i++) {
    const e = row.events[i];
    try {
      m.apply(e.seat, e.action, e.at);
    } catch (err) {
      console.warn(`[match ${row.id}] ignoring stored event ${i} (${e.action.type}): ${(err as Error).message}`);
      break;
    }
  }
  return m;
}

/**
 * One match held in memory by the game server. Owns the authoritative MatchState, the flag timer,
 * persistence of accepted events, and fan-out to subscribers.
 */
export class LiveMatch {
  readonly id: string;
  readonly config: MatchConfig;
  seats: [SeatInfo, SeatInfo];
  startedAt: number | null;
  state: MatchState | null;
  private flagTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<MatchListener>();

  constructor(row: MatchRow) {
    this.id = row.id;
    this.config = row.config;
    this.seats = row.seats;
    this.startedAt = row.startedAt;
    this.state = row.startedAt !== null ? replayTolerant(row) : null;
    // A game that was mid-flight when the server went down may have flagged meanwhile.
    this.armFlag();
  }

  static create(id: string, config: MatchConfig, seats: [SeatInfo, SeatInfo], refs?: { matchRef: StrongRef; acceptRef: StrongRef }): LiveMatch {
    const row: MatchRow = { id, config, seats, createdAt: Date.now(), startedAt: null, result: null, matchRef: refs?.matchRef ?? null, acceptRef: refs?.acceptRef ?? null, events: [] };
    matchStore.create(row);
    return new LiveMatch(row);
  }

  /**
   * Which seat a connection may play. A seat token always wins (so one account can test both
   * sides); otherwise a logged-in player gets the first seat bound to their DID.
   */
  seatFor(token: string | null, did: string | null): Seat | null {
    if (token) {
      if (this.seats[0].token === token) return 0;
      if (this.seats[1].token === token) return 1;
    }
    if (did) {
      if (this.seats[0].did === did) return 0;
      if (this.seats[1].did === did) return 1;
    }
    return null;
  }

  /** Bind a logged-in player to an unclaimed seat. Silently keeps the existing binding otherwise. */
  claim(seat: Seat, did: string, p: { name: string; handle?: string | null; avatar?: string | null }) {
    const s = this.seats[seat];
    if (s.did && s.did !== did) throw new MatchError('seat-taken', 'that seat belongs to another player');
    if (s.did === did && s.name === p.name && s.avatar === (p.avatar ?? null)) return;
    s.did = did;
    s.name = p.name;
    s.handle = p.handle ?? null;
    s.avatar = p.avatar ?? null;
    matchStore.saveSeats(this.id, this.seats, this.startedAt);
    this.emit('seats');
  }

  /** Mark a seat as present. The clocks start the moment the second player arrives. */
  join(seat: Seat) {
    if (this.seats[seat].joined) return;
    this.seats[seat].joined = true;
    let started = false;
    if (this.seats[0].joined && this.seats[1].joined && this.startedAt === null) {
      this.startedAt = Date.now();
      this.state = new MatchState(this.config, this.startedAt);
      this.armFlag();
      started = true;
    }
    matchStore.saveSeats(this.id, this.seats, this.startedAt);
    this.emit(started ? 'start' : 'seats');
  }

  /** Apply a player's action. Throws MatchError; on success persists, re-arms the clock and broadcasts. */
  act(seat: Seat, action: Action, now = Date.now()) {
    if (!this.state) throw new MatchError('waiting', 'waiting for the other player');
    if (action.type === 'timeout') throw new MatchError('forbidden', 'only the server can flag a player');
    const events = this.state.apply(seat, action, now);
    matchStore.appendEvents(this.id, events, this.state.result);
    this.armFlag();
    this.emit('events');
    return events;
  }

  snapshot(now = Date.now()): LiveSnapshot {
    const seats = this.seats.map((s) => ({ name: s.name, did: s.did, handle: s.handle ?? null, avatar: s.avatar ?? null, joined: s.joined }));
    if (!this.state) {
      return {
        id: this.id, seats, phase: 'waiting', config: this.config, startedAt: 0, events: [], status: 'playing', result: null,
        seatToMove: 0, drawOffer: null, now,
        clocks: this.config.timeControl ? [this.config.timeControl.base * 1000, this.config.timeControl.base * 1000] : null,
      };
    }
    return { id: this.id, seats, phase: this.state.status, ...this.state.snapshot(now) };
  }

  subscribe(fn: MatchListener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  get finished() {
    return this.state?.result != null;
  }

  private emit(kind: 'seats' | 'start' | 'events') {
    for (const fn of this.listeners) fn(this, kind);
  }

  /** Schedule the timeout for the side to move. The server is the only clock authority. */
  private armFlag() {
    if (this.flagTimer) clearTimeout(this.flagTimer);
    this.flagTimer = null;
    const at = this.state?.flagAt();
    if (at == null) return;
    const fire = () => {
      if (!this.state || this.state.result) return;
      const now = Date.now();
      try {
        const events = this.state.apply(this.state.seatToMove, { type: 'timeout' }, now);
        matchStore.appendEvents(this.id, events, this.state.result);
        this.emit('events');
      } catch (err) {
        // Clock was bumped by a move that raced the timer; re-arm and carry on.
        if (err instanceof MatchError && err.code === 'time-left') this.armFlag();
        else console.error(`flag failed for ${this.id}`, err);
      }
    };
    this.flagTimer = setTimeout(fire, Math.max(0, at - Date.now()));
  }
}
