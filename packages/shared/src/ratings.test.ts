import { describe, expect, test } from 'bun:test';
import { computeRatings, currentRd, glicko2, orderGames, rank, ratePair, unrated, type RatedGame } from './ratings.js';

const DAY = 24 * 3600_000;

describe('glicko2', () => {
  test('reproduces the worked example in Glickman\'s paper', () => {
    const r = glicko2({ rating: 1500, rd: 200, vol: 0.06 }, [
      { rating: 1400, rd: 30, score: 1 },
      { rating: 1550, rd: 100, score: 0 },
      { rating: 1700, rd: 300, score: 0 },
    ]);
    expect(r.rating).toBeCloseTo(1464.06, 1);
    expect(r.rd).toBeCloseTo(151.52, 1);
    expect(r.vol).toBeCloseTo(0.05999, 4);
  });

  test('no games only inflates the deviation, capped at 350', () => {
    const r = glicko2({ rating: 1600, rd: 100, vol: 0.06 }, [], 1);
    expect(r.rating).toBe(1600);
    expect(r.rd).toBeGreaterThan(100);
    expect(glicko2({ rating: 1600, rd: 340, vol: 0.06 }, [], 1e6).rd).toBe(350);
  });
});

describe('ratePair', () => {
  test('winner goes up, loser goes down, by the same amount for equal players', () => {
    const [a, b] = ratePair(unrated(), unrated(), 1, DAY);
    expect(a.rating).toBeGreaterThan(1500);
    expect(b.rating).toBeLessThan(1500);
    expect(a.rating - 1500).toBeCloseTo(1500 - b.rating, 6);
    expect(a.games).toBe(1);
    expect(a.lastPlayedAt).toBe(DAY);
    expect(a.rd).toBeLessThan(350);
  });

  test('a draw between equal players changes nothing but the deviation', () => {
    const [a, b] = ratePair(unrated(), unrated(), 0.5, DAY);
    expect(a.rating).toBeCloseTo(1500, 6);
    expect(b.rating).toBeCloseTo(1500, 6);
  });

  test('beating a stronger player is worth more than beating a weaker one', () => {
    const me = { ...unrated(), rd: 100, games: 10, lastPlayedAt: 0 };
    const [vsStrong] = ratePair(me, { ...unrated(), rating: 1800, rd: 60 }, 1, DAY);
    const [vsWeak] = ratePair(me, { ...unrated(), rating: 1200, rd: 60 }, 1, DAY);
    expect(vsStrong.rating - me.rating).toBeGreaterThan(vsWeak.rating - me.rating);
  });

  test('inactivity inflates the deviation before the game', () => {
    const me = { ...unrated(), rd: 60, games: 20, lastPlayedAt: 0 };
    const [soon] = ratePair(me, unrated(), 1, DAY);
    const [late] = ratePair(me, unrated(), 1, 400 * DAY);
    expect(late.rd).toBeGreaterThan(soon.rd);
    expect(currentRd(me, 400 * DAY)).toBeGreaterThan(currentRd(me, DAY));
    expect(currentRd(unrated(), 400 * DAY)).toBe(350);
  });
});

describe('rank', () => {
  test('maps the ladder with 1 dan at 2100 and 6 kyu at the default', () => {
    expect(rank({ rating: 2100, rd: 50 })!.grade).toBe('1d');
    expect(rank({ rating: 2099, rd: 50 })!.grade).toBe('1k');
    expect(rank({ rating: 2000, rd: 50 })!.grade).toBe('1k');
    expect(rank({ rating: 1999, rd: 50 })!.grade).toBe('2k');
    expect(rank({ rating: 1500, rd: 50 })!.grade).toBe('6k');
    expect(rank({ rating: 3400, rd: 50 })!.grade).toBe('9d');
    expect(rank({ rating: -1500, rd: 50 })!.grade).toBe('30k');
  });
  test('marks a wide deviation as provisional and hides unrated players', () => {
    expect(rank({ rating: 1500, rd: 200 })!.label).toBe('6k?');
    expect(rank({ rating: 1500, rd: 80 })!.label).toBe('6k');
    expect(rank({ rating: 1500, rd: 350, games: 0 })).toBeNull();
  });
});

describe('computeRatings', () => {
  const games: RatedGame[] = [
    { id: 'b', players: ['alice', 'bob'], winner: 0, finishedAt: 2 * DAY },
    { id: 'a', players: ['bob', 'carol'], winner: null, finishedAt: 2 * DAY },
    { id: 'c', players: ['carol', 'alice'], winner: 1, finishedAt: 1 * DAY },
  ];

  test('orders by finish time then id', () => {
    expect(orderGames(games).map((g) => g.id)).toEqual(['c', 'a', 'b']);
  });

  test('is a pure function of the game set, whatever order it arrives in', () => {
    const forward = computeRatings(games);
    const shuffled = computeRatings([games[1], games[2], games[0]]);
    for (const did of ['alice', 'bob', 'carol']) expect(shuffled.ratings.get(did)).toEqual(forward.ratings.get(did));
    expect(forward.ratings.get('alice')!.games).toBe(2);
    expect(forward.ratings.get('alice')!.rating).toBeGreaterThan(forward.ratings.get('bob')!.rating);
  });

  test('records per-game before/after for both seats and ignores self-play', () => {
    const { changes, ratings } = computeRatings([...games, { id: 'self', players: ['dave', 'dave'], winner: 0, finishedAt: 3 * DAY }]);
    expect(ratings.has('dave')).toBe(false);
    const [a, b] = changes.get('b')!;
    expect(a.before.games).toBe(1); // alice's second game
    expect(a.after.rating).toBeGreaterThan(a.before.rating);
    expect(b.after.rating).toBeLessThan(b.before.rating);
  });
});
