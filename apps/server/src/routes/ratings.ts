// Ratings as XRPC queries, per the top.manalath.getPlayer / getLeaderboard lexicons. Other clients
// and indexers can compare their own fold against ours; the algorithm id says which fold that is.
import { GetLeaderboard, GetPlayer, ids } from '@manalath/shared/lex.ts';
import { ratingService } from '../ratings/service.js';

const isDid = (s: string | null): s is string => !!s && /^did:[a-z]+:[A-Za-z0-9._:%-]+$/.test(s);

export function ratingRoutes() {
  return {
    [`/xrpc/${ids.TopManalathGetPlayer}`]: (req: Request) => {
      const actor = new URL(req.url).searchParams.get('actor');
      if (!isDid(actor)) return Response.json({ error: 'InvalidRequest', message: 'actor must be a DID' }, { status: 400 });
      const out: GetPlayer.OutputSchema = ratingService.player(actor);
      return Response.json(out);
    },
    [`/xrpc/${ids.TopManalathGetLeaderboard}`]: (req: Request) => {
      const raw = new URL(req.url).searchParams.get('limit');
      const limit = raw === null ? 25 : Number(raw);
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) return Response.json({ error: 'InvalidRequest', message: 'limit must be 1..100' }, { status: 400 });
      const out: GetLeaderboard.OutputSchema = { algorithm: ratingService.player('did:plc:none').algorithm, players: ratingService.leaderboard(limit) };
      return Response.json(out);
    },
  };
}
