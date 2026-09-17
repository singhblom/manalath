import type { TimeControl } from '@manalath/shared/match.ts';
import type { FirstMover } from '@manalath/shared/lobby.ts';
import { agentFor, didFromRequest, type OAuthClient } from '../auth.js';
import { LobbyError, LobbyService, type Repo } from '../lobby/service.js';
import { matchStore } from '../match/store.js';
import { getProfile, resolveHandle } from '../repo/profile.js';

export const TIME_CONTROLS: Record<string, TimeControl | null> = {
  '1+0': { base: 60, increment: 0 },
  '3+2': { base: 180, increment: 2 },
  '5+3': { base: 300, increment: 3 },
  '10+5': { base: 600, increment: 5 },
  untimed: null,
};

/** Repo operations backed by the players' own OAuth sessions. */
export function oauthRepo(oauth: OAuthClient): Repo {
  const agentOrThrow = async (did: string) => {
    const agent = await agentFor(oauth, did);
    if (!agent) throw new LobbyError(401, 'your session has expired; log in again');
    return agent;
  };
  return {
    async create(did, collection, record) {
      const agent = await agentOrThrow(did);
      const res = await agent.com.atproto.repo.createRecord({ repo: did, collection, record });
      return { uri: res.data.uri, cid: res.data.cid };
    },
    async delete(did, collection, rkey) {
      const agent = await agentOrThrow(did);
      await agent.com.atproto.repo.deleteRecord({ repo: did, collection, rkey });
    },
    profile: getProfile,
  };
}

const fail = (err: unknown) => {
  if (err instanceof LobbyError) return Response.json({ error: err.message }, { status: err.status });
  console.error('lobby error', err);
  return Response.json({ error: 'internal error' }, { status: 500 });
};

export function lobbyRoutes(lobby: LobbyService) {
  return {
    '/api/lobby': async (req: Request) => {
      const me = didFromRequest(req) ?? null;
      const challenges = await lobby.visible(me);
      const games = me ? matchStore.forPlayer(me).map((m) => ({
        id: m.id, seats: m.seats.map((s) => ({ did: s.did, name: s.name, avatar: s.avatar ?? null })), startedAt: m.startedAt, result: m.result,
        timeControl: m.config.timeControl, rated: !!m.config.rated, createdAt: m.createdAt,
      })) : [];
      return Response.json({
        me: me ? await getProfile(me) : null, challenges, games, timeControls: Object.keys(TIME_CONTROLS),
      });
    },

    '/api/challenge': {
      POST: async (req: Request) => {
        const did = didFromRequest(req);
        if (!did) return Response.json({ error: 'log in first' }, { status: 401 });
        const body = (await req.json().catch(() => ({}))) as { timeControl?: string; opponent?: string; firstMover?: FirstMover; rated?: boolean };
        const key = body.timeControl ?? '3+2';
        if (!(key in TIME_CONTROLS)) return Response.json({ error: `unknown time control ${key}` }, { status: 400 });
        const firstMover = body.firstMover ?? 'random';
        if (!['challenger', 'opponent', 'random'].includes(firstMover)) return Response.json({ error: 'bad firstMover' }, { status: 400 });
        let opponent: string | null = null;
        if (body.opponent?.trim()) {
          opponent = await resolveHandle(body.opponent.trim().replace(/^@/, ''));
          if (!opponent) return Response.json({ error: `could not resolve ${body.opponent}` }, { status: 400 });
        }
        try {
          return Response.json(await lobby.create(did, { timeControl: TIME_CONTROLS[key], opponent, firstMover, rated: body.rated === true }), { status: 201 });
        } catch (err) { return fail(err); }
      },
    },

    '/api/match/:id/rematch': {
      GET: (req: Request & { params: { id: string } }) => {
        const c = lobby.rematchOf(req.params.id);
        return Response.json({ rematch: c ? { uri: c.uri, challenger: c.challenger, status: c.status, matchId: c.matchId } : null });
      },
      POST: async (req: Request & { params: { id: string } }) => {
        const did = didFromRequest(req);
        if (!did) return Response.json({ error: 'log in first' }, { status: 401 });
        try {
          const c = await lobby.rematch(did, req.params.id);
          return Response.json({ rematch: { uri: c.uri, challenger: c.challenger, status: c.status, matchId: c.matchId } });
        } catch (err) { return fail(err); }
      },
    },

    '/api/challenge/accept': {
      POST: async (req: Request) => {
        const did = didFromRequest(req);
        if (!did) return Response.json({ error: 'log in first' }, { status: 401 });
        const { uri } = (await req.json().catch(() => ({}))) as { uri?: string };
        if (!uri) return Response.json({ error: 'uri required' }, { status: 400 });
        try {
          return Response.json({ matchId: await lobby.accept(did, uri) });
        } catch (err) { return fail(err); }
      },
    },

    '/api/challenge/cancel': {
      POST: async (req: Request) => {
        const did = didFromRequest(req);
        if (!did) return Response.json({ error: 'log in first' }, { status: 401 });
        const { uri } = (await req.json().catch(() => ({}))) as { uri?: string };
        if (!uri) return Response.json({ error: 'uri required' }, { status: 400 });
        try {
          await lobby.cancel(did, uri);
          return Response.json({ ok: true });
        } catch (err) { return fail(err); }
      },
    },
  };
}
