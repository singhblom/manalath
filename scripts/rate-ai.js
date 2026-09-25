// Measures the strength of the AI across its difficulty range on an Elo scale anchored at
// uniform-random play = 0.
//
//   bun scripts/rate-ai.js [--games 40] [--step 0.5] [--reach 2] [--workers N]
//
// Plays bots at difficulties 0, step, 2·step, ... MAX_DIFFICULTY against their neighbours up to
// `reach` steps away (close matches carry the most information), `games` per pairing with colours
// alternating. Results are appended to scripts/ai-games.jsonl, so reruns add evidence rather than
// start over; records from another ENGINE version, or whose bots used tiers that have since changed,
// are ignored. All games so far are then fit
// at once by maximum likelihood (Bradley-Terry with a first-move advantage per difficulty), which, unlike
// incremental Elo, doesn't depend on game order and gives standard errors. The fit is written to
// packages/shared/src/ai-ratings.json for the difficulty slider.
import { TIERS, MAX_DIFFICULTY, ENGINE } from '../packages/shared/src/ai.js';
import { cpus } from 'node:os';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? dflt : +process.argv[i + 1]; };
const GAMES = arg('games', 40), STEP = arg('step', 0.5), REACH = arg('reach', 2);
const WORKERS = arg('workers', Math.max(1, cpus().length - 1));
const LOG = new URL('./ai-games.jsonl', import.meta.url).pathname;
const OUT = new URL('../packages/shared/src/ai-ratings.json', import.meta.url).pathname;
const tiers = JSON.stringify(TIERS);

// --- play ---
const points = [];
for (let x = 0; x <= MAX_DIFFICULTY + 1e-9; x += STEP) points.push(+x.toFixed(3));
const jobs = [];
for (let i = 0; i < points.length; i++)
  for (let k = 1; k <= REACH && i + k < points.length; k++)
    for (let n = 0; n < GAMES; n++) {
      const [first, second] = n % 2 ? [points[i + k], points[i]] : [points[i], points[i + k]];
      jobs.push({ first, second, seed: (Math.random() * 2 ** 32) >>> 0 });
    }

if (jobs.length) {
  console.log(`${jobs.length} games over ${points.length} difficulties on ${WORKERS} workers`);
  const t0 = performance.now();
  let next = 0, done = 0;
  await Promise.all(Array.from({ length: WORKERS }, () => new Promise(resolve => {
    const w = new Worker(new URL('./rate-ai-worker.js', import.meta.url).href);
    const feed = () => {
      if (next >= jobs.length) { w.terminate(); return resolve(); }
      const id = next++;
      w.postMessage({ id, ...jobs[id] });
    };
    w.onmessage = ({ data: { id, score, moves } }) => {
      const { first, second, seed } = jobs[id];
      appendFileSync(LOG, JSON.stringify({ tiers, engine: ENGINE, first, second, seed, score, moves }) + '\n');
      if (++done % 50 === 0 || done === jobs.length)
        process.stdout.write(`\r${done}/${jobs.length} games, ${((performance.now() - t0) / 1000).toFixed(0)}s`);
      feed();
    };
    feed();
  })));
  console.log();
}

// --- fit ---
// A game still counts if both its bots would play the same tiers today. Difficulty x mixes tiers
// floor(x) and ceil(x), so games recorded under an older TIERS table that differs only elsewhere
// (say, before a stronger tier was added at the top) are kept.
const parsed = new Map();
const tiersOf = (json, x) => {
  if (!parsed.has(json)) parsed.set(json, JSON.parse(json));
  const t = parsed.get(json);
  return JSON.stringify([t[Math.floor(x)], t[Math.ceil(x)]]);
};
const current = g => (g.engine ?? 1) === ENGINE && [g.first, g.second].every(x => x <= MAX_DIFFICULTY && tiersOf(g.tiers, x) === tiersOf(tiers, x));
const games = existsSync(LOG)
  ? readFileSync(LOG, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(current)
  : [];
const players = [...new Set(games.flatMap(g => [g.first, g.second]))].sort((a, b) => a - b);
if (players[0] !== 0) throw new Error('no games involving the random anchor (difficulty 0)');
const idx = new Map(players.map((x, i) => [x, i]));

// Aggregate to (first, second) -> [score sum, count]. Each pairing also gets one virtual draw, a
// weak prior that keeps the fit finite when one side has won every game so far.
const cells = new Map();
const add = (a, b, s, n) => { const k = `${a},${b}`; const c = cells.get(k) ?? [a, b, 0, 0]; c[2] += s; c[3] += n; cells.set(k, c); };
for (const g of games) add(idx.get(g.first), idx.get(g.second), g.score, 1);
for (const [, [a, b]] of [...cells]) { add(a, b, 0.25, 0.5); add(b, a, 0.25, 0.5); }

// Parameters, all in Elo points: ratings of players 1..n-1 (player 0 is pinned at 0), and a first-move
// advantage per player. A game's first-move advantage is the mean of its two players' terms: it is
// near zero between weak bots but grows to ~200 once both search three plies, so one shared term
// would bend every rating. Each difficulty plays neighbours on both sides, and those triangles of
// pairings make the per-player terms identifiable. A smoothness prior (neighbouring difficulties'
// terms differ by about FM_SD) steadies them. Newton's method on the penalised log-likelihood.
const K = Math.LN10 / 400, FM_SD = 50;
const n = players.length, dim = 2 * n - 1;
const r = new Float64Array(n), fm = new Float64Array(n);
const col = i => i - 1, fmCol = i => n - 1 + i;
let cov;
for (let iter = 0; iter < 100; iter++) {
  const grad = new Float64Array(dim), H = Array.from({ length: dim }, () => new Float64Array(dim));
  for (const [a, b, s, cnt] of cells.values()) {
    const p = 1 / (1 + Math.exp(-K * (r[a] - r[b] + (fm[a] + fm[b]) / 2)));
    const gsc = K * (s - cnt * p), w = K * K * cnt * p * (1 - p);
    const terms = [[a === 0 ? -1 : col(a), 1], [b === 0 ? -1 : col(b), -1], [fmCol(a), 0.5], [fmCol(b), 0.5]].filter(t => t[0] >= 0);
    for (const [i, si] of terms) {
      grad[i] += si * gsc;
      for (const [j, sj] of terms) H[i][j] += si * sj * w; // negative Hessian (Fisher information)
    }
  }
  for (let i = 0; i + 1 < n; i++) {
    const a = fmCol(i), b = fmCol(i + 1), d = (fm[i] - fm[i + 1]) / FM_SD ** 2, w = 1 / FM_SD ** 2;
    grad[a] -= d; grad[b] += d;
    H[a][a] += w; H[b][b] += w; H[a][b] -= w; H[b][a] -= w;
  }
  cov = invert(H);
  let step = 0;
  for (let i = 0; i < dim; i++) {
    let d = 0;
    for (let j = 0; j < dim; j++) d += cov[i][j] * grad[j];
    if (i >= n - 1) fm[i - (n - 1)] += d; else r[i + 1] += d;
    step = Math.max(step, Math.abs(d));
  }
  if (step < 1e-6) break;
}

function invert(M) {
  const m = M.length, A = M.map((row, i) => [...row, ...Array.from({ length: m }, (_, j) => +(i === j))]);
  for (let c = 0; c < m; c++) {
    let p = c;
    for (let i = c + 1; i < m; i++) if (Math.abs(A[i][c]) > Math.abs(A[p][c])) p = i;
    [A[c], A[p]] = [A[p], A[c]];
    const d = A[c][c];
    for (let j = 0; j < 2 * m; j++) A[c][j] /= d;
    for (let i = 0; i < m; i++) if (i !== c) { const f = A[i][c]; for (let j = 0; j < 2 * m; j++) A[i][j] -= f * A[c][j]; }
  }
  return A.map(row => row.slice(m));
}

const played = new Map(players.map(x => [x, 0]));
for (const g of games) { played.set(g.first, played.get(g.first) + 1); played.set(g.second, played.get(g.second) + 1); }
const table = players.map((x, i) => ({
  difficulty: x,
  elo: Math.round(r[i]),
  se: i === 0 ? 0 : Math.round(Math.sqrt(cov[col(i)][col(i)])),
  firstMove: Math.round(fm[i]),
  firstMoveSe: Math.round(Math.sqrt(cov[fmCol(i)][fmCol(i)])),
  games: played.get(x),
}));

console.log(`${games.length} games\n`);
console.log('difficulty    elo     ±   first-move     ±   games');
for (const t of table)
  console.log(`${t.difficulty.toFixed(2).padStart(10)} ${String(t.elo).padStart(6)} ${String(t.se).padStart(5)} ${String(t.firstMove).padStart(12)} ${String(t.firstMoveSe).padStart(5)} ${String(t.games).padStart(7)}`);

writeFileSync(OUT, JSON.stringify({ anchor: 'uniform random play = 0', engine: ENGINE, tiers: TIERS, points: table }, null, 2) + '\n');
console.log(`\nwrote ${OUT}`);
