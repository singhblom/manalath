// The Online dialog: login when logged out, the lobby when logged in. Renders into a container
// inside the game page; never navigates away from the board.
export function mountLobby(root, { onOpenMatch, onLeaveMatch, currentMatchId, isOpen }) {
  let me = null;
  let data = null;
  const seen = new Set();
  const loginError = new URLSearchParams(location.search).get('error');

  const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
  const escape = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const tcLabel = (tc) => (tc ? `${tc.base / 60}+${tc.increment}` : 'untimed');
  const ago = (t) => { const s = Math.max(0, (Date.now() - t) / 1000); return s < 60 ? 'just now' : s < 3600 ? `${Math.floor(s / 60)} min ago` : `${Math.floor(s / 3600)} h ago`; };
  const avatar = (p) => (p?.avatar ? `<img class="avatar" src="${escape(p.avatar)}" alt="">` : '<span class="avatar blank"></span>');
  // Rank badge from the server's rating table: "6k" once established, "6k?" while provisional, nothing before a rated game.
  const rankOf = (did) => { const r = did && data?.ratings?.[did]; return r?.rank ? `<span class="rank" title="${r.rating} ± ${r.deviation}">${r.rank}${r.provisional ? '?' : ''}</span>` : ''; };
  const person = (p, label) => `<span class="person" title="${escape(p?.handle ? '@' + p.handle : '')}">${avatar(p)}<span>${escape(label ?? p?.name ?? '?')}</span>${rankOf(p?.did)}</span>`;

  async function api(path, body) {
    const res = await fetch(path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : undefined);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || res.statusText);
    return json;
  }

  function render() {
    root.innerHTML = '';
    if (!data) { root.appendChild(h('<p class="hint">Connecting…</p>')); return; }
    const current = currentMatchId();

    if (!me) {
      root.appendChild(h(`<section>
        <p class="tagline">Log in with your Bluesky account to challenge other players. Manalath only asks to write its own game records to your repo.</p>
        <form class="stack" method="post" action="/login">
          <input type="hidden" name="next" value="/?online">
          <label>Bluesky handle <input name="handle" placeholder="you.bsky.social" autocomplete="username" required></label>
          <button class="primary">Log in with Bluesky</button>
          ${loginError ? `<p class="hint error">${escape(loginError)}</p>` : ''}
        </form>
      </section>`));
    } else {
      root.appendChild(h(`<div class="who">${person(me)}<a href="#" data-act="logout">log out</a></div>`));
      const form = h(`<section><h2>New challenge</h2>
        <form class="stack" id="create">
          <div class="row">
            <label>Time control <select name="timeControl">${data.timeControls.map((k) => `<option${k === '3+2' ? ' selected' : ''}>${k}</option>`).join('')}</select></label>
            <label>Who moves first <select name="firstMover"><option value="random" selected>Random</option><option value="challenger">Me</option><option value="opponent">Opponent</option></select></label>
          </div>
          <label>Opponent <input name="opponent" placeholder="anyone (leave empty), or a handle"></label>
          <label class="check"><input type="checkbox" name="rated" checked> Rated <span class="hint">counts towards your rank; needs a clock</span></label>
          <button class="primary">Post challenge</button>
        </form></section>`);
      const ratedBox = form.querySelector('[name=rated]');
      const tcSelect = form.querySelector('[name=timeControl]');
      const syncRated = () => { const untimed = tcSelect.value === 'untimed'; ratedBox.disabled = untimed; if (untimed) ratedBox.checked = false; };
      tcSelect.addEventListener('change', syncRated);
      form.querySelector('form').addEventListener('submit', (e) => {
        e.preventDefault();
        const f = new FormData(e.target);
        act(() => api('/api/challenge', { timeControl: f.get('timeControl'), firstMover: f.get('firstMover'), opponent: f.get('opponent'), rated: f.get('rated') === 'on' }));
      });
      root.appendChild(form);
    }

    // Open challenges (visible to everyone)
    const open = data.challenges.filter((c) => c.status === 'open' || c.status === 'accepting');
    const sec = h(`<section><h2>Open challenges</h2><ul class="list"></ul><p class="hint"></p></section>`);
    const ul = sec.querySelector('ul');
    for (const c of open) {
      const mine = me && c.challenger === me.did;
      const forMe = me && c.opponent === me.did;
      let who = person(c.challengerProfile, mine ? 'You' : undefined);
      if (c.opponent) who += ` <span class="arrow">→</span> ${person(c.opponentProfile, forMe ? 'you' : undefined)}`;
      const first = c.firstMover === 'random' ? 'random first' : c.firstMover === 'challenger' ? 'challenger first' : 'opponent first';
      const li = h(`<li class="${mine ? 'mine' : forMe ? 'forme' : ''}"><span class="tc">${tcLabel(c.timeControl)}</span><span class="who-line">${who}</span><span class="meta">${c.rated ? 'rated · ' : ''}${first} · ${ago(c.createdAt)}</span></li>`);
      const btn = document.createElement('button');
      if (mine) { btn.textContent = 'Withdraw'; btn.onclick = () => act(() => api('/api/challenge/cancel', { uri: c.uri })); }
      else if (!me) { btn.textContent = 'Log in to accept'; btn.onclick = () => root.querySelector('input[name=handle]')?.focus(); }
      else if (c.opponent && !forMe) { btn.textContent = 'Private'; btn.disabled = true; }
      else if (c.status === 'accepting') { btn.textContent = 'Being accepted…'; btn.disabled = true; }
      else { btn.className = 'primary'; btn.textContent = 'Accept'; btn.onclick = () => act(async () => { const { matchId } = await api('/api/challenge/accept', { uri: c.uri }); onOpenMatch(matchId); }); }
      li.appendChild(btn);
      ul.appendChild(li);
    }
    sec.querySelector('.hint').textContent = open.length ? '' : me ? 'No open challenges. Post one; you can close this and play the computer while you wait.' : 'No open challenges right now.';
    root.appendChild(sec);

    if (me) {
      const gs = h(`<section><h2>Your games</h2><ul class="list"></ul></section>`);
      const gul = gs.querySelector('ul');
      for (const g of data.games) {
        const vs = g.seats.map((s) => person(s, s.did === me.did ? 'You' : undefined)).join(' <span class="arrow">vs</span> ');
        let state = g.result ? (g.result.winner === null ? 'draw' : `${g.seats[g.result.winner].did === me.did ? 'you won' : `${g.seats[g.result.winner].name} won`} (${g.result.reason})`) : g.startedAt ? 'in progress' : 'waiting';
        const mySeat = g.seats.findIndex((s) => s.did === me.did);
        if (g.ratingChange && mySeat >= 0) { const d = g.ratingChange[mySeat]; state += ` · ${d > 0 ? '+' : ''}${d}`; }
        else if (g.rated) state += ' · rated';
        const li = h(`<li class="${g.id === current ? 'current' : ''}"><span class="tc">${tcLabel(g.timeControl)}</span><a class="who-line" href="/m/${g.id}">${vs}</a><span class="meta">${state} · ${ago(g.createdAt)}</span></li>`);
        li.querySelector('a').addEventListener('click', (e) => { e.preventDefault(); onOpenMatch(g.id); });
        gul.appendChild(li);
        if (!g.result) seen.add(g.id);
      }
      if (!data.games.length) gul.appendChild(h('<li><span class="meta">No games yet.</span></li>'));
      root.appendChild(gs);
    }

    if (data.leaderboard?.length) {
      const lb = h(`<section><h2>Ratings</h2><ol class="list ranks"></ol><p class="hint">Glicko-2, derived from the public game records. A "?" marks a provisional rank.</p></section>`);
      const ol = lb.querySelector('ol');
      for (const p of data.leaderboard) {
        const prof = data.leaderboardProfiles?.[p.did] ?? { did: p.did, name: p.did.slice(0, 16) + '…' };
        ol.appendChild(h(`<li><span class="tc">${p.rank ?? ''}${p.provisional ? '?' : ''}</span><span class="who-line">${person({ ...prof, did: null }, me && p.did === me.did ? 'You' : undefined)}</span><span class="meta">${p.rating} ± ${p.deviation} · ${p.games} game${p.games === 1 ? '' : 's'}</span></li>`));
      }
      root.appendChild(lb);
    }

    if (current) {
      const leave = h(`<p class="hint leave"><span>You are in a game. Leaving does not resign; find it again under Your games.</span><button data-act="leave">Back to local play</button></p>`);
      root.appendChild(leave);
    }
    root.querySelector('[data-act=logout]')?.addEventListener('click', async (e) => { e.preventDefault(); await fetch('/logout', { method: 'POST' }); location.href = '/?online'; });
    root.querySelector('[data-act=leave]')?.addEventListener('click', onLeaveMatch);
  }

  async function refresh() {
    try {
      data = await api('/api/lobby');
      me = data.me;
      // My challenge was accepted (possibly while the dialog was closed): go to the board.
      const accepted = data.challenges.find((c) => me && c.challenger === me.did && c.status === 'accepted' && c.matchId && !seen.has(c.matchId) && c.createdAt > Date.now() - 600_000);
      if (accepted) { seen.add(accepted.matchId); onOpenMatch(accepted.matchId, { announce: true }); }
      if (isOpen()) render();
    } catch (err) {
      if (isOpen()) { root.innerHTML = ''; root.appendChild(h(`<p class="hint error">Could not reach the server: ${escape(err.message)}</p>`)); }
    }
  }

  async function act(fn) {
    try { await fn(); } catch (err) { alert(err.message); }
    refresh();
  }

  const hasOwnOpen = () => !!(me && data?.challenges.some((c) => c.challenger === me.did && (c.status === 'open' || c.status === 'accepting')));
  setInterval(() => { if (isOpen() || hasOwnOpen()) refresh(); }, 2000);
  refresh();
  return { refresh, render };
}
