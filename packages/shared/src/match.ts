// Match state machine shared by the game server and the browser client.
//
// A match is two seats (0 and 1) playing one Game. Seat 0 always makes the first ply after the
// root and owns colour 1 for end-of-turn checks; seat 1 owns colour 2. Everything that changes
// the match is an Action applied by a seat at a server timestamp; the resulting MatchEvent list
// fully determines the state, so clients rebuild it with `MatchState.replay`.
//
// Ply numbering is absolute depth in the move tree (see the top.manalath.move lexicon). Actions
// that do not consume a turn (offerDraw) carry the ply they were made at.

// @ts-ignore -- plain JS module without types
import { Game } from './game.js';
// @ts-ignore
import { cells, indexOf } from './hex.js';

export type Seat = 0 | 1;
export type TimeControl = { base: number; increment: number }; // seconds

export type Action =
  | { type: 'place'; q: number; r: number; color: 1 | 2 }
  | { type: 'pass' }
  | { type: 'resign' }
  | { type: 'offerDraw' }
  | { type: 'acceptDraw' }
  | { type: 'timeout' };

export type MatchEvent = {
  ply: number;
  seat: Seat;
  action: Action;
  /** Server time in ms when the action was accepted. */
  at: number;
  /** Both players' remaining time in ms after this event, or null in untimed games. */
  clocks: [number, number] | null;
};

export type ResultReason = 'quint' | 'quart' | 'resign' | 'timeout' | 'agreement' | 'passes' | 'full';
export type Result = { winner: Seat | null; reason: ResultReason };

export type MatchConfig = {
  timeControl: TimeControl | null;
  /** Ply of the first move of this match (0 for a fresh game, root.ply + 1 for a fork). */
  startPly: number;
  /** Counts towards the players' ratings once finished. */
  rated?: boolean;
};

export class MatchError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

export type Snapshot = {
  config: MatchConfig;
  /** Server time the clocks started; replay events against this. */
  startedAt: number;
  events: MatchEvent[];
  status: 'playing' | 'finished';
  result: Result | null;
  seatToMove: Seat;
  drawOffer: Seat | null;
  /** Remaining time per seat as of `now`, or null in untimed games. */
  clocks: [number, number] | null;
  now: number;
};

export class MatchState {
  readonly game: any;
  readonly events: MatchEvent[] = [];
  result: Result | null = null;
  drawOffer: Seat | null = null;
  /** Remaining time banked for each seat at the start of the current turn (ms). */
  private bank: [number, number] | null;
  /** When the current turn started; the mover's clock has been running since then. */
  private turnStartedAt: number;
  readonly startedAt: number;

  constructor(readonly config: MatchConfig, startedAt: number, game?: any) {
    this.game = game ?? new Game();
    this.startedAt = startedAt;
    const tc = config.timeControl;
    this.bank = tc ? [tc.base * 1000, tc.base * 1000] : null;
    this.turnStartedAt = startedAt;
  }

  static replay(config: MatchConfig, startedAt: number, events: MatchEvent[], game?: any): MatchState {
    const m = new MatchState(config, startedAt, game);
    for (const e of events) m.apply(e.seat, e.action, e.at);
    return m;
  }

  get status(): 'playing' | 'finished' {
    return this.result ? 'finished' : 'playing';
  }

  get seatToMove(): Seat {
    return (this.game.player - 1) as Seat;
  }

  /** Current ply: the depth at which the next move will be recorded. */
  get ply(): number {
    return this.config.startPly + this.game.moveCount;
  }

  /** Remaining time for a seat at time `now`. */
  remaining(seat: Seat, now: number): number | null {
    if (!this.bank) return null;
    const banked = this.bank[seat];
    if (this.result || seat !== this.seatToMove) return banked;
    return Math.max(0, banked - (now - this.turnStartedAt));
  }

  clocks(now: number): [number, number] | null {
    if (!this.bank) return null;
    return [this.remaining(0, now)!, this.remaining(1, now)!];
  }

  /** Server time at which the seat to move runs out of time, or null. */
  flagAt(): number | null {
    if (!this.bank || this.result) return null;
    return this.turnStartedAt + this.bank[this.seatToMove];
  }

  snapshot(now: number): Snapshot {
    return {
      config: this.config,
      startedAt: this.startedAt,
      events: this.events,
      status: this.status,
      result: this.result,
      seatToMove: this.seatToMove,
      drawOffer: this.drawOffer,
      clocks: this.clocks(now),
      now,
    };
  }

  /**
   * Apply an action. Returns the events appended (the action itself plus any forced passes).
   * Throws MatchError if the action is not allowed; state is unchanged in that case.
   */
  apply(seat: Seat, action: Action, now: number): MatchEvent[] {
    if (this.result) throw new MatchError('finished', 'the game is over');
    const appended: MatchEvent[] = [];
    const push = (s: Seat, a: Action) => {
      const ev: MatchEvent = { ply: this.ply, seat: s, action: a, at: now, clocks: this.clocks(now) };
      this.events.push(ev);
      appended.push(ev);
      return ev;
    };

    switch (action.type) {
      case 'place':
      case 'pass': {
        if (seat !== this.seatToMove) throw new MatchError('not-your-turn', 'not your turn');
        this.chargeClock(seat, now);
        if (action.type === 'place') {
          const i = indexOf(action.q, action.r);
          if (i < 0) throw new MatchError('off-board', 'cell is not on the board');
          if (this.game.board[i] !== 0) throw new MatchError('occupied', 'cell is occupied');
          if (!this.game.isLegal(i, action.color)) throw new MatchError('illegal', 'that would make a group larger than five');
          this.game.place(i, action.color);
        } else {
          if (!this.game.mustPass()) throw new MatchError('must-move', 'you have a legal move and may not pass');
          this.game.pass();
        }
        // The event records the ply it was played at, so push after the game advanced the count.
        appended.push(this.recordAfterMove(seat, action, now));
        if (this.drawOffer !== null && this.drawOffer !== seat) this.drawOffer = null; // implicit decline
        this.settleGame();
        this.autoPass(now, appended);
        break;
      }
      case 'resign':
        push(seat, action);
        this.result = { winner: (1 - seat) as Seat, reason: 'resign' };
        break;
      case 'offerDraw':
        if (this.drawOffer === seat) throw new MatchError('already-offered', 'you already offered a draw');
        this.drawOffer = seat;
        push(seat, action);
        break;
      case 'acceptDraw':
        if (this.drawOffer === null || this.drawOffer === seat) throw new MatchError('no-offer', 'there is no draw offer to accept');
        push(seat, action);
        this.result = { winner: null, reason: 'agreement' };
        break;
      case 'timeout': {
        if (seat !== this.seatToMove) throw new MatchError('not-your-turn', 'only the player to move can be flagged');
        const rem = this.remaining(seat, now);
        if (rem === null) throw new MatchError('untimed', 'this game has no clock');
        if (rem > 0) throw new MatchError('time-left', 'player still has time');
        if (this.bank) this.bank[seat] = 0;
        push(seat, action);
        this.result = { winner: (1 - seat) as Seat, reason: 'timeout' };
        break;
      }
    }
    return appended;
  }

  private chargeClock(seat: Seat, now: number) {
    if (!this.bank) return;
    const rem = this.remaining(seat, now)!;
    if (rem <= 0) throw new MatchError('flag', 'out of time');
    this.bank[seat] = rem + this.config.timeControl!.increment * 1000;
    this.turnStartedAt = now;
  }

  private recordAfterMove(seat: Seat, action: Action, now: number): MatchEvent {
    const ev: MatchEvent = { ply: this.ply - 1, seat, action, at: now, clocks: this.clocks(now) };
    this.events.push(ev);
    return ev;
  }

  private settleGame() {
    const g = this.game;
    if (g.status === 'won') this.result = { winner: (g.winner - 1) as Seat, reason: 'quint' };
    else if (g.status === 'lost') this.result = { winner: (g.winner - 1) as Seat, reason: 'quart' };
    else if (g.status === 'draw') this.result = { winner: null, reason: g.passes >= 2 ? 'passes' : 'full' };
  }

  /** A player with no legal placement must pass; the server does it for them at zero cost. */
  private autoPass(now: number, appended: MatchEvent[]) {
    while (!this.result && this.game.mustPass()) {
      const seat = this.seatToMove;
      if (this.bank) this.bank[seat] += this.config.timeControl!.increment * 1000;
      this.turnStartedAt = now;
      this.game.pass();
      appended.push(this.recordAfterMove(seat, { type: 'pass' }, now));
      this.settleGame();
    }
  }
}

/** Axial coordinates of a board cell index, for building place actions. */
export function cellCoords(i: number): { q: number; r: number } {
  const c = cells[i];
  return { q: c.q, r: c.r };
}
