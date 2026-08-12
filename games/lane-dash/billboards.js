/* ============================================================================
   BILLBOARDS.JS — sponsor-provided ad creatives for in-game billboards.
   ----------------------------------------------------------------------------
   Separate from brand.js for the same reason brand.js is separate from
   theme.js: this is media content a sponsor swaps per campaign, not a game
   label. WHERE/how often billboards appear in the world is a world-layout
   concern instead, controlled by RunnerTheme.BILLBOARD (theme.js) — this
   file only supplies what plays ON them.

   Each entry: { type: 'image' | 'video', url }. Billboard SLOTS always exist
   in the world regardless of this array's length — an empty array (or any
   URL that fails to load) falls back to a placeholder panel rather than a
   missing billboard, so ad inventory always reads as present even with
   nothing configured yet. Creatives are assigned round-robin across
   billboard slots as they spawn (see assignBillboardCreative in
   engine/runner.js).

   Like brand.js, this is meant to be replaced by the platform's live
   hot-reload pipeline eventually — mutate this array and re-run
   engine/runner.js's billboard spawn path to pick up new creatives without
   a page reload, once that transport exists.
============================================================================ */
const RunnerBillboards = [
  // { type: 'image', url: 'https://example.com/sponsor-ad.jpg' },
  // { type: 'video', url: 'https://example.com/sponsor-ad.mp4' },
];
