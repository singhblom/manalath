// The Manalath board for the docs/ write-ups: hex geometry as in packages/shared/src/hex.js, and an SVG drawer.
// A classic script (not a module) so the pages still work when opened straight from disk.

// ---------- geometry ----------
const RADIUS = 4, CELLS = [], KEY = new Map();
for (let r = -RADIUS; r <= RADIUS; r++) for (let q = Math.max(-RADIUS, -r - RADIUS); q <= Math.min(RADIUS, -r + RADIUS); q++) { KEY.set(q + ',' + r, CELLS.length); CELLS.push({ q, r, i: CELLS.length }); }
const N = CELLS.length;
const cellAt = (q, r) => KEY.get(q + ',' + r) ?? -1;
const STEP = CELLS.map(({ q, r }) => [[1, 0], [0, 1], [1, -1], [-1, 0], [0, -1], [-1, 1]].map(([dq, dr]) => cellAt(q + dq, r + dr)));
const dist = i => { const { q, r } = CELLS[i]; return Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)); };
// Rows a–i from top to bottom, cells numbered from 1 left to right: e5 is the centre.
const ROWS = []; for (let r = -RADIUS; r <= RADIUS; r++) ROWS.push(CELLS.filter(c => c.r === r).map(c => c.i));
const cellName = i => { const row = CELLS[i].r + RADIUS; return String.fromCharCode(97 + row) + (ROWS[row].indexOf(i) + 1); };
const cellIndex = name => ROWS[name.charCodeAt(0) - 97][+name.slice(1) - 1];

// ---------- drawing ----------
// stones: cell → 1 (white) or 2 (black), as an object or a board array.
// fills: cell → fill colour. text: cell → a short label drawn on the cell.
// labels: row letters down the left. open: cell → whether it takes clicks (class "cell open").
// overlay(i, x, y, s): extra SVG drawn on top of each cell, where s is the cell radius.
function boardSVG({ stones = {}, fills = {}, text = {}, labels = false, open = null, overlay = null, label = 'Manalath board' } = {}) {
  const s = 100 / 17, SQ3 = Math.sqrt(3), at = c => [50 + s * SQ3 * (c.q + c.r / 2), 50 + s * 1.5 * c.r];
  let out = `<svg viewBox="${labels ? '-6 0 106 100' : '0 0 100 100'}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${label}">`;
  if (labels) ROWS.forEach((row, k) => { const [x, y] = at(CELLS[row[0]]); out += `<text x="${x - s * 1.35}" y="${y + 1.1}" text-anchor="end" font-size="3.2" fill="var(--muted)">${String.fromCharCode(97 + k)}</text>`; });
  for (const c of CELLS) {
    const i = c.i, [x, y] = at(c), stone = stones[i];
    const pts = []; for (let k = 0; k < 6; k++) { const a = Math.PI / 180 * (60 * k - 30); pts.push((x + s * .96 * Math.cos(a)).toFixed(2) + ',' + (y + s * .96 * Math.sin(a)).toFixed(2)); }
    out += `<polygon class="cell${open && open(i) ? ' open' : ''}" data-i="${i}" points="${pts.join(' ')}" fill="${fills[i] ?? 'var(--cell)'}" stroke="var(--cell-stroke)" stroke-width=".6"><title>${cellName(i)}</title></polygon>`;
    if (stone) out += `<circle cx="${x}" cy="${y}" r="${s * .64}" fill="${stone === 1 ? 'var(--p1)' : 'var(--p2)'}" stroke="var(--ink)" stroke-width=".5" stroke-opacity=".5" pointer-events="none"/>`;
    if (text[i] != null) out += `<text x="${x}" y="${y + s * .32}" text-anchor="middle" font-size="${s * .9}" font-family="Jost, Futura, sans-serif" fill="${stone === 2 ? 'var(--p1)' : 'var(--ink)'}" pointer-events="none">${text[i]}</text>`;
    if (overlay) out += overlay(i, x, y, s);
  }
  return out + '</svg>';
}
