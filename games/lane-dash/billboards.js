/* ============================================================================
   BILLBOARDS.JS — sponsor-provided ad creatives for in-game billboards.
   ----------------------------------------------------------------------------
   Separate from brand.js for the same reason brand.js is separate from
   theme.js: this is media content a sponsor swaps per campaign, not a game
   label. WHERE/how often billboards appear in the world is a world-layout
   concern instead — RunnerTheme.BILLBOARD (theme.js) sizes the panel;
   CITY_ROWS[0]'s rooftopBillboardChance/openLotChance/
   openLotBillboardChance (also theme.js) decide placement, on individual
   buildings and in open lots between them (see spawnCityRow() in
   engine/runner.js) — this file only supplies what plays ON a given slot.

   Each entry: { type: 'image' | 'video', url }. Billboard SLOTS always exist
   in the world regardless of this array's length — an empty array (or any
   URL that fails to load) falls back to a placeholder panel rather than a
   missing billboard, so ad inventory always reads as present even with
   nothing configured yet. Creatives are picked at random per slot (see the
   addBillboard() call sites in engine/runner.js's spawnCityRow()).

   Like brand.js, this is meant to be replaced by the platform's live
   hot-reload pipeline eventually — mutate this array and re-run
   engine/runner.js's billboard spawn path to pick up new creatives without
   a page reload, once that transport exists.
============================================================================ */
const RunnerBillboards = [
  // Self-hosted (games/lane-dash/assets/branding/), not hotlinked — image
  // creatives get drawn onto a canvas to build a WebGL texture
  // (BillboardMedia.getTexture -> compositeContainTexture), which requires
  // a same-origin or CORS-enabled source. The site this logo came from
  // sends no Access-Control-Allow-Origin header, which silently broke
  // billboards (while working fine for brand.js's sponsorLogoUrl, a plain
  // <img> tag with no such restriction) until this was tracked down. Same
  // file as brand.js's sponsorLogoUrl/collectibleImageUrl — see the
  // comment there for the full explanation.
  { type: 'image', url: 'assets/branding/sponsor-logo.png' },
];
