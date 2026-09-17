import { describe, expect, test } from 'bun:test';

process.env.DB_PATH = ':memory:';
const { matches } = await import('./registry.js');

describe('LiveMatch', () => {
  test('clocks start when the second seat joins and the server flags the player to move', async () => {
    const m = matches.create({ timeControl: { base: 1, increment: 0 }, startPly: 0 });
    expect(m.snapshot().phase).toBe('waiting');
    m.join(0);
    expect(m.snapshot().phase).toBe('waiting');
    const snaps: string[] = [];
    m.subscribe((lm) => snaps.push(lm.snapshot().phase));
    m.join(1);
    expect(m.snapshot().phase).toBe('playing');
    await Bun.sleep(1200);
    const s = m.snapshot();
    expect(s.phase).toBe('finished');
    expect(s.result).toEqual({ winner: 1, reason: 'timeout' });
    expect(s.events.at(-1)?.action.type).toBe('timeout');
    expect(snaps).toEqual(['playing', 'finished']);
  });

  test('a move re-arms the flag for the other player', async () => {
    const m = matches.create({ timeControl: { base: 1, increment: 0 }, startPly: 0 });
    m.join(0); m.join(1);
    await Bun.sleep(500);
    m.act(0, { type: 'place', q: 0, r: 0, color: 1 });
    await Bun.sleep(700); // seat 0 would have flagged by now; seat 1 still has ~300ms
    expect(m.snapshot().phase).toBe('playing');
    await Bun.sleep(400);
    expect(m.snapshot().result).toEqual({ winner: 0, reason: 'timeout' });
  });

  test('state is rebuilt from the database and spectators get no seat', () => {
    const m = matches.create({ timeControl: null, startPly: 0 });
    m.join(0); m.join(1);
    m.act(0, { type: 'place', q: 1, r: -1, color: 2 });
    const { matchStore } = require('./store.js');
    const { LiveMatch } = require('./live.js');
    const reloaded = new LiveMatch(matchStore.load(m.id));
    expect(reloaded.snapshot().events).toHaveLength(1);
    expect(reloaded.snapshot().seatToMove).toBe(1);
    expect(reloaded.seatFor(null, null)).toBeNull();
    expect(reloaded.seatFor(null, 'did:plc:nobody')).toBeNull();
    expect(reloaded.seatFor(m.seats[1].token, null)).toBe(1);
  });
});
