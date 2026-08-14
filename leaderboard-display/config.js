/* ========================================================================
   CONFIG.JS — local configuration, loaded before app.js.
   See config.example.js for what these values mean. Same Supabase project
   (URL + public anon key) as the game — this page only reads `scores`.
======================================================================== */
window.LEADERBOARD_CONFIG = {
  SUPABASE_URL: 'https://ornjmnakoxjnjvvqqeho.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_RO20qsp65m4ozJ2R5udNQg__lbF9QzD',
  SCORES_TABLE: 'scores',

  TOP_N: 10,
  POLL_INTERVAL_MS: 7000,
  PAGE_RELOAD_INTERVAL_MS: 6 * 60 * 60 * 1000,
};
