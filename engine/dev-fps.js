/* ============================================================================
   DEV-FPS.JS — ENGINE (generic, shared by every content pack).
   Lightweight FPS overlay, opt-in only via ?debug or ?fps in the URL, so a
   normal player never sees it. Built to get real frame-time numbers instead
   of going on feel when investigating a suspected performance regression —
   updates twice a second (steadier reading than every single frame) and
   also tracks the single worst frame time in each window, since an
   occasional stutter can hide inside a healthy-looking average FPS.

   Self-contained: reads nothing from the game and writes nothing back
   except its own DOM node. Call DevFPS.tick(dt) once per animation frame
   from runner.js's main loop — it no-ops entirely (a single property check)
   when the debug flag isn't set, so there's no cost for a normal player.
============================================================================ */
const DevFPS = (function () {
  const params = new URLSearchParams(window.location.search);
  const enabled = params.has('debug') || params.has('fps');
  if (!enabled) return { tick() {} };

  const el = document.createElement('div');
  el.id = 'dev-fps';
  el.style.cssText = [
    'position:fixed', 'top:8px', 'left:8px', 'z-index:9999',
    'background:rgba(0,0,0,.65)', 'color:#7CFF9E', 'font:12px/1.4 monospace',
    'padding:6px 10px', 'border-radius:6px', 'pointer-events:none',
    'white-space:pre',
  ].join(';');
  document.body.appendChild(el);

  let frames = 0;
  let windowStart = performance.now();
  let worstFrameMs = 0;

  return {
    tick(dt) {
      frames++;
      worstFrameMs = Math.max(worstFrameMs, dt * 1000);
      const now = performance.now();
      const elapsed = now - windowStart;
      if (elapsed >= 500) {
        const fps = Math.round((frames * 1000) / elapsed);
        el.textContent = 'FPS ' + fps + '\nworst frame ' + worstFrameMs.toFixed(1) + 'ms';
        frames = 0;
        worstFrameMs = 0;
        windowStart = now;
      }
    },
  };
})();
