// Ratings are a derived view over the public game records, never a fact anyone asserts. Any
// indexer that folds the same finished rated games in the same order with this module gets the
// same numbers, which is what makes the ladder distributed: the rating lives in the algorithm and
// the record graph, not in a server.
//
// Glicko-2 (Glickman 2013), applied per game rather than per fixed rating period, the way Lichess
// does it: each game is its own rating period for the two players involved, and a player's
// deviation grows with the real time elapsed since their previous game. Every input is taken from
// the records (players, result, finish time), so the fold is deterministic and can be recomputed
// from scratch whenever a game arrives out of order.

export const RATING_ALGORITHM = 'glicko2-v1';

export const DEFAULT_RATING = 1500;
export const DEFAULT_RD = 350;
export const DEFAULT_VOL = 0.06;
/** A rating deviation above this shows the rank as provisional. */
export const PROVISIONAL_RD = 110;
/** One Glicko-2 rating period in ms; deviation inflates by vol² per period of inactivity. */
export const RATING_PERIOD_MS = 24 * 3600_000;

const TAU = 0.5;
const SCALE = 173.7178;
const EPSILON = 1e-6;
const MIN_RD = 30;
const MAX_RD = DEFAULT_RD;

export type Rating = {
  rating: number;
  rd: number;
  vol: number;
  /** Rated games folded into this rating. */
  games: number;
  /** Finish time of the last rated game, or null for an unrated player. */
  lastPlayedAt: number | null;
};

export const unrated = (): Rating => ({ rating: DEFAULT_RATING, rd: DEFAULT_RD, vol: DEFAULT_VOL, games: 0, lastPlayedAt: null });

export type Opponent = { rating: number; rd: number; /** 1 win, 0.5 draw, 0 loss, from the player's point of view. */ score: number };

const g = (phi: number) => 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
const E = (mu: number, muJ: number, phiJ: number) => 1 / (1 + Math.exp(-g(phiJ) * (mu - muJ)));

/**
 * One Glicko-2 rating-period update for a player against `opponents` (pre-period values), where
 * `periods` rating periods have elapsed since the player's last update. With `periods = 1` and a
 * batch of results this is exactly the algorithm in Glickman's paper.
 */
export function glicko2(p: { rating: number; rd: number; vol: number }, opponents: Opponent[], periods = 1): { rating: number; rd: number; vol: number } {
  const mu = (p.rating - DEFAULT_RATING) / SCALE;
  const phi = p.rd / SCALE;
  let sigma = p.vol;

  if (opponents.length === 0) {
    const phiStar = Math.sqrt(phi * phi + sigma * sigma * periods);
    return { rating: p.rating, rd: clampRd(phiStar * SCALE), vol: sigma };
  }

  let vInv = 0;
  let deltaSum = 0;
  for (const o of opponents) {
    const muJ = (o.rating - DEFAULT_RATING) / SCALE;
    const phiJ = o.rd / SCALE;
    const gj = g(phiJ);
    const e = E(mu, muJ, phiJ);
    vInv += gj * gj * e * (1 - e);
    deltaSum += gj * (o.score - e);
  }
  const v = 1 / vInv;
  const delta = v * deltaSum;

  // Step 5: new volatility by Illinois-style bisection on f(x).
  const a = Math.log(sigma * sigma);
  const f = (x: number) => {
    const ex = Math.exp(x);
    const d2 = delta * delta, phi2 = phi * phi;
    return (ex * (d2 - phi2 - v - ex)) / (2 * (phi2 + v + ex) ** 2) - (x - a) / (TAU * TAU);
  };
  let A = a;
  let B: number;
  if (delta * delta > phi * phi + v) {
    B = Math.log(delta * delta - phi * phi - v);
  } else {
    let k = 1;
    while (f(a - k * TAU) < 0) k++;
    B = a - k * TAU;
  }
  let fA = f(A), fB = f(B);
  while (Math.abs(B - A) > EPSILON) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB <= 0) { A = B; fA = fB; } else fA /= 2;
    B = C; fB = fC;
  }
  sigma = Math.exp(A / 2);

  // Steps 6-8, with the pre-period inflation scaled by real elapsed time.
  const phiStar = Math.sqrt(phi * phi + sigma * sigma * periods);
  const phiNew = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const muNew = mu + phiNew * phiNew * deltaSum;
  return { rating: muNew * SCALE + DEFAULT_RATING, rd: clampRd(phiNew * SCALE), vol: sigma };
}

const clampRd = (rd: number) => Math.min(MAX_RD, Math.max(MIN_RD, rd));

/** Rating periods elapsed between a player's previous game and `at`. A first game gets one full period. */
function periodsSince(r: Rating, at: number) {
  if (r.lastPlayedAt === null) return 1;
  return Math.max(0, (at - r.lastPlayedAt) / RATING_PERIOD_MS);
}

/** Deviation as it stands at `now`, after inflating for inactivity. For display only. */
export function currentRd(r: Rating, now: number) {
  if (r.games === 0) return r.rd;
  const phi = r.rd / SCALE;
  return clampRd(Math.sqrt(phi * phi + r.vol * r.vol * periodsSince(r, now)) * SCALE);
}

/**
 * Update both players after one game finishing at `at`. `scoreA` is 1 if seat A won, 0 if B won,
 * 0.5 for a draw. Each side is rated against the other's pre-game values.
 */
export function ratePair(a: Rating, b: Rating, scoreA: number, at: number): [Rating, Rating] {
  const na = glicko2(a, [{ rating: b.rating, rd: b.rd, score: scoreA }], periodsSince(a, at));
  const nb = glicko2(b, [{ rating: a.rating, rd: a.rd, score: 1 - scoreA }], periodsSince(b, at));
  return [
    { ...na, games: a.games + 1, lastPlayedAt: at },
    { ...nb, games: b.games + 1, lastPlayedAt: at },
  ];
}

// --- dan / kyu -------------------------------------------------------------------------------

/**
 * Display rank on a go-style ladder: 100 rating points per grade, 1 dan starting at 2100, so the
 * default 1500 is 6 kyu. Rank is presentation only and is never stored or written to a repo.
 */
export type Rank = { grade: string; provisional: boolean; label: string };

export function rank(r: { rating: number; rd: number; games?: number }): Rank | null {
  if (r.games === 0) return null;
  const grade = r.rating >= 2100
    ? `${Math.min(9, Math.floor((r.rating - 2100) / 100) + 1)}d`
    : `${Math.min(30, Math.ceil((2100 - r.rating) / 100))}k`;
  const provisional = r.rd > PROVISIONAL_RD;
  return { grade, provisional, label: provisional ? `${grade}?` : grade };
}

// --- the fold --------------------------------------------------------------------------------

export type RatedGame = {
  /** Stable identifier, used only to break ties in ordering. Indexers use the match CID. */
  id: string;
  players: [string, string];
  /** Index into `players`, or null for a draw. */
  winner: 0 | 1 | null;
  /** Finish time (ms since epoch); indexers take the terminal move's createdAt. */
  finishedAt: number;
};

export type RatingChange = { before: Rating; after: Rating };

/** Canonical order: finish time, then id. Every indexer must fold in this order. */
export function orderGames(games: RatedGame[]): RatedGame[] {
  return [...games].sort((x, y) => x.finishedAt - y.finishedAt || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
}

/**
 * Fold every rated game into a rating table. Pure and deterministic; recompute from scratch
 * when a game arrives out of order. Games where both seats are the same player are ignored.
 */
export function computeRatings(games: RatedGame[]) {
  const ratings = new Map<string, Rating>();
  const changes = new Map<string, [RatingChange, RatingChange]>();
  for (const gm of orderGames(games)) {
    const [a, b] = gm.players;
    if (a === b) continue;
    const ra = ratings.get(a) ?? unrated();
    const rb = ratings.get(b) ?? unrated();
    const score = gm.winner === null ? 0.5 : gm.winner === 0 ? 1 : 0;
    const [na, nb] = ratePair(ra, rb, score, gm.finishedAt);
    ratings.set(a, na);
    ratings.set(b, nb);
    changes.set(gm.id, [{ before: ra, after: na }, { before: rb, after: nb }]);
  }
  return { algorithm: RATING_ALGORITHM, ratings, changes };
}
