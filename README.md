# Manalath

A browser implementation of **Manalath** (Dieter Stein & Néstor Romeral Andrés) built with Three.js and plain ES modules.

**Rules:** players alternate placing one piece of *either* colour on the 61-cell hex board. A group (connected same-colour pieces) may never exceed five. At the end of your own turn, a friendly group of exactly four loses and a friendly group of exactly five wins (a quart takes precedence). No legal move means you must pass; two passes in a row or a full board is a draw.

## Run

The project is a [Bun](https://bun.sh) workspace. Install dependencies once, then start the dev server:

```bash
bun install
bun run dev
```

then open <http://localhost:8765>. The board is always the main view. The **Online** button opens a dialog in the same style as the menu: log in with a Bluesky handle, post an open or direct challenge (this writes a `top.manalath.match` record to your repo), or accept one (which writes the `top.manalath.accept` and swaps the live match in under the dialog). While your challenge waits you can close the dialog and play the computer; acceptance pulls you into the game. `/m/:id` still opens a match directly for sharing and spectating; `/lobby` and `/login` redirect to `/?online`. You can accept your own challenge from a second tab to test alone. `/dev/matches` shows how many events have been written to repos. Run exactly one server per database: two processes on one SQLite file would both arm flag timers. The server bundles the web app (including Three.js from npm) with hot reload. `bun test` runs the tests and `bun run lex` regenerates TypeScript types from the lexicons.

## Deploy to Fly.io

The repo ships a `Dockerfile` and `fly.toml`. The server keeps live matches and flag timers in memory and owns its SQLite file, so the config runs exactly one machine that never auto-stops, with the database on a persistent volume at `/data`, and replaces it in place on deploy rather than overlapping old and new. First-time setup, after installing [flyctl](https://fly.io/docs/flyctl/install/):

```bash
fly launch --no-deploy --copy-config --name manalath
```

```bash
fly volumes create manalath_data --region arn --size 1
```

```bash
fly secrets set OAUTH_PRIVATE_KEY="$(bun run gen-key)"
```

```bash
fly deploy
```

`bun run gen-key` prints a fresh ES256 signing key as a JWK; the ATProto OAuth client is confidential in production and publishes the public half at `/oauth/jwks.json`, so keep the same key for the lifetime of the deployment. Edit `app`, `primary_region` and `PUBLIC_URL` in `fly.toml` to taste. `PUBLIC_URL` must be the exact origin browsers use, since it becomes the OAuth `client_id` and redirect URI; if you attach a custom domain with `fly certs add`, change it to that domain. Uncomment `ARBITER_DID` to stamp challenges with the server's DID. `/xrpc/_health` is the health check.

## Features

- **Hotseat** – two players sharing one screen.
- **Local vs computer** – alpha-beta search with iterative deepening (Easy / Normal / Hard), choose your side.
- **Nine visual themes**, switchable mid-game. One is a homage to go:
  - *Goban* – Three.js, a thick kaya-wood slab with procedurally drawn straight grain and an ink hex grid, on legs over tatami; lens-shaped slate and clamshell stones with clearcoat reflection and mild iridescence, dropped with slightly irregular placement.

  Two treat groups as fluids: Two treat groups as fluids:
  - *Quintessence* – Three.js marching-cubes metaballs: same-colour stones flow into one pool of liquid metal or oil, with spring-driven wobble, a gooey hover preview, and a wave-simulated pool surface that ripples on every placement.
  - *Slime Lab* – SVG goo filter: blobs of slime in a petri dish that melt together, splat on arrival, jiggle their neighbours, breathe, bubble and drip.

  Two are built around Manalath's group focus:
  - *Quartz* – Three.js, every group rises as one plateau whose height is its size, with floating size badges; quarts glow red, quints gold.
  - *Constellation* – SVG, stones are stars, adjacent stones are linked, each cluster has a size badge and hovering previews the size of the resulting group.
  - *Marble Hall* – Three.js, realistic marble tiles with shadows and orbit camera.
  - *Neon Void* – Three.js, glowing floating crystals over an endless grid with fog.
  - *Paper & Ink* – 2D canvas, hand-drawn pencil hexes and ink pieces.
  - *Phosphor Terminal* – monospace CRT-style text grid with a move log.
- Colour picker (`1` / `2`, `X` to toggle, right-click for the other colour), undo (`U`), new game (`N`), a live list of group sizes, last-move and decisive-group highlights.

## Layout

Monorepo, laid out for the online version (see the ATProto design below):

- `packages/shared/src/` – code shared by client and server.
  - `hex.js` – board geometry (axial coords, neighbours).
  - `game.js` – rules, group detection, legality, win/lose checks, passing, undo.
  - `ai.js` – computer opponent.
  - `match.ts` – match state machine: two seats, Fischer clocks, draw offers, resignation, timeout, forced passes. Replayable from its event list; the client and server run the same code.
  - `ratings.ts` – Glicko-2 applied per game, the dan/kyu ladder, and the deterministic fold over finished rated games that every indexer runs (`glicko2-v1`).
  - `lex.ts` – barrel over the generated lexicon types in `lexicon/` (do not edit; regenerate).
- `apps/web/` – the browser client. `src/renderers/` holds one renderer per theme family, all implementing `update(game)` / `destroy()`; `src/main.js` is UI wiring; `src/lobby.js` renders the Online dialog (login and lobby); `src/online.js` mirrors a server-hosted match at `/m/:id` over a websocket, with an on-board status pill, player handles, clocks, resign/draw/rematch controls and a toast for refused moves.
- `apps/server/` – Bun server. `auth.ts` is the ATProto OAuth client (loopback in dev, confidential with `PUBLIC_URL` + `OAUTH_PRIVATE_KEY` in production); `match/` holds the in-memory live matches, the flag timers and SQLite persistence; `lobby/` turns challenges into matches (first accept wins, random first mover from the accept CID's last byte); `ratings/` caches the rating fold in SQLite, rebuilt from scratch after every rated game, and serves it as `top.manalath.getPlayer` / `getLeaderboard` XRPC queries; `repo/writer.ts` mirrors every accepted event into the players' repos as chained `top.manalath.move` records (plus `match` and `accept` at the start), serially per match with retries and never on the hot path; `routes/` has the HTTP and websocket handlers. State lives in `manalath.sqlite` (override with `DB_PATH`).
- `lexicons/` – ATProto lexicon definitions under `top.manalath.*` (the domain manalath.top).
- `docs/plan.md` – decisions, rejected alternatives and phase status.

## Online play over ATProto

Moves form a tree: every `top.manalath.move` references its predecessor by strong ref, so a fresh game is a move with no `prev` and a fork of any public position is a move whose `prev` points into another game. A `top.manalath.match` is a labelled path through that tree (players, first mover, clock, rated, optional `root`), and a `top.manalath.accept` from the opponent pins the agreed terms by CID. Board state, results and ratings are derived by the appview, never written to repos.

### Ratings

A rating is a pure function of the public records, so any indexer that folds the same finished rated games in the same order (finish time, then id) gets the same numbers. The fold is Glicko-2 with each game as its own rating period and deviation inflating with real time since a player's last game; the display rank is a go-style ladder with 100 points per grade and 1 dan at 2100, shown with a `?` while the deviation is above 110. Only clocked, unforked games with `rated: true` count; untimed games cannot end when a player walks away, so they are never rated.

A match record may name an `arbiter`: the DID of the game server both players agreed to have run the game live. The field is a pointer, not proof. A later `verdict` record in the arbiter's own repo, referencing the match by CID, is what lets independent indexers trust clock results such as timeouts; set `ARBITER_DID` to stamp the field on challenges this server hosts.

## License

[MIT](LICENSE). Manalath itself was designed by Dieter Stein and Néstor Romeral Andrés; this is an independent implementation.
