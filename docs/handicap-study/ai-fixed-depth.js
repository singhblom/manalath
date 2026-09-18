// Fixed-depth copy of ../../packages/shared/src/ai.js exposing the root score, for calibration.
import { N, distFromCenter } from '../../packages/shared/src/hex.js';
import { sizeIfPlaced, checkEnd, allGroups, MAX_GROUP } from '../../packages/shared/src/game.js';
export const WIN = 10000;
function outcome(board, i, c, p) { board[i] = c; const r = checkEnd(board, p).result; board[i] = 0; return r; }
// dead[p] = Uint8Array mask of cells player p may not play (either colour), or null.
export const dead = [null, null, null];
export function legalMoves(board, p = 0) {
  const out = [];
  const m = dead[p];
  for (let i = 0; i < N; i++) {
    if (board[i] !== 0 || (m && m[i])) continue;
    if (sizeIfPlaced(board, i, 1) <= MAX_GROUP) out.push([i, 1]);
    if (sizeIfPlaced(board, i, 2) <= MAX_GROUP) out.push([i, 2]);
  }
  return out;
}
export function classify(board, p, moves) {
  const wins = [], safe = [];
  for (const m of moves) { const r = outcome(board, m[0], m[1], p); if (r === 'won') wins.push(m); else if (r === null) safe.push(m); }
  return { wins, safe };
}
function evaluate(board, p) {
  const o = 3 - p; const mine = classify(board, p, legalMoves(board, p));
  if (mine.wins.length) return WIN - 10; if (!mine.safe.length) return -(WIN - 10);
  const theirs = classify(board, o, legalMoves(board, o));
  let score = -theirs.wins.length * 40 + (mine.safe.length - theirs.safe.length) * 0.5;
  for (const g of allGroups(board)) { const v = g.size === 3 ? 6 : g.size === 2 ? 2 : g.size === 1 ? 1 : 0; score += g.color === p ? v : -v; }
  for (let i = 0; i < N; i++) if (board[i] === p) score += 0.3 * (4 - distFromCenter(i));
  return score;
}
function ordered(board, p, safe) {
  const o = 3 - p;
  return safe.map(m => { let s = -distFromCenter(m[0]); if (outcome(board, m[0], m[1], o) === 'won') s += 30; if (m[1] === o) s -= 1; return [s, m]; })
    .sort((a, b) => b[0] - a[0]).map(x => x[1]);
}
export function negamax(board, p, depth, alpha, beta) {
  const moves = legalMoves(board, p);
  if (!moves.length) { const r = checkEnd(board, p).result; return r === 'won' ? WIN + depth : r === 'lost' ? -(WIN + depth) : 0; }
  const { wins, safe } = classify(board, p, moves);
  if (wins.length) return WIN + depth; if (!safe.length) return -(WIN + depth);
  if (depth === 0) return evaluate(board, p);
  let best = -Infinity;
  for (const [i, c] of ordered(board, p, safe)) {
    board[i] = c; const v = -negamax(board, 3 - p, depth - 1, -beta, -alpha); board[i] = 0;
    if (v > best) best = v; if (v > alpha) alpha = v; if (alpha >= beta) break;
  }
  return best;
}
// Returns { move:[i,c]|null, score } for p at fixed depth. depth 0 = random safe move.
export function search(boardIn, p, depth) {
  const board = Int8Array.from(boardIn);
  const moves = legalMoves(board, p);
  if (!moves.length) return { move: null, score: 0 };
  const { wins, safe } = classify(board, p, moves);
  if (wins.length) return { move: wins[0], score: WIN };
  if (!safe.length) return { move: moves[Math.floor(Math.random() * moves.length)], score: -WIN };
  if (depth === 0) return { move: safe[Math.floor(Math.random() * safe.length)], score: 0 };
  let best = -Infinity, alpha = -Infinity, ties = [];
  for (const m of ordered(board, p, safe)) {
    board[m[0]] = m[1]; const v = -negamax(board, 3 - p, depth - 1, -Infinity, -alpha); board[m[0]] = 0;
    if (v > best) { best = v; ties = [m]; } else if (v === best) ties.push(m);
    if (v > alpha) alpha = v;
  }
  return { move: ties[Math.floor(Math.random() * ties.length)], score: best };
}
