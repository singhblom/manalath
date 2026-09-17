import { OAuthCallbackError } from '@atproto/oauth-client-node';
import { agentFor, clearCookie, didFromRequest, sessionCookie, sidFromRequest, type OAuthClient } from '../auth.js';
import { webSessions } from '../db.js';

const html = (body: string, status = 200) =>
  new Response(`<!doctype html><meta charset="utf-8"><title>Manalath</title>
<style>body{font:16px system-ui;max-width:40em;margin:4em auto;padding:0 1em}input{font:inherit;padding:.4em}button{font:inherit;padding:.4em .8em}pre{background:#eee;padding:1em;overflow:auto}</style>
${body}`, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });

export function authRoutes(client: OAuthClient, origin: string) {
  return {
    '/oauth/client-metadata.json': () => Response.json(client.clientMetadata),
    '/oauth/jwks.json': () => Response.json(client.jwks),

    '/login': {
      // GET redirects to the Online dialog on the game page (see index.ts); this handles the form post.
      POST: async (req: Request) => {
        const form = await req.formData();
        const handle = String(form.get('handle') ?? '').trim().replace(/^@/, '');
        const next = safeNext(form.get('next'));
        const back = (msg: string) => Response.redirect(`${origin}/?online&error=${encodeURIComponent(msg)}`, 303);
        if (!handle) return back('Handle required.');
        try {
          // The state round-trips through the PDS; we use it to carry the post-login destination.
          const url = await client.authorize(handle, { state: `${crypto.randomUUID()}|${next}` });
          return Response.redirect(url.toString(), 302);
        } catch (err) {
          console.error('authorize failed', err);
          return back(`Could not start login: ${(err as Error).message}`);
        }
      },
    },

    '/oauth/callback': async (req: Request) => {
      const params = new URL(req.url).searchParams;
      try {
        const { session, state } = await client.callback(params);
        const sid = webSessions.create(session.did);
        const next = safeNext(state?.split('|')[1]);
        return new Response(null, {
          status: 302,
          headers: { location: `${origin}${next}`, 'set-cookie': sessionCookie(sid, origin) },
        });
      } catch (err) {
        console.error('callback failed', err);
        const msg = err instanceof OAuthCallbackError ? `${err.message} (${err.params.get('error') ?? ''})` : (err as Error).message;
        return Response.redirect(`${origin}/?online&error=${encodeURIComponent(`Login failed: ${msg}`)}`, 303);
      }
    },

    '/logout': {
      POST: async (req: Request) => {
        const sid = sidFromRequest(req);
        const did = sid && webSessions.lookup(sid);
        if (sid) webSessions.destroy(sid);
        if (did) {
          // Revoke on the PDS too, so the grant disappears from the user's settings.
          try { await client.revoke(did); } catch (err) { console.warn('revoke failed', (err as Error).message); }
        }
        return new Response(null, { status: 302, headers: { location: `${origin}/?online`, 'set-cookie': clearCookie() } });
      },
    },

    '/api/me': async (req: Request) => {
      const did = didFromRequest(req);
      if (!did) return Response.json({ did: null }, { status: 401 });
      const agent = await agentFor(client, did);
      return Response.json({ did, active: !!agent });
    },

    // Developer page: session check, a repo write smoke test, and record status.
    '/dev': async (req: Request) => {
      const did = didFromRequest(req);
      if (!did) return Response.redirect(`${origin}/?online`, 302);
      return html(`<h1>Manalath dev</h1>
<p>Logged in as <code>${escape(did)}</code></p>
<form method="post" action="/dev/test-record"><button>Write and delete a test record</button></form>
<form method="post" action="/logout"><button>Log out</button></form>
<p><a href="/?online">Lobby</a> · <a href="/dev/matches">Recent matches and record status</a> · <a href="/">Play locally</a></p>`);
    },

    '/dev/test-record': {
      POST: async (req: Request) => {
        const did = didFromRequest(req);
        if (!did) return Response.redirect(`${origin}/login`, 302);
        const agent = await agentFor(client, did);
        if (!agent) return html('<p>Your session has expired. <a href="/?online">Log in again</a>.</p>', 401);
        const log: string[] = [];
        try {
          const t0 = performance.now();
          const created = await agent.com.atproto.repo.createRecord({
            repo: did,
            collection: 'top.manalath.match',
            record: { $type: 'top.manalath.match', firstMover: 'random', createdAt: new Date().toISOString() },
          });
          log.push(`createRecord ok in ${Math.round(performance.now() - t0)} ms`);
          log.push(`uri: ${created.data.uri}`);
          log.push(`cid: ${created.data.cid}`);
          const rkey = created.data.uri.split('/').pop()!;
          const t1 = performance.now();
          await agent.com.atproto.repo.deleteRecord({ repo: did, collection: 'top.manalath.match', rkey });
          log.push(`deleteRecord ok in ${Math.round(performance.now() - t1)} ms`);
        } catch (err) {
          log.push(`FAILED: ${(err as Error).message}`);
          console.error(err);
        }
        return html(`<h1>Test record</h1><pre>${escape(log.join('\n'))}</pre><p><a href="/dev">Back</a></p>`);
      },
    },
  };
}

/** Only allow same-origin paths as post-login destinations. */
function safeNext(v: unknown): string {
  const s = typeof v === 'string' ? v : '';
  return s.startsWith('/') && !s.startsWith('//') ? s : '/?online';
}

function escape(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}
