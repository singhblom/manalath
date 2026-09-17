import { Game, checkEnd, groupAt } from '@manalath/shared/game.js';
import { chooseMove } from '@manalath/shared/ai.js';
import { ThreeRenderer } from './renderers/three.js';
import { TerracesRenderer } from './renderers/terraces.js';
import { PaperRenderer } from './renderers/paper.js';
import { TerminalRenderer } from './renderers/terminal.js';
import { ConstellationRenderer } from './renderers/constellation.js';
import { MercuryRenderer } from './renderers/mercury.js';
import { SlimeRenderer } from './renderers/slime.js';
import { GobanRenderer } from './renderers/goban.js';
import { NeonRenderer } from './renderers/neon.js';
import { OnlineMatch, formatClock } from './online.js';
import { mountLobby } from './lobby.js';

const $ = (s) => document.querySelector(s);
const boardEl = $('#board');

const THEME_HINTS = {
  goban: 'Go-inspired 3D: a thick kaya-wood board with straight grain; stones sit on the intersections of an inked triangular lattice, dropped a little irregularly.',
  marble: 'Realistic 3D: marble tiles, ivory and onyx spheres, soft shadows. Drag to orbit, scroll to zoom.',
  neon: 'Glowing 3D: crystals floating over a neon lattice of intersections. Drag to orbit, scroll to zoom.',
  terraces: 'Group-focused 3D: every group rises as one plateau, height = size. Quarts glow red, quints gold.',
  constellation: 'Group-focused 2D: stars on a faint lattice; groups are linked clusters in a shared nebula.',
  mercury: 'Fluid 3D: groups are pools of liquid metal and oil that flow together (marching-cubes metaballs) over a rippling wave-simulated pool.',
  slime: 'Fluid 2D: groups are blobs of goo in a petri dish that melt together, jiggle, bubble and drip.',
  paper: 'Hand-drawn 2D: pencil hexes, ink blobs and red pencil rings on ruled paper.',
  terminal: 'Text mode: a monospace hex grid on a phosphor CRT, with a move log and group list.',
};

const settings = Object.assign(
  { mode: 'hotseat', level: 'normal', side: '1', theme: 'terraces' },
  JSON.parse(localStorage.getItem('manalath.settings') || '{}')
);
function saveSettings() { localStorage.setItem('manalath.settings', JSON.stringify(settings)); }

const game = new Game();
// Online mode: while `online` is set the server owns the game and we mirror it.
let online = null;
let renderer = null;
let thinking = false;
let aiTimer = null;
let selColor = 0; // 0 = no colour chosen yet (must choose before placing)
let note = '';

function isAiTurn() { return !online && settings.mode === 'ai' && !game.isOver && game.player !== +settings.side; }
function humanTurn() { return online ? online.myTurn : !game.isOver && !thinking && !isAiTurn(); }
function canPlay() { return humanTurn() && selColor !== 0; }
function selectedColor() { return selColor; }

// What would happen if the held colour were dropped on cell i?
// Returns null if not placeable, else { size, own, result } with result in 'lose' | 'win' | 'check' | null.
function previewOutcome(i) {
  if (!canPlay() || !game.isLegal(i, selColor)) return null;
  game.board[i] = selColor;
  const size = groupAt(game.board, i).length;
  const end = checkEnd(game.board, game.player).result;
  game.board[i] = 0;
  const own = selColor === game.player;
  const result = end === 'lost' ? 'lose' : end === 'won' ? 'win' : (!own && size === 4) ? 'check' : null;
  return { size, own, result };
}

// Is the player to move currently sitting on a group of four (must make it five or lose)?
function inCheck() {
  return !game.isOver && game.groups().some(g => g.color === game.player && g.size === 4);
}

function playerLabel(p) {
  if (online) return online.seatName(p - 1);
  if (settings.mode === 'ai') return p === +settings.side ? 'You' : 'Computer';
  return `Player ${p}`;
}
function verb(p, v) { return playerLabel(p) === 'You' ? v : v + 's'; }

function statusText() {
  if (online) {
    if (!online.connected) return online.snap ? 'Reconnecting…' : 'Connecting…';
    if (online.phase === 'waiting') return 'Waiting for the other player…';
    if (online.phase === 'finished') return online.resultText();
    if (online.drawOffered !== null && online.drawOffered !== online.seat && online.isPlayer) return `${online.seatName(online.drawOffered)} offers a draw`;
    if (online.myTurn) return 'Your turn';
    return online.isPlayer ? `Waiting for ${playerLabel(game.player)}` : `${playerLabel(game.player)} to move`;
  }
  if (game.status === 'won') return `${playerLabel(game.winner)} ${verb(game.winner, 'win')} with a group of five!`;
  if (game.status === 'lost') return `${playerLabel(3 - game.winner)} ended the turn with a group of four — ${playerLabel(game.winner)} ${verb(game.winner, 'win')}!`;
  if (game.status === 'draw') return 'Draw.';
  if (thinking) return 'Computer is thinking…';
  const who = playerLabel(game.player);
  return who === 'You' ? 'Your move' : `${who} to move`;
}

function renderGroups() {
  const groups = game.groups();
  const box = $('#groups');
  box.innerHTML = '';
  for (const c of [1, 2]) {
    const row = document.createElement('div');
    row.className = 'group-row';
    const label = document.createElement('span');
    label.className = 'dot';
    label.style.background = renderer.colors['p' + c];
    row.appendChild(label);
    const name = document.createElement('span');
    name.className = 'group-name';
    name.textContent = `Player ${c}`;
    row.appendChild(name);
    const sizes = groups.filter(g => g.color === c).map(g => g.size).sort((a, b) => b - a);
    if (!sizes.length) { const e = document.createElement('span'); e.className = 'hint'; e.textContent = 'no groups'; row.appendChild(e); }
    for (const s of sizes) { const chip = document.createElement('span'); chip.className = `chip s${s}`; chip.textContent = s; row.appendChild(chip); }
    box.appendChild(row);
  }
}

function render() {
  renderer.update(game);
  const st = $('#status');
  const col = game.isOver ? (game.status === 'draw' ? '#888' : renderer.colors['p' + game.winner]) : renderer.colors['p' + game.player];
  st.innerHTML = `<span class="dot" style="background:${col}"></span><span>${statusText()}</span>`;
  st.classList.toggle('over', game.isOver);
  $('#moves').textContent = `Turn ${game.moveCount + 1}${note ? ' · ' + note : ''}`;
  $('#undo').disabled = online || game.moveCount === 0 || thinking;
  if (online) renderOnlineControls();
  for (const c of [1, 2]) {
    const b = $('#col' + c);
    b.classList.toggle('active', selColor === c);
    b.querySelector('.dot').style.background = renderer.colors['p' + c];
  }
  $('#choose-hint').textContent = selColor === 0 ? 'Pick up a colour from the left or right margin of the board.' : 'Drop it on a cell, or click the other margin to switch.';
  renderGroups();
  renderHud();
}

// Show the theme's own piece in the reservoirs and on the cursor.
function applyPieceIcons() {
  pieceIcons = {};
  cancelAnimationFrame(iconRaf);
  if (renderer.liveIcons) {
    // animated portraits: each reservoir (and the carried piece) gets a canvas the renderer paints every frame
    for (const c of [1, 2]) setPieceCanvas(document.querySelector(`#hud .hud-side[data-c="${c}"] .hud-piece`));
    setPieceCanvas($('#carry .hud-piece'));
    const paint = () => {
      const t = performance.now() / 1000;
      for (const c of [1, 2]) renderer.iconFrame(c, document.querySelector(`#hud .hud-side[data-c="${c}"] .hud-piece canvas`).getContext('2d'), t);
      if (selColor) renderer.iconFrame(selColor, $('#carry .hud-piece canvas').getContext('2d'), t);
    };
    paint(); // first frame right away, even if the tab is hidden
    const tick = () => { iconRaf = requestAnimationFrame(tick); if (!document.hidden) paint(); };
    tick();
    return;
  }
  for (const c of [1, 2]) {
    let url = null;
    try { url = renderer.pieceIcon?.(c) || null; } catch (e) { console.warn('piece icon failed', e); }
    pieceIcons[c] = url;
    const el = document.querySelector(`#hud .hud-side[data-c="${c}"] .hud-piece`);
    setPieceIcon(el, url);
  }
}
let iconRaf = 0;
function setPieceCanvas(el) {
  el.classList.add('has-icon');
  el.querySelector('img')?.remove();
  if (!el.querySelector('canvas')) { const c = document.createElement('canvas'); c.width = c.height = 192; el.appendChild(c); }
}
function setPieceIcon(el, url) {
  if (renderer?.liveIcons) return; // live canvases are driven by the icon loop
  el.querySelector('canvas')?.remove();
  el.classList.toggle('has-icon', !!url);
  let img = el.querySelector('img');
  if (url) {
    if (!img) { img = document.createElement('img'); img.alt = ''; img.draggable = false; el.appendChild(img); }
    if (img.src !== url) img.src = url;
  } else if (img) img.remove();
}
let pieceIcons = {};

function renderHud() {
  const turnCol = game.isOver ? (game.status === 'draw' ? '#888' : renderer.colors['p' + game.winner]) : renderer.colors['p' + game.player];
  boardEl.style.setProperty('--turn', turnCol);
  boardEl.classList.toggle('over', game.isOver);
  boardEl.classList.toggle('thinking', thinking);
  boardEl.classList.toggle('ai-wait', !game.isOver && !humanTurn());
  const choosing = humanTurn() && selColor === 0;
  boardEl.classList.toggle('choose', choosing);
  boardEl.classList.toggle('carrying', humanTurn() && selColor !== 0);
  const check = inCheck();
  boardEl.classList.toggle('check', check);
  for (const c of [1, 2]) {
    const side = $(`#hud .hud-side[data-c="${c}"]`);
    side.style.setProperty('--pc', renderer.colors['p' + c]);
    side.title = `${playerLabel(c) === 'You' ? 'Your' : playerLabel(c) === 'Computer' ? "Computer's" : `Player ${c}'s`} colour — click to pick up (${c})`;
    side.classList.toggle('turn', c === game.player && !game.isOver);
    side.classList.toggle('winner', game.isOver && game.winner === c);
    side.classList.toggle('loser', game.isOver && game.winner === 3 - c);
    side.classList.toggle('selected', selColor === c);
    side.classList.toggle('other', selColor !== 0 && selColor !== c);
    const clock = side.querySelector('.hud-clock');
    const ms = online ? online.remaining(c - 1) : null;
    clock.hidden = ms == null;
    if (ms != null) {
      clock.textContent = formatClock(ms);
      clock.classList.toggle('low', ms < 10_000);
      clock.classList.toggle('running', online.phase === 'playing' && game.player === c);
    }
  }
  $('#carry .hud-piece').style.setProperty('--pc', selColor ? renderer.colors['p' + selColor] : '#888');
  setPieceIcon($('#carry .hud-piece'), selColor ? pieceIcons[selColor] : null);
}

function makeRenderer(name) {
  const handlers = { onCellClick, canPlay, statusText, selectedColor, previewOutcome };
  if (name === 'terraces') return new TerracesRenderer(boardEl, handlers);
  if (name === 'mercury') return new MercuryRenderer(boardEl, handlers);
  if (name === 'goban') return new GobanRenderer(boardEl, handlers);
  if (name === 'slime') return new SlimeRenderer(boardEl, handlers);
  if (name === 'neon') return new NeonRenderer(boardEl, handlers);
  if (name === 'marble') return new ThreeRenderer(boardEl, handlers, name);
  if (name === 'paper') return new PaperRenderer(boardEl, handlers);
  if (name === 'constellation') return new ConstellationRenderer(boardEl, handlers);
  return new TerminalRenderer(boardEl, handlers);
}

function setTheme(name) {
  if (renderer) renderer.destroy();
  renderer = makeRenderer(name);
  settings.theme = name; saveSettings();
  document.querySelectorAll('#themes button').forEach(b => b.classList.toggle('active', b.dataset.theme === name));
  boardEl.dataset.theme = name;
  document.documentElement.dataset.theme = name;
  applyPieceIcons();
  $('#theme-hint').textContent = THEME_HINTS[name];
  render();
}

function setColor(c) { selColor = c; note = ''; render(); }

function renderOnlineControls() {
  const playing = online.phase === 'playing' && online.isPlayer;
  $('#resign').hidden = !playing;
  $('#draw').hidden = !playing;
  // Rematch, once the game is over.
  const rm = $('#rematch');
  const finished = online.phase === 'finished' && online.isPlayer;
  rm.hidden = !finished;
  if (finished) {
    const r = online.rematch;
    if (!r) { rm.textContent = '⟳ Rematch'; rm.disabled = false; rm.classList.remove('primary'); }
    else if (r.challenger === online.myDid) { rm.textContent = '⟳ Rematch offered…'; rm.disabled = true; rm.classList.remove('primary'); }
    else { rm.textContent = '⟳ Accept rematch'; rm.disabled = false; rm.classList.add('primary'); }
  }
  // On-board status and names (the menu panel is closed most of the time).
  const st = $('#hud-status');
  st.hidden = false;
  const col = game.isOver ? (game.status === 'draw' ? '#888' : renderer.colors['p' + game.winner]) : renderer.colors['p' + game.player];
  st.querySelector('.dot').style.background = col;
  st.querySelector('.hud-text').textContent = (online.isPlayer ? '' : 'Spectating · ') + statusText();
  st.classList.toggle('is-check', inCheck() && humanTurn());
  for (const c of [1, 2]) {
    const seat = online.snap?.seats[c - 1];
    const box = document.querySelector(`#hud .hud-side[data-c="${c}"] .hud-player`);
    box.hidden = false;
    const rk = online.seatRank(c - 1);
    box.querySelector('.hud-side-name').textContent = rk ? `${online.seatName(c - 1)} · ${rk}` : online.seatName(c - 1);
    box.title = seat?.handle ? `@${seat.handle}` : seat?.did ?? '';
    const img = box.querySelector('.hud-avatar');
    if (seat?.avatar) { if (img.src !== seat.avatar) img.src = seat.avatar; img.hidden = false; } else img.hidden = true;
  }
  document.title = online.phase === 'playing' ? (online.myTurn ? '● Your turn · Manalath' : `Waiting for ${playerLabel(game.player)} · Manalath`) : online.phase === 'finished' ? 'Game over · Manalath' : 'Manalath';
  const offered = online.drawOffered;
  if (offered !== null && offered !== online.seat) { $('#draw').textContent = '½ Accept draw'; $('#draw').classList.add('primary'); }
  else { $('#draw').textContent = offered === online.seat ? '½ Draw offered' : '½ Offer draw'; $('#draw').classList.remove('primary'); }
  $('#draw').disabled = offered === online.seat;
  if (online.error) { toast(online.error); online.error = ''; }
}

let toastTimer = 0;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2500);
}

function onCellClick(i, alt) {
  if (!humanTurn()) return;
  if (selColor === 0) {
    note = 'choose a colour first';
    if (online) toast(note);
    boardEl.classList.remove('nudge'); void boardEl.offsetWidth; boardEl.classList.add('nudge');
    render();
    return;
  }
  const c = alt ? 3 - selColor : selColor;
  if (game.board[i] !== 0) return;
  if (!game.isLegal(i, c)) { note = 'illegal: that would make a group larger than five'; if (online) toast(note); render(); return; }
  note = '';
  selColor = 0;
  if (online) { online.place(i, c); render(); return; }
  game.place(i, c);
  afterMove();
}

// Handle forced passes, then hand over to the AI if needed.
function afterMove() {
  while (!game.isOver && game.mustPass()) {
    const p = game.player;
    game.pass();
    note = `${playerLabel(p)} had no legal move and passed`;
  }
  render();
  scheduleAi();
}

function scheduleAi() {
  clearTimeout(aiTimer);
  if (!isAiTurn()) return;
  thinking = true;
  render();
  aiTimer = setTimeout(() => {
    const m = chooseMove(game.board, game.player, settings.level);
    thinking = false;
    if (m) game.place(m.cell, m.color); else game.pass();
    afterMove();
  }, 250);
}

function newGame() {
  clearTimeout(aiTimer);
  thinking = false;
  note = '';
  selColor = 0;
  game.reset();
  render();
  scheduleAi();
}

function undo() {
  clearTimeout(aiTimer);
  thinking = false;
  note = '';
  selColor = 0;
  game.undo();
  if (settings.mode === 'ai') while (game.moveCount > 0 && isAiTurn()) game.undo();
  render();
  scheduleAi();
}

// --- wire up UI ---
$('#mode').value = settings.mode;
$('#level').value = settings.level;
$('#side').value = settings.side;
$('#ai-opts').style.display = settings.mode === 'ai' ? '' : 'none';

$('#mode').addEventListener('change', e => { settings.mode = e.target.value; $('#ai-opts').style.display = settings.mode === 'ai' ? '' : 'none'; saveSettings(); newGame(); });
$('#level').addEventListener('change', e => { settings.level = e.target.value; saveSettings(); });
$('#side').addEventListener('change', e => { settings.side = e.target.value; saveSettings(); newGame(); });
$('#new').addEventListener('click', newGame);
const panel = $('#panel');
$('#settings').addEventListener('click', () => panel.showModal());
$('#close-panel').addEventListener('click', () => panel.close());
panel.addEventListener('click', e => { if (e.target === panel) panel.close(); });
// theme choice closes the menu so you see the result immediately
document.querySelectorAll('#themes button').forEach(b => b.addEventListener('click', () => panel.close()));
$('#undo').addEventListener('click', undo);
$('#col1').addEventListener('click', () => setColor(1));
$('#col2').addEventListener('click', () => setColor(2));
document.querySelectorAll('#hud .hud-side').forEach(b => b.addEventListener('click', () => setColor(selColor === +b.dataset.c ? 0 : +b.dataset.c)));
boardEl.addEventListener('pointermove', e => {
  const r = boardEl.getBoundingClientRect();
  const carry = $('#carry');
  carry.style.left = (e.clientX - r.left) + 'px';
  carry.style.top = (e.clientY - r.top) + 'px';
});
document.querySelectorAll('#themes button').forEach(b => b.addEventListener('click', () => setTheme(b.dataset.theme)));
window.addEventListener('keydown', e => {
  if (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT' || panel.open || onlineDialog.open) return;
  if (!online && (e.key === 'u' || e.key === 'U')) undo();
  if (!online && (e.key === 'n' || e.key === 'N')) newGame();
  if (e.key === '1') setColor(1);
  if (e.key === '2') setColor(2);
  if ((e.key === 'x' || e.key === 'X' || e.key === ' ') && selColor !== 0) { e.preventDefault(); setColor(3 - selColor); }
  if (e.key === 'Escape') setColor(0);
});

// small debugging handle
window.manalath = { get renderer() { return renderer; }, game, get online() { return online; } };

// --- online play: the board stays, matches swap in and out underneath ---
const onlineDialog = $('#online');
function matchIdFromUrl() { return location.pathname.match(/^\/m\/([^/]+)/)?.[1] ?? null; }

function enterMatch(id, seatToken = null, { push = true, announce = false } = {}) {
  if (online?.matchId === id) { onlineDialog.close(); return; }
  if (online) { online.close(); online = null; }
  clearTimeout(aiTimer); thinking = false; selColor = 0; note = '';
  document.body.classList.add('online');
  $('#new').hidden = true; $('#undo').hidden = true; $('#mode-section').hidden = true;
  online = new OnlineMatch(id, seatToken, {
    onChange() { const ms = online.applyTo(game); if (ms && !humanTurn()) selColor = 0; render(); },
    onOpenMatch(nextId) { enterMatch(nextId, null, { announce: true }); },
  });
  if (push) history.pushState({ match: id }, '', `/m/${id}`);
  onlineDialog.close();
  if (announce) toast('Game on!');
  game.reset();
  render();
}

function exitMatch({ push = true } = {}) {
  if (!online) return;
  online.close(); online = null;
  document.body.classList.remove('online');
  $('#new').hidden = false; $('#undo').hidden = false; $('#mode-section').hidden = false;
  for (const id of ['resign', 'draw', 'rematch', 'hud-status']) $('#' + id).hidden = true;
  document.querySelectorAll('#hud .hud-player, #hud .hud-clock').forEach((el) => { el.hidden = true; });
  if (push) history.pushState({}, '', '/');
  document.title = 'Manalath';
  onlineDialog.close();
  newGame();
}

$('#resign').addEventListener('click', () => { if (online && confirm('Resign this game?')) online.resign(); });
$('#draw').addEventListener('click', () => {
  if (!online) return;
  if (online.drawOffered !== null && online.drawOffered !== online.seat) online.acceptDraw(); else online.offerDraw();
});
$('#rematch').addEventListener('click', () => {
  if (!online) return;
  if (online.rematch && online.rematch.challenger !== online.myDid) online.acceptRematch(); else online.offerRematch();
});
setInterval(() => online?.pollRematch(), 2000);
// Clocks tick locally between server updates.
setInterval(() => { if (online?.snap?.clocks && online.phase === 'playing') renderHud(); }, 100);

const lobby = mountLobby($('#online-body'), {
  onOpenMatch: (id, opts) => enterMatch(id, null, opts),
  onLeaveMatch: () => exitMatch(),
  currentMatchId: () => online?.matchId ?? null,
  isOpen: () => onlineDialog.open,
});
function openOnline() { panel.close(); lobby.render(); onlineDialog.showModal(); lobby.refresh(); }
$('#online-btn').addEventListener('click', openOnline);
$('#close-online').addEventListener('click', () => onlineDialog.close());
onlineDialog.addEventListener('click', (e) => { if (e.target === onlineDialog) onlineDialog.close(); });
window.addEventListener('popstate', () => {
  const id = matchIdFromUrl();
  if (id) enterMatch(id, null, { push: false }); else exitMatch({ push: false });
});

setTheme(settings.theme in THEME_HINTS ? settings.theme : 'terraces');
{
  const id = matchIdFromUrl();
  const params = new URLSearchParams(location.search);
  if (id) enterMatch(id, params.get('seat'), { push: false });
  else scheduleAi();
  if (params.has('online')) { openOnline(); history.replaceState({}, '', location.pathname); }
}
