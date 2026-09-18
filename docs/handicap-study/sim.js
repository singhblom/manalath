// Usage: bun sim.js '{"d":[3,3],"pass":[0,0],"liab":[0,0],"tempo":[0,0],"games":50}'
// d[i]: search depth of player i+1. pass[i]: pass tokens. liab[i]: liability 3-groups of player i+1's colour
// pre-placed in corners. tempo[i]: extra opening placements for player i+1.
import { Game } from '../../packages/shared/src/game.js';
import { N, cells, indexOf, RADIUS } from '../../packages/shared/src/hex.js';
import { search, negamax, WIN, dead } from './ai-fixed-depth.js';
import { distFromCenter, isStarPoint, rows } from '../../packages/shared/src/hex.js';
const cfg = Object.assign({ d: [3, 3], pass: [0, 0], liab: [0, 0], tempo: [0, 0], dead: [0, 0], deadMode: 'random', games: 50 }, JSON.parse(/^\d+$/.test(process.argv[2]) ? require('fs').readFileSync(process.env.CFG||'configs.txt','utf8').split('\n')[+process.argv[2]-1] : (process.argv[2] || '{}')));

// Six corners of the hexagon and the two edge cells adjacent to each: cramped 3-groups.
const corners = [[RADIUS, 0], [0, RADIUS], [-RADIUS, RADIUS], [-RADIUS, 0], [0, -RADIUS], [RADIUS, -RADIUS]];
const dirs = [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]];
function cornerGroup(k) {
  const [q, r] = corners[k];
  // neighbours of the corner that lie on the board: exactly 3, two of them on the edge. Take the two edge ones.
  const nb = dirs.map(([dq, dr]) => indexOf(q + dq, r + dr)).filter(i => i >= 0);
  const edge = nb.filter(i => { const c = cells[i]; return Math.max(Math.abs(c.q), Math.abs(c.r), Math.abs(-c.q - c.r)) === RADIUS; });
  return [indexOf(q, r), ...edge];
}

const cellOf = n => rows[n.charCodeAt(0) - 97][+n.slice(1) - 1];
const PATTERNS = [[], ['e5'], ['e3','e7'], ['c3','e7','g3'], ['c3','c5','g3','g5'], ['c3','c5','e5','g3','g5'], ['c3','c5','e3','e7','g3','g5'], ['c3','c5','e3','e5','e7','g3','g5'], ['e3']];
let used = 0, forcedPasses = 0;
function play() {
  const g = new Game();
  // dead cells: player p+1 may not play cfg.dead[p] cells (random, or the most central ones)
  for (let p = 1; p <= 2; p++) {
    const k = cfg.dead[p - 1]; dead[p] = null; if (!k) continue;
    const m = new Uint8Array(N);
    let idx = [...Array(N).keys()];
    if (cfg.deadMode === 'pattern') idx = PATTERNS[k].map(cellOf);
    else if (cfg.deadMode === 'star') idx = idx.filter(isStarPoint).sort((a, b) => distFromCenter(a) - distFromCenter(b) || Math.random() - 0.5);
    else if (cfg.deadMode === 'center') idx.sort((a, b) => distFromCenter(a) - distFromCenter(b) || Math.random() - 0.5);
    else if (cfg.deadMode === 'edge') idx.sort((a, b) => distFromCenter(b) - distFromCenter(a) || Math.random() - 0.5);
    else idx.sort(() => Math.random() - 0.5);
    for (const i of idx.slice(0, k)) m[i] = 1;
    dead[p] = m;
  }
  // liability groups: player 1's colour in corners 0,2,4; player 2's in 1,3,5
  for (let p = 1; p <= 2; p++) for (let k = 0; k < cfg.liab[p - 1]; k++) for (const i of cornerGroup((k * 2 + (p - 1)) % 6)) g.board[i] = p;
  const tokens = [...cfg.pass];
  let extra = [...cfg.tempo];
  while (!g.isOver) {
    const p = g.player, idx = p - 1;
    const { move, score } = search(g.board, p, cfg.d[idx]);
    // Use a pass token when the search sees a forced loss (or no safe move) and tokens remain.
    if (tokens[idx] > 0) {
      // Value a pass as a move: opponent to play in the same position, searched to the same depth.
      const d = Math.max(1, cfg.d[idx]);
      const passScore = -negamax(Int8Array.from(g.board), 3 - p, d - 1, -Infinity, Infinity);
      if (move === null || passScore > score + 5) { tokens[idx]--; used++; g.pass(); continue; }
    }
    if (move === null) { forcedPasses++; g.pass(); continue; }
    g.place(move[0], move[1]);
    if (extra[idx] > 0 && !g.isOver) { extra[idx]--; g.player = p; }
  }
  return g.status === 'draw' ? 0 : g.winner;
}
const t0 = performance.now();
const res = { p1: 0, p2: 0, draw: 0 };
for (let n = 0; n < cfg.games; n++) { const w = play(); if (w === 1) res.p1++; else if (w === 2) res.p2++; else res.draw++; }
console.log(JSON.stringify({ cfg, ...res, passesUsed: used, forcedPasses, p1rate: +(res.p1 / cfg.games).toFixed(3), secs: +((performance.now() - t0) / 1000).toFixed(1) }));
