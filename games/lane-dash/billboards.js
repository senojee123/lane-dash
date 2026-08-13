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
  // { type: 'image', url: 'https://example.com/sponsor-ad.jpg' },
  // { type: 'video', url: 'https://example.com/sponsor-ad.mp4' },
];
