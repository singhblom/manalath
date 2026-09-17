import { NodeOAuthClient, type NodeSavedSession, type NodeSavedState } from '@atproto/oauth-client-node';
import { buildAtprotoLoopbackClientId } from '@atproto/oauth-types';
import { JoseKey } from '@atproto/jwk-jose';
import { Agent } from '@atproto/api';
import { jsonStore, webSessions } from './db.js';

// The app only ever writes its own record types. Granular scopes keep it that way.
export const SCOPE = process.env.OAUTH_SCOPE ??
  'atproto repo:top.manalath.match repo:top.manalath.accept repo:top.manalath.move';

export type AuthConfig = {
  /** Origin the browser reaches us at, e.g. http://127.0.0.1:8765 or https://manalath.example. */
  origin: string;
  /** Present in production: turns us into a confidential client with hosted metadata and a signing key. */
  privateKeyJwk?: string;
};

// The library's default handle resolver (DNS TXT + HTTPS well-known) is built on a Node-only
// undici-based fetch that Bun does not provide. Until Bun ships it, delegate handle -> DID
// resolution to a public XRPC endpoint. Everything after that (DID documents, PDS metadata,
// token exchange, DPoP) uses plain fetch and runs fine under Bun.
const HANDLE_RESOLVER = process.env.HANDLE_RESOLVER ?? 'https://public.api.bsky.app';

export function isLoopback(origin: string) {
  return origin.startsWith('http://127.0.0.1') || origin.startsWith('http://[::1]');
}

export async function createOAuthClient(cfg: AuthConfig) {
  const redirectUri = `${cfg.origin}/oauth/callback`;
  const stateStore = jsonStore<NodeSavedState>('oauth_state', 'key', 'created_at');
  const sessionStore = jsonStore<NodeSavedSession>('oauth_session', 'did', 'updated_at');

  if (isLoopback(cfg.origin)) {
    // Development mode defined by the ATProto OAuth spec: the PDS derives our metadata from
    // the client_id itself instead of fetching it, so nothing needs to be publicly hosted.
    // Loopback clients are always public clients (shorter sessions, no key).
    const client_id = buildAtprotoLoopbackClientId({ scope: SCOPE, redirect_uris: [redirectUri] });
    return new NodeOAuthClient({
      clientMetadata: {
        client_id,
        client_name: 'Manalath (dev)',
        redirect_uris: [redirectUri],
        scope: SCOPE,
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        application_type: 'native',
        token_endpoint_auth_method: 'none',
        dpop_bound_access_tokens: true,
      },
      stateStore,
      sessionStore,
      handleResolver: HANDLE_RESOLVER,
    });
  }

  if (!cfg.privateKeyJwk) {
    throw new Error('OAUTH_PRIVATE_KEY (a JWK) is required when not running on a loopback origin');
  }
  const key = await JoseKey.fromImportable(cfg.privateKeyJwk, 'manalath-1');
  return new NodeOAuthClient({
    clientMetadata: {
      client_id: `${cfg.origin}/oauth/client-metadata.json`,
      client_name: 'Manalath',
      client_uri: cfg.origin,
      redirect_uris: [redirectUri],
      scope: SCOPE,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      application_type: 'web',
      token_endpoint_auth_method: 'private_key_jwt',
      token_endpoint_auth_signing_alg: 'ES256',
      dpop_bound_access_tokens: true,
      jwks_uri: `${cfg.origin}/oauth/jwks.json`,
    },
    keyset: [key],
    stateStore,
    sessionStore,
    handleResolver: HANDLE_RESOLVER,
  });
}

export type OAuthClient = Awaited<ReturnType<typeof createOAuthClient>>;

const COOKIE = 'manalath_sid';

export function sessionCookie(sid: string, origin: string) {
  const secure = origin.startsWith('https://') ? '; Secure' : '';
  return `${COOKIE}=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 90}${secure}`;
}

export function clearCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function sidFromRequest(req: Request): string | undefined {
  const raw = req.headers.get('cookie');
  if (!raw) return undefined;
  for (const part of raw.split(';')) {
    const [k, v] = part.trim().split('=');
    if (k === COOKIE && v) return v;
  }
  return undefined;
}

export function didFromRequest(req: Request): string | undefined {
  const sid = sidFromRequest(req);
  return sid ? webSessions.lookup(sid) : undefined;
}

/** An authenticated agent for a logged-in player, or undefined if their OAuth session is gone. */
export async function agentFor(client: OAuthClient, did: string): Promise<Agent | undefined> {
  try {
    const session = await client.restore(did);
    return new Agent(session);
  } catch (err) {
    console.warn(`could not restore session for ${did}:`, (err as Error).message);
    return undefined;
  }
}
