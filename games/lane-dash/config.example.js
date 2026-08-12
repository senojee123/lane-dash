/* ============================================================================
   CONFIG.EXAMPLE.JS — template for config.js.

   This project has no build step (no bundler, no package.json, no Node
   tooling) — everything runs as plain <script> tags loaded straight by the
   browser. That means there's no real process.env to read a .env file into,
   which is the usual reason a project separates config from code. This file
   plays that same role instead: copy it to config.js, fill in your actual
   Supabase project's values, and config.js is what index.html actually
   loads — keeping the real values out of the tracked source files, same
   intent as a .env / .env.example pair in a Node project.

   Where to find these values: Supabase dashboard -> Project Settings -> API.
   SUPABASE_ANON_KEY is the public "anon" key, not the service_role key — the
   anon key is DESIGNED to be shipped in client-side code; it's safe here
   precisely because Row Level Security policies (not secrecy) are what
   actually restrict what it can do.
============================================================================ */
window.GAME_CONFIG = {
  SUPABASE_URL: 'YOUR_SUPABASE_PROJECT_URL_HERE',
  SUPABASE_ANON_KEY: 'YOUR_SUPABASE_ANON_KEY_HERE',

  // Table scores are inserted into on game-over. Must match SCORES_TABLE in
  // leaderboard-display's config.js for the same deployment — running
  // multiple deployments off one Supabase project is just a matter of
  // giving each its own table name here.
  SCORES_TABLE: 'scores',
};
