import { cells, hexToPlane, N, step } from '@manalath/shared/hex.js';
import { BaseRenderer } from './base.js';

// "Slime Lab": groups are blobs of goo in a petri dish. Same-colour stones melt into one another
// through an SVG goo filter; every blob runs little spring simulations (spawn splat, neighbour
// jiggle, idle breathing), grows bubbles, and drips when it hangs low.
const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}, parent) => {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
};
const COLORS = { 1: '#8df01c', 2: '#b25cff', quart: '#ff5a3c', quint: '#ffe14a' };
const R = 0.8;

export class SlimeRenderer extends BaseRenderer {
  constructor(container, handlers) {
    super(container, handlers);
    this.colors = { p1: COLORS[1], p2: COLORS[2] };
    this.hover = -1;
    this.pos = cells.map(c => hexToPlane(c.q, c.r, 1));
    this.svg = el('svg', { viewBox: '-9.6 -8.6 19.2 17.2', preserveAspectRatio: 'xMidYMid meet', class: 'slm' });
    container.appendChild(this.svg);
    this.buildStatic();
    this.stones = Array.from({ length: N }, () => ({ present: false, color: 0, s: 0, v: 0, ox: 0, oy: 0, vx: 0, vy: 0, phase: Math.random() * 6.28, el: null, gloss: null }));
    this.drips = [];
    this.bubbles = [];
    this.initialized = false;
    this.lastT = performance.now();
    this.svg.addEventListener('click', this.onClick = (e) => this.hit(e, false));
    this.svg.addEventListener('contextmenu', this.onCtx = (e) => { e.preventDefault(); this.hit(e, true); });
    this.svg.addEventListener('pointermove', this.onMove = (e) => { const i = this.cellFrom(e); if (i !== this.hover) { this.hover = i; this.drawHover(); } });
    this.svg.addEventListener('pointerleave', this.onLeave = () => { this.hover = -1; this.drawHover(); });
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  buildStatic() {
    const defs = el('defs', {}, this.svg);
    const goo = el('filter', { id: 'slm-goo', x: '-30%', y: '-30%', width: '160%', height: '160%', colorInterpolationFilters: 'sRGB' }, defs);
    el('feGaussianBlur', { in: 'SourceGraphic', stdDeviation: '0.26', result: 'blur' }, goo);
    el('feColorMatrix', { in: 'blur', mode: 'matrix', values: '1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -10', result: 'goo' }, goo);
    const shade = el('filter', { id: 'slm-inner', x: '-30%', y: '-30%', width: '160%', height: '160%' }, defs);
    el('feGaussianBlur', { stdDeviation: '0.35' }, shade);
    const bench = el('linearGradient', { id: 'slm-bench', x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
    el('stop', { offset: 0, 'stop-color': '#16232a' }, bench);
    el('stop', { offset: 1, 'stop-color': '#0a1114' }, bench);
    const dish = el('radialGradient', { id: 'slm-dish', cx: '50%', cy: '45%', r: '60%' }, defs);
    el('stop', { offset: 0, 'stop-color': '#dbe9ea', 'stop-opacity': 0.16 }, dish);
    el('stop', { offset: 0.85, 'stop-color': '#a9c7c9', 'stop-opacity': 0.08 }, dish);
    el('stop', { offset: 1, 'stop-color': '#ffffff', 'stop-opacity': 0.3 }, dish);

    el('rect', { x: -50, y: -50, width: 100, height: 100, fill: 'url(#slm-bench)' }, this.svg);
    // bench grid
    const grid = el('g', { stroke: 'rgba(255,255,255,0.04)', 'stroke-width': 0.02 }, this.svg);
    for (let k = -12; k <= 12; k += 1.5) { el('line', { x1: -50, y1: k, x2: 50, y2: k }, grid); el('line', { x1: k, y1: -50, x2: k, y2: 50 }, grid); }
    // petri dish
    el('circle', { cx: 0, cy: 0.2, r: 8.6, fill: 'url(#slm-dish)', stroke: 'rgba(255,255,255,0.35)', 'stroke-width': 0.12 }, this.svg);
    el('circle', { cx: 0, cy: 0.2, r: 8.25, fill: 'none', stroke: 'rgba(255,255,255,0.12)', 'stroke-width': 0.05 }, this.svg);
    el('ellipse', { cx: -3.2, cy: -5.4, rx: 2.2, ry: 0.45, fill: 'rgba(255,255,255,0.05)', transform: 'rotate(-30 -3.2 -5.2)' }, this.svg);

    const cellsG = el('g', {}, this.svg);
    this.cellEls = [];
    for (const c of cells) {
      const { x, y } = this.pos[c.i];
      const pts = [];
      for (let k = 0; k < 6; k++) { const a = Math.PI / 180 * (60 * k + 30); pts.push(`${(x + 0.95 * Math.cos(a)).toFixed(3)},${(y + 0.95 * Math.sin(a)).toFixed(3)}`); }
      this.cellEls.push(el('polygon', { points: pts.join(' '), class: 'slm-cell', 'data-i': c.i }, cellsG));
    }
    this.layers = {};
    this.layers.shadow = el('g', { class: 'slm-shadow', filter: 'url(#slm-inner)', opacity: 0.35 }, this.svg);
    this.goo = { 1: el('g', { filter: 'url(#slm-goo)' }, this.svg), 2: el('g', { filter: 'url(#slm-goo)' }, this.svg) };
    for (const name of ['gloss', 'bubbles', 'hover']) this.layers[name] = el('g', { class: 'slm-' + name }, this.svg);
    this.layers.hover.style.pointerEvents = 'none';
  }

  cellFrom(e) { const t = e.target.closest?.('.slm-cell'); return t ? +t.dataset.i : -1; }
  hit(e, alt) { const i = this.cellFrom(e); if (i >= 0) this.handlers.onCellClick?.(i, alt); }

  update(game) {
    super.update(game);
    const line = new Set(game.line || []);
    const sizes = new Int8Array(N);
    for (const g of game.groups()) for (const i of g.cells) sizes[i] = g.size;
    for (let i = 0; i < N; i++) {
      const st = this.stones[i], c = game.board[i];
      if (c && !st.present) {
        st.present = true; st.color = c;
        if (this.initialized) { st.s = 0.1; st.v = 7; } else { st.s = 1; st.v = 0; }
        st.el = el('circle', { cx: this.pos[i].x, cy: this.pos[i].y, r: R * st.s }, this.goo[c]);
        st.shadow = el('circle', { cx: this.pos[i].x, cy: this.pos[i].y + 0.25, r: R, fill: '#000' }, this.layers.shadow);
        st.gloss = el('ellipse', { cx: this.pos[i].x - 0.25, cy: this.pos[i].y - 0.3, rx: 0.28, ry: 0.16, fill: 'rgba(255,255,255,0.45)', transform: `rotate(-25 ${this.pos[i].x - 0.25} ${this.pos[i].y - 0.3})` }, this.layers.gloss);
        // splat the neighbours
        for (let d = 0; d < 6 && this.initialized; d++) {
          const j = step[i][d];
          if (j !== -1 && game.board[j] === c) {
            const n = this.stones[j];
            n.vx += (this.pos[j].x - this.pos[i].x) * 1.4; n.vy += (this.pos[j].y - this.pos[i].y) * 1.4;
          }
        }
      } else if (!c && st.present) {
        st.present = false; st.el.remove(); st.gloss.remove(); st.shadow.remove(); st.el = st.gloss = st.shadow = null;
      } else if (c && st.present && st.color !== c) {
        st.color = c; this.goo[c].appendChild(st.el);
      }
      if (st.present) {
        st.fill = line.has(i) ? (game.status === 'won' ? COLORS.quint : COLORS.quart) : sizes[i] === 4 ? COLORS.quart : COLORS[c];
        st.el.setAttribute('fill', st.fill);
        st.el.classList.toggle('slm-decisive', line.has(i));
      }
    }
    const sel = this.handlers.selectedColor?.() ?? game.player;
    const canPlay = !game.isOver && this.handlers.canPlay?.();
    for (let i = 0; i < N; i++) {
      const e = this.cellEls[i];
      e.classList.toggle('slm-legal', canPlay && game.isLegal(i, sel));
      e.classList.toggle('slm-illegal', canPlay && game.board[i] === 0 && !game.isLegal(i, sel));
      e.classList.toggle('slm-last', i === game.lastMove);
    }
    this.initialized = true;
    this.drawHover();
  }

  drawHover() {
    const L = this.layers.hover; L.replaceChildren();
    if (this.ghost) { this.ghost.remove(); this.ghost = null; }
    const g = this.game;
    if (!g || this.hover < 0 || g.isOver || !this.handlers.canPlay?.()) return;
    const sel = this.handlers.selectedColor?.() ?? g.player;
    if (!g.isLegal(this.hover, sel)) return;
    const { x, y } = this.pos[this.hover];
    const pv = this.handlers.previewOutcome?.(this.hover);
    const oc = pv?.result === 'lose' ? COLORS.quart : pv?.result === 'win' ? COLORS.quint : pv?.result === 'check' ? '#ffb347' : null;
    this.ghost = el('circle', { cx: x, cy: y, r: R * 0.8, fill: oc || COLORS[sel], opacity: oc ? 0.75 : 0.45, class: 'slm-ghost' }, this.goo[sel]);
    if (oc) el('circle', { cx: x, cy: y, r: R * 1.05, fill: 'none', stroke: oc, 'stroke-width': 0.08, 'stroke-dasharray': '0.2 0.12', class: 'slm-outcome' }, L);
  }

  loop() {
    this.raf = requestAnimationFrame(this.loop);
    const now = performance.now();
    const tsec = now / 1000, dt = Math.min(0.05, (now - this.lastT) / 1000);
    this.lastT = now;
    const g = this.game;
    for (let i = 0; i < N; i++) {
      const st = this.stones[i];
      if (!st.present) continue;
      st.v += ((1 - st.s) * 80 - st.v * 6) * dt; st.s += st.v * dt;
      st.vx += (-st.ox * 60 - st.vx * 5) * dt; st.ox += st.vx * dt;
      st.vy += (-st.oy * 60 - st.vy * 5) * dt; st.oy += st.vy * dt;
      const breathe = 1 + 0.05 * Math.sin(tsec * 2.2 + st.phase);
      const wx = 0.05 * Math.sin(tsec * 1.4 + st.phase), wy = 0.04 * Math.cos(tsec * 1.1 + st.phase);
      const x = this.pos[i].x + st.ox + wx, y = this.pos[i].y + st.oy + wy;
      const r = R * Math.max(0.05, st.s) * breathe;
      st.el.setAttribute('cx', x); st.el.setAttribute('cy', y); st.el.setAttribute('r', r);
      st.shadow.setAttribute('cx', x); st.shadow.setAttribute('cy', y + 0.25); st.shadow.setAttribute('r', r);
      st.gloss.setAttribute('cx', x - 0.25); st.gloss.setAttribute('cy', y - 0.3);
      st.gloss.setAttribute('transform', `rotate(-25 ${x - 0.25} ${y - 0.3})`);
      st.gloss.setAttribute('rx', 0.28 * st.s); st.gloss.setAttribute('ry', 0.16 * st.s);
      // bubbles
      if (Math.random() < 0.006) {
        const b = el('circle', { cx: x + (Math.random() - 0.5) * 0.6, cy: y + 0.3, r: 0.05 + Math.random() * 0.08, fill: 'rgba(255,255,255,0.35)' }, this.layers.bubbles);
        this.bubbles.push({ el: b, life: 0, x: +b.getAttribute('cx'), y: y + 0.3 });
      }
      // drips from the lowest stones of a blob
      if (g && Math.random() < 0.0015) {
        const below = step[i].some(j => j !== -1 && g.board[j] === st.color && this.pos[j].y > this.pos[i].y + 0.5);
        if (!below) {
          const d = el('circle', { cx: x, cy: y + R * 0.6, r: 0.22, fill: st.fill, opacity: 0.95 }, this.goo[st.color]);
          this.drips.push({ el: d, x, y: y + R * 0.6, vy: 0, r: 0.22 });
        }
      }
    }
    for (let k = this.bubbles.length - 1; k >= 0; k--) {
      const b = this.bubbles[k];
      b.life += dt; b.y -= dt * 0.45; b.x += Math.sin(tsec * 3 + k) * dt * 0.1;
      b.el.setAttribute('cy', b.y); b.el.setAttribute('cx', b.x);
      b.el.setAttribute('opacity', Math.max(0, 0.6 - b.life * 0.5));
      if (b.life > 1.3) { b.el.remove(); this.bubbles.splice(k, 1); }
    }
    for (let k = this.drips.length - 1; k >= 0; k--) {
      const d = this.drips[k];
      d.vy += 1.2 * dt; d.y += d.vy * dt; d.r = Math.max(0.06, d.r - dt * 0.05);
      d.el.setAttribute('cy', d.y); d.el.setAttribute('r', d.r);
      if (d.y > 9.5 || d.r <= 0.06) { d.el.remove(); this.drips.splice(k, 1); }
    }
    if (this.ghost) this.ghost.setAttribute('r', R * (0.78 + 0.05 * Math.sin(tsec * 5)));
  }

  pieceIcon(player) {
    const size = 160, c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d'), cx = size / 2, cy = size / 2 + 4;
    const col = COLORS[player];
    // shadow, then a slightly squashed goo blob with a bulge, then gloss and a bubble
    g.fillStyle = 'rgba(0,0,0,0.3)'; g.filter = 'blur(6px)';
    g.beginPath(); g.ellipse(cx, cy + 22, size * 0.36, size * 0.14, 0, 0, Math.PI * 2); g.fill();
    g.filter = 'none';
    const body = g.createRadialGradient(cx - 14, cy - 18, 8, cx, cy, size * 0.42);
    body.addColorStop(0, '#ffffff'); body.addColorStop(0.12, col); body.addColorStop(1, col);
    g.fillStyle = body;
    g.beginPath();
    g.moveTo(cx - size * 0.4, cy);
    g.bezierCurveTo(cx - size * 0.42, cy - size * 0.42, cx + size * 0.1, cy - size * 0.5, cx + size * 0.28, cy - size * 0.3);
    g.bezierCurveTo(cx + size * 0.5, cy - size * 0.1, cx + size * 0.42, cy + size * 0.36, cx + size * 0.05, cy + size * 0.36);
    g.bezierCurveTo(cx - size * 0.3, cy + size * 0.38, cx - size * 0.42, cy + size * 0.22, cx - size * 0.4, cy);
    g.fill();
    g.fillStyle = 'rgba(255,255,255,0.45)';
    g.beginPath(); g.ellipse(cx - 18, cy - 24, 22, 12, -0.5, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.35)';
    g.beginPath(); g.arc(cx + 22, cy + 10, 6, 0, Math.PI * 2); g.fill();
    return c.toDataURL();
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.svg.removeEventListener('click', this.onClick);
    this.svg.removeEventListener('contextmenu', this.onCtx);
    this.svg.removeEventListener('pointermove', this.onMove);
    this.svg.removeEventListener('pointerleave', this.onLeave);
    this.svg.remove();
  }
}
