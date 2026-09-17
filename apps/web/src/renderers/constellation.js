import { cells, hexToPlane, N, step, isStarPoint } from '@manalath/shared/hex.js';
import { BaseRenderer } from './base.js';

// "Constellation": groups are star clusters. Adjacent same-colour stones are joined by glowing lines,
// every cluster sits in a soft nebula and carries a badge with its size (3 = amber warning,
// 4 = pulsing red quart, 5 = golden quint).
const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}, parent) => {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
};
function rng(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export class ConstellationRenderer extends BaseRenderer {
  constructor(container, handlers) {
    super(container, handlers);
    this.colors = { p1: '#ffd166', p2: '#5ee1ff' };
    this.hover = -1;
    this.svg = el('svg', { viewBox: '-9.6 -8.6 19.2 17.2', preserveAspectRatio: 'xMidYMid meet', class: 'cst' });
    container.appendChild(this.svg);
    this.pos = cells.map(c => hexToPlane(c.q, c.r, 1));
    this.buildStatic();
    this.layers = {};
    for (const name of ['halos', 'edges', 'pieces', 'hover']) this.layers[name] = el('g', { class: 'cst-' + name }, this.svg);
    this.svg.addEventListener('click', this.onClick = (e) => this.hit(e, false));
    this.svg.addEventListener('contextmenu', this.onCtx = (e) => { e.preventDefault(); this.hit(e, true); });
    this.svg.addEventListener('pointermove', this.onMove = (e) => { const i = this.cellFrom(e); if (i !== this.hover) { this.hover = i; this.drawHover(); } });
    this.svg.addEventListener('pointerleave', this.onLeave = () => { this.hover = -1; this.drawHover(); });
  }

  buildStatic() {
    const defs = el('defs', {}, this.svg);
    const glow = el('filter', { id: 'cst-glow', x: '-50%', y: '-50%', width: '200%', height: '200%' }, defs);
    el('feGaussianBlur', { stdDeviation: '0.18', result: 'b' }, glow);
    const m = el('feMerge', {}, glow); el('feMergeNode', { in: 'b' }, m); el('feMergeNode', { in: 'SourceGraphic' }, m);
    const blur = el('filter', { id: 'cst-blur', x: '-50%', y: '-50%', width: '200%', height: '200%' }, defs);
    el('feGaussianBlur', { stdDeviation: '0.55' }, blur);
    const grad = el('radialGradient', { id: 'cst-sky', cx: '50%', cy: '45%', r: '75%' }, defs);
    el('stop', { offset: '0', 'stop-color': '#141b3a' }, grad);
    el('stop', { offset: '1', 'stop-color': '#04060f' }, grad);
    el('rect', { x: -50, y: -50, width: 100, height: 100, fill: 'url(#cst-sky)' }, this.svg);
    // nebula: soft colour clouds, warped by turbulence into wisps and swirls, drifting very slowly
    const swirl = el('filter', { id: 'cst-nebula', x: '-40%', y: '-40%', width: '180%', height: '180%', filterUnits: 'objectBoundingBox', primitiveUnits: 'userSpaceOnUse' }, defs);
    el('feTurbulence', { type: 'fractalNoise', baseFrequency: '0.045 0.07', numOctaves: 3, seed: 7, result: 'noise' }, swirl);
    el('feDisplacementMap', { in: 'SourceGraphic', in2: 'noise', scale: 5, xChannelSelector: 'R', yChannelSelector: 'G', result: 'warped' }, swirl);
    el('feGaussianBlur', { in: 'warped', stdDeviation: 0.9 }, swirl);
    const cloud = (id, c0, c1) => {
      const gr = el('radialGradient', { id }, defs);
      el('stop', { offset: 0, 'stop-color': c0, 'stop-opacity': 0.55 }, gr);
      el('stop', { offset: 0.55, 'stop-color': c1, 'stop-opacity': 0.22 }, gr);
      el('stop', { offset: 1, 'stop-color': c1, 'stop-opacity': 0 }, gr);
    };
    cloud('cst-neb-a', '#6d3bb5', '#2a1660');
    cloud('cst-neb-b', '#1f7c8c', '#0b3a4a');
    cloud('cst-neb-c', '#b0356f', '#4a1030');
    const nebula = el('g', { class: 'cst-nebula', filter: 'url(#cst-nebula)' }, this.svg);
    el('ellipse', { cx: -3.5, cy: -2.5, rx: 9, ry: 4.2, fill: 'url(#cst-neb-a)', transform: 'rotate(-28 -3.5 -2.5)' }, nebula);
    el('ellipse', { cx: 4.5, cy: 1.5, rx: 8, ry: 3.4, fill: 'url(#cst-neb-b)', transform: 'rotate(18 4.5 1.5)' }, nebula);
    el('ellipse', { cx: 1, cy: 5, rx: 6.5, ry: 2.6, fill: 'url(#cst-neb-c)', transform: 'rotate(-12 1 5)' }, nebula);
    el('ellipse', { cx: -6, cy: 4.5, rx: 4.5, ry: 2, fill: 'url(#cst-neb-b)', transform: 'rotate(35 -6 4.5)' }, nebula);
    // stars
    const stars = el('g', { class: 'cst-stars' }, this.svg);
    const r = rng(2024);
    for (let k = 0; k < 220; k++) {
      const s = el('circle', { cx: (r() * 30 - 15).toFixed(2), cy: (r() * 24 - 12).toFixed(2), r: (0.02 + r() * 0.05).toFixed(3), fill: '#ffffff', opacity: (0.3 + r() * 0.7).toFixed(2) }, stars);
      if (r() < 0.25) s.style.animationDelay = (r() * 4).toFixed(2) + 's', s.classList.add('cst-twinkle');
    }
    // the dual lattice: faint dotted lines between neighbouring points, a small node at each point,
    // and an invisible disc per point as the click target
    const lattice = el('g', { class: 'cst-lattice' }, this.svg);
    for (const c of cells) {
      const a = this.pos[c.i];
      for (let d = 0; d < 3; d++) {
        const j = step[c.i][d];
        if (j === -1) continue;
        const b = this.pos[j];
        el('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y }, lattice);
      }
    }
    const grid = el('g', { class: 'cst-grid' }, this.svg);
    this.cellEls = [];
    for (const c of cells) {
      const { x, y } = this.pos[c.i];
      if (isStarPoint(c.i)) el('circle', { cx: x, cy: y, r: 0.07, class: 'cst-node cst-star-point' }, grid);
      this.cellEls.push(el('circle', { cx: x, cy: y, r: 0.8, class: 'cst-cell', 'data-i': c.i }, grid));
    }
  }

  cellFrom(e) {
    const t = e.target.closest?.('.cst-cell');
    return t ? +t.dataset.i : -1;
  }
  hit(e, alt) { const i = this.cellFrom(e); if (i >= 0) this.handlers.onCellClick?.(i, alt); }

  color(c) { return c === 1 ? this.colors.p1 : this.colors.p2; }

  update(game) {
    super.update(game);
    const L = this.layers;
    for (const k in L) L[k].replaceChildren();
    const line = new Set(game.line || []);
    const sel = this.handlers.selectedColor?.() ?? game.player;
    const canPlay = !game.isOver && this.handlers.canPlay?.();
    for (let i = 0; i < N; i++) {
      const e = this.cellEls[i];
      e.classList.toggle('cst-legal', canPlay && game.isLegal(i, sel));
      e.classList.toggle('cst-illegal', canPlay && game.board[i] === 0 && !game.isLegal(i, sel));
    }
    for (const g of game.groups()) {
      const col = this.color(g.color);
      const decisive = line.has(g.cells[0]);
      // nebula halo
      const halo = el('g', { filter: 'url(#cst-blur)', opacity: g.size >= 4 ? 0.45 : 0.22 }, L.halos);
      for (const i of g.cells) el('circle', { cx: this.pos[i].x, cy: this.pos[i].y, r: 0.85, fill: g.size === 4 ? '#ff4d5e' : g.size === 5 ? '#ffd700' : col }, halo);
      // edges
      for (const i of g.cells) for (let d = 0; d < 3; d++) {
        const j = step[i][d];
        if (j !== -1 && game.board[j] === g.color) {
          el('line', { x1: this.pos[i].x, y1: this.pos[i].y, x2: this.pos[j].x, y2: this.pos[j].y, stroke: col, 'stroke-width': 0.12, 'stroke-linecap': 'round', filter: 'url(#cst-glow)', opacity: 0.9 }, L.edges);
        }
      }
      // stars
      for (const i of g.cells) {
        const { x, y } = this.pos[i];
        const grp = el('g', { class: 'cst-star' + (decisive ? (game.status === 'won' ? ' cst-quint' : ' cst-quart') : '') }, L.pieces);
        el('circle', { cx: x, cy: y, r: 0.36, fill: col, filter: 'url(#cst-glow)' }, grp);
        el('circle', { cx: x, cy: y, r: 0.14, fill: '#ffffff', opacity: 0.9 }, grp);
        if (i === game.lastMove) el('circle', { cx: x, cy: y, r: 0.55, fill: 'none', stroke: '#ffffff', 'stroke-width': 0.05, 'stroke-dasharray': '0.18 0.12', class: 'cst-last' }, grp);
      }
    }
    this.drawHover();
  }

  drawHover() {
    const L = this.layers.hover;
    L.replaceChildren();
    const g = this.game;
    if (!g || this.hover < 0 || g.isOver || !this.handlers.canPlay?.()) return;
    const sel = this.handlers.selectedColor?.() ?? g.player;
    if (!g.isLegal(this.hover, sel)) return;
    const { x, y } = this.pos[this.hover];
    const col = this.color(sel);
    // projected connections
    for (let d = 0; d < 6; d++) {
      const j = step[this.hover][d];
      if (j !== -1 && g.board[j] === sel) el('line', { x1: x, y1: y, x2: this.pos[j].x, y2: this.pos[j].y, stroke: col, 'stroke-width': 0.08, 'stroke-dasharray': '0.2 0.15', opacity: 0.7 }, L);
    }
    const pv = this.handlers.previewOutcome?.(this.hover);
    const oc = pv?.result === 'lose' ? '#ff4d5e' : pv?.result === 'win' ? '#ffd700' : pv?.result === 'check' ? '#ffb347' : null;
    el('circle', { cx: x, cy: y, r: 0.36, fill: oc || col, opacity: 0.55 }, L);
    if (oc) {
      // ring the whole group this stone would join, in the outcome colour
      el('circle', { cx: x, cy: y, r: 0.62, fill: 'none', stroke: oc, 'stroke-width': 0.08, class: 'cst-outcome' }, L);
      for (let d = 0; d < 6; d++) {
        const j = step[this.hover][d];
        if (j !== -1 && g.board[j] === sel) el('circle', { cx: this.pos[j].x, cy: this.pos[j].y, r: 0.62, fill: 'none', stroke: oc, 'stroke-width': 0.08, class: 'cst-outcome' }, L);
      }
    }
  }

  pieceIcon(player) {
    const size = 160, c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d'), cx = size / 2, cy = size / 2;
    const col = player === 1 ? this.colors.p1 : this.colors.p2;
    const halo = g.createRadialGradient(cx, cy, 10, cx, cy, size * 0.48);
    halo.addColorStop(0, col); halo.addColorStop(0.35, col + '66'); halo.addColorStop(1, col + '00');
    g.fillStyle = halo; g.beginPath(); g.arc(cx, cy, size * 0.48, 0, Math.PI * 2); g.fill();
    g.shadowColor = col; g.shadowBlur = 22;
    g.fillStyle = col; g.beginPath(); g.arc(cx, cy, size * 0.22, 0, Math.PI * 2); g.fill();
    g.shadowBlur = 0;
    g.fillStyle = 'rgba(255,255,255,0.92)'; g.beginPath(); g.arc(cx, cy, size * 0.085, 0, Math.PI * 2); g.fill();
    // four-point sparkle
    g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(cx - size * 0.4, cy); g.lineTo(cx + size * 0.4, cy); g.moveTo(cx, cy - size * 0.4); g.lineTo(cx, cy + size * 0.4); g.stroke();
    return c.toDataURL();
  }

  destroy() {
    this.svg.removeEventListener('click', this.onClick);
    this.svg.removeEventListener('contextmenu', this.onCtx);
    this.svg.removeEventListener('pointermove', this.onMove);
    this.svg.removeEventListener('pointerleave', this.onLeave);
    this.svg.remove();
  }
}
