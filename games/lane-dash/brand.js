/* ============================================================================
   BRAND.JS — sponsor-controlled branding, kept separate from theme.js's
   game-feel tuning on purpose.
   ----------------------------------------------------------------------------
   This game is destined to sit inside a larger engagement platform where a
   sponsor customizes brand elements (labels, colors, logos) through an admin
   UI and pushes them to the running game live — the same kind of hot-reload
   the platform's other games already do. theme.js's numbers (speed, camera,
   difficulty curve) are NOT that kind of knob — they're game-feel, tuned
   once per reskin, not something a sponsor edits per campaign. This file is
   the layer that eventually gets replaced by that live pipeline: everything
   in RunnerBrand is applied through the single applyBrandConfig() function
   in engine/runner.js, which is safe to call again with new values (no
   reload transport wired up yet — that comes with the platform integration
   — but the seam is here so adding it later doesn't touch runner.js's
   mechanics).
============================================================================ */
const RunnerBrand = {
  // The collectible — today "coins". Renaming this updates every place the
  // word appears in the UI (HUD, bank-line, game-over, pause). Recoloring
  // updates both the HTML HUD dot (--rd-collectible-color) and the in-game
  // 3D coin mesh (Mat.gold in assets.js is the fallback color if this is
  // left unset — see applyBrandConfig()'s comment on why that split exists).
  collectibleLabel: 'Coins',
  collectibleColor: 0xffd166,

  // Score / points.
  scoreLabel: 'Score',
  multiplierLabel: 'multiplier',
  bestLabel: 'Best',
};
