import { N, distFromCenter, step } from './hex.js';
import { MAX_GROUP } from './game.js';

const WIN = 10000;
const TIE_EPS = 1e-6;

// Bump when a change to the search alters how the bots play, so scripts/rate-ai.js stops pooling
// games played by the old engine. 2: exact ties at the root. 3: faster move generation, so the
// time-capped tier reaches its node budget (the search itself is unchanged).
export const ENGINE = 3;

// Labels every group on the board with one flood fill. Everything the search needs to know about a
// move (its legality, and whether it wins or loses for either player) then follows from the groups
// around its cell, without placing the stone and re-scanning the board.
// Groups are numbered in order of their lowest cell, the same order as allGroups() in game.js.
function analyse(board) {
  const gid = new Int16Array(N).fill(-1), size = [], color = [];
  const quarts = [0, 0, 0], quints = [0, 0, 0], stack = [];
  for (let i = 0; i < N; i++) {
    if (board[i] === 0 || gid[i] !== -1) continue;
    const g = size.length, c = board[i];
    let n = 0;
    gid[i] = g;
    stack.push(i);
    while (stack.length) {
      const cur = stack.pop();
      n++;
      for (let d = 0; d < 6; d++) {
        const j = step[cur][d];
        if (j !== -1 && gid[j] === -1 && board[j] === c) { gid[j] = g; stack.push(j); }
      }
    }
    size.push(n);
    color.push(c);
    if (n === 4) quarts[c]++;
    else if (n === 5) quints[c]++;
  }
  return { board, gid, size, color, quarts, quints };
}

// Moves are [cell, colour, size of the group it makes, number of quarts it absorbs into that group].
function legalMoves(a) {
  const { board, gid, size } = a, out = [], seen = [];
  for (let i = 0; i < N; i++) {
    if (board[i] !== 0) continue;
    for (let c = 1; c <= 2; c++) {
      let s = 1, q = 0;
      seen.length = 0;
      for (let d = 0; d < 6; d++) {
        const j = step[i][d];
        if (j === -1 || board[j] !== c || seen.includes(gid[j])) continue;
        seen.push(gid[j]);
        s += size[gid[j]];
        if (size[gid[j]] === 4) q++;
      }
      if (s <= MAX_GROUP) out.push([i, c, s, q]);
    }
  }
  return out;
}

// What happens to `p` if p plays move m and ends the turn: 'won' | 'lost' | null.
// Same rule as checkEnd() in game.js: any group of p's colour of exactly 4 loses, else one of 5 wins.
function outcome(a, m, p) {
  let q4 = a.quarts[p], q5 = a.quints[p];
  if (m[1] === p) { q4 += (m[2] === 4) - m[3]; q5 += m[2] === 5; }
  return q4 ? 'lost' : q5 ? 'won' : null;
}

// Classify moves for player p: returns { wins:[], safe:[] } (losing moves dropped).
function classify(a, p, moves) {
  const wins = [], safe = [];
  for (const m of moves) {
    const r = outcome(a, m, p);
    if (r === 'won') wins.push(m);
    else if (r === null) safe.push(m);
  }
  return { wins, safe };
}

// Static evaluation for side p to move, given the analysis, moves and classification negamax already
// has for this position (p has safe moves and no immediate win, or negamax would have returned).
function evaluate(a, p, moves, mine) {
  const o = 3 - p;
  const theirs = classify(a, o, moves);
  let score = -theirs.wins.length * 40 + (mine.safe.length - theirs.safe.length) * 0.5;
  // Groups of 3 of my colour are latent threats (opponent can't grow them without gifting me a quint chance);
  // groups of 3 of the opponent's are the same for them.
  for (let g = 0; g < a.size.length; g++) {
    const n = a.size[g], v = n === 3 ? 6 : n === 2 ? 2 : n === 1 ? 1 : 0;
    score += a.color[g] === p ? v : -v;
  }
  for (let i = 0; i < N; i++) if (a.board[i] === p) score += 0.3 * (4 - distFromCenter(i));
  return score;
}

class Timeout extends Error {}

function ordered(a, p, safe) {
  const o = 3 - p;
  return safe
    .map(m => {
      let s = -distFromCenter(m[0]);
      // prefer moves that remove opponent winning chances: crude proxy — placing my colour adjacent to their groups
      const so = outcome(a, m, o);
      if (so === 'won') s += 30; // taking a cell the opponent would win with
      if (m[1] === o) s -= 1;
      return [s, m];
    })
    .sort((a, b) => b[0] - a[0])
    .map(x => x[1]);
}

function negamax(board, p, depth, alpha, beta, ctx) {
  if (++ctx.nodes > ctx.maxNodes || ((ctx.nodes & 255) === 0 && performance.now() > ctx.deadline)) throw new Timeout();
  const a = analyse(board);
  const moves = legalMoves(a);
  if (!moves.length) {
    // forced pass: end conditions for p still apply
    return a.quarts[p] ? -(WIN + depth) : a.quints[p] ? WIN + depth : 0;
  }
  const mine = classify(a, p, moves);
  if (mine.wins.length) return WIN + depth;
  if (!mine.safe.length) return -(WIN + depth);
  if (depth === 0) return evaluate(a, p, moves, mine);
  let best = -Infinity;
  for (const [i, c] of ordered(a, p, mine.safe)) {
    board[i] = c;
    const v = -negamax(board, 3 - p, depth - 1, -beta, -alpha, ctx);
    board[i] = 0;
    if (v > best) best = v;
    if (v > alpha) alpha = v;
    if (alpha >= beta) break;
  }
  return best;
}

function rootSearch(board, p, depth, ctx) {
  const a = analyse(board);
  const moves = legalMoves(a);
  if (!moves.length) return { move: null, score: 0 };
  const { wins, safe } = classify(a, p, moves);
  if (wins.length) return { move: wins[0], score: WIN };
  if (!safe.length) return { move: moves[Math.floor(ctx.rand() * moves.length)], score: -WIN };
  let best = -Infinity, alpha = -Infinity, ties = [];
  for (const m of ordered(a, p, safe)) {
    board[m[0]] = m[1];
    // Search against a bound just below alpha: a fail-soft cut-off at exactly alpha would otherwise
    // report a worse move as a tie for best, and the random tie-break could pick it.
    const v = -negamax(board, 3 - p, depth - 1, -Infinity, -alpha + TIE_EPS, ctx);
    board[m[0]] = 0;
    if (v > best) { best = v; ties = [m]; }
    else if (v === best) ties.push(m);
    if (v > alpha) alpha = v;
  }
  return { move: ties[Math.floor(ctx.rand() * ties.length)], score: best };
}

// Difficulty is a continuous number over a ladder of tiers. Each move, a bot at difficulty x plays
// as tier ceil(x) with probability frac(x) and as tier floor(x) otherwise, so strength moves
// smoothly between neighbouring tiers. Search tiers are budgeted in nodes rather than time so a
// bot is equally strong on every device (and its measured rating means something); MAX_MS is only a
// safety cap for slow devices. Ratings for each point are measured by scripts/rate-ai.js.
export const TIERS = [
  { kind: 'random' },                     // 0: any legal move, uniformly
  { kind: 'safe' },                       // 1: takes an immediate win, never loses on the spot
  { kind: 'quiet' },                      // 2: ...and doesn't hand the opponent an immediate win
  { kind: 'search', maxDepth: 1 },
  { kind: 'search', nodes: 3000,  maxDepth: 8 },
  { kind: 'search', nodes: 12000, maxDepth: 8 },
  { kind: 'search', nodes: 50000, maxDepth: 8 },
];
export const MAX_DIFFICULTY = TIERS.length - 1;
const MAX_MS = 4000;

// Named levels from before the slider (saved settings may still hold them).
const NAMED = { easy: 2, medium: 3.5, normal: 5, hard: 6 };
export function difficultyOf(level) {
  const x = typeof level === 'number' ? level : NAMED[level] ?? NAMED.normal;
  return Math.min(MAX_DIFFICULTY, Math.max(0, x));
}

// Returns { cell, color } or null if no legal move (caller should pass).
// `level` is a difficulty in [0, MAX_DIFFICULTY] or a legacy level name.
export function chooseMove(boardIn, p, level = 'normal', rand = Math.random) {
  const x = difficultyOf(level);
  const lo = Math.floor(x);
  const tier = TIERS[rand() < x - lo ? lo + 1 : lo];
  return playTier(Int8Array.from(boardIn), p, tier, rand);
}

function playTier(board, p, tier, rand) {
  const pick = a => a[Math.floor(rand() * a.length)];
  const a = analyse(board);
  const moves = legalMoves(a);
  if (!moves.length) return null;
  if (tier.kind === 'random') return toMove(pick(moves));
  const { wins, safe } = classify(a, p, moves);
  if (wins.length) return toMove(wins[0]);
  if (!safe.length) return toMove(pick(moves));
  if (tier.kind === 'safe') return toMove(pick(safe));

  if (tier.kind === 'quiet') {
    // Don't hand the opponent an immediate win if avoidable; otherwise random.
    const o = 3 - p;
    const quiet = safe.filter(([i, c]) => {
      board[i] = c;
      const after = analyse(board);
      const oppWins = legalMoves(after).some(m => outcome(after, m, o) === 'won');
      board[i] = 0;
      return !oppWins;
    });
    return toMove(pick(quiet.length ? quiet : safe));
  }

  const ctx = { nodes: 0, maxNodes: tier.nodes ?? Infinity, deadline: performance.now() + MAX_MS, rand };
  let result = rootSearch(board, p, 1, { ...ctx, maxNodes: Infinity });
  for (let d = 2; d <= tier.maxDepth; d++) {
    try {
      const r = rootSearch(board, p, d, ctx);
      result = r;
      if (Math.abs(r.score) >= WIN - 100) break;
    } catch (e) {
      if (e instanceof Timeout) break;
      throw e;
    }
  }
  return toMove(result.move);
}

function toMove(m) { return m ? { cell: m[0], color: m[1] } : null; }
