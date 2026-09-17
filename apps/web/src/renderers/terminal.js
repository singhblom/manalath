import { cells, rows, N } from '@manalath/shared/hex.js';
import { BaseRenderer } from './base.js';

// "Phosphor Terminal" theme: a monospace, CRT-flavoured DOM grid.
const COLS = 'abcdefghi';
export function cellName(i) {
  const c = cells[i];
  return `${COLS[c.r + 4]}${c.q - Math.max(-4, -c.r - 4) + 1}`;
}

export class TerminalRenderer extends BaseRenderer {
  constructor(container, handlers) {
    super(container, handlers);
    this.colors = { p1: '#5dff7a', p2: '#ffb400' };
    this.root = document.createElement('div');
    this.root.className = 'term';
    this.root.innerHTML = `
      <div class="term-scanlines"></div>
      <pre class="term-screen"><span class="term-prompt">manalath@local:~$</span> ./manalath

<span class="term-grid"></span>
<span class="term-log"></span>
<span class="term-status"></span><span class="term-cursor">▌</span></pre>`;
    container.appendChild(this.root);
    this.grid = this.root.querySelector('.term-grid');
    this.log = this.root.querySelector('.term-log');
    this.status = this.root.querySelector('.term-status');
    this.spans = new Array(N);
    this.buildGrid();
    this.onClick = (e) => {
      const el = e.target.closest('.term-cell');
      if (el) this.handlers.onCellClick?.(+el.dataset.i, false);
    };
    this.onCtx = (e) => {
      const el = e.target.closest('.term-cell');
      if (el) { e.preventDefault(); this.handlers.onCellClick?.(+el.dataset.i, true); }
    };
    this.grid.addEventListener('click', this.onClick);
    this.grid.addEventListener('contextmenu', this.onCtx);
    this.onOver = (e) => {
      const el = e.target.closest('.term-cell');
      this.grid.querySelectorAll('.term-pv').forEach(x => x.classList.remove('term-pv', 'term-pv-lose', 'term-pv-win', 'term-pv-check'));
      if (!el) return;
      const pv = this.handlers.previewOutcome?.(+el.dataset.i);
      if (pv?.result) el.classList.add('term-pv', 'term-pv-' + pv.result);
    };
    this.grid.addEventListener('pointerover', this.onOver);
    this.grid.addEventListener('pointerleave', this.onOver);
  }

  buildGrid() {
    const frag = document.createDocumentFragment();
    rows.forEach((row, ri) => {
      const r = ri - 4;
      const label = document.createElement('span');
      label.className = 'term-dim';
      label.textContent = '  ' + COLS[ri] + ' ' + ' '.repeat(Math.abs(r));
      frag.appendChild(label);
      row.forEach(i => {
        const s = document.createElement('span');
        s.className = 'term-cell';
        s.dataset.i = i;
        s.textContent = '·';
        s.title = cellName(i);
        frag.appendChild(s);
        frag.appendChild(document.createTextNode(' '));
        this.spans[i] = s;
      });
      frag.appendChild(document.createTextNode('\n'));
    });
    this.grid.appendChild(frag);
  }

  update(game) {
    super.update(game);
    const line = new Set(game.line || []);
    const quart = new Set();
    if (!game.isOver) for (const g of game.groups()) if (g.size === 4) for (const c of g.cells) quart.add(c);
    const canPlay = !game.isOver && this.handlers.canPlay?.();
    const sel = this.handlers.selectedColor?.() ?? game.player;
    for (let i = 0; i < N; i++) {
      const s = this.spans[i];
      const v = game.board[i];
      s.textContent = v === 1 ? 'X' : v === 2 ? 'O' : '·';
      s.className = 'term-cell' + (v === 1 ? ' term-p1' : v === 2 ? ' term-p2' : '') +
        (i === game.lastMove ? ' term-last' : '') +
        (line.has(i) ? (game.status === 'won' ? ' term-win' : ' term-lose') : '') + (quart.has(i) ? ' term-quart' : '') +
        (canPlay && game.isLegal(i, sel) ? ' term-free' : '') + (canPlay && v === 0 && !game.isLegal(i, sel) ? ' term-illegal' : '');
    }
    // move log (last 6 moves)
    const h = game.history;
    const lines = [];
    const start = Math.max(0, h.length - 5);
    for (let k = start; k < h.length; k++) {
      const e = h[k];
      const who = `<span class="term-dim">P${e.player}</span>`;
      lines.push(`<span class="term-dim">${String(k + 1).padStart(2, ' ')}.</span> ${who} ${e.cell < 0 ? 'passes' : `places <span class="term-p${e.color}">${e.color === 1 ? 'X' : 'O'}</span> → ${cellName(e.cell)}`}`);
    }
    const groups = game.groups();
    const fmt = (c) => groups.filter(g => g.color === c).map(g => g.size).sort((a, b) => b - a)
      .map(n => `<span class="${n === 4 ? 'term-lose' : n === 5 ? 'term-win' : n === 3 ? 'term-warn' : ''}">${n}</span>`).join(' ') || '<span class="term-dim">-</span>';
    lines.push('', `<span class="term-dim">groups</span>  <span class="term-p1">X</span>: ${fmt(1)}   <span class="term-p2">O</span>: ${fmt(2)}`);
    this.log.innerHTML = '\n' + (lines.length ? lines.join('\n') : '<span class="term-dim">(no moves yet)</span>') + '\n\n';
    this.status.textContent = this.handlers.statusText?.() || '';
  }

  pieceIcon(player) {
    const size = 160, c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    const col = player === 1 ? this.colors.p1 : this.colors.p2;
    g.font = 'bold 110px "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.shadowColor = col; g.shadowBlur = 18;
    g.fillStyle = col;
    g.fillText(player === 1 ? 'X' : 'O', size / 2, size / 2 + 6);
    g.shadowBlur = 0;
    // scanlines
    g.fillStyle = 'rgba(0,0,0,0.25)';
    for (let y = 0; y < size; y += 4) g.fillRect(0, y, size, 1);
    return c.toDataURL();
  }

  destroy() {
    this.grid.removeEventListener('click', this.onClick);
    this.grid.removeEventListener('contextmenu', this.onCtx);
    this.grid.removeEventListener('pointerover', this.onOver);
    this.grid.removeEventListener('pointerleave', this.onOver);
    this.root.remove();
  }
}
