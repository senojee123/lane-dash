/* ============================================================================
   DEV-FPS.JS — ENGINE (generic, shared by every content pack).
   Live FPS time-series overlay, opt-in only via ?debug or ?fps in the URL,
   so a normal player never sees it. Built to get real frame-time numbers
   (and their trend over time — a screenshot of the plot is easier to hand
   someone than a single number) instead of going on feel when investigating
   a suspected performance regression.

   Self-contained: reads nothing from the game and writes nothing back
   except its own DOM node. Call DevFPS.tick() once per animation frame from
   runner.js's main loop — it no-ops entirely (a single property check) when
   the debug flag isn't set, so there's no cost for a normal player.

   Deliberately measures its OWN raw frame time via performance.now(),
   rather than accepting the game's dt as a parameter: runner.js clamps its
   delta to 50ms (Math.min(0.05, clock.getDelta())) so physics never take a
   huge jump on a stalled tab/slow frame — correct for gameplay, but it
   means a genuinely worse stall (say, 150ms) would report as a suspiciously
   round "50.0ms" here and hide exactly the number this tool exists to show.

   Optionally call DevFPS.attachRenderer(renderer) once at startup to also
   surface Three.js's own renderer.info counters (draw calls, triangles) —
   the actual GPU submission cost per frame, not just wall-clock time. For a
   scene built from lots of small separate meshes (this project's procedural
   buildings/streetlights/lane-dashes, none of them batched or instanced),
   draw-call count is usually the real story behind a frame-time problem,
   and this is the direct, no-guessing way to see it instead of inferring it
   from FPS alone.

   Optionally sprinkle DevFPS.markStart() at the top of the main loop and
   DevFPS.mark('label') after each named phase (player update, track
   scroll/recycle, collision, animation, render, ...) to get a per-phase
   average-ms breakdown — this is what actually answers "where does the
   frame time go", since draw calls/triangles alone only show the GPU side
   and a CPU-bound bottleneck (e.g. a burst of work when a segment recycles)
   wouldn't show up there at all.

   FREEZING, FOR SCREENSHOTTING: a live overlay is hard to screenshot at the
   right moment (it's already moved on to the next window by the time you've
   alt-tabbed to a capture tool), and once gameplay stops — e.g. right after
   a crash — the play-only phases (player/scroll/recycle/collision) go
   straight to 0 because they've genuinely stopped running, which reads as
   "everything broke" rather than "the run ended." Two ways to freeze the
   exact moment you want on screen instead:
     - click the overlay any time to toggle freeze/resume yourself.
     - call DevFPS.freeze() from game code right when something notable
       happens (runner.js calls it from endGame(), so the overlay holds the
       last live in-play numbers instead of drifting into post-crash idle
       zeros).
   While frozen, tick()/mark()/markStart() are all no-ops — the canvas and
   text are left exactly as they were, nothing keeps changing underneath you
   while you screenshot.
============================================================================ */
const DevFPS = (function () {
  const params = new URLSearchParams(window.location.search);
  const enabled = params.has('debug') || params.has('fps');
  // Every method the game calls unconditionally (attachRenderer, markStart,
  // mark, tick, freeze, unfreeze) needs a no-op here — runner.js doesn't
  // guard these calls behind the debug flag itself, so a normal player
  // (no ?debug/?fps) would hit "DevFPS.whatever is not a function" and the
  // game would fail to load at all if any of these were missing.
  if (!enabled) {
    return { attachRenderer() {}, markStart() {}, mark() {}, tick() {}, freeze() {}, unfreeze() {} };
  }

  const HISTORY_SECONDS = 20;   // how far back the plot scrolls
  const MAX_FPS_AXIS = 70;      // fixed Y range (not auto-scaled) so plots
                                 // from different sessions stay comparable
  const REDRAW_INTERVAL_MS = 120; // throttled separately from sampling —
                                   // every real frame is recorded (accurate
                                   // history), the canvas just doesn't need
                                   // to repaint that often to read clearly

  const wrap = document.createElement('div');
  wrap.id = 'dev-fps';
  wrap.title = 'Click to freeze/resume — freezing stops the overlay updating so you can screenshot a specific moment.';
  wrap.style.cssText = [
    'position:fixed', 'top:8px', 'left:8px', 'z-index:9999',
    'background:rgba(0,0,0,.7)', 'color:#7CFF9E', 'font:12px/1.4 monospace',
    'padding:8px 10px', 'border-radius:6px', 'cursor:pointer', 'user-select:none',
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
  let lastTickTime = performance.now();
  let renderer = null;

  // Per-phase timing: accumulated ms per named phase across the current
  // report window, plus each phase's single worst individual sample in
  // that window (an average can hide an occasional spike the same way an
  // average FPS can — see the header's note on worst-frame vs average).
  let phaseMs = {};
  let phaseWorstMs = {};
  let phaseOrder = [];
  let lastMarkTime = null;
  let frozen = false;

  function freezeNow() {
    if (frozen) return;
    // Force an immediate draw of whatever has accumulated so far THIS
    // window, rather than leaving whatever the last throttled redraw (up to
    // REDRAW_INTERVAL_MS old) happened to show — freeze() is called right
    // at the moment something notable happens, so the snapshot should
    // reflect that moment as closely as possible.
    const now = performance.now();
    const elapsed = now - windowStart;
    const fps = elapsed > 0 ? Math.round((windowFrames * 1000) / elapsed) : 0;
    draw(now, fps, worstFrameMs);
    frozen = true;
    wrap.style.outline = '2px solid #ffcf33';
    label.textContent = '[FROZEN — click to resume]\n' + label.textContent;
  }

  function unfreezeNow() {
    if (!frozen) return;
    frozen = false;
    wrap.style.outline = 'none';
  }

  wrap.addEventListener('click', () => {
    if (frozen) unfreezeNow(); else freezeNow();
  });

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

    let text = 'FPS ' + currentFps + '  (worst frame ' + worstMsInWindow.toFixed(1) + 'ms)';
    if (renderer) {
      const info = renderer.info;
      text += '\ndraw calls ' + info.render.calls + '   triangles ' + info.render.triangles.toLocaleString();
      text += '\ngeometries ' + info.memory.geometries + '   textures ' + info.memory.textures;
    }
    if (phaseOrder.length && windowFrames > 0) {
      text += '\n--- avg ms/frame (worst) ---';
      phaseOrder.forEach((name) => {
        const avg = phaseMs[name] / windowFrames;
        text += '\n' + name + ': ' + avg.toFixed(2) + ' (' + phaseWorstMs[name].toFixed(1) + ')';
      });
    }
    label.textContent = text;
  }

  return {
    attachRenderer(r) { renderer = r; },

    // Freeze the overlay exactly as it looks right now (no further updates
    // until unfrozen, by click or by freeze()/unfreeze() again) — see the
    // header's FREEZING section. Safe to call from game code at a moment
    // worth capturing (runner.js calls this from endGame()).
    freeze: freezeNow,
    unfreeze: unfreezeNow,

    // Call at the very top of the main loop, before any per-frame work.
    markStart() {
      if (frozen) return;
      lastMarkTime = performance.now();
    },

    // Call after each named phase of the main loop. Accumulates elapsed
    // time since the previous mark()/markStart() into that phase's bucket
    // — so call these in the same order every frame, immediately after
    // each phase actually finishes.
    mark(name) {
      if (frozen || lastMarkTime === null) return;
      const now = performance.now();
      const elapsedMs = now - lastMarkTime;
      lastMarkTime = now;
      if (!(name in phaseMs)) { phaseMs[name] = 0; phaseWorstMs[name] = 0; phaseOrder.push(name); }
      phaseMs[name] += elapsedMs;
      phaseWorstMs[name] = Math.max(phaseWorstMs[name], elapsedMs);
    },

    tick() {
      if (frozen) return;
      const now = performance.now();
      const rawMs = now - lastTickTime;
      lastTickTime = now;
      const instFps = rawMs > 0 ? 1000 / rawMs : 0;
      history.push({ t: now, fps: instFps });
      const cutoff = now - HISTORY_SECONDS * 1000;
      while (history.length && history[0].t < cutoff) history.shift();

      windowFrames++;
      worstFrameMs = Math.max(worstFrameMs, rawMs);

      if (now - lastRedraw >= REDRAW_INTERVAL_MS) {
        const elapsed = now - windowStart;
        const fps = elapsed > 0 ? Math.round((windowFrames * 1000) / elapsed) : 0;
        draw(now, fps, worstFrameMs);
        lastRedraw = now;
        windowFrames = 0;
        worstFrameMs = 0;
        windowStart = now;
        phaseMs = {};
        phaseWorstMs = {};
        phaseOrder.forEach((name) => { phaseMs[name] = 0; phaseWorstMs[name] = 0; });
      }
    },
  };
})();
