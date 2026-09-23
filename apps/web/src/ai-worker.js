import { chooseMove } from '@manalath/shared/ai.js';

// The AI search runs here, off the main thread, so a long think never stalls the board's animations.
self.onmessage = ({ data: { id, board, player, level } }) => {
  const move = chooseMove(board, player, level);
  self.postMessage({ id, move });
};
