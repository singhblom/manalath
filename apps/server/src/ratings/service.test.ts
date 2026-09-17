import { describe, expect, test } from 'bun:test';

process.env.DB_PATH = ':memory:';
const { LobbyService } = await import('../lobby/service.js');
const { matches } = await import('../match/registry.js');
const { ratingService } = await import('./service.js');

let n = 0;
const records: Record<string, unknown>[] = [];
const repo = {
  async create(did: string, collection: string, record: Record<string, unknown>) { records.push(record); return { uri: `at://${did}/${collection}/${(++n).toString(36)}`, cid: 'bafyreigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi' }; },
  async delete() {},
  async profile(did: string) { const h = did.split(':').pop()!; return { name: h, handle: `${h}.test`, avatar: null }; },
};

async function play(lobby: InstanceType<typeof LobbyService>, challenger: string, opponent: string, rated: boolean, loser: 0 | 1) {
  const c = await lobby.create(challenger, { timeControl: { base: 60, increment: 0 }, opponent, firstMover: 'challenger', rated });
  const id = await lobby.accept(opponent, c.uri);
  const m = matches.get(id)!;
  m.join(0); m.join(1);
  m.act(loser, { type: 'resign' });
  return m;
}

describe('ratingService', () => {
  test('rated games move ratings; unrated games do not; the arbiter is stamped on the record', async () => {
    matches.onAll(ratingService.onMatch);
    const lobby = new LobbyService(repo, 'did:web:arbiter.test');
    expect(ratingService.player('did:plc:alice')).toMatchObject({ rating: 1500, deviation: 350, games: 0, provisional: true, algorithm: 'glicko2-v1' });
    expect(ratingService.player('did:plc:alice').rank).toBeUndefined();

    await play(lobby, 'did:plc:alice', 'did:plc:bob', false, 1);
    expect(ratingService.player('did:plc:alice').games).toBe(0);

    const m = await play(lobby, 'did:plc:alice', 'did:plc:bob', true, 1); // bob resigns
    const alice = ratingService.player('did:plc:alice');
    const bob = ratingService.player('did:plc:bob');
    expect(alice.games).toBe(1);
    expect(alice.rating).toBeGreaterThan(1500);
    expect(bob.rating).toBeLessThan(1500);
    expect(alice.rank).toMatch(/k$/);
    expect(alice.provisional).toBe(true);

    const info = ratingService.forMatch(m);
    expect(info.rated).toBe(true);
    expect(info.change![0].before).toBe(1500);
    expect(info.change![0].after).toBe(alice.rating);
    expect(ratingService.leaderboard(10).map((p) => p.did)).toEqual(['did:plc:alice', 'did:plc:bob']);

    const { challengeStore } = await import('../lobby/store.js');
    const c = await lobby.create('did:plc:alice', { timeControl: { base: 60, increment: 0 }, opponent: null, firstMover: 'random', rated: true });
    expect(challengeStore.get(c.uri)!.rated).toBe(true);
    expect(records.at(-1)).toMatchObject({ $type: 'top.manalath.match', rated: true, arbiter: 'did:web:arbiter.test' });
  });

  test('rated untimed challenges are refused', async () => {
    const lobby = new LobbyService(repo, null);
    await expect(lobby.create('did:plc:alice', { timeControl: null, opponent: null, firstMover: 'random', rated: true })).rejects.toThrow('rated games need a clock');
  });

  test('recompute is idempotent', () => {
    const before = ratingService.player('did:plc:alice');
    ratingService.recompute();
    expect(ratingService.player('did:plc:alice')).toEqual(before);
  });
});
