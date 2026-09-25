// Maps between AI difficulty (see TIERS in ai.js) and measured strength in Elo, where uniform-random
// play is 0. The points come from scripts/rate-ai.js; between them we interpolate linearly.
import ratings from './ai-ratings.json';
import { difficultyOf } from './ai.js';

// Measurement noise can make a harder point rate slightly below an easier one; keep the curve
// non-decreasing so it can be inverted.
const curve = [];
for (const { difficulty, elo } of ratings.points) curve.push([difficulty, Math.max(elo, curve.at(-1)?.[1] ?? -Infinity)]);

export const MAX_ELO = curve.at(-1)[1];

export function eloForDifficulty(level) {
  const x = difficultyOf(level);
  const k = curve.findIndex(([d]) => d >= x);
  if (k <= 0) return curve[0][1];
  const [x0, e0] = curve[k - 1], [x1, e1] = curve[k];
  return e0 + ((x - x0) / (x1 - x0)) * (e1 - e0);
}

export function difficultyForElo(elo) {
  if (elo <= curve[0][1]) return curve[0][0];
  const k = curve.findIndex(([, e]) => e >= elo);
  // Past the strongest measured point, use the cheapest difficulty that reached it.
  if (k < 0) return curve.find(([, e]) => e === MAX_ELO)[0];
  const [x0, e0] = curve[k - 1], [x1, e1] = curve[k];
  return e1 === e0 ? x0 : x0 + ((elo - e0) / (e1 - e0)) * (x1 - x0);
}
