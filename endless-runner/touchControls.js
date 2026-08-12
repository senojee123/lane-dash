/* ============================================================================
   TOUCH CONTROLS — swipe-to-lane-change/jump/roll for touchscreens.

   This file only detects gestures. It never touches player/game state
   directly — every gesture routes into tryLaneChange/tryJump/trySlide, the
   exact same functions the keydown handler in game.js calls, so keyboard and
   touch are two front-ends over one action layer rather than two parallel
   gameplay implementations. Loaded after game.js so those globals (canvas,
   Game, tryLaneChange, tryJump, trySlide) already exist in this shared
   top-level script scope.

   Both input paths stay live at all times — nothing here disables the
   keyboard, and nothing in game.js disables touch. A touchscreen laptop with
   a keyboard attached, or a phone with a Bluetooth controller, both just work.

   Orientation: the game's chase camera (see cameraNarrowZoom in game.js)
   dollies back automatically on narrow aspect ratios, so portrait is treated
   as the primary phone orientation, but nothing here assumes it — swipes are
   read the same way in landscape.
============================================================================ */

(function () {
  const SWIPE_MIN_DIST = 40;      // px — under this it's a tap or jitter, not a swipe
  const SWIPE_MAX_DURATION = 600; // ms — a slow drag isn't read as a swipe either
  const TAP_MAX_DIST = 12;        // px — a clean tap moves less than this
  const TAP_MAX_DURATION = 250;   // ms

  let startX = 0, startY = 0, startT = 0, tracking = false;

  function onTouchStart(e) {
    const t = e.changedTouches[0];
    startX = t.clientX;
    startY = t.clientY;
    startT = performance.now();
    tracking = true;
  }

  function onTouchMove(e) {
    if (!tracking) return;
    // Only fight the browser's native scroll/pinch-zoom/pull-to-refresh while
    // a run is actually in progress. On the start/pause/game-over overlays we
    // deliberately leave default touch behaviour alone so their buttons (and
    // the canvas's own tap-to-start listener in game.js) keep working as a
    // normal tap, synthetic click included.
    if (Game.state === 'playing') e.preventDefault();
  }

  function onTouchEnd(e) {
    if (!tracking) return;
    tracking = false;

    const t = e.changedTouches[0];
    const dx = t.clientX - startX;
    const dy = t.clientY - startY;
    const dt = performance.now() - startT;
    const adx = Math.abs(dx), ady = Math.abs(dy);
    const dist = Math.max(adx, ady);

    if (Game.state === 'playing') e.preventDefault();
    if (Game.state !== 'playing') return; // menu taps belong to their own DOM buttons/listeners

    if (dist < TAP_MAX_DIST && dt < TAP_MAX_DURATION) return; // plain tap mid-run — no gameplay action
    if (dist < SWIPE_MIN_DIST || dt > SWIPE_MAX_DURATION) return; // too small/slow to count as a deliberate swipe

    // Classify by whichever axis moved further, exactly one action per swipe.
    if (adx > ady) {
      tryLaneChange(dx > 0 ? 1 : -1); // swipe right / left
    } else if (dy > 0) {
      trySlide(); // swipe down
    } else {
      tryJump(); // swipe up
    }
  }

  canvas.addEventListener('touchstart', onTouchStart, { passive: true });
  canvas.addEventListener('touchmove', onTouchMove, { passive: false });
  canvas.addEventListener('touchend', onTouchEnd, { passive: false });
})();
