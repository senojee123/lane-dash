/* ============================================================================
   DEV-FPS.JS — ENGINE (generic, shared by every content pack).
   Live FPS time-series overlay, opt-in only via ?debug or ?fps in the URL,
   so a normal player never sees it. Built to get real frame-time numbers
   (and their trend over time — a screenshot of the plot is easier to hand
   someone than a single number) instead of going on feel when investigating
   a suspected performance regression.

   Self-contained: reads nothing from the game and writes nothing back
   except its own DOM node. Call DevFPS.tick(dt) once per animation frame
   from runner.js's main loop — it no-ops entirely (a single property check)
   when the debug flag isn't set, so there's no cost for a normal player.
============================================================================ */
const DevFPS = (function () {
  const params = new URLSearchParams(window.location.search);
  const enabled = params.has('debug') || params.has('fps');
  if (!enabled) return { tick() {} };

  const HISTORY_SECONDS = 20;   // how far back the plot scrolls
  const MAX_FPS_AXIS = 70;      // fixed Y range (not auto-scaled) so plots
                                 // from different sessions stay comparable
  const REDRAW_INTERVAL_MS = 120; // throttled separately from sampling —
                                   // every real frame is recorded (accurate
                                   // history), the canvas just doesn't need
                                   // to repaint that often to read clearly

  const wrap = document.createElement('div');
  wrap.id = 'dev-fps';
  wrap.style.cssText = [
    'position:fixed', 'top:8px', 'left:8px', 'z-index:9999',
    'background:rgba(0,0,0,.7)', 'color:#7CFF9E', 'font:12px/1.4 monospace',
    'padding:8px 10px', 'border-radius:6px', 'pointer-events:none',
  ].join(';');

  const label = document.createElement('div');
  label.style.cssText = 'margin-bottom:4px; white-space:pre;';
  wrap.appendChild(label);

  const canvas = document.createElement('canvas');
  canvas.width = 240;
  canvas.height = 70;
  canvas.style.cssText = 'display:block;';
  wrap.appendChild(canvas);
  const ctx = canvas.getContext('2d');

  document.body.appendChild(wrap);

  // Ring buffer of {t, fps} — pruned by AGE (not a fixed sample count), so
  // the X axis maps correctly to elapsed time regardless of frame rate.
  let history = [];
  let lastRedraw = 0;
  let windowFrames = 0;
  let windowStart = performance.now();
  let worstFrameMs = 0;

  function yForFps(fps, h) {
    return h - Math.min(fps, MAX_FPS_AXIS) / MAX_FPS_AXIS * h;
  }

  function draw(now, currentFps, worstMsInWindow) {
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    // reference lines at 30/60 fps — the two thresholds that actually matter
    ctx.strokeStyle = 'rgba(255,255,255,.18)';
    ctx.lineWidth = 1;
    [30, 60].forEach((mark) => {
      const y = Math.round(yForFps(mark, h)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    });

    if (history.length > 1) {
      ctx.strokeStyle = '#7CFF9E';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      history.forEach((s, i) => {
        const x = w - ((now - s.t) / (HISTORY_SECONDS * 1000)) * w;
        const y = yForFps(s.fps, h);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }

    label.textContent = 'FPS ' + currentFps + '  (worst frame ' + worstMsInWindow.toFixed(1) + 'ms)';
  }

  return {
    tick(dt) {
      const now = performance.now();
      const instFps = dt > 0 ? 1 / dt : 0;
      history.push({ t: now, fps: instFps });
      const cutoff = now - HISTORY_SECONDS * 1000;
      while (history.length && history[0].t < cutoff) history.shift();

      windowFrames++;
      worstFrameMs = Math.max(worstFrameMs, dt * 1000);

      if (now - lastRedraw >= REDRAW_INTERVAL_MS) {
        const elapsed = now - windowStart;
        const fps = elapsed > 0 ? Math.round((windowFrames * 1000) / elapsed) : 0;
        draw(now, fps, worstFrameMs);
        lastRedraw = now;
        windowFrames = 0;
        worstFrameMs = 0;
        windowStart = now;
      }
    },
  };
})();
