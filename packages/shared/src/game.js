import { N, step } from './hex.js';

// Manalath.
// Board: Int8Array of length 61, 0 = empty, 1 = white (Player 1's colour), 2 = black (Player 2's colour).
// On your turn you place one piece of EITHER colour. A group (connected same-colour pieces) may never
// exceed 5. At the end of your own turn: a friendly group of exactly 4 (quart) loses, a friendly group
// of exactly 5 (quint) wins. A quart on the board takes precedence over a quint.

export const MAX_GROUP = 5;

// Flood-fill the group containing cell i (board[i] must be non-zero).
export function groupAt(board, i, visited) {
  const c = board[i];
  const cells = [i];
  const stack = [i];
  if (visited) visited[i] = 1;
  const seen = visited || new Uint8Array(N);
  seen[i] = 1;
  while (stack.length) {
    const cur = stack.pop();
    for (let d = 0; d < 6; d++) {
      const j = step[cur][d];
      if (j !== -1 && !seen[j] && board[j] === c) { seen[j] = 1; cells.push(j); stack.push(j); }
    }
  }
  return cells;
}

// All groups on the board: [{ color, cells, size }]
export function allGroups(board) {
  const visited = new Uint8Array(N);
  const out = [];
  for (let i = 0; i < N; i++) {
    if (board[i] === 0 || visited[i]) continue;
    const cells = groupAt(board, i, visited);
    out.push({ color: board[i], cells, size: cells.length });
  }
  return out;
}

// Size of the group that would result from placing colour c at empty cell i.
export function sizeIfPlaced(board, i, c) {
  board[i] = c;
  const g = groupAt(board, i);
  board[i] = 0;
  return g.length;
}

export function isLegal(board, i, c) {
  return board[i] === 0 && sizeIfPlaced(board, i, c) <= MAX_GROUP;
}

// End-of-turn check for player p (colour p). Returns { result: 'lost'|'won'|null, group }.
export function checkEnd(board, p) {
  const groups = allGroups(board).filter(g => g.color === p);
  const quart = groups.find(g => g.size === 4);
  if (quart) return { result: 'lost', group: quart.cells };
  const quint = groups.find(g => g.size === 5);
  if (quint) return { result: 'won', group: quint.cells };
  return { result: null, group: null };
}

export class Game {
  constructor() { this.reset(); }

  reset() {
    this.board = new Int8Array(N);
    this.player = 1;
    this.history = [];       // [{ cell, color, player }] — cell = -1 for a pass
    this.status = 'playing'; // 'playing' | 'won' | 'lost' | 'draw'
    this.winner = 0;
    this.line = null;        // decisive group cells
    this.passes = 0;         // consecutive passes
  }

  get lastMove() {
    for (let k = this.history.length - 1; k >= 0; k--) if (this.history[k].cell >= 0) return this.history[k].cell;
    return -1;
  }
  get lastEntry() { return this.history.length ? this.history[this.history.length - 1] : null; }
  get moveCount() { return this.history.length; }
  get isOver() { return this.status !== 'playing'; }
  get other() { return 3 - this.player; }

  groups() { return allGroups(this.board); }

  isLegal(i, c) { return this.status === 'playing' && (c === 1 || c === 2) && i >= 0 && i < N && isLegal(this.board, i, c); }

  legalMoves() {
    const out = [];
    for (let i = 0; i < N; i++) {
      if (this.board[i] !== 0) continue;
      if (sizeIfPlaced(this.board, i, 1) <= MAX_GROUP) out.push({ cell: i, color: 1 });
      if (sizeIfPlaced(this.board, i, 2) <= MAX_GROUP) out.push({ cell: i, color: 2 });
    }
    return out;
  }

  mustPass() { return this.status === 'playing' && this.legalMoves().length === 0; }

  place(i, c) {
    if (!this.isLegal(i, c)) return null;
    const p = this.player;
    this.board[i] = c;
    this.history.push({ cell: i, color: c, player: p });
    this.passes = 0;
    return this.finishTurn(p);
  }

  pass() {
    if (this.status !== 'playing') return null;
    const p = this.player;
    this.history.push({ cell: -1, color: 0, player: p });
    this.passes++;
    const r = this.finishTurn(p);
    if (this.status === 'playing' && this.passes >= 2) this.status = 'draw';
    return r;
  }

  finishTurn(p) {
    const { result, group } = checkEnd(this.board, p);
    if (result === 'lost') { this.status = 'lost'; this.winner = 3 - p; this.line = group; }
    else if (result === 'won') { this.status = 'won'; this.winner = p; this.line = group; }
    else if (this.history.filter(h => h.cell >= 0).length === N) { this.status = 'draw'; }
    else this.player = 3 - p;
    return { player: p, result, group, status: this.status };
  }

  undo() {
    if (!this.history.length) return false;
    const e = this.history.pop();
    if (e.cell >= 0) this.board[e.cell] = 0;
    this.status = 'playing';
    this.winner = 0;
    this.line = null;
    this.player = e.player;
    // recompute consecutive passes
    let k = this.history.length - 1, n = 0;
    while (k >= 0 && this.history[k].cell < 0) { n++; k--; }
    this.passes = n;
    return true;
  }
}
