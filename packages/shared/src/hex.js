// Hex board geometry for Yavalath: hexagon of side 5 (radius 4), 61 cells.
// Axial coordinates (q, r); pointy-top layout.
export const RADIUS = 4;
export const SQRT3 = Math.sqrt(3);

export const cells = [];       // [{q, r, i}]
const keyToIndex = new Map();

for (let r = -RADIUS; r <= RADIUS; r++) {
  const qMin = Math.max(-RADIUS, -r - RADIUS);
  const qMax = Math.min(RADIUS, -r + RADIUS);
  for (let q = qMin; q <= qMax; q++) {
    const i = cells.length;
    cells.push({ q, r, i });
    keyToIndex.set(`${q},${r}`, i);
  }
}

export const N = cells.length; // 61

export function indexOf(q, r) {
  const i = keyToIndex.get(`${q},${r}`);
  return i === undefined ? -1 : i;
}

// The three line directions (and their reverses are handled by negating).
export const DIRS = [[1, 0], [0, 1], [1, -1]];

// step[i][d] = index of neighbour of cell i in direction d (0..5), -1 if off board.
// d < 3 are DIRS, d >= 3 are the reverse of DIRS[d-3].
export const step = cells.map(({ q, r }) => {
  const out = [];
  for (let d = 0; d < 6; d++) {
    const [dq, dr] = DIRS[d % 3];
    const sgn = d < 3 ? 1 : -1;
    out.push(indexOf(q + sgn * dq, r + sgn * dr));
  }
  return out;
});

export function distFromCenter(i) {
  const { q, r } = cells[i];
  return Math.max(Math.abs(q), Math.abs(r), Math.abs(-q - r));
}

// Pointy-top axial -> planar coordinates, with `size` = circumradius of a cell.
export function hexToPlane(q, r, size = 1) {
  return { x: size * SQRT3 * (q + r / 2), y: size * 1.5 * r };
}

// Rows for text-style layouts: array of arrays of cell indices, top to bottom.
export const rows = (() => {
  const out = [];
  for (let r = -RADIUS; r <= RADIUS; r++) {
    out.push(cells.filter(c => c.r === r).map(c => c.i));
  }
  return out;
})();

// "Star points" (hoshi): the centre and the six points two steps out along the axes — the same set the goban marks.
export function isStarPoint(i) {
  const { q, r } = cells[i];
  const d = distFromCenter(i);
  return d === 0 || (d === 2 && (q === 0 || r === 0 || q + r === 0));
}
