import { describe, expect, test } from 'bun:test';

process.env.DB_PATH = ':memory:';
const { matches } = await import('../match/registry.js');
const { matchStore } = await import('../match/store.js');
const { RepoWriter, moveRecord } = await import('./writer.js');
const { ids } = await import('@manalath/shared/lex.ts');

type Written = { did: string; collection: string; record: any; uri: string; cid: string };

function fakeRepo(failFirst = 0) {
  const written: Written[] = [];
  let n = 0, fails = failFirst;
  const create = async (did: string, collection: string, record: any) => {
    if (fails-- > 0) throw new Error('pds down');
    const uri = `at://${did}/${collection}/${(++n).toString(36).padStart(6, '0')}`;
    const cid = 'bafyreigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'; // any valid CID; the uri is what differs
    written.push({ did, collection, record, uri, cid });
    return { uri, cid };
  };
  return { written, create };
}

describe('RepoWriter', () => {
  test('writes match, accept and a chained move per event, in the mover\'s repo', async () => {
    const repo = fakeRepo();
    const writer = new RepoWriter(null, repo.create);
    const m = matches.create({ timeControl: { base: 180, increment: 2 }, startPly: 0 }, { did: 'did:plc:alice', name: 'alice' });
    m.subscribe(writer.onMatch);
    m.claim(1, 'did:plc:bob', { name: 'bob' });
    m.join(0); m.join(1);
    m.act(0, { type: 'place', q: 0, r: 0, color: 1 });
    m.act(1, { type: 'offerDraw' });
    m.act(1, { type: 'place', q: 1, r: 0, color: 2 });
    m.act(0, { type: 'resign' });
    await writer.idle();

    const kinds = repo.written.map((w) => `${w.collection.split('.').pop()}:${w.did.split(':').pop()}`);
    expect(kinds).toEqual(['match:alice', 'accept:bob', 'move:alice', 'move:bob', 'move:bob', 'move:alice']);

    const [match, accept, ...moves] = repo.written;
    expect(match.record.opponent).toBe('did:plc:bob');
    expect(match.record.timeControl).toEqual({ base: 180, increment: 2 });
    expect(accept.record.match).toEqual({ uri: match.uri, cid: match.cid });
    expect(moves[0].record.prev).toBeUndefined();
    expect(moves[0].record.ply).toBe(0);
    expect(moves[0].record.action).toEqual({ $type: `${ids.TopManalathMove}#place`, q: 0, r: 0, color: 1 });
    expect(moves[0].record.clock.remainingMs).toBeGreaterThan(179_000);
    for (let i = 1; i < moves.length; i++) {
      expect(moves[i].record.prev).toEqual({ uri: moves[i - 1].uri, cid: moves[i - 1].cid });
      expect(moves[i].record.match).toEqual({ uri: match.uri, cid: match.cid });
    }
    expect(moves[1].record.ply).toBe(1); // offerDraw at ply 1
    expect(moves[2].record.ply).toBe(1); // the placement at ply 1
    expect(moves[3].record.action.$type).toBe(`${ids.TopManalathMove}#resign`);

    const row = matchStore.load(m.id)!;
    expect(row.matchRef).toEqual({ uri: match.uri, cid: match.cid });
    expect(matchStore.writes(m.id)).toHaveLength(4);
  });

  test('a failed write is retried and picks up where it left off', async () => {
    const repo = fakeRepo(1);
    const writer = new RepoWriter(null, repo.create);
    const m = matches.create({ timeControl: null, startPly: 0 }, { did: 'did:plc:carol', name: 'carol' });
    m.claim(1, 'did:plc:carol', { name: 'carol' }); // same account on both sides
    m.subscribe(writer.onMatch);
    m.join(0); m.join(1);
    m.act(0, { type: 'place', q: 0, r: 0, color: 1 });
    await writer.idle();
    expect(repo.written).toHaveLength(0); // first attempt failed on the match record
    await Bun.sleep(2100); // backoff: 2s
    await writer.idle();
    expect(repo.written.map((w) => w.collection.split('.').pop())).toEqual(['match', 'accept', 'move']);
  });

  test('nothing is written for an anonymous challenger', async () => {
    const repo = fakeRepo();
    const writer = new RepoWriter(null, repo.create);
    const m = matches.create({ timeControl: null, startPly: 0 });
    m.subscribe(writer.onMatch);
    m.join(0); m.join(1);
    m.act(0, { type: 'place', q: 0, r: 0, color: 1 });
    await writer.idle();
    expect(repo.written).toHaveLength(0);
  });

  test('move records validate against the lexicon', () => {
    const { Move } = require('@manalath/shared/lex.ts');
    const ref = { uri: 'at://did:plc:x/top.manalath.match/3k', cid: 'bafyreigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi' };
    const rec = moveRecord(ref, { ply: 3, seat: 1, action: { type: 'pass' }, at: Date.now(), clocks: [1000, 2000] }, ref);
    expect(Move.validateRecord(rec).success).toBe(true);
    expect(rec.clock).toEqual({ remainingMs: 2000 });
  });
});
