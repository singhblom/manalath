import type { Server } from 'bun';
import index from '../../web/index.html';
import { createOAuthClient, isLoopback } from './auth.js';
import { authRoutes } from './routes/auth.js';
import { matchRoutes, matchWebsocket, type WsData } from './routes/match.js';
import { matches } from './match/registry.js';
import { RepoWriter } from './repo/writer.js';
import { LobbyService } from './lobby/service.js';
import { lobbyRoutes, oauthRepo } from './routes/lobby.js';
import { ratingService } from './ratings/service.js';
import { ratingRoutes } from './routes/ratings.js';

const port = Number(process.env.PORT ?? 8765);
const dev = process.env.NODE_ENV !== 'production';

// In development we are a loopback OAuth client, which must be addressed as 127.0.0.1
// (RFC 8252 forbids "localhost" as a redirect host). In production set PUBLIC_URL.
const origin = process.env.PUBLIC_URL ?? `http://127.0.0.1:${port}`;

const oauth = await createOAuthClient({ origin, privateKeyJwk: process.env.OAUTH_PRIVATE_KEY });

// Mirror accepted events into players' repos, off the hot path.
const writer = new RepoWriter(oauth);
matches.onAll(writer.onMatch);
writer.resumeAll();

// Ratings are a cache over finished rated matches; rebuild it on start and after every rated game.
ratingService.recompute();
matches.onAll(ratingService.onMatch);

const lobby = new LobbyService(oauthRepo(oauth));

// The AI runs in a Web Worker. The HTML bundler does not rewrite worker URLs, so the worker is bundled here and
// served at a fixed path; in development it is rebuilt per request so edits to the search show up on reload.
const workerEntry = new URL('../../web/src/ai-worker.js', import.meta.url).pathname;
async function buildWorker() {
  const out = await Bun.build({ entrypoints: [workerEntry], target: 'browser', format: 'esm', minify: !dev });
  if (!out.success) throw new AggregateError(out.logs, 'ai-worker build failed');
  return out.outputs[0].text();
}
let workerJs: Promise<string> = buildWorker();
const workerRoute = async () => new Response(await (dev ? (workerJs = buildWorker()) : workerJs), { headers: { 'content-type': 'text/javascript; charset=utf-8' } });

const server: Server<WsData> = Bun.serve<WsData>({
  port,
  development: dev && { hmr: true, console: true },
  routes: {
    '/': index,
    '/m/:id': index,
    // The lobby and login live in a dialog on the game page; old links still work.
    '/lobby': () => Response.redirect(`${origin}/?online`, 302),
    '/login': { GET: () => Response.redirect(`${origin}/?online`, 302), POST: authRoutes(oauth, origin)['/login'].POST },
    '/xrpc/_health': () => Response.json({ version: '0.0.1' }),
    '/ai-worker.js': workerRoute,
    ...Object.fromEntries(Object.entries(authRoutes(oauth, origin)).filter(([k]) => k !== '/login')),
    ...matchRoutes(() => server),
    ...lobbyRoutes(lobby),
    ...ratingRoutes(),
  },
  websocket: matchWebsocket,
  fetch(req) {
    // Cookies are per host, so send anyone who arrived via "localhost" to the canonical origin.
    const url = new URL(req.url);
    if (isLoopback(origin) && url.hostname === 'localhost') {
      return Response.redirect(`${origin}${url.pathname}${url.search}`, 302);
    }
    return new Response('Not found', { status: 404 });
  },
});

console.log(`manalath listening on ${origin} (port ${server.port}, ${isLoopback(origin) ? 'loopback OAuth client' : 'confidential OAuth client'})`);
