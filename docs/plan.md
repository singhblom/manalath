# Manalath online: plan and decisions

Working notes for putting Manalath online over ATProto. The README describes the design as it is; this file records why, what was rejected, and where we are. Update it when a phase lands or a decision changes.

## Decisions

Made 2026-09-11 and 2026-09-12 unless noted.

- **Runtime: Bun** with `Bun.serve`, one process. Node and Deno were considered and rejected; Bun bundles the web app, runs TypeScript directly and ships SQLite. Do not reopen.
- **Storage: `bun:sqlite`**, with Litestream for replication once deployed. Postgres was rejected as more than one machine's worth of game needs. Exactly one server per database file, because two processes would both arm flag timers.
- **Hosting:** one Fly machine, later.
- **Blitz from the start.** The server is authoritative for live games and clocks. It writes move records into players' repos itself using server-held OAuth sessions (confidential client in production, loopback client in development). Players never sign moves in the browser.
- **Lexicon shape: a tree of moves.** Every `top.manalath.move` points to its predecessor by strong ref. A `top.manalath.match` is a labelled path through that tree with an optional `root` for forking a public position. A `top.manalath.accept` pins the agreed terms by CID. Board state, results and ratings are derived by the appview, never written to repos.
- **NSID:** `top.manalath.*`. Martin owns manalath.top (chosen 2026-09-12).
- **Defaults:** Fischer 3+2, random first mover decided by the parity of the accept record's CID, Glicko-2 ratings, forks unrated.
- **Ratings are a derived view** (2026-09-16). A rating is a pure function of the public game records: any indexer folding the same finished rated games in the same order (finish time, then id) gets the same numbers. No player-authored rating record; that would be a self-asserted claim nobody could verify.
- **Rating algorithm** (2026-09-16): Glicko-2 applied per game, the way Lichess does it, rather than in fixed rating periods, so indexers never disagree about which period a game belongs to. Deviation inflates with real time since the player's last game. Algorithm id `glicko2-v1`; bump it if the fold changes. Display rank is a go-style ladder, 100 points per grade, 1 dan at 2100, provisional above deviation 110. Only clocked, unforked games count; untimed games cannot end when a player walks away.
- **Arbiter** (2026-09-16): a match record may name an `arbiter`, the DID of the game server both players agreed to have run the game live. The field is a pointer, not proof. Trust comes from a future `verdict` record in the arbiter's own repo that references the match by CID, following the labeler pattern. Indexers choose a policy: rate everything replayable, or only games with a verdict from an arbiter they trust. Signing moves inside move records was rejected because key distribution and rotation would then live outside ATProto's identity system.

## Phases

| # | Phase | Status |
|---|-------|--------|
| 1 | Scaffold and lexicons | done |
| 2 | OAuth spike (repo write verified under Bun; default handle resolver needed a workaround) | done |
| 3 | Match engine and websocket play | done |
| 4 | Repo writer (chain read back from a PDS) | done |
| 5 | Lobby: challenges as match records, first accept wins | done |
| 6 | Client polish: status pill, names, toast, rematch as direct challenge | done |
| 7 | Jetstream ingest and backfill | to do |
| 8 | Ratings and XRPC | done 2026-09-16, except the verdict record |
| 9 | Deploy | to do |

## Phase 8 as landed

- `packages/shared/src/ratings.ts`: Glicko-2, the ladder, the deterministic fold. Tested against the worked example in Glickman's paper.
- `apps/server/src/ratings/service.ts`: caches the fold in SQLite, rebuilt from scratch on start and after every rated game.
- `top.manalath.getPlayer` and `top.manalath.getLeaderboard` query lexicons and `defs#playerRating`, served under `/xrpc/`.
- Lobby: Rated checkbox (on by default, disabled for untimed), rated tags, rank badges, rating deltas, top-ten list. HUD shows ranks; the result line shows the rating change.
- `ARBITER_DID` stamps the arbiter field on challenges this server hosts.

## Open work

- **Verdict record.** A `top.manalath.verdict` lexicon (strong ref to the match, result, reason) written to the arbiter's own repo when a match finishes. Needs a server DID with its own PDS account and a writer path alongside the move writer.
- **Jetstream indexer (phase 7).** Feed the rating fold from repo records instead of the server's match table. Finish time then comes from the terminal move's `createdAt` and the tie-break from the match CID. Results must be derived by replaying moves with the shared rules, never trusted from a field.
- **Anti-abuse policy.** A verdict proves the server ran the game, not that two DIDs are two people. Sandbagging and collusion are rating-policy questions: minimum account age, capping repeated games against one opponent, and similar.
- **Deploy (phase 9).**
