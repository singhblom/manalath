import { describe, expect, test } from 'bun:test';

process.env.DB_PATH = ':memory:';
const { LobbyService, LobbyError } = await import('./service.js');
const { challengeStore } = await import('./store.js');
const { matchStore } = await import('../match/store.js');
const { resolveFirstMover } = await import('@manalath/shared/lobby.ts');

const EVEN = 'bafyreigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'; // last byte parity checked in test below

let n = 0; // shared across fakes: the in-memory DB is shared too
function fakeRepo(cidFor: () => string = () => EVEN) {
  const log: string[] = [];
  return {
    log,
    repo: {
      async create(did: string, collection: string, _record: any) {
        const uri = `at://${did}/${collection}/${(++n).toString(36).padStart(6, '0')}`;
        log.push(`create ${collection} ${did}`);
        return { uri, cid: cidFor() };
      },
      async delete(did: string, collection: string, rkey: string) { log.push(`delete ${collection} ${did} ${rkey}`); },
      async profile(did: string) { const h = did.split(':').pop()!; return { name: h, handle: `${h}.test`, avatar: null }; },
    },
  };
}

const status = async (p: Promise<unknown>) => { try { await p; return 200; } catch (e) { return e instanceof LobbyError ? e.status : -1; } };

describe('LobbyService', () => {
  test('create writes a match record and lists it as open', async () => {
    const { repo, log } = fakeRepo();
    const lobby = new LobbyService(repo);
    const c = await lobby.create('did:plc:alice', { timeControl: { base: 180, increment: 2 }, opponent: null, firstMover: 'random' });
    expect(c.status).toBe('open');
    expect(log).toEqual(['create top.manalath.match did:plc:alice']);
    const visible = await lobby.visible(null);
    expect(visible.map((v) => v.challengerProfile.name)).toContain('alice');
  });

  test('accept writes the accept record, seats both players and starts a match with refs', async () => {
    const { repo } = fakeRepo();
    const lobby = new LobbyService(repo);
    const c = await lobby.create('did:plc:alice', { timeControl: null, opponent: null, firstMover: 'opponent' });
    const id = await lobby.accept('did:plc:bob', c.uri);
    const row = matchStore.load(id)!;
    expect(row.seats[0].did).toBe('did:plc:bob'); // opponent moves first
    expect(row.seats[1].did).toBe('did:plc:alice');
    expect(row.matchRef).toEqual({ uri: c.uri, cid: c.cid });
    expect(row.acceptRef?.uri).toContain('top.manalath.accept');
    expect(challengeStore.get(c.uri)!.status).toBe('accepted');
    expect(challengeStore.get(c.uri)!.matchId).toBe(id);
  });

  test('first accept wins, even while the first accept is still being written', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { repo } = fakeRepo();
    const slow = { ...repo, async create(did: string, col: string, rec: any) { if (col.endsWith('accept')) await gate; return repo.create(did, col, rec); } };
    const lobby = new LobbyService(slow);
    const c = await lobby.create('did:plc:alice', { timeControl: null, opponent: null, firstMover: 'challenger' });
    const first = lobby.accept('did:plc:bob', c.uri);
    expect(await status(lobby.accept('did:plc:carol', c.uri))).toBe(409);
    release();
    await first;
    expect(matchStore.load((await challengeStore.get(c.uri))!.matchId!)!.seats[1].did).toBe('did:plc:bob');
  });

  test('a failed accept write releases the challenge', async () => {
    const { repo } = fakeRepo();
    const failing = { ...repo, async create(did: string, col: string, rec: any) { if (col.endsWith('accept')) throw new Error('pds down'); return repo.create(did, col, rec); } };
    const lobby = new LobbyService(failing);
    const c = await lobby.create('did:plc:alice', { timeControl: null, opponent: null, firstMover: 'challenger' });
    expect(await status(lobby.accept('did:plc:bob', c.uri))).toBe(-1);
    expect(challengeStore.get(c.uri)!.status).toBe('open');
  });

  test('direct challenges can only be accepted by the named opponent', async () => {
    const lobby = new LobbyService(fakeRepo().repo);
    const c = await lobby.create('did:plc:alice', { timeControl: null, opponent: 'did:plc:bob', firstMover: 'challenger' });
    expect(await status(lobby.accept('did:plc:carol', c.uri))).toBe(403);
    expect(await status(lobby.accept('did:plc:bob', c.uri))).toBe(200);
  });

  test('cancel deletes the record; only the challenger may cancel, only while open', async () => {
    const { repo, log } = fakeRepo();
    const lobby = new LobbyService(repo);
    const c = await lobby.create('did:plc:alice', { timeControl: null, opponent: null, firstMover: 'challenger' });
    expect(await status(lobby.cancel('did:plc:bob', c.uri))).toBe(403);
    await lobby.cancel('did:plc:alice', c.uri);
    expect(log.at(-1)).toBe(`delete top.manalath.match did:plc:alice ${c.uri.split('/').pop()}`);
    expect(challengeStore.get(c.uri)!.status).toBe('cancelled');
    expect(await status(lobby.accept('did:plc:bob', c.uri))).toBe(409);
  });
});

describe('resolveFirstMover', () => {
  test('fixed choices pass through', () => {
    expect(resolveFirstMover('challenger', EVEN)).toBe('challenger');
    expect(resolveFirstMover('opponent', EVEN)).toBe('opponent');
  });
  test('random follows the parity of the CID\'s last byte', async () => {
    const { CID } = await import('multiformats/cid');
    const parity = CID.parse(EVEN).bytes.at(-1)! % 2;
    expect(resolveFirstMover('random', EVEN)).toBe(parity === 0 ? 'challenger' : 'opponent');
  });
});

describe('rematch', () => {
  test('offers a direct challenge with the same clock and swapped first mover, idempotently', async () => {
    const lobby = new LobbyService(fakeRepo().repo);
    const c = await lobby.create('did:plc:alice', { timeControl: { base: 60, increment: 0 }, opponent: null, firstMover: 'challenger' });
    const id = await lobby.accept('did:plc:bob', c.uri); // alice seat 0, bob seat 1
    const { matches } = await import('../match/registry.js');
    const m = matches.get(id)!;
    m.join(0); m.join(1);
    expect(await status(lobby.rematch('did:plc:bob', id))).toBe(409); // not over yet
    m.act(0, { type: 'resign' });
    expect(await status(lobby.rematch('did:plc:carol', id))).toBe(403);
    const r = await lobby.rematch('did:plc:alice', id);
    expect(r.opponent).toBe('did:plc:bob');
    expect(r.timeControl).toEqual({ base: 60, increment: 0 });
    expect(r.firstMover).toBe('opponent'); // bob moved second, so bob moves first now
    expect(r.rematchOf).toBe(id);
    const again = await lobby.rematch('did:plc:bob', id);
    expect(again.uri).toBe(r.uri); // one rematch per match, whoever asks
    expect((await lobby.visible(null)).map((v) => v.uri)).not.toContain(r.uri); // private to the two players
    const id2 = await lobby.accept('did:plc:bob', r.uri);
    expect(matchStore.load(id2)!.seats[0].did).toBe('did:plc:bob');
    expect(lobby.rematchOf(id)!.matchId).toBe(id2);
  });
});
