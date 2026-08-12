/* ============================================================================
   LEADERBOARD-CLIENT.JS — ENGINE (generic, shared by every content pack).
   The one place the game talks to its scores table. Loaded after config.js
   (for window.GAME_CONFIG) and the Supabase UMD CDN script (for
   window.supabase), and before game.js, which calls submitScore() from its
   existing game-over handler. Table name comes from GAME_CONFIG.SCORES_TABLE
   (default 'scores') — a new deployment points this at its own table/project
   purely through config.js, no code change here.
============================================================================ */

const SUPABASE_URL = (window.GAME_CONFIG && window.GAME_CONFIG.SUPABASE_URL) || '';
const SUPABASE_ANON_KEY = (window.GAME_CONFIG && window.GAME_CONFIG.SUPABASE_ANON_KEY) || '';
// Defaults to 'scores' so existing deployments (whose config.js predates this
// field) keep working unchanged; set SCORES_TABLE in config.js to run a
// second deployment against a different table in the same Supabase project.
const SCORES_TABLE = (window.GAME_CONFIG && window.GAME_CONFIG.SCORES_TABLE) || 'scores';

// NOTE: deliberately NOT named `supabase`. The Supabase UMD library loaded in
// index.html declares that identifier itself at its own top level, and
// classic <script> tags all share ONE global lexical scope for
// let/const/class — a second `let supabase` anywhere collides with it. That
// collision is a parse-time SyntaxError, which kills the ENTIRE file it's in
// before a single line of it runs (this bit the previous attempt at this
// integration: naming the client `supabase` silently broke all of game.js,
// not just the leaderboard call).
let gameSupabaseClient = null;
if (!SUPABASE_URL || SUPABASE_URL === 'YOUR_SUPABASE_PROJECT_URL_HERE') {
  console.warn('[Supabase] config.js still has placeholder values — score submission is disabled until SUPABASE_URL/SUPABASE_ANON_KEY are filled in (see config.example.js).');
} else {
  try {
    gameSupabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  } catch (err) {
    console.error('[Supabase] client failed to initialize — score submission disabled, game unaffected.', err);
  }
}

/**
 * Fire-and-forget: inserts one row into `scores`. `created_at` is left out
 * on purpose — the table defaults it. Never throws back into the caller; a
 * failed submission (network error, RLS rejection, still-placeholder config,
 * etc.) only logs a warning, since this must never block or crash the
 * game-over flow that calls it. Returns true/false in case a future caller
 * needs to know whether it actually landed; ordinary fire-and-forget callers
 * are free to ignore the return value.
 */
async function submitScore(playerName, score) {
  // TEMP DEBUG — confirms this function is actually being reached at all;
  // an earlier attempt at this same integration silently no-op'd (placeholder
  // config, or the page opened as file:// instead of served over http://),
  // which read from the outside as "submitScore is broken" when it was never
  // being called in a state that could succeed. Safe to remove once confirmed
  // working against a real project, or leave — one line per submission.
  console.log('[Supabase] submitScore called', playerName, score);
  if (!gameSupabaseClient) return false; // not configured — see the warning logged above
  try {
    const { error } = await gameSupabaseClient.from(SCORES_TABLE).insert([
      { player_name: playerName, score },
    ]);
    if (error) { console.warn('[Supabase] submitScore failed:', error.message); return false; }
    return true;
  } catch (err) {
    console.warn('[Supabase] submitScore failed:', err);
    return false;
  }
}
