# Leaderboard Display

Standalone, read-only big-screen leaderboard for the `scores` Supabase table.
Not the game — just a spectator/lobby/event display. Plain HTML/CSS/JS, no
build step, no game code.

## Setup

1. Copy `config.example.js` to `config.js` and fill in your Supabase project
   URL + public anon key (Supabase dashboard -> Project Settings -> API).
   `config.js` in this folder is already pre-filled with the same values the
   game uses, since it's the same Supabase project.
2. Confirm the table named by `SCORES_TABLE` (default `scores`) has a public
   `SELECT` RLS policy — this page never inserts/updates/deletes, so no other
   policies are needed. (Verified working against the live project: the
   table currently has `player_name` and `score` columns only, no
   `created_at` — the query and dedup key here are based on `player_name` +
   `score`.) `SCORES_TABLE` must match the game's own `config.js` for the
   same deployment — that's the one thing tying this display to a specific
   game instance.
3. Open `index.html` over `http://` (not `file://`) — e.g. via the repo's
   `serve.ps1`, or any static file server.

## Deploy

Deploy this folder as its own static site (Netlify, Vercel, GitHub Pages,
etc.), separate from the game's hosting. A `netlify.toml` is included for a
one-click Netlify deploy (publish directory = `.`). Open the resulting URL
full-screen on whatever display/TV is running the show.

## Behavior

- Fetches the current top N scores (`TOP_N` in `config.js`, default 10) on
  load, then polls again every `POLL_INTERVAL_MS` (default 7000ms, keep it
  between 5000-10000) via `setInterval(fetchLeaderboard, POLL_INTERVAL_MS)` —
  no persistent Realtime subscription, just a simple recurring re-fetch.
- Guards against overlapping requests: `fetchLeaderboard()` skips a tick if
  the previous call hasn't resolved yet (`isFetching` flag).
- On a failed poll, logs a console warning and keeps showing the last
  successfully fetched list — a single hiccup never clears or disrupts the
  display.
- Diffs the freshly fetched list against what's currently shown and only
  applies the highlight animation to rows whose rank/value actually changed,
  so routine polls read as a smooth update rather than a full-list flicker.
- Reloads the whole page every `PAGE_RELOAD_INTERVAL_MS` (default 6 hours) as
  a safety net against long-running tab memory/state drift, standard practice
  for unattended kiosk-style displays.
