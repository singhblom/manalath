import { N, distFromCenter } from './hex.js';
import { sizeIfPlaced, checkEnd, allGroups, MAX_GROUP } from './game.js';

const WIN = 10000;

// What happens to `p` if p places colour c at i and ends the turn: 'won' | 'lost' | null
function outcome(board, i, c, p) {
  board[i] = c;
  const r = checkEnd(board, p).result;
  board[i] = 0;
  return r;
}

function legalMoves(board) {
  const out = [];
  for (let i = 0; i < N; i++) {
    if (board[i] !== 0) continue;
    if (sizeIfPlaced(board, i, 1) <= MAX_GROUP) out.push([i, 1]);
    if (sizeIfPlaced(board, i, 2) <= MAX_GROUP) out.push([i, 2]);
  }
  return out;
}

// Classify moves for player p: returns { wins:[], safe:[] } (losing moves dropped).
function classify(board, p, moves) {
  const wins = [], safe = [];
  for (const m of moves) {
    const r = outcome(board, m[0], m[1], p);
    if (r === 'won') wins.push(m);
    else if (r === null) safe.push(m);
  }
  return { wins, safe };
}

// Static evaluation for side p to move.
function evaluate(board, p) {
  const o = 3 - p;
  const moves = legalMoves(board);
  const mine = classify(board, p, moves);
  if (mine.wins.length) return WIN - 10;
  if (!mine.safe.length) return -(WIN - 10);
  const theirs = classify(board, o, moves);
  let score = -theirs.wins.length * 40 + (mine.safe.length - theirs.safe.length) * 0.5;
  // Groups of 3 of my colour are latent threats (opponent can't grow them without gifting me a quint chance);
  // groups of 3 of the opponent's are the same for them.
  for (const g of allGroups(board)) {
    const v = g.size === 3 ? 6 : g.size === 2 ? 2 : g.size === 1 ? 1 : 0;
    score += g.color === p ? v : -v;
  }
  for (let i = 0; i < N; i++) if (board[i] === p) score += 0.3 * (4 - distFromCenter(i));
  return score;
}

class Timeout extends Error {}

function ordered(board, p, safe) {
  const o = 3 - p;
  return safe
    .map(m => {
      let s = -distFromCenter(m[0]);
      // prefer moves that remove opponent winning chances: crude proxy — placing my colour adjacent to their groups
      const so = outcome(board, m[0], m[1], o);
      if (so === 'won') s += 30; // taking a cell the opponent would win with
      if (m[1] === o) s -= 1;
      return [s, m];
    })
    .sort((a, b) => b[0] - a[0])
    .map(x => x[1]);
}

function negamax(board, p, depth, alpha, beta, ctx) {
  if (++ctx.nodes > ctx.maxNodes || ((ctx.nodes & 255) === 0 && performance.now() > ctx.deadline)) throw new Timeout();
  const moves = legalMoves(board);
  if (!moves.length) {
    // forced pass: end conditions for p still apply
    const r = checkEnd(board, p).result;
    return r === 'won' ? WIN + depth : r === 'lost' ? -(WIN + depth) : 0;
  }
  const { wins, safe } = classify(board, p, moves);
  if (wins.length) return WIN + depth;
  if (!safe.length) return -(WIN + depth);
  if (depth === 0) return evaluate(board, p);
  let best = -Infinity;
  for (const [i, c] of ordered(board, p, safe)) {
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
  const moves = legalMoves(board);
  if (!moves.length) return { move: null, score: 0 };
  const { wins, safe } = classify(board, p, moves);
  if (wins.length) return { move: wins[0], score: WIN };
  if (!safe.length) return { move: moves[Math.floor(ctx.rand() * moves.length)], score: -WIN };
  let best = -Infinity, alpha = -Infinity, ties = [];
  for (const m of ordered(board, p, safe)) {
    board[m[0]] = m[1];
    const v = -negamax(board, 3 - p, depth - 1, -Infinity, -alpha, ctx);
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
  const moves = legalMoves(board);
  if (!moves.length) return null;
  if (tier.kind === 'random') return toMove(pick(moves));
  const { wins, safe } = classify(board, p, moves);
  if (wins.length) return toMove(wins[0]);
  if (!safe.length) return toMove(pick(moves));
  if (tier.kind === 'safe') return toMove(pick(safe));

  if (tier.kind === 'quiet') {
    // Don't hand the opponent an immediate win if avoidable; otherwise random.
    const o = 3 - p;
    const quiet = safe.filter(([i, c]) => {
      board[i] = c;
      const oppWins = legalMoves(board).some(([j, d]) => outcome(board, j, d, o) === 'won');
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
