// Online play: a thin client over the game server's websocket. The server is authoritative; the
// client replays the event list through the shared MatchState so the board it shows is exactly
// the server's, and only uses local rules for click previews.
import { MatchState, cellCoords } from '@manalath/shared/match.ts';

export class OnlineMatch {
  constructor(matchId, seatToken, { onChange, onOpenMatch }) {
    this.matchId = matchId;
    this.seatToken = seatToken;
    this.onChange = onChange;
    this.onOpenMatch = onOpenMatch || ((id) => { location.href = `/m/${id}`; });
    this.closed = false;
    this.seat = null;        // 0 | 1 | null (spectator)
    this.snap = null;        // last LiveSnapshot from the server
    this.receivedAt = 0;     // performance.now() when snap arrived, anchors clock display
    this.error = '';
    this.rematch = null;     // pending/accepted rematch challenge for this match, if any
    this.connected = false;
    this.ws = null;
    this.retry = 0;
    this.connect();
  }

  connect() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${location.host}/ws/match/${this.matchId}${this.seatToken ? `?seat=${encodeURIComponent(this.seatToken)}` : ''}`;
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onopen = () => { this.connected = true; this.retry = 0; this.onChange(); };
    ws.onmessage = (e) => this.handle(JSON.parse(e.data));
    ws.onclose = () => {
      this.connected = false;
      if (this.closed) return;
      this.onChange();
      if (this.snap?.phase === 'finished') return;
      const delay = Math.min(10_000, 500 * 2 ** this.retry++);
      setTimeout(() => this.connect(), delay);
    };
  }

  /** Leave the match view: no more reconnects or callbacks. */
  close() {
    this.closed = true;
    this.onChange = () => {};
    try { this.ws?.close(); } catch { /* already closed */ }
  }

  handle(msg) {
    if (msg.t === 'hello') { this.seat = msg.seat; this.setSnap(msg.snap); }
    else if (msg.t === 'state') this.setSnap(msg.snap);
    else if (msg.t === 'error') { this.error = msg.message; this.onChange(); }
  }

  setSnap(snap) {
    this.snap = snap;
    this.receivedAt = performance.now();
    this.error = '';
    this.onChange();
  }

  /** Rebuild `game` (the UI's shared Game instance) from the server's events. */
  applyTo(game) {
    const s = this.snap;
    game.reset();
    if (!s || s.phase === 'waiting') return;
    const ms = MatchState.replay(s.config, s.startedAt, s.events, game);
    // Results the rules engine does not know about (resign, timeout, agreement) are shown as wins/draws.
    if (s.result && game.status === 'playing') {
      if (s.result.winner === null) game.status = 'draw';
      else { game.status = 'won'; game.winner = s.result.winner + 1; }
    }
    return ms;
  }

  get phase() { return this.snap?.phase ?? 'waiting'; }
  get isPlayer() { return this.seat !== null; }
  get myTurn() { return this.snap?.phase === 'playing' && this.seat !== null && this.snap.seatToMove === this.seat; }
  get drawOffered() { return this.snap?.drawOffer ?? null; }

  /** Remaining ms for a seat right now, or null in untimed games. */
  remaining(seat) {
    const s = this.snap;
    if (!s?.clocks) return null;
    let ms = s.clocks[seat];
    if (s.phase === 'playing' && s.seatToMove === seat) ms -= performance.now() - this.receivedAt;
    return Math.max(0, ms);
  }

  seatName(seat) {
    if (seat === this.seat) return 'You';
    return this.snap?.seats[seat]?.name ?? `Player ${seat + 1}`;
  }

  /** Rank badge for a seat, e.g. "6k" or "6k?", or '' before any rated game. */
  seatRank(seat) {
    const r = this.snap?.ratings?.seats?.[seat];
    return r?.rank ? `${r.rank}${r.provisional ? '?' : ''}` : '';
  }

  /** "1500 → 1519" for the given seat after a rated game, or ''. */
  ratingChangeText(seat) {
    const c = this.snap?.ratings?.change?.[seat];
    if (!c) return '';
    const d = c.after - c.before;
    return `${c.before} → ${c.after} (${d > 0 ? '+' : ''}${d}${c.rank ? `, ${c.rank}` : ''})`;
  }

  // --- rematch (after the game) ---
  async pollRematch() {
    if (this.phase !== 'finished' || this.closed) return;
    try {
      const res = await fetch(`/api/match/${this.matchId}/rematch`);
      const { rematch } = await res.json();
      if (JSON.stringify(rematch) !== JSON.stringify(this.rematch)) { this.rematch = rematch; this.onChange(); }
      if (rematch?.status === 'accepted' && rematch.matchId && this.isPlayer) this.onOpenMatch(rematch.matchId);
    } catch { /* offline; try again next tick */ }
  }
  async offerRematch() {
    const res = await fetch(`/api/match/${this.matchId}/rematch`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) { this.error = data.error || 'rematch failed'; this.onChange(); return; }
    this.rematch = data.rematch; this.onChange();
  }
  async acceptRematch() {
    if (!this.rematch) return;
    const res = await fetch('/api/challenge/accept', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ uri: this.rematch.uri }) });
    const data = await res.json();
    if (!res.ok) { this.error = data.error || 'could not accept'; this.onChange(); return; }
    this.onOpenMatch(data.matchId);
  }
  get myDid() { return this.seat === null ? null : this.snap?.seats[this.seat]?.did ?? null; }

  send(action) {
    if (this.ws?.readyState !== WebSocket.OPEN) { this.error = 'not connected'; this.onChange(); return; }
    this.ws.send(JSON.stringify({ t: 'act', action }));
  }
  place(cell, color) { this.send({ type: 'place', ...cellCoords(cell), color }); }
  resign() { this.send({ type: 'resign' }); }
  offerDraw() { this.send({ type: 'offerDraw' }); }
  acceptDraw() { this.send({ type: 'acceptDraw' }); }

  resultText() {
    const base = this.baseResultText();
    if (this.seat === null || !this.snap?.ratings?.change) return base;
    const change = this.ratingChangeText(this.seat);
    return change ? `${base} Rating ${change}.` : base;
  }

  baseResultText() {
    const r = this.snap?.result;
    if (!r) return '';
    if (r.winner === null) return r.reason === 'agreement' ? 'Draw by agreement.' : r.reason === 'passes' ? 'Draw: both players passed.' : 'Draw: the board is full.';
    const w = this.seatName(r.winner), l = this.seatName(1 - r.winner);
    const verb = w === 'You' ? 'win' : 'wins';
    switch (r.reason) {
      case 'quint': return `${w} ${verb} with a group of five!`;
      case 'quart': return `${l} ended the turn with a group of four — ${w} ${verb}!`;
      case 'resign': return `${l} resigned — ${w} ${verb}.`;
      case 'timeout': return `${l} ran out of time — ${w} ${verb}.`;
    }
    return `${w} ${verb}.`;
  }
}

export function formatClock(ms) {
  if (ms == null) return '';
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60), s = total % 60;
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}
