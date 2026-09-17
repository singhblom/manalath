import type { MatchConfig } from '@manalath/shared/match.ts';
import { LiveMatch, type MatchListener } from './live.js';
import { matchStore, type SeatInfo, type StrongRef } from './store.js';

type Player = { did: string; name: string; handle?: string | null; avatar?: string | null };

const live = new Map<string, LiveMatch>();
const hooks: MatchListener[] = [];

function track(m: LiveMatch) {
  live.set(m.id, m);
  for (const h of hooks) m.subscribe(h);
  return m;
}

export const matches = {
  get(id: string): LiveMatch | undefined {
    let m = live.get(id);
    if (!m) {
      const row = matchStore.load(id);
      if (!row) return undefined;
      m = track(new LiveMatch(row));
    }
    return m;
  },

  create(config: MatchConfig, seat0?: Player, seat1?: Player, refs?: { matchRef: StrongRef; acceptRef: StrongRef }): LiveMatch {
    const id = shortId();
    const seats: [SeatInfo, SeatInfo] = [
      { token: crypto.randomUUID(), did: seat0?.did ?? null, name: seat0?.name ?? 'Player 1', handle: seat0?.handle ?? null, avatar: seat0?.avatar ?? null, joined: false },
      { token: crypto.randomUUID(), did: seat1?.did ?? null, name: seat1?.name ?? 'Player 2', handle: seat1?.handle ?? null, avatar: seat1?.avatar ?? null, joined: false },
    ];
    return track(LiveMatch.create(id, config, seats, refs));
  },

  /** Register a listener attached to every live match, now and in future. */
  onAll(hook: MatchListener) {
    hooks.push(hook);
    for (const m of live.values()) m.subscribe(hook);
  },

  recent: () => matchStore.recent(),
};

function shortId() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => 'abcdefghijkmnpqrstuvwxyz23456789'[b % 32]).join('');
}
