// How much does the first move decide? Plays the AI against itself from each distinct first move and
// reports the first player's score, to find the fairest fixed opening and the moves that make a swap
// rule interesting.
//
//   bun scripts/opening-study.js [--level 6] [--games 100] [--workers N] [--only e5w,e5b]
//
// The board has twelve symmetries, so the 122 first moves reduce to 9 cells x 2 colours. Colours
// belong to players (white is the first player's), so the colour of the opening stone matters. The
// "bot" row lets the bot choose its own first move, as a baseline. Games are appended to
// scripts/opening-games.jsonl, so reruns add evidence; records from another ENGINE version or
// TIERS table are ignored.
import { TIERS, ENGINE } from '../packages/shared/src/ai.js';
import { cells, indexOf, rows, N } from '../packages/shared/src/hex.js';
import { cpus } from 'node:os';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';

const argv = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? dflt : process.argv[i + 1]; };
const LEVEL = +argv('level', 6), GAMES = +argv('games', 100);
const WORKERS = +argv('workers', Math.max(1, cpus().length - 1));
const ONLY = argv('only', null)?.split(',');
const LOG = new URL('./opening-games.jsonl', import.meta.url).pathname;
const tiers = JSON.stringify(TIERS);

// Cell names as in the docs: row a..i from the top, position in the row from the left.
const name = i => { const r = rows.findIndex(row => row.includes(i)); return String.fromCharCode(97 + r) + (rows[r].indexOf(i) + 1); };
// The twelve symmetries of the hexagon in cube coordinates: six rotations, each optionally mirrored.
const images = i => {
  let { q, r } = cells[i], out = [];
  for (let k = 0; k < 6; k++) {
    const s = -q - r;
    out.push(indexOf(q, r), indexOf(r, q));
    [q, r] = [-r, -s];
  }
  return out;
};
const reps = [...new Set([...Array(N).keys()].map(i => Math.min(...images(i))))];
const openings = [{ key: 'bot', opening: null }];
for (const i of reps) for (const c of [1, 2]) openings.push({ key: name(i) + (c === 1 ? 'w' : 'b'), opening: [i, c], cell: i, orbit: new Set(images(i)).size });

// --- play ---
const jobs = [];
for (const o of openings) if (!ONLY || ONLY.includes(o.key))
  for (let n = 0; n < GAMES; n++) jobs.push({ key: o.key, opening: o.opening, level: LEVEL, seed: (Math.random() * 2 ** 32) >>> 0 });
if (jobs.length) {
  console.log(`${jobs.length} games at difficulty ${LEVEL} on ${WORKERS} workers`);
  const t0 = performance.now();
  let next = 0, done = 0;
  await Promise.all(Array.from({ length: WORKERS }, () => new Promise(resolve => {
    const w = new Worker(new URL('./opening-study-worker.js', import.meta.url).href);
    const feed = () => {
      if (next >= jobs.length) { w.terminate(); return resolve(); }
      const id = next++;
      w.postMessage({ id, ...jobs[id] });
    };
    w.onmessage = ({ data: { id, score, moves } }) => {
      const { key, level, seed } = jobs[id];
      appendFileSync(LOG, JSON.stringify({ tiers, engine: ENGINE, level, opening: key, seed, score, moves }) + '\n');
      if (++done % 20 === 0 || done === jobs.length)
        process.stdout.write(`\r${done}/${jobs.length} games, ${((performance.now() - t0) / 1000).toFixed(0)}s`);
      feed();
    };
    feed();
  })));
  console.log();
}

// --- report ---
const games = existsSync(LOG)
  ? readFileSync(LOG, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(g => g.engine === ENGINE && g.tiers === tiers)
  : [];
for (const level of [...new Set(games.map(g => g.level))].sort()) {
  console.log(`\ndifficulty ${level}: first player's score by opening (± is one standard error)`);
  console.log('opening  cells   games   score     ±   length');
  const rowsOut = openings.map(o => {
    const gs = games.filter(g => g.level === level && g.opening === o.key);
    if (!gs.length) return null;
    const s = gs.reduce((a, g) => a + g.score, 0) / gs.length;
    const len = gs.reduce((a, g) => a + g.moves.length, 0) / gs.length;
    return { ...o, n: gs.length, s, se: Math.sqrt(Math.max(s * (1 - s), 0.01) / gs.length), len };
  }).filter(Boolean);
  for (const r of rowsOut)
    console.log(`${r.key.padEnd(8)} ${String(r.orbit ?? '').padStart(5)} ${String(r.n).padStart(7)} ${(100 * r.s).toFixed(1).padStart(6)}% ${(100 * r.se).toFixed(1).padStart(5)} ${r.len.toFixed(1).padStart(8)}`);
}
