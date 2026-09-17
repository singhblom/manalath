import { describe, expect, test } from 'bun:test';
import { MatchState, MatchError, type Action } from './match.js';
import { cells, N } from './hex.js';

const blitz = { timeControl: { base: 180, increment: 2 }, startPly: 0 };
const untimed = { timeControl: null, startPly: 0 };
const place = (q: number, r: number, color: 1 | 2): Action => ({ type: 'place', q, r, color });
const code = (fn: () => unknown) => {
  try { fn(); } catch (e) { return e instanceof MatchError ? e.code : `not a MatchError: ${e}`; }
  return 'no-throw';
};

describe('MatchState', () => {
  test('seat 0 moves first, turns alternate, plies count up', () => {
    const m = new MatchState(untimed, 0);
    expect(m.seatToMove).toBe(0);
    expect(() => m.apply(1, place(0, 0, 1), 1)).toThrow(MatchError);
    const ev = m.apply(0, place(0, 0, 1), 1);
    expect(ev).toHaveLength(1);
    expect(ev[0].ply).toBe(0);
    expect(m.seatToMove).toBe(1);
    expect(m.ply).toBe(1);
  });

  test('rejects occupied and off-board cells', () => {
    const m = new MatchState(untimed, 0);
    m.apply(0, place(0, 0, 1), 1);
    expect(code(() => m.apply(1, place(0, 0, 2), 2))).toBe('occupied');
    expect(code(() => m.apply(1, place(9, 9, 2), 2))).toBe('off-board');
  });

  test('a quint ends the game with the mover winning', () => {
    const m = new MatchState(untimed, 0);
    // Seat 0 builds colour 1 as a three and a separate one along r=0 (never a quart), then joins them.
    const own = [[-2, 0], [-1, 0], [0, 0], [2, 0]];
    const junk = [[-4, 4], [-2, 4], [0, 4], [2, 2]]; // pairwise non-adjacent
    let t = 1;
    for (let k = 0; k < 4; k++) {
      m.apply(0, place(own[k][0], own[k][1], 1), t++);
      m.apply(1, place(junk[k][0], junk[k][1], 2), t++);
    }
    expect(m.status).toBe('playing');
    m.apply(0, place(1, 0, 1), t++);
    expect(m.result).toEqual({ winner: 0, reason: 'quint' });
    expect(code(() => m.apply(1, place(4, 0, 2), t))).toBe('finished');
  });

  test('ending your turn on a quart loses', () => {
    const m = new MatchState(untimed, 0);
    let t = 1;
    m.apply(0, place(0, 0, 1), t++); m.apply(1, place(4, 0, 2), t++);
    m.apply(0, place(1, 0, 1), t++); m.apply(1, place(4, -1, 2), t++);
    m.apply(0, place(-1, 0, 1), t++); m.apply(1, place(3, 1, 2), t++);
    m.apply(0, place(2, 0, 1), t++); // quart of own colour at end of turn
    expect(m.result).toEqual({ winner: 1, reason: 'quart' });
  });

  test('resignation from either seat, any time', () => {
    const m = new MatchState(untimed, 0);
    m.apply(1, { type: 'resign' }, 1);
    expect(m.result).toEqual({ winner: 0, reason: 'resign' });
  });

  test('draw offer, implicit decline, acceptance', () => {
    const m = new MatchState(untimed, 0);
    m.apply(0, { type: 'offerDraw' }, 1);
    expect(m.drawOffer).toBe(0);
    expect(code(() => m.apply(0, { type: 'acceptDraw' }, 2))).toBe('no-offer');
    m.apply(0, place(0, 0, 1), 3);
    expect(m.drawOffer).toBe(0); // own move does not withdraw
    m.apply(1, place(1, 0, 1), 4);
    expect(m.drawOffer).toBeNull(); // opponent moving declines
    m.apply(1, { type: 'offerDraw' }, 5);
    m.apply(0, { type: 'acceptDraw' }, 6);
    expect(m.result).toEqual({ winner: null, reason: 'agreement' });
  });

  test('Fischer clock: charges elapsed time and adds increment', () => {
    const m = new MatchState(blitz, 1000);
    expect(m.clocks(1000)).toEqual([180_000, 180_000]);
    expect(m.clocks(6000)).toEqual([175_000, 180_000]); // only the mover's clock runs
    m.apply(0, place(0, 0, 1), 6000);
    expect(m.clocks(6000)).toEqual([177_000, 180_000]); // 175s + 2s increment
    expect(m.flagAt()).toBe(6000 + 180_000);
  });

  test('flag: move after time is up is refused, timeout ends the game', () => {
    const m = new MatchState(blitz, 0);
    expect(code(() => m.apply(0, place(0, 0, 1), 181_000))).toBe('flag');
    expect(code(() => m.apply(0, { type: 'timeout' }, 100))).toBe('time-left');
    expect(code(() => m.apply(1, { type: 'timeout' }, 181_000))).toBe('not-your-turn');
    m.apply(0, { type: 'timeout' }, 181_000);
    expect(m.result).toEqual({ winner: 1, reason: 'timeout' });
    expect(m.clocks(200_000)).toEqual([0, 180_000]);
  });

  test('voluntary pass is refused while a legal move exists', () => {
    const m = new MatchState(untimed, 0);
    expect(code(() => m.apply(0, { type: 'pass' }, 1))).toBe('must-move');
  });

  test('replay reproduces the state', () => {
    const m = new MatchState(blitz, 0);
    let t = 1000;
    m.apply(0, place(0, 0, 1), t += 1000);
    m.apply(1, { type: 'offerDraw' }, t += 1000);
    m.apply(1, place(1, 0, 2), t += 1000);
    m.apply(0, place(-1, 0, 2), t += 1000);
    const r = MatchState.replay(blitz, 0, JSON.parse(JSON.stringify(m.events)));
    expect(Array.from(r.game.board)).toEqual(Array.from(m.game.board));
    expect(r.seatToMove).toBe(m.seatToMove);
    expect(r.clocks(t)).toEqual(m.clocks(t));
    expect(r.ply).toBe(m.ply);
    expect(r.drawOffer).toBe(m.drawOffer);
  });

  test('startPly offsets ply numbering for forks', () => {
    const m = new MatchState({ timeControl: null, startPly: 24 }, 0);
    const [ev] = m.apply(0, place(0, 0, 1), 1);
    expect(ev.ply).toBe(24);
    expect(m.ply).toBe(25);
  });

  test('board is 61 cells', () => {
    expect(N).toBe(61);
    expect(cells[0]).toHaveProperty('q');
  });
});
