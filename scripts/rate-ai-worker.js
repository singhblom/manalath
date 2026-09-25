// Plays one AI-vs-AI game per message for rate-ai.js. The seed makes each game's dice reproducible
// (the search's safety time cap aside).
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

self.onmessage = ({ data: { id, first, second, seed } }) => {
  const rand = mulberry32(seed);
  const g = new Game();
  while (!g.isOver) {
    const m = chooseMove(g.board, g.player, g.player === 1 ? first : second, rand);
    if (m) g.place(m.cell, m.color); else g.pass();
  }
  // score from the first player's point of view
  self.postMessage({ id, score: g.status === 'draw' ? 0.5 : g.winner === 1 ? 1 : 0, moves: g.moveCount });
};
