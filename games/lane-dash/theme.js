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
  // Pre-scale road width.
  ROAD_WIDTH: 8,
  SEGMENT_LENGTH: 30,
  SEGMENTS_AHEAD: 11, // how many segments exist ahead of the player at once

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
  CITY_ROWS: [
    { setback: 6.4, maxWidth: 9, height: [7, 16], detail: 'full' },
    { setback: 15.5, maxWidth: 11, height: [10, 24], detail: 'low' },
    { setback: 27.5, maxWidth: 15, height: [14, 34], detail: 'low' },
  ],

  // AssetRegistry keys for the pieces of scenery the track generator places
  // itself (as opposed to CityModels' building manifest). A reskin that
  // renames/replaces these primitives in its own assets.js only needs to
  // update the keys here — engine/runner.js never hardcodes them.
  SCENERY_KEYS: {
    streetlight: 'streetlight',
    laneDash: 'lane_dash',
    billboard: 'billboard',
  },

  // ---- billboards ------------------------------------------------------
  // WHICH images/videos actually show is sponsor content, see billboards.js
  // (RunnerBillboards) — this is placement/sizing only. One billboard slot
  // is placed every `interval` of track (pre-scale, like REST_INTERVAL —
  // engine/runner.js multiplies by TRACK_SCALE), alternating sides, keyed
  // off absolute distance (not per-segment randomness) so a slot lands
  // exactly once regardless of where segment-recycling boundaries happen to
  // fall — same technique as the breather-stretch cadence above. At 40
  // (pre-scale) the first billboard lands around the 50-unit mark, roughly
  // 3-4 seconds into a run — tuned to be found quickly, not just eventually.
  //
  // `setback` is a FLAT offset beyond ROAD_WIDTH/2, deliberately NOT
  // multiplied by TRACK_SCALE — same convention as the streetlight's own
  // hardcoded 0.7 in engine/runner.js's spawnScenery(). It has to stay
  // comfortably under CITY_ROWS[0].setback (6.4, itself unscaled) or the
  // panel ends up planted inside the first building row; 1.0 puts it just
  // past the streetlights' own 5.7 band with room to spare.
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
    interval: 40,
    setback: 1.0,
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
