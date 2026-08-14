/* ========================================================================
   CONFIG.JS — local configuration, loaded before engine/leaderboard-client.js.

   See config.example.js for what these values mean and where to get them.
   ACTION NEEDED: replace both placeholders below with your actual Supabase
   project's values (dashboard -> Project Settings -> API), or score
   submission stays safely disabled (see the warning leaderboard-client.js
   logs for a still-placeholder config).
======================================================================== */
window.GAME_CONFIG = {
  SUPABASE_URL: 'https://ornjmnakoxjnjvvqqeho.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_RO20qsp65m4ozJ2R5udNQg__lbF9QzD',
  SCORES_TABLE: 'scores',
};