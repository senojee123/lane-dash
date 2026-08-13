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
  // Optional: a sponsor logo shown above the title on every overlay screen
  // (loading, start, game-over, pause) — the one guaranteed-seen branding
  // surface every player passes through, unlike billboards which are
  // peripheral to gameplay. Leave null to show no logo (default reskin
  // look, no reserved empty space). Shown at its own aspect ratio (not
  // cropped/stretched) via applyBrandConfig() in engine/runner.js — plain
  // <img>, not composited onto anything, so a transparent-background PNG
  // just sits on the screen's own dark background.
  //
  // Self-hosted (assets/branding/), not hotlinked from the logo site it
  // came from — that site sends no Access-Control-Allow-Origin header
  // (checked: `curl -I` on its URL), which is fine for a plain <img> tag
  // like this one but silently breaks collectibleImageUrl/billboards
  // below, both of which have to draw the image onto a canvas to build a
  // WebGL texture, and browsers refuse that for a cross-origin image with
  // no CORS header (crossOrigin='anonymous' either fails the load outright
  // or taints the canvas so WebGL rejects the texture upload). Same file
  // reused for all three so there's only one same-origin copy to keep
  // in sync — swap this path once real per-sponsor assets exist.
  sponsorLogoUrl: 'assets/branding/sponsor-logo.png',

  // The collectible — today "coins". Renaming this updates every place the
  // word appears in the UI (HUD, bank-line, game-over, pause). Recoloring
  // updates both the HTML HUD dot (--rd-collectible-color) and the in-game
  // 3D coin mesh (Mat.gold/Mat.coinFace in assets.js are the fallback color
  // if this is left unset — see applyBrandConfig()'s comment on why the
  // ring/face split exists).
  collectibleLabel: 'Coins',
  collectibleColor: 0xffd166,

  // Optional: an image URL shown on the coin's flat face (the ring around
  // it stays plain collectibleColor) — a sponsor logo instead of a plain
  // gold disc. Leave null for the default plain-color coin. Composited
  // "contain" fit (BillboardMedia.getImageTexture, engine/billboard-
  // media.js) onto collectibleColor as the backing, so a transparent-
  // background logo blends in rather than showing a mismatched square.
  // Same self-hosted file as sponsorLogoUrl above — see its comment for
  // why this one specifically needs a same-origin/CORS-enabled source
  // (goes through a canvas -> WebGL texture, unlike the plain <img> logo).
  collectibleImageUrl: 'assets/branding/sponsor-logo.png',

  // Score / points.
  scoreLabel: 'Score',
  multiplierLabel: 'multiplier',
  bestLabel: 'Best',
};
