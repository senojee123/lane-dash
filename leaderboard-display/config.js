/* ========================================================================
   CONFIG.JS — local configuration, loaded before app.js.
   See config.example.js for what these values mean. Same Supabase project
   (URL + public anon key) as the game — this page only reads `scores`.
======================================================================== */
window.LEADERBOARD_CONFIG = {
  SUPABASE_URL: 'https://awjaovibrslzghflwwin.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_OPviUM9Hl4QCxv6F3v2nAQ_F9tgHYeg',
  SCORES_TABLE: 'scores',

  TOP_N: 10,
  POLL_INTERVAL_MS: 7000,
  PAGE_RELOAD_INTERVAL_MS: 6 * 60 * 60 * 1000,
};
