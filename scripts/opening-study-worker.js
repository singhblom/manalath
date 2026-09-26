// Plays one AI-vs-AI game per message for opening-study.js, starting from a fixed first move
// (or none, to let the bot choose its own).
import { Game } from '../packages/shared/src/game.js';
import { chooseMove } from '../packages/shared/src/ai.js';

function mulberry32(a) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

self.onmessage = ({ data: { id, opening, level, seed } }) => {
  const rand = mulberry32(seed);
  const g = new Game();
  if (opening) g.place(opening[0], opening[1]);
  while (!g.isOver) {
    const m = chooseMove(g.board, g.player, level, rand);
    if (m) g.place(m.cell, m.color); else g.pass();
  }
  // score from the first player's point of view; moves as cell*2 + colour - 1, pass = -1
  self.postMessage({
    id,
    score: g.status === 'draw' ? 0.5 : g.winner === 1 ? 1 : 0,
    moves: g.history.map(h => (h.cell < 0 ? -1 : h.cell * 2 + h.color - 1)),
  });
};
