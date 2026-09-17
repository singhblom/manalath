import type { Server, ServerWebSocket } from 'bun';
import { MatchError, type Action, type Seat } from '@manalath/shared/match.ts';
import { matches } from '../match/registry.js';
import type { LiveMatch } from '../match/live.js';
import { matchStore } from '../match/store.js';
import { didFromRequest } from '../auth.js';
import { getProfile } from '../repo/profile.js';
import { ratingService } from '../ratings/service.js';
export { TIME_CONTROLS } from './lobby.js';

export type WsData = { matchId: string; seat: Seat | null; unsubscribe?: () => void };

type ClientMsg = { t: 'act'; action: Action } | { t: 'ping' };


const page = (title: string, body: string, status = 200) =>
  new Response(`<!doctype html><meta charset="utf-8"><title>${title}</title>
<style>body{font:16px system-ui;max-width:44em;margin:4em auto;padding:0 1em}code{font-size:13px}table{border-collapse:collapse}td,th{padding:.3em .6em;text-align:left;border-bottom:1px solid #ddd}</style>
${body}`, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });

export function matchRoutes(server: () => Server<WsData>) {
  return {
    '/dev/matches': () => {
      const rows = matches.recent().map((r) => {
        const written = matchStore.writes(r.id).length;
        const total = matchStore.eventCount(r.id);
        const refs = [r.matchRef, r.acceptRef].filter(Boolean).map((x) => `<code>${x!.uri}</code>`).join('<br>');
        return `<tr><td><a href="/m/${r.id}">${r.id}</a></td><td>${r.seats.map((s) => s.name).join(' vs ')}</td>
<td>${r.startedAt ? (r.result ? 'finished' : 'playing') : 'waiting'}</td><td>${written}/${total}</td><td>${refs}</td></tr>`;
      });
      return page('Matches', `<h1>Recent matches</h1>
<table><tr><th>id</th><th>players</th><th>state</th><th>records written</th><th>match / accept</th></tr>${rows.join('')}</table>
<p><a href="/dev">Back</a></p>`);
    },

    '/api/match/:id': (req: Request & { params: { id: string } }) => {
      const m = matches.get(req.params.id);
      if (!m) return Response.json({ error: 'not found' }, { status: 404 });
      const row = matchStore.load(m.id)!;
      return Response.json({ ...m.snapshot(), ratings: ratingService.forMatch(m), records: { match: row.matchRef, accept: row.acceptRef, moves: matchStore.writes(m.id) } });
    },

    '/ws/match/:id': async (req: Request & { params: { id: string } }) => {
      const m = matches.get(req.params.id);
      if (!m) return new Response('no such match', { status: 404 });
      const token = new URL(req.url).searchParams.get('seat');
      const did = didFromRequest(req) ?? null;
      const seat = m.seatFor(token, did);
      if (seat !== null && did && m.seats[seat].did !== did) {
        try { m.claim(seat, did, await getProfile(did)); } catch (err) {
          if (err instanceof MatchError) return new Response(err.message, { status: 403 });
          throw err;
        }
      }
      const ok = server().upgrade(req, { data: { matchId: m.id, seat } satisfies WsData });
      return ok ? undefined : new Response('websocket upgrade failed', { status: 400 });
    },
  };
}

const send = (ws: ServerWebSocket<WsData>, msg: unknown): void => { ws.send(JSON.stringify(msg)); };
/** The live snapshot plus each seat's rating; the rating hook runs before socket listeners, so a finished game already shows its change. */
const snapshot = (m: LiveMatch) => ({ ...m.snapshot(), ratings: ratingService.forMatch(m) });

export const matchWebsocket = {
  open(ws: ServerWebSocket<WsData>) {
    const m = matches.get(ws.data.matchId);
    if (!m) { ws.close(4004, 'no such match'); return; }
    ws.data.unsubscribe = m.subscribe((lm) => send(ws, { t: 'state', snap: snapshot(lm) }));
    if (ws.data.seat !== null) m.join(ws.data.seat); // broadcasts, including to this socket
    send(ws, { t: 'hello', seat: ws.data.seat, snap: snapshot(m) });
  },
  message(ws: ServerWebSocket<WsData>, raw: string | Buffer) {
    let msg: ClientMsg;
    try { msg = JSON.parse(String(raw)); } catch { return send(ws, { t: 'error', code: 'bad-json', message: 'unparseable message' }); }
    if (msg.t === 'ping') return send(ws, { t: 'pong', now: Date.now() });
    if (msg.t !== 'act') return send(ws, { t: 'error', code: 'bad-type', message: 'unknown message type' });
    const m = matches.get(ws.data.matchId);
    if (!m) { ws.close(4004, 'no such match'); return; }
    if (ws.data.seat === null) return send(ws, { t: 'error', code: 'spectator', message: 'spectators cannot move' });
    try {
      m.act(ws.data.seat, msg.action);
    } catch (err) {
      if (err instanceof MatchError) return send(ws, { t: 'error', code: err.code, message: err.message });
      console.error('act failed', err);
      send(ws, { t: 'error', code: 'internal', message: 'internal error' });
    }
  },
  close(ws: ServerWebSocket<WsData>) {
    ws.data.unsubscribe?.();
  },
};
