import { matchStore } from '../match/store.js';

const PUBLIC_API = process.env.PUBLIC_API ?? 'https://public.api.bsky.app';
const MAX_AGE = 24 * 3600_000;

export type Profile = {
  did: string;
  handle: string | null;
  displayName: string | null;
  avatar: string | null;
  /** Best label for UI: display name, else handle, else shortened DID. */
  name: string;
};

const inflight = new Map<string, Promise<Profile>>();

/** Public profile for a DID, cached in the players table and refreshed daily. */
export async function getProfile(did: string): Promise<Profile> {
  const cached = matchStore.player(did);
  if (cached && Date.now() - cached.updatedAt < MAX_AGE) return toProfile(did, cached);
  let p = inflight.get(did);
  if (!p) {
    p = fetchProfile(did, cached).finally(() => inflight.delete(did));
    inflight.set(did, p);
  }
  return p;
}

export async function displayName(did: string): Promise<string> {
  return (await getProfile(did)).name;
}

async function fetchProfile(did: string, stale: { handle: string | null; displayName: string | null; avatar: string | null } | undefined): Promise<Profile> {
  try {
    const res = await fetch(`${PUBLIC_API}/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(did)}`);
    if (res.ok) {
      const d = (await res.json()) as { handle?: string; displayName?: string; avatar?: string };
      const row = { handle: d.handle ?? null, displayName: d.displayName?.trim() || null, avatar: d.avatar ?? null };
      matchStore.savePlayer(did, row);
      return toProfile(did, row);
    }
  } catch (err) {
    console.warn(`profile lookup failed for ${did}:`, (err as Error).message);
  }
  // Keep serving a stale row rather than nothing; bump its timestamp so we do not hammer the API.
  if (stale) { matchStore.savePlayer(did, stale); return toProfile(did, stale); }
  return toProfile(did, { handle: null, displayName: null, avatar: null });
}

function toProfile(did: string, r: { handle: string | null; displayName: string | null; avatar: string | null }): Profile {
  return { did, ...r, name: r.displayName || r.handle || did.slice(0, 16) + '…' };
}

/** Handle -> DID via the public API. Returns null if the handle does not resolve. */
export async function resolveHandle(handle: string): Promise<string | null> {
  if (handle.startsWith('did:')) return handle;
  try {
    const res = await fetch(`${PUBLIC_API}/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`);
    if (!res.ok) return null;
    const { did } = (await res.json()) as { did?: string };
    return did ?? null;
  } catch {
    return null;
  }
}
