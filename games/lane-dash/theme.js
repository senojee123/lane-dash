/* ============================================================================
   THEME.JS — this reskin's tuning knobs.
   ----------------------------------------------------------------------------
   Every number here is read by engine/runner.js (see its CONSTANTS section) instead
   of being hardcoded — this is the one file a new reskin edits to change how
   Lane Dash's fixed mechanics (3 lanes, jump/slide/roll, coins x multiplier)
   *feel*, without touching engine/runner.js itself. Branding/copy/colors are a
   separate concern, edited directly in this pack's own index.html.

   Values below are exactly what engine/runner.js hardcoded before this file existed —
   moving them here changes nothing about how the game plays today.
============================================================================ */
const RunnerTheme = {
  // Uniform scale for everything the player interacts with — road, lanes,
  // character, obstacles, coins. Buildings deliberately stay unscaled, so
  // raising this genuinely widens the road and enlarges the runner RELATIVE
  // to the city rather than just zooming the whole scene.
  TRACK_SCALE: 1.25,

  // Pre-scale lane centers (x, world units) — engine/runner.js multiplies these by
  // TRACK_SCALE. Must stay a 3-element array; lane math elsewhere assumes 3.
  LANE_OFFSETS: [-2.2, 0, 2.2],

  // Render resolution cap: renderer.setPixelRatio(Math.min(devicePixelRatio,
  // MAX_PIXEL_RATIO)). This is the single biggest lever on GPU render cost —
  // a high-DPI screen (most phones, retina laptops) has devicePixelRatio 2-3,
  // and rendering at the full value costs 4-9x the pixels of rendering at 1x.
  // 1.5 trades a small amount of sharpness for real GPU headroom. Deployment-
  // dependent: a dedicated jumbotron/stadium screen with more GPU to spare
  // (and where the screen is viewed from further away, hiding the softening)
  // could reasonably run this higher; a phone-first deployment could go
  // lower still.
  MAX_PIXEL_RATIO: 1.5,
  // Pre-scale road width.
  ROAD_WIDTH: 8,
  SEGMENT_LENGTH: 30,
  // How many segments exist ahead of the player at once. 7 x 30 = 210 world
  // units of loaded track — comfortably past the camera's 130-unit far
  // plane (runner.js frustum-culls anything beyond that already, so this
  // mainly cuts per-frame CPU overhead — matrix updates and culling tests
  // Three.js still runs on every loaded object even when it never actually
  // gets drawn — not the GPU draw-call cost of what's actually visible,
  // which this alone won't move much). Was 11 (330 units, ~2.5x the far
  // plane) before this pass.
  SEGMENTS_AHEAD: 7,

  // ---- chase camera framing ------------------------------------------------
  // Every number that shapes the shot lives here, in world units / degrees,
  // independent of TRACK_SCALE (the rig is tuned in absolute world units).
  // The rig is a parent Group that rides the player's z (and, subtly, x);
  // the camera is its child at a FIXED local height, back-offset and
  // downward tilt, so a jump or roll never moves the shot.
  CAMERA: {
    height: 6.5,        // above the road surface
    distance: 9.0,      // behind the runner
    tiltDeg: -16.1,     // downward pitch. Chosen with `fov` so the character's
                        // mid-body lands ~45% of the way down the lower half of
                        // frame, and the horizon stays inside the top of frame.
    fov: 60,            // vertical FOV: all three lanes clearly separated at the
                        // runner, converging naturally toward the vanishing point
    referenceAspect: 16 / 9, // the aspect ratio this whole rig was tuned against
    maxNarrowZoom: 1.9,      // cap on how far the narrow-screen dolly-back can push
    lateralFollow: 0.35, // fraction of the runner's x the rig drifts across
    lateralLag: 5,       // how fast (per second) it catches up — deliberately soft
    // A touch of pull-back and lift at speed, so fast running reads as fast.
    // Heavily smoothed and tiny; this is framing, not shake.
    speedPullback: 0.6,
    speedRise: 0.25,
    speedFovGain: 8,
    speedSettle: 2,      // per-second smoothing on the three values above
  },

  // Pre-scale gravity. Scaling gravity and jump speed together (both by
  // TRACK_SCALE, done in engine/runner.js) keeps JUMP_AIRTIME identical while making
  // the arc TRACK_SCALE times taller — so it still clears the (now taller)
  // barriers and every obstacle-spacing guarantee still holds.
  GRAVITY: -32,
  // Pre-scale jump speed. Apex = JUMP_SPEED^2 / (2*GRAVITY) = 2.33 units
  // (pre-scale). Kept as low as the obstacle set allows — a floatier arc
  // reads as a double jump. It must still clear the 1.8 tops of
  // `barrier_low`/`barrier_high`, while staying under the 3.6 of
  // `barrier_gap` and the 3.6 collision tops of the vehicles, all of which
  // are impassable by jumping.
  JUMP_SPEED: 12.2,
  SLIDE_DURATION: 1.0,  // a ground slide always lasts a full second
  ROLL_DURATION: 0.55,  // shorter duck you recover into after an air dive
  // Pre-scale downward kick applied when ducking mid-air — fast enough to
  // read as a "bullet drop" rather than just falling early.
  DIVE_SPEED: -32,
  LANE_LERP_SPEED: 12,

  // Pre-scale speeds. Speeds scale with the track so the run still covers
  // the same number of lane-widths per second — the feel is unchanged, only
  // the scale is.
  BASE_SPEED: 11,
  MAX_SPEED: 26,
  SPEED_RAMP_PER_UNIT: 0.0035, // speed gained per unit distance travelled (not track-scaled)
  DIFFICULTY_DISTANCE: 1600, // pre-scale; reach full difficulty sooner if lowered

  // ---- scoring -------------------------------------------------------------
  // Distance does NOT score directly. It raises a multiplier, one level
  // every MULT_DISTANCE travelled, and the final score is coins x
  // multiplier — so a long run is only worth something if you actually
  // picked coins up along it.
  MULT_DISTANCE: 150, // pre-scale
  MULT_MAX: 25,

  // Reaction-time budget added on top of the lane-lerp settling time — see
  // LANE_SWITCH_MIN_SECONDS in engine/runner.js for the full derivation.
  LANE_SWITCH_REACTION_TIME: 0.25,

  // ---- city wall layout ----------------------------------------------------
  // Three contiguous rows of buildings per side, in absolute world units
  // (NOT track-scaled — these are tuned against CityModels' measured sizes).
  // Each row's inner face starts at `setback` and no building may exceed
  // `maxWidth`, so rows can never overlap each other or reach the road
  // (road half-width is ROAD_WIDTH / 2).
  //
  // rooftopBillboardChance (optional, per-row): chance any given building in
  // that row also gets a billboard mounted on its roof — see spawnCityRow()
  // in engine/runner.js. Only set on row 0: it's the row nearest the road
  // (most visible) AND the shortest (height 7-16, vs 10-24/14-34 further
  // back) — the chase camera sits at height ~6.5 with a mild downward tilt,
  // so a rooftop sign only reads clearly on buildings in roughly that same
  // height range; anything much taller and it'd sit above the frame.
  //
  // openLotChance/openLotDepth (optional, per-row): real streets don't have
  // buildings packed wall-to-wall against them everywhere — occasionally
  // spawnCityRow() leaves a gap (the existing grass plane shows through,
  // reading as an open lot) instead of packing another building. Only row
  // 0: the gap between the road edge and row 0's own setback is just 1.4
  // units (6.4 - ROAD_WIDTH/2's 5) — nowhere near enough for a freestanding,
  // full-size billboard to stand in facing the road, which is exactly what
  // openLotBillboardChance/openLotBillboardSetback use these lots for: real
  // room, not a squeeze.
  CITY_ROWS: [
    {
      setback: 6.4, maxWidth: 9, height: [7, 16], detail: 'full',
      // Raised from 0.12: only 9 of the 15 "full" building models are
      // rooftopMountable now (cityModels.js MANIFEST — the other 6 have a
      // stepped/multi-mass roof that floated a billboard at some spawn
      // scale no matter how this fraction was tuned, so they're excluded
      // outright instead of patched again). Bumped so sign density stays
      // roughly where it was with the smaller eligible pool.
      rooftopBillboardChance: 0.2,
      openLotChance: 0.15,
      // Widened from [8, 14]: buildings pack edge-to-edge, so the billboard
      // (placed at the lot's own center) sits exactly depth/2 away from
      // whichever building borders the lot on either side — at depth 8 that
      // was only 4 units, tight enough for a tall row-0 building (up to 16)
      // to occlude the sightline into the lot. 20 gives up to 10 units of
      // clearance, and the wider range itself is more size variety (roughly
      // 3-8 parking-line stripes now, was a narrow 3-6).
      openLotDepth: [8, 20],
      // Chance a given open lot also gets a billboard (not every real lot
      // has one — at 0.6 that's already ~40% of lots billboard-free), and
      // how far past the row's own setback line it stands (lateral distance
      // from the road — NOT the along-the-road far-edge placement below,
      // a separate axis) — setback(6.4) + 2.5 = X=8.9. Panel half-width
      // (4.4/2 * TRACK_SCALE 1.25 = 2.75) puts its near edge at 6.15 (1.15
      // clear of the road at 5) and its far edge at 11.65 (3.85 clear of
      // row 1 at 15.5), both comfortably inside the pavement's own X range
      // (5.3-14.0) — real margin, checked by hand against all three before
      // picking this value, not a near-miss like the freestanding-in-the-
      // sidewalk-gap attempt this replaced. Was 4 (X=10.4); brought closer
      // to the road on request, re-verifying clearance rather than just
      // shrinking the number — 1.35 is the actual minimum before the panel
      // clips the road, so this keeps real margin above that floor.
      openLotBillboardChance: 0.6,
      openLotBillboardSetback: 2.5,
      // Z placement within the lot: (far edge) + this margin, so the
      // billboard sits near the end of the lot furthest from whichever
      // building the player passes right before reaching it — see the
      // comment at the placement call site (spawnCityRow, engine/runner.js)
      // for why that's the fix for occlusion rather than centering it. 2
      // units of buffer so it doesn't read as touching the NEXT building's
      // own boundary.
      openLotBillboardFarMargin: 2,
      // Every open lot (not just the ones that win openLotBillboardChance)
      // gets a paved patch + painted parking-line stripes instead of bare
      // grass — a "why is there a gap here" open lot reads as intentional
      // once it's clearly a car park, whether or not this particular one
      // has a billboard standing in it.
      //
      // Pavement spans X from (ROAD_WIDTH/2 + openLotPavementSetback) to
      // (+ openLotPavementWidth) — 5.3 to 14.0 with these numbers — checked
      // by hand: 0.3 clear of the road, 1.5 clear of row 1 (setback 15.5),
      // and it fully contains the billboard's own X position (10.4) so a
      // billboard always reads as standing IN the lot, not near it.
      openLotPavementSetback: 0.3,
      openLotPavementWidth: 8.7,
      // Spacing between painted parking-line stripes along the lot's depth,
      // and how much of the pavement's own width each stripe spans (7 of
      // the 8.7 total, leaving a small margin so lines don't touch the
      // pavement's own edge).
      openLotLineSpacing: 2.5,
      openLotLineWidth: 7,
      // Minimum world-unit distance spawnCityRow() must cover (in buildings
      // or other lots) before it'll roll for another open lot — without
      // this, nothing stops two or three lots (each independently a 0.15
      // chance) landing back-to-back with no buildings between them, which
      // is exactly what happened before this field existed. 18 is a couple
      // of buildings' worth of separation (typical row-0 building width is
      // roughly 2-5 units — see the rooftop billboard width guard in
      // runner.js for the actual numbers this is based on).
      openLotMinGap: 18,
      // Block rhythm: no lot before 2 buildings since the last one, one
      // forced (bypassing openLotChance's coin flip, but still gated by
      // openLotMinGap above) once 4 buildings have gone by — without this
      // a long run of buildings could go by with nothing but bad luck on
      // the 0.15 roll, reading as "too close together" with no layout
      // pattern. 2-4 buildings per block, same rhythm on all three rows —
      // see spawnCityRow (engine/runner.js) for how blockMin/blockMax and
      // openLotMinGap combine.
      blockMin: 2,
      blockMax: 4,
      // Minimum world-unit distance (buildings, since rooftop signs are
      // building-mounted) since the last rooftop sign before another can
      // roll — buildings pack edge-to-edge with zero gap, so without this
      // two neighbors could each independently win rooftopBillboardChance
      // and end up sharing a wall, reading as squeezed together. Same fix
      // as openLotMinGap, for the building-mounted placement path instead
      // of the open-lot one.
      //
      // A smaller "banner" format (mounted on a building's face, for
      // buildings too narrow for the rooftop panel) was tried and dropped —
      // cramming a sign into whatever tiny space a narrow building offered
      // read as cluttered rather than clean, even after fixing its spacing.
      // Only full-size panels with real, deliberately-chosen room (rooftop
      // here, freestanding in open lots below) are worth placing.
      signMinGap: 14,
    },
    // Rows 1/2 previously had no open-lot config at all — 100% wall-to-wall
    // buildings, the biggest single contributor to the "too packed, no
    // layout" feel since they're the two furthest-back (tallest, most
    // visible) rows. Same block-rhythm mechanism as row 0, reusing
    // addParkingLot's exact code path, but deliberately lighter for a
    // background row: no billboards (openLotBillboardChance omitted —
    // sponsor ad inventory stays in row 0, where it's actually readable)
    // and no painted parking-line stripes (openLotLineSpacing omitted —
    // addParkingLot's line loop is a no-op without it, see its own
    // comment), just flat pavement, cheaper than a building at the same
    // spot rather than more expensive.
    //
    // openLotPavementSetback is picked so the pavement's near edge lands
    // exactly on this row's OWN setback (ROAD_WIDTH/2 (5) +
    // openLotPavementSetback = setback) — i.e. a lot fills exactly the
    // X-band this row's buildings would otherwise occupy, never reaching
    // into the row in front of or behind it. openLotPavementWidth stays
    // just under maxWidth (same margin pattern as row 0's 8.7-under-9), so
    // the far edge of the widest lot still clears the next row's own near
    // edge: row 1's pavement reaches to 15.5+10.5=26.0, row 2 starts at
    // 27.5 (1.5 clear); row 2's pavement reaches to 27.5+14.5=42.0, nothing
    // beyond it.
    {
      setback: 15.5, maxWidth: 11, height: [10, 24], detail: 'low',
      openLotChance: 0.15, openLotDepth: [10, 22],
      openLotMinGap: 20, blockMin: 2, blockMax: 4,
      openLotPavementSetback: 10.5, openLotPavementWidth: 10.5,
    },
    {
      setback: 27.5, maxWidth: 15, height: [14, 34], detail: 'low',
      openLotChance: 0.15, openLotDepth: [12, 26],
      openLotMinGap: 24, blockMin: 2, blockMax: 4,
      openLotPavementSetback: 22.5, openLotPavementWidth: 14.5,
    },
  ],

  // AssetRegistry keys for the pieces of scenery the track generator places
  // itself (as opposed to CityModels' building manifest). A reskin that
  // renames/replaces these primitives in its own assets.js only needs to
  // update the keys here — engine/runner.js never hardcodes them.
  SCENERY_KEYS: {
    streetlight: 'streetlight',
    laneDash: 'lane_dash',
    billboard: 'billboard',
    parkingLot: 'parking_lot',
  },

  // Distance between streetlights (pre-scale — engine/runner.js multiplies
  // by TRACK_SCALE). Placed deterministically, alternating sides, keyed off
  // absolute distance the same way rooftop/open-lot billboards are — was
  // previously `11 + Math.random()*5` with a random side each time, which
  // could clump two on the same side back to back.
  // 24 = half as many as the original ~12-16 average spacing: each
  // streetlight is 5 separate meshes (pole/arm/lamp/cone/pool), and with
  // SEGMENTS_AHEAD=11 segments loaded at once this was one of the largest
  // single contributors to draw-call count alongside buildings.
  STREETLIGHT_INTERVAL: 24,

  // ---- billboards ------------------------------------------------------
  // WHICH images/videos actually show is sponsor content, see billboards.js
  // (RunnerBillboards) — this is sizing only. WHERE billboards get placed
  // is CITY_ROWS[0]'s rooftopBillboardChance (on individual buildings) and
  // openLotChance/openLotBillboardChance (in gaps between buildings) above
  // — only where there's real, deliberately-chosen room. There's no
  // freestanding/interval-based billboard placement (an earlier version
  // tried that; the road-to-building gap is only 1.4 units, nowhere near
  // enough room for a full-size panel standing on its own) and no smaller
  // building-facade "banner" format either (also tried; cramming a sign
  // into whatever tiny space a narrow building offered read as cluttered,
  // not clean — see CITY_ROWS[0]'s comment).
  //
  // `panelWidth`/`panelHeight` (world units, pre-scale) size BOTH the actual
  // 3D panel (buildBillboard() in assets.js) and the aspect ratio
  // billboard-media.js composites image creatives into — the two files stay
  // in sync only because both read these same numbers, never their own
  // hardcoded copies. `backingColor` fills the panel behind a "contain"-fit
  // image (see billboard-media.js) so a logo — square, portrait, whatever
  // its native shape — sits centered and undistorted instead of being
  // stretched to fill a wide rectangle; default white suits a dark logo,
  // flip it dark for a light-colored one.
  BILLBOARD: {
    panelWidth: 4.4,
    panelHeight: 2.6,
    backingColor: 0xffffff,
  },

  // ---- breather stretches ---------------------------------------------------
  // Every REST_INTERVAL of track, obstacles stop for REST_LENGTH so the run
  // has a rhythm instead of unbroken pressure. Kept deliberately SHORT
  // relative to the interval — a breather is a couple of seconds of open
  // road with a coin trail, not a stretch of nothing. Both pre-scale.
  REST_INTERVAL: 800,
  REST_LENGTH: 80,

  // Small buffer kept between two vehicles' visual edges in the same row, so
  // adjacent ones read as clearly distinct rather than touching bumper-to-
  // bumper even at the moment they'd otherwise just barely clear each other.
  PILEUP_VISUAL_GAP: 0.15,

  // Lane divider dash length/gap (world units, not track-scaled).
  LANE_DASH_LENGTH: 1.6,
  LANE_DASH_GAP: 1.6,

  // ---- obstacle classes -----------------------------------------------------
  // Every barrier AssetRegistry key the track generator can place, grouped
  // by how the player has to get past it: JUMP over jumpOnly, ROLL under
  // rollOnly, EITHER works for `either`. engine/runner.js picks a class by
  // weight, then a random key from within that class (each class holds one
  // key today, but a reskin can list several — a wider bench of jump-only
  // obstacles, say — without engine/runner.js changing at all). Weights are
  // relative, not required to sum to 1.
  OBSTACLE_KEYS: {
    jumpOnly: { keys: ['barrier_low'], weight: 0.38 },   // solid to the ground — must jump
    either: { keys: ['barrier_high'], weight: 0.34 },    // beam — jump OR roll
    rollOnly: { keys: ['barrier_gap'], weight: 0.28 },   // wall with a gap underneath — must roll
  },

  // ---- obstacle row mix -----------------------------------------------------
  // Chance bands for what a given row of the track becomes, each
  // `base + difficulty * slope` (difficulty ramps 0..1 over
  // DIFFICULTY_DISTANCE). Rebalanced so late-run (difficulty -> 1) leans
  // into MIXED rows rather than pure vehicle chains — a long run was
  // spending most of its rows on back-to-back vehicle pileups, crowding out
  // barriers almost entirely right when the run should be showing its
  // fullest variety. Vehicle/barrier chances barely grow with difficulty;
  // mixed absorbs almost all of the extra pressure instead, so late-game
  // stays dense but keeps reading as "vehicles AND barriers" rather than
  // "vehicles, occasionally." If the three bands sum past 0.95 at full
  // difficulty, engine/runner.js normalizes them proportionally (always
  // leaving at least 5% of rolls for a plain clear/coin row) — so these can
  // be tuned independently without needing to keep the sum in mind.
  //
  // vehicleChance requires a TrafficVehicles module (TrafficVehicles.pick/
  // .KEYS) to be loaded; if this pack doesn't define one, engine/runner.js
  // forces vehicleChance to 0 regardless of what's set here.
  ROW_MIX: {
    vehicleBase: 0.40, vehicleSlope: 0.08,
    barrierBase: 0.34, barrierSlope: 0.06,
    mixedBase: 0.18, mixedSlope: 0.22,
  },
};
