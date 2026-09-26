// Helpers shared by the docs/ write-ups: DOM lookup, hover tooltips, number formatting and chart scaffolding.
// A classic script (not a module) so the pages still work when opened straight from disk.

const $ = s => document.querySelector(s);

// ---------- tooltips: any element with data-tip inside an attached container ----------
const tip = document.body.appendChild(Object.assign(document.createElement('div'), { className: 'tip' }));
function showTip(e, html) { tip.innerHTML = html; tip.style.opacity = 1; tip.style.left = (e.clientX + 12) + 'px'; tip.style.top = (e.clientY - 28) + 'px'; }
function hideTip() { tip.style.opacity = 0; }
function attach(container) {
  container.querySelectorAll('[data-tip]').forEach(el => {
    el.addEventListener('mousemove', e => showTip(e, el.dataset.tip));
    el.addEventListener('mouseleave', hideTip);
  });
}

// ---------- numbers ----------
// Elo difference implied by a score p, clamped so 0% and 100% stay finite.
const elo = p => { p = Math.min(Math.max(p, .005), .995); return 400 * Math.log10(p / (1 - p)); };
const pct = x => Math.round(x * 100) + '%';
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

// ---------- charts ----------
function svgOpen(w, h) { return `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">`; }
// Horizontal gridlines with tick labels to the left of x0. `zero` gets the darker axis colour.
function yAxis(x0, x1, v2y, ticks, fmt, zero = null) {
  let s = '';
  for (const t of ticks) {
    const y = v2y(t);
    s += `<line x1="${x0}" x2="${x1}" y1="${y}" y2="${y}" stroke="${t === zero ? 'var(--axis)' : 'var(--grid)'}"/><text x="${x0 - 8}" y="${y + 4}" text-anchor="end" font-size="12" fill="var(--muted)" style="font-variant-numeric:tabular-nums">${fmt(t)}</text>`;
  }
  return s;
}
// Title, subtitle, the chart itself and an optional legend of [label, style] pairs, with tooltips wired up.
function renderChart(el, { title, sub = '', svg, legend = null }) {
  const leg = legend ? `<div class="legend">${legend.map(([label, style, cls = '']) => `<span${cls ? ` class="${cls}"` : ''} style="${style}">${label}</span>`).join('')}</div>` : '';
  el.innerHTML = `<div class="chart-title">${title}</div>${sub ? `<div class="chart-sub">${sub}</div>` : ''}${svg}${leg}`;
  attach(el);
}

// ---------- code: light syntax colouring for <code class="language-js"> ----------
// Enough of JavaScript for short snippets: comments, strings, numbers, keywords and called names.
const HL_KEYWORDS = new Set('function return if else for of in while do break continue const let var new throw try catch finally class extends typeof instanceof true false null undefined Infinity NaN this'.split(' '));
function highlight(code) {
  const esc = t => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const re = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|('(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`)|(\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b)|([A-Za-z_$][\w$]*)(?=(\s*\()?)/g;
  let out = '', last = 0;
  for (const m of code.matchAll(re)) {
    out += esc(code.slice(last, m.index));
    const [tok, com, str, num, id, call] = m;
    const cls = com ? 'com' : str ? 'str' : num ? 'num' : HL_KEYWORDS.has(id) ? 'kw' : call !== undefined ? 'fn' : '';
    out += cls ? `<span class="hl-${cls}">${esc(tok)}</span>` : esc(tok);
    last = m.index + tok.length;
  }
  return out + esc(code.slice(last));
}
document.querySelectorAll('code.language-js').forEach(el => { el.innerHTML = highlight(el.textContent); });
