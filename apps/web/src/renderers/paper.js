import { cells, hexToPlane, N, step } from '@manalath/shared/hex.js';
import { BaseRenderer } from './base.js';

// Hand-drawn "Paper & Ink" theme on a 2D canvas: wobbly pencil hexes, ink blobs and red pencil rings.
function rng(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export class PaperRenderer extends BaseRenderer {
  constructor(container, handlers) {
    super(container, handlers);
    this.colors = { p1: '#1c2436', p2: '#c0392b' };
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'paper-canvas';
    container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.hover = -1;
    this.onMove = (e) => { const i = this.pick(e); if (i !== this.hover) { this.hover = i; this.draw(); } this.canvas.style.cursor = i >= 0 && this.game && this.game.board[i] === 0 && !this.game.isOver ? 'pointer' : 'default'; };
    this.onClick = (e) => { const i = this.pick(e); if (i >= 0) this.handlers.onCellClick?.(i, false); };
    this.onCtx = (e) => { e.preventDefault(); const i = this.pick(e); if (i >= 0) this.handlers.onCellClick?.(i, true); };
    this.canvas.addEventListener('contextmenu', this.onCtx);
    this.onLeave = () => { this.hover = -1; this.draw(); };
    this.canvas.addEventListener('pointermove', this.onMove);
    this.canvas.addEventListener('click', this.onClick);
    this.canvas.addEventListener('pointerleave', this.onLeave);
    this.ro = new ResizeObserver(() => this.layout());
    this.ro.observe(container);
    this.layout();
  }

  layout() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = w * dpr; this.canvas.height = h * dpr;
    this.canvas.style.width = w + 'px'; this.canvas.style.height = h + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = w; this.h = h;
    this.size = Math.min(w / 17.5, h / 16.5);
    this.cx = w / 2; this.cy = h / 2 + this.size * 0.2;
    this.centers = cells.map(c => { const p = hexToPlane(c.q, c.r, this.size); return { x: this.cx + p.x, y: this.cy + p.y }; });
    this.draw();
  }

  pick(e) {
    const r = this.canvas.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    let best = -1, bd = Infinity;
    for (let i = 0; i < N; i++) {
      const c = this.centers[i];
      const d = (c.x - x) ** 2 + (c.y - y) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    return bd < (this.size * 0.85) ** 2 ? best : -1;
  }

  update(game) { super.update(game); this.draw(); }

  // Sketchy line: two slightly offset passes.
  sketchLine(x1, y1, x2, y2, rand, amt, color, width, alpha) {
    const g = this.ctx;
    g.strokeStyle = color; g.lineWidth = width; g.lineCap = 'round';
    for (let pass = 0; pass < 2; pass++) {
      g.globalAlpha = alpha * (pass === 0 ? 1 : 0.55);
      const j = () => (rand() - 0.5) * amt;
      const mx = (x1 + x2) / 2 + j() * 1.5, my = (y1 + y2) / 2 + j() * 1.5;
      g.beginPath();
      g.moveTo(x1 + j(), y1 + j());
      g.quadraticCurveTo(mx, my, x2 + j(), y2 + j());
      g.stroke();
    }
    g.globalAlpha = 1;
  }

  hexPoints(i, radius) {
    const c = this.centers[i];
    const pts = [];
    for (let k = 0; k < 6; k++) {
      const a = Math.PI / 180 * (60 * k + 30);
      pts.push([c.x + radius * Math.cos(a), c.y + radius * Math.sin(a)]);
    }
    return pts;
  }

  drawPaper() {
    const g = this.ctx, w = this.w, h = this.h;
    g.fillStyle = '#f6efdc';
    g.fillRect(0, 0, w, h);
    // faint ruled lines
    g.strokeStyle = 'rgba(90,130,190,0.16)'; g.lineWidth = 1;
    for (let y = 28; y < h; y += 28) { g.beginPath(); g.moveTo(0, y + 0.5); g.lineTo(w, y + 0.5); g.stroke(); }
    g.strokeStyle = 'rgba(200,80,80,0.28)'; g.lineWidth = 1.2;
    g.beginPath(); g.moveTo(64.5, 0); g.lineTo(64.5, h); g.stroke();
    // speckles / stains
    const rand = rng(1234);
    for (let k = 0; k < 160; k++) {
      g.fillStyle = `rgba(120,90,40,${0.04 + rand() * 0.08})`;
      g.beginPath(); g.arc(rand() * w, rand() * h, rand() * 1.6, 0, Math.PI * 2); g.fill();
    }
    g.fillStyle = 'rgba(150,110,40,0.07)';
    g.beginPath(); g.ellipse(w * 0.83, h * 0.16, this.size * 1.4, this.size * 1.1, 0.4, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(150,110,40,0.14)'; g.lineWidth = 3;
    g.beginPath(); g.ellipse(w * 0.83, h * 0.16, this.size * 1.4, this.size * 1.1, 0.4, 0, Math.PI * 2); g.stroke();
  }

  draw() {
    if (!this.w) return;
    const g = this.ctx;
    this.drawPaper();
    const game = this.game;
    const line = new Set(game?.line || []);
    const s = this.size;

    // hex cells
    for (let i = 0; i < N; i++) {
      const rand = rng(i * 7919 + 17);
      const pts = this.hexPoints(i, s * 0.94);
      if (i === this.hover && game && game.isLegal(i, this.handlers.selectedColor?.() ?? game.player) && this.handlers.canPlay?.()) {
        // pencil shading
        g.save();
        g.beginPath(); pts.forEach(([x, y], k) => k ? g.lineTo(x, y) : g.moveTo(x, y)); g.closePath(); g.clip();
        const pv = this.handlers.previewOutcome?.(i);
        g.strokeStyle = pv?.result === 'lose' ? 'rgba(200,30,30,0.6)' : pv?.result === 'win' ? 'rgba(200,150,0,0.7)' : pv?.result === 'check' ? 'rgba(220,120,20,0.6)' : 'rgba(60,60,80,0.28)';
        g.lineWidth = pv?.result ? 2 : 1.2;
        const c = this.centers[i];
        for (let d = -s; d <= s; d += 4) { g.beginPath(); g.moveTo(c.x - s + d, c.y - s); g.lineTo(c.x + d, c.y + s); g.stroke(); }
        g.restore();
      }
      for (let k = 0; k < 6; k++) {
        const [x1, y1] = pts[k], [x2, y2] = pts[(k + 1) % 6];
        this.sketchLine(x1, y1, x2, y2, rand, s * 0.08, '#3a3f4f', 1.6, 0.8);
      }
    }

    // decisive line: highlighter stroke
    if (line.size && game) {
      const ids = game.line;
      const a = this.centers[ids[0]], b = this.centers[ids[ids.length - 1]];
      const rand = rng(99);
      const col = game.status === 'won' ? 'rgba(255,230,0,0.45)' : 'rgba(255,60,60,0.4)';
      const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
      const ex = dx / len * s * 0.5, ey = dy / len * s * 0.5;
      this.sketchLine(a.x - ex, a.y - ey, b.x + ex, b.y + ey, rand, 3, col, s * 0.75, 1);
      if (game.status === 'lost') {
        // an angry scribble across
        g.strokeStyle = 'rgba(200,30,30,0.85)'; g.lineWidth = 2.2;
        g.beginPath(); g.moveTo(a.x - ex, a.y - ey);
        for (let k = 1; k <= 12; k++) {
          const t = k / 12;
          g.lineTo(a.x + dx * t + (rand() - 0.5) * s * 0.5, a.y + dy * t + (rand() - 0.5) * s * 0.5);
        }
        g.stroke();
      }
    }

    // groups of four: red highlighter under them (the "check" state)
    if (game && !game.isOver) {
      for (const gr of game.groups()) {
        if (gr.size !== 4) continue;
        g.fillStyle = 'rgba(255,60,60,0.28)';
        for (const i of gr.cells) { const c = this.centers[i]; g.beginPath(); g.arc(c.x + 2, c.y + 2, s * 0.7, 0, Math.PI * 2); g.fill(); }
      }
    }

    // group connectors: ink strokes between adjacent same-colour pieces
    if (game) {
      for (let i = 0; i < N; i++) {
        const v = game.board[i]; if (!v) continue;
        for (let d = 0; d < 3; d++) {
          const j = step[i][d];
          if (j !== -1 && game.board[j] === v) {
            const a = this.centers[i], b = this.centers[j];
            this.sketchLine(a.x, a.y, b.x, b.y, rng(i * 13 + j), 3, v === 1 ? this.colors.p1 : this.colors.p2, s * 0.16, 0.55);
          }
        }
      }
    }

    // pieces
    for (let i = 0; i < N; i++) {
      const v = game?.board[i];
      if (!v) continue;
      const c = this.centers[i];
      const rand = rng(i * 31 + 5);
      if (v === 1) {
        // ink blob, several overlapping ellipses
        g.fillStyle = this.colors.p1;
        for (let k = 0; k < 4; k++) {
          g.globalAlpha = 0.75;
          g.beginPath();
          g.ellipse(c.x + (rand() - 0.5) * s * 0.12, c.y + (rand() - 0.5) * s * 0.12, s * (0.42 + rand() * 0.06), s * (0.4 + rand() * 0.06), rand() * Math.PI, 0, Math.PI * 2);
          g.fill();
        }
        g.globalAlpha = 1;
        g.fillStyle = 'rgba(255,255,255,0.35)';
        g.beginPath(); g.ellipse(c.x - s * 0.16, c.y - s * 0.18, s * 0.09, s * 0.05, -0.6, 0, Math.PI * 2); g.fill();
      } else {
        // red pencil ring with hatching
        g.strokeStyle = this.colors.p2; g.lineWidth = 2.6; g.lineCap = 'round';
        for (let pass = 0; pass < 2; pass++) {
          g.globalAlpha = pass ? 0.5 : 0.9;
          g.beginPath();
          const r = s * 0.44, n = 24;
          for (let k = 0; k <= n + 2; k++) {
            const a = (k / n) * Math.PI * 2;
            const rr = r + (rand() - 0.5) * s * 0.07;
            const x = c.x + rr * Math.cos(a), y = c.y + rr * Math.sin(a);
            k ? g.lineTo(x, y) : g.moveTo(x, y);
          }
          g.stroke();
        }
        g.globalAlpha = 0.5; g.lineWidth = 1.4;
        for (let d = -0.3; d <= 0.3; d += 0.15) {
          const dx = d * s, hh = Math.sqrt(Math.max(0, (0.4 * s) ** 2 - dx * dx));
          this.sketchLine(c.x + dx - hh * 0.5, c.y - hh * 0.7, c.x + dx + hh * 0.5, c.y + hh * 0.7, rand, 2, this.colors.p2, 1.4, 0.5);
        }
        g.globalAlpha = 1;
      }
    }

    // last move: small pencil arrow tick
    if (game && game.lastMove >= 0 && !line.size) {
      const c = this.centers[game.lastMove];
      const rand = rng(game.moveCount * 101);
      this.sketchLine(c.x + s * 0.55, c.y - s * 0.95, c.x + s * 0.28, c.y - s * 0.5, rand, 2, '#2a5db0', 2, 0.9);
      this.sketchLine(c.x + s * 0.28, c.y - s * 0.5, c.x + s * 0.5, c.y - s * 0.56, rand, 2, '#2a5db0', 2, 0.9);
      this.sketchLine(c.x + s * 0.28, c.y - s * 0.5, c.x + s * 0.34, c.y - s * 0.76, rand, 2, '#2a5db0', 2, 0.9);
    }

  }

  // Portrait of the piece for the HUD, drawn with the same ink/pencil strokes as on the board.
  pieceIcon(player) {
    const size = 160, c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d'), s = size * 0.42, cx = size / 2, cy = size / 2;
    const rand = rng(player * 991);
    if (player === 1) {
      g.fillStyle = this.colors.p1;
      for (let k = 0; k < 4; k++) {
        g.globalAlpha = 0.75;
        g.beginPath();
        g.ellipse(cx + (rand() - 0.5) * s * 0.12, cy + (rand() - 0.5) * s * 0.12, s * (0.95 + rand() * 0.08), s * (0.9 + rand() * 0.08), rand() * Math.PI, 0, Math.PI * 2);
        g.fill();
      }
      g.globalAlpha = 1;
      g.fillStyle = 'rgba(255,255,255,0.35)';
      g.beginPath(); g.ellipse(cx - s * 0.35, cy - s * 0.4, s * 0.2, s * 0.11, -0.6, 0, Math.PI * 2); g.fill();
    } else {
      g.strokeStyle = this.colors.p2; g.lineWidth = 5; g.lineCap = 'round';
      for (let pass = 0; pass < 2; pass++) {
        g.globalAlpha = pass ? 0.5 : 0.9;
        g.beginPath();
        const n = 28;
        for (let k = 0; k <= n + 2; k++) {
          const a = (k / n) * Math.PI * 2, rr = s * 0.95 + (rand() - 0.5) * s * 0.08;
          k ? g.lineTo(cx + rr * Math.cos(a), cy + rr * Math.sin(a)) : g.moveTo(cx + rr * Math.cos(a), cy + rr * Math.sin(a));
        }
        g.stroke();
      }
      g.globalAlpha = 0.5; g.lineWidth = 3;
      for (let d = -0.6; d <= 0.6; d += 0.3) {
        const dx = d * s, hh = Math.sqrt(Math.max(0, (0.85 * s) ** 2 - dx * dx));
        g.beginPath(); g.moveTo(cx + dx - hh * 0.5, cy - hh * 0.7); g.lineTo(cx + dx + hh * 0.5, cy + hh * 0.7); g.stroke();
      }
      g.globalAlpha = 1;
    }
    return c.toDataURL();
  }

  destroy() {
    this.ro.disconnect();
    this.canvas.removeEventListener('pointermove', this.onMove);
    this.canvas.removeEventListener('click', this.onClick);
    this.canvas.removeEventListener('contextmenu', this.onCtx);
    this.canvas.removeEventListener('pointerleave', this.onLeave);
    this.canvas.remove();
  }
}
