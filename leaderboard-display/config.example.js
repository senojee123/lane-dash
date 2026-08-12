/* ============================================================================
   CONFIG.EXAMPLE.JS — template for config.js.

   This is a static, no-build-step page (plain <script> tags), so there's no
   process.env to load a .env file into. This file plays that role instead:
   copy it to config.js and fill in your Supabase project's values — config.js
   is what index.html actually loads, keeping real values out of anything you
   might commit to a public repo.

   Where to find these values: Supabase dashboard -> Project Settings -> API.
   SUPABASE_ANON_KEY is the public "anon" key, not the service_role key — it's
   safe to ship in client-side code because Row Level Security policies (not
   secrecy) are what actually restrict what it can do. This page only ever
   reads from `scores`, so it only needs the project's existing public SELECT
   policy on that table — no write access required.
============================================================================ */
window.LEADERBOARD_CONFIG = {
  SUPABASE_URL: 'YOUR_SUPABASE_PROJECT_URL_HERE',
  SUPABASE_ANON_KEY: 'YOUR_SUPABASE_ANON_KEY_HERE',

  // How many top scores to display.
  TOP_N: 10,

  // Re-fetch the full top-N list on this interval (ms). Keep this between
  // 5000-10000 (5-10s) for a "near-live" feel without hammering Supabase.
  POLL_INTERVAL_MS: 7000,

  // Reload the whole page on this interval (ms) as a safety net against
  // long-running browser tab memory/state drift. Common practice for
  // unattended kiosk-style displays.
  PAGE_RELOAD_INTERVAL_MS: 6 * 60 * 60 * 1000, // 6 hours
};
