/* ============================================================================
   RUNNER.JS — ENGINE (generic, shared by every content pack).
   Scene setup, input, player state machine, track generation, collision,
   scoring/UI, the game state machine, and the main loop — everything that
   defines Lane Dash's fixed genre mechanics (3 lanes, jump/slide/roll,
   coins x multiplier scoring). Nothing in here is specific to one reskin:
   every mesh comes from AssetRegistry/MeshPool (assets.js +
   engine/asset-registry.js, never inline geometry), every tunable number
   comes from RunnerTheme (this pack's theme.js), and the two places genre
   mechanics touch content identity — which AssetRegistry keys are
   jump-only/either/roll-only, and whether a vehicle module exists at all —
   go through RunnerTheme.OBSTACLE_KEYS and the HAS_VEHICLES duck-type check
   below rather than hardcoded key names.

   To build a new reskin: copy games/lane-dash/ as a template and replace its
   assets/ + assets.js/cityModels.js/trafficVehicles.js/character.js/theme.js
   — this file does not need to change. See engine/README.md.
============================================================================ */

// ---------------------------------------------------------------------------
// PLAYER IDENTITY — captured from the name field folded into the existing
// start screen (see #username-input in index.html). `isGameStarted` tracks
// whether a name has ever been submitted this session; it is NOT what gates
// the render loop — Game.state (below) already does that job precisely,
// including keeping the idle scene rendering behind the start/pause/game-over
// overlays. A second hard gate on the animation loop would fight that and
// blank the canvas instead.
// ---------------------------------------------------------------------------
let playerCurrentName = 'Player';
let isGameStarted = false;

// ---------------------------------------------------------------------------
// CONSTANTS
// ---------------------------------------------------------------------------
// Every base tunable below lives in theme.js (RunnerTheme) — this section
// only derives the values gameplay code actually needs from it. See
// theme.js for what each knob means and why it's set the way it is; this
// file is where reskinning stops being about numbers and starts being
// about mechanics.
const TRACK_SCALE = RunnerTheme.TRACK_SCALE;

const LANES = RunnerTheme.LANE_OFFSETS.map((x) => x * TRACK_SCALE);
const ROAD_WIDTH = RunnerTheme.ROAD_WIDTH * TRACK_SCALE;
const SEGMENT_LENGTH = RunnerTheme.SEGMENT_LENGTH;
const SEGMENTS_AHEAD = RunnerTheme.SEGMENTS_AHEAD; // how many segments exist ahead of the player at once
// A segment's contents span [origin - SEGMENT_LENGTH, origin], so the origin
// must travel a full segment length PAST the camera before the segment is
// safe to recycle — otherwise its far end is still on screen when it's
// reused, which reads as scenery popping out of existence mid-view.
const CAMERA = RunnerTheme.CAMERA;
// On a narrow/portrait screen, a fixed FOV keeps the same angular view but the
// aspect ratio crops it down to a much narrower horizontal slice — the road
// reads as "zoomed in", which is exactly what pushes mobile players to
// pinch-zoom the whole page out instead (that just scales the HUD/canvas as a
// bitmap and looks squashed/blurry, not fixed). Dollying the camera straight
// back along its existing look direction widens the world-space slice visible
// at the runner's depth with NO fov/tilt change, so there's no fisheye and no
// page-level zoom needed — the shot is simply framed wider on narrow screens.
function cameraNarrowZoom(aspect) {
  if (aspect >= CAMERA.referenceAspect) return 1;
  return Math.min(CAMERA.maxNarrowZoom, CAMERA.referenceAspect / aspect);
}
const RECYCLE_Z = SEGMENT_LENGTH + CAMERA.distance * CAMERA.maxNarrowZoom + 6;

// Scaling gravity and jump speed together (both by TRACK_SCALE) keeps
// JUMP_AIRTIME identical while making the arc TRACK_SCALE times taller — so
// it still clears the (now taller) barriers and every obstacle-spacing
// guarantee below still holds. See theme.js for the pre-scale values and why
// they're set where they are.
const GRAVITY = RunnerTheme.GRAVITY * TRACK_SCALE;
const JUMP_SPEED = RunnerTheme.JUMP_SPEED * TRACK_SCALE;
const SLIDE_DURATION = RunnerTheme.SLIDE_DURATION;
const ROLL_DURATION = RunnerTheme.ROLL_DURATION;
const DIVE_SPEED = RunnerTheme.DIVE_SPEED * TRACK_SCALE;
const LANE_LERP_SPEED = RunnerTheme.LANE_LERP_SPEED;
const BASE_SPEED = RunnerTheme.BASE_SPEED * TRACK_SCALE;
const MAX_SPEED = RunnerTheme.MAX_SPEED * TRACK_SCALE;
const SPEED_RAMP_PER_UNIT = RunnerTheme.SPEED_RAMP_PER_UNIT;
const DIFFICULTY_DISTANCE = RunnerTheme.DIFFICULTY_DISTANCE * TRACK_SCALE;

// ---- scoring -------------------------------------------------------------
// Distance does NOT score directly. It raises a multiplier, one level every
// MULT_DISTANCE travelled, and the final score is coins x multiplier — so a
// long run is only worth something if you actually picked coins up along it.
const MULT_DISTANCE = RunnerTheme.MULT_DISTANCE * TRACK_SCALE;
const MULT_MAX = RunnerTheme.MULT_MAX;

// Total airtime of a jump — obstacle spacing uses this so the player is
// always back on the ground before the next row arrives.
const JUMP_AIRTIME = (2 * JUMP_SPEED) / -GRAVITY; // ~0.72s

// Minimum time a vehicle-blocking row (pileup or mixed-with-a-vehicle) must
// reserve before the next row, so a lane switch is always physically
// completable — not just theoretically, if the player reacts instantly.
// playerState.x approaches its target exponentially (see LANE_LERP_SPEED
// above), so how long that takes to settle is INDEPENDENT of how many lanes
// away the target is — crossing 2 lanes (the pileup worst case: 1 open lane
// out of 3) settles in the same time as crossing 1, provided both inputs
// land before the first one's target is reached. ln(100)/LANE_LERP_SPEED is
// the time to close 99% of the remaining distance; LANE_SWITCH_REACTION_TIME
// on top of that is the budget for the player to actually notice the row and
// press the key(s) at all, which the lerp settling time alone doesn't cover.
const LANE_SWITCH_REACTION_TIME = RunnerTheme.LANE_SWITCH_REACTION_TIME;
const LANE_SWITCH_MIN_SECONDS = Math.log(100) / LANE_LERP_SPEED + LANE_SWITCH_REACTION_TIME; // ~0.63s

// ---- city wall layout ----------------------------------------------------
// Three contiguous rows of buildings per side. Each row's inner face starts
// at `setback` and no building may exceed `maxWidth`, so rows can never
// overlap each other or reach the road (road half-width is ROAD_WIDTH / 2).
const CITY_ROWS = RunnerTheme.CITY_ROWS;

// ---------------------------------------------------------------------------
// RENDERER / SCENE / CAMERA
// ---------------------------------------------------------------------------
const canvas = document.getElementById('game-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, RunnerTheme.MAX_PIXEL_RATIO));
renderer.setSize(window.innerWidth, window.innerHeight);
if (THREE.sRGBEncoding) renderer.outputEncoding = THREE.sRGBEncoding;
DevFPS.attachRenderer(renderer); // no-op unless ?debug/?fps — see engine/dev-fps.js

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8fd3ff);
scene.fog = new THREE.Fog(0x8fd3ff, 20, 78);

// far plane sits just past the fog end so the dense city rows beyond it are
// frustum-culled rather than drawn into solid fog
const camera = new THREE.PerspectiveCamera(CAMERA.fov, window.innerWidth / window.innerHeight, 0.1, 130);

// CAMERA RIG. `cameraRig` is the only thing that moves during play: it tracks
// the runner's z (plus a subtle fraction of their x). The camera itself is
// parked in the rig's local space and never re-aimed — no lookAt() anywhere in
// the loop — which is what keeps the shot rock-steady through jumps and rolls.
const cameraRig = new THREE.Group();
cameraRig.add(camera);
let cameraZoom = cameraNarrowZoom(window.innerWidth / window.innerHeight);
camera.position.set(0, CAMERA.height * cameraZoom, CAMERA.distance * cameraZoom);
camera.rotation.order = 'YXZ';
camera.rotation.x = CAMERA.tiltDeg * Math.PI / 180;
scene.add(cameraRig);

// EXPOSURE: these intensities are tuned against `outputEncoding = sRGBEncoding`
// (set on the renderer above). sRGB output lifts mid-tones hard, so the
// pre-sRGB values of 0.95/0.9 pushed a combined ~1.85 through the encode and
// clipped roughly a quarter of the frame to pure white — which read as the
// building atlas textures looking bleached and detail-free. Keeping the total
// near ~1.45 preserves the bright cartoony look without blowing the textures.
const hemi = new THREE.HemisphereLight(0xffffff, 0x6b6b6b, 0.75);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff3d6, 0.7);
sun.position.set(-6, 12, 6);
scene.add(sun);

function handleViewportResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  cameraZoom = cameraNarrowZoom(camera.aspect);
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', handleViewportResize);
// iOS Safari fires 'orientationchange' before innerWidth/innerHeight settle to
// their new post-rotation values, and 'resize' doesn't reliably follow it on
// every device — so re-run the same handler once next tick and again after
// the rotation animation finishes, rather than relying on 'resize' alone.
window.addEventListener('orientationchange', () => {
  handleViewportResize();
  setTimeout(handleViewportResize, 300);
});

// ---------------------------------------------------------------------------
// STATIC GROUND (wide strip, doesn't need to scroll since it's featureless)
// ---------------------------------------------------------------------------
{
  const roadGeo = new THREE.PlaneGeometry(ROAD_WIDTH, 400);
  const road = new THREE.Mesh(roadGeo, Mat.road);
  road.rotation.x = -Math.PI / 2;
  road.position.set(0, 0, -150);
  scene.add(road);

  const sideGeo = new THREE.PlaneGeometry(40, 400);
  const grassL = new THREE.Mesh(sideGeo, Mat.grass);
  grassL.rotation.x = -Math.PI / 2;
  grassL.position.set(-24, -0.02, -150);
  scene.add(grassL);
  const grassR = grassL.clone();
  grassR.position.x = 24;
  scene.add(grassR);

  // Solid edge lines marking the road/shoulder boundary. Unlike the dashed
  // lane dividers (which scroll with the segments to sell speed), these can
  // be one continuous static strip the same length as the road plane itself
  // — an edge line doesn't need to visibly move to read correctly.
  const edgeGeo = new THREE.PlaneGeometry(0.16, 400);
  const edgeL = new THREE.Mesh(edgeGeo, Mat.roadLine);
  edgeL.rotation.x = -Math.PI / 2;
  edgeL.position.set(-ROAD_WIDTH / 2 + 0.1, 0.012, -150);
  scene.add(edgeL);
  const edgeR = edgeL.clone();
  edgeR.position.x = ROAD_WIDTH / 2 - 0.1;
  scene.add(edgeR);
}

// ---------------------------------------------------------------------------
// PLAYER
// ---------------------------------------------------------------------------
// `player` is the RIG: a bare container that owns position/lean/track-scale.
// Its visual child is swappable — the procedural box character to start with,
// replaced by the Mixamo Ch09 rig once character.js finishes loading.
// Keeping them separate means the state machine below never cares which is in.
const player = new THREE.Group();
player.position.set(0, 0, 0);
player.scale.setScalar(TRACK_SCALE);
scene.add(player);

const placeholderBody = AssetRegistry.create('player');
player.add(placeholderBody);
const playerParts = placeholderBody.userData.parts;

// Swap in the real character when it lands (falls back silently if it fails).
const characterLoadPromise = Character.init({ targetHeight: AssetRegistry.player.footprint.height }).then(() => {
  if (Character.isActive()) {
    player.remove(placeholderBody);
    player.add(Character.root);
  }
});

const playerState = {
  lane: 1,
  x: 0,
  targetX: 0,
  y: 0,
  velY: 0,
  prevX: 0,          // position at the start of the frame — collision sweeps
  prevY: 0,          // from here so nothing can be crossed untested
  isJumping: false,
  isSliding: false,
  slideTimer: 0,
  isDiving: false,   // mid-air, slamming down after a duck input
  isRolling: false,  // the tumble on landing from a dive
  rollTimer: 0,
  distance: 0,
  runPhase: 0,
  alive: true,
};

// Slide and roll both put the character low to the ground — the two states
// that duck under a high beam and that coins should meet at waist height.
function isLowProfile() {
  return playerState.isSliding || playerState.isRolling;
}

function resetPlayer() {
  playerState.lane = 1;
  playerState.x = 0;
  playerState.targetX = 0;
  playerState.y = 0;
  playerState.prevX = 0;
  playerState.prevY = 0;
  playerState.velY = 0;
  playerState.isJumping = false;
  playerState.isSliding = false;
  playerState.slideTimer = 0;
  playerState.isDiving = false;
  playerState.isRolling = false;
  playerState.rollTimer = 0;
  playerState.distance = 0;
  playerState.runPhase = 0;
  playerState.alive = true;
  player.position.set(0, 0, 0);
  player.rotation.set(0, 0, 0);
  player.scale.setScalar(TRACK_SCALE);
}

// Footprint of a track-scale asset (player, obstacle, coin). Buildings are
// deliberately NOT run through this — they keep their own measured size.
function trackFootprint(key) {
  const f = AssetRegistry[key].footprint;
  return {
    width: f.width * TRACK_SCALE,
    height: f.height * TRACK_SCALE,
    depth: f.depth * TRACK_SCALE,
    yBase: f.yBase * TRACK_SCALE,
  };
}

// The player's box for this frame, SWEPT from where the body was at the start
// of the frame. Vertical sweep is what matters most: a mid-air dive falls at
// 40 u/s, which on a slow frame is 2 units — enough to pass clean through a
// 1-unit-tall beam between samples and read on screen as running through it.
function playerAABB() {
  const fp = trackFootprint('player');
  const height = isLowProfile() ? fp.height * 0.5 : fp.height;
  const x0 = Math.min(playerState.x, playerState.prevX);
  const x1 = Math.max(playerState.x, playerState.prevX);
  const y0 = Math.min(playerState.y, playerState.prevY);
  const y1 = Math.max(playerState.y, playerState.prevY);
  return {
    minX: x0 - fp.width / 2,
    maxX: x1 + fp.width / 2,
    minY: y0,
    maxY: y1 + height,
    minZ: -fp.depth / 2,
    maxZ: fp.depth / 2,
  };
}

function aabbIntersect(a, b) {
  return a.minX < b.maxX && a.maxX > b.minX &&
         a.minY < b.maxY && a.maxY > b.minY &&
         a.minZ < b.maxZ && a.maxZ > b.minZ;
}

// ---------------------------------------------------------------------------
// INPUT
// ---------------------------------------------------------------------------
function tryLaneChange(dir) {
  if (!playerState.alive || Game.state !== 'playing') return;
  const next = playerState.lane + dir;
  if (next < 0 || next > 2) return;
  playerState.lane = next;
  playerState.targetX = LANES[next];
}

function tryJump() {
  if (!playerState.alive || Game.state !== 'playing') return;
  // jumping cancels a ground slide or roll so the controls stay responsive
  if (playerState.isSliding) { playerState.isSliding = false; playerState.slideTimer = 0; }
  if (playerState.isRolling) { playerState.isRolling = false; playerState.rollTimer = 0; }
  if (!playerState.isJumping) {
    playerState.isJumping = true;
    playerState.velY = JUMP_SPEED;
  }
}

function trySlide() {
  if (!playerState.alive || Game.state !== 'playing') return;

  // Mid-air: bullet down instead of sliding. The dive itself is just a hard
  // downward velocity; the roll is entered on impact (see updatePlayer).
  if (playerState.isJumping) {
    if (!playerState.isDiving) {
      playerState.isDiving = true;
      playerState.velY = DIVE_SPEED;
    }
    return;
  }

  if (isLowProfile()) return; // already low — don't restart the timer
  playerState.isSliding = true;
  playerState.slideTimer = SLIDE_DURATION;
}

window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyP') { togglePause(); return; }
  switch (e.code) {
    case 'ArrowLeft': case 'KeyA': tryLaneChange(-1); break;
    case 'ArrowRight': case 'KeyD': tryLaneChange(1); break;
    case 'ArrowUp': case 'KeyW': case 'Space': tryJump(); e.preventDefault(); break;
    case 'ArrowDown': case 'KeyS': trySlide(); break;
  }
  // Deliberately no "any key starts the run" fallback here — the only way to
  // start is the Start button (see tryStartFromNameEntry below). Typing a
  // name into #username-input dispatches keydown events too, and this used
  // to treat every one of those keystrokes as "press any key to start,"
  // launching the run before a name was even entered.
});

// Touch/swipe input lives in engine/touch-controls.js (loaded after this
// file), which
// calls tryLaneChange/tryJump/trySlide directly — the same functions the
// keydown handler above uses — so keyboard and touch stay two front-ends
// over one action layer, never two parallel gameplay implementations.

// ---------------------------------------------------------------------------
// TRACK / SEGMENT GENERATION
// ---------------------------------------------------------------------------
const segments = [];
let difficulty = 0; // 0..1 ramps with score
let carryGap = 0;   // spacing owed by the previous segment to the next one

function makeSegmentSlot() {
  const group = new THREE.Group();
  scene.add(group);
  return { group, obstacles: [], coins: [], scenery: [] };
}

for (let i = 0; i < SEGMENTS_AHEAD; i++) segments.push(makeSegmentSlot());

function clearSegment(seg) {
  seg.obstacles.forEach((o) => MeshPool.release(o.mesh));
  seg.coins.forEach((c) => MeshPool.release(c.mesh));
  seg.scenery.forEach((s) => MeshPool.release(s));
  seg.obstacles.length = 0;
  seg.coins.length = 0;
  seg.scenery.length = 0;
}

function addObstacle(seg, key, lane, localZ, footprintOverride) {
  const mesh = MeshPool.acquire(key);
  mesh.position.set(LANES[lane], 0, localZ);
  // Absolute set, not a relative multiply: MeshPool hands back the SAME mesh
  // instance across many acquire/release cycles as segments recycle all
  // game long, so multiplying TRACK_SCALE onto whatever scale is already
  // there would compound a little more every time that instance got reused
  // (confirmed directly: it grew ~25% larger on every recycle in testing).
  // AssetRegistry[key].meshScaleMultiplier is each asset's own EXTRA factor
  // on top of TRACK_SCALE — 1 for plain primitives (barriers), or a vehicle's
  // lane-fit-normalization x CAR_VISUAL_SCALE (see trafficVehicles.js) — so
  // this always resets to the exact correct absolute scale regardless of
  // whatever the mesh's scale happened to be from its previous use.
  const extraScale = AssetRegistry[key].meshScaleMultiplier || 1;
  mesh.scale.setScalar(TRACK_SCALE * extraScale);
  seg.group.add(mesh);
  const record = { mesh, key, lane, localZ, footprint: footprintOverride || trackFootprint(key) };
  seg.obstacles.push(record);
  return record;
}

// Small buffer kept between two vehicles' visual edges in the same row, so
// adjacent ones read as clearly distinct rather than touching bumper-to-
// bumper even at the moment they'd otherwise just barely clear each other.
const PILEUP_VISUAL_GAP = RunnerTheme.PILEUP_VISUAL_GAP;

// Vehicles sit at FIXED lane-center X positions (LANES[lane]) as far as
// collision is concerned — checkCollisions reads o.lane, never mesh.position.x
// — so nudging a mesh sideways here is purely cosmetic and has zero effect on
// hitboxes or dodgeability. That's what makes this safe: a lane is only
// LANES[1]-LANES[0] wide, but CAR_VISUAL_SCALE can still render a vehicle
// wider than that (trucks/vans especially), so two vehicles in ADJACENT
// lanes in the same row can visually intersect even though their hitboxes
// (computed independently, from HITBOX_SCALE_FACTOR) never do. A pileup/mixed
// row always leaves at least one lane open, so at most 2 of the 3 lanes ever
// hold a vehicle at once — meaning at most ONE adjacent pair needs checking,
// never a vehicle sandwiched between two occupied neighbors.
function spaceRowVehiclesVisually(rowVehicles) {
  if (rowVehicles.length < 2) return;
  rowVehicles.sort((a, b) => a.lane - b.lane);
  for (let i = 0; i < rowVehicles.length - 1; i++) {
    const a = rowVehicles[i];
    const b = rowVehicles[i + 1];
    if (b.lane - a.lane !== 1) continue; // not adjacent lanes — plenty of room regardless
    const widthA = AssetRegistry[a.key].footprint.visualWidth * TRACK_SCALE;
    const widthB = AssetRegistry[b.key].footprint.visualWidth * TRACK_SCALE;
    const laneGap = LANES[b.lane] - LANES[a.lane];
    const neededGap = (widthA + widthB) / 2 + PILEUP_VISUAL_GAP;
    if (neededGap > laneGap) {
      const shortfall = neededGap - laneGap;
      a.mesh.position.x -= shortfall / 2;
      b.mesh.position.x += shortfall / 2;
    }
  }
}

function addCoin(seg, lane, localZ, height) {
  const mesh = MeshPool.acquire('coin');
  const y = height * TRACK_SCALE;
  mesh.position.set(LANES[lane], y, localZ);
  mesh.scale.setScalar(TRACK_SCALE);
  seg.group.add(mesh);
  seg.coins.push({ mesh, lane, localZ, height: y, collected: false });
}

function addScenery(seg, key, x, localZ, scaleMul, rotY, variant, depthSquash) {
  const mesh = MeshPool.acquire(key);
  mesh.position.set(x, 0, localZ);
  const s = scaleMul || 1;
  mesh.scale.set(s, s, s * (depthSquash || 1));
  mesh.rotation.y = rotY || 0;
  if (variant) applyCityModelVariant(mesh, variant);
  seg.group.add(mesh);
  seg.scenery.push(mesh);
}

// Fills one row on one side with buildings packed edge-to-edge along z.
// Each building advances the cursor by exactly its own scaled depth, so the
// row reads as a solid city block with no gaps. The last building in a
// segment is squashed on z alone (never on x/y, which would notch the wall)
// so rows tile seamlessly across segment boundaries.
// A rooftop billboard needs a building at least this wide, or the panel
// (built at a fixed RunnerTheme.BILLBOARD.panelWidth regardless of which
// building it lands on) overhangs the sides — confirmed visually, not just
// on paper: row-0 buildings range roughly 2.3-5.3 units wide across their
// own height range (7-16), which is frequently narrower than the panel's
// own 5.5-unit rendered width. 1.1x margin so it sits comfortably inside
// the roofline rather than exactly at the edge.
const ROOFTOP_BILLBOARD_MIN_WIDTH = RunnerTheme.BILLBOARD.panelWidth * TRACK_SCALE * 1.1;

function spawnCityRow(seg, side, row) {
  const keys = row.detail === 'full' ? CityModels.FULL_BUILDING_KEYS : CityModels.LOW_BUILDING_KEYS;
  if (!keys.length) return;

  let z = 0;
  // World-unit distance covered (by buildings or other lots) since the last
  // open lot, so consecutive lots can't land back-to-back with nothing
  // between them — every independent 0.15-chance roll was otherwise free to
  // hit two or three times in a row. Starts large so a lot is allowed near
  // a segment's own start. Doesn't carry across segment boundaries (each
  // segment's row is generated independently) — a rarer residual case than
  // the within-segment back-to-back one this actually fixes.
  let distanceSinceLastLot = Infinity;

  while (z > -SEGMENT_LENGTH + 0.05) {
    // Open lot: occasionally leave a gap instead of packing another
    // building — real streets aren't wall-to-wall buildings everywhere.
    // The existing grass plane shows through, reading as an open field, and
    // (row.openLotBillboardChance permitting) it's real room for a
    // freestanding, full-size billboard — unlike the 1.4-unit gap between
    // the road and row 0's own building line, which is nowhere near enough
    // (see theme.js's CITY_ROWS[0] comment for the numbers this is built
    // from). Rolled here, before the building pick, so it competes fairly
    // with "place a building" at every packing decision.
    if (row.openLotChance && distanceSinceLastLot >= (row.openLotMinGap || 0) && Math.random() < row.openLotChance) {
      const remaining = z + SEGMENT_LENGTH;
      const rawLotDepth = row.openLotDepth[0] + Math.random() * (row.openLotDepth[1] - row.openLotDepth[0]);
      const lotDepth = Math.min(rawLotDepth, remaining);
      if (row.openLotBillboardChance && Math.random() < row.openLotBillboardChance) {
        const lotZ = z - lotDepth / 2;
        const billboardX = side * (row.setback + row.openLotBillboardSetback);
        const creative = HAS_BILLBOARD_CREATIVES ? randChoice(RunnerBillboards) : null;
        addBillboard(seg, SCENERY_KEYS.billboard, billboardX, lotZ, creative);
      }
      z -= lotDepth;
      distanceSinceLastLot = 0;
      continue;
    }

    const key = randChoice(keys);
    const fp = AssetRegistry[key].footprint;

    // Scale to a target height, but clamp so a wide model can never grow
    // past this row's maxWidth and spill into the row (or road) in front.
    const targetH = row.height[0] + Math.random() * (row.height[1] - row.height[0]);
    const s = Math.min(targetH / fp.height, row.maxWidth / fp.width);

    const width = fp.width * s;
    let depth = fp.depth * s;

    const remaining = z + SEGMENT_LENGTH;
    let squash = 1;
    if (depth > remaining) { squash = remaining / depth; depth = remaining; }

    // only 0 / 180 degree turns, so depth stays aligned to z and the row stays tight
    const rotY = Math.random() < 0.5 ? 0 : Math.PI;
    const buildingX = side * (row.setback + width / 2);
    const buildingZ = z - depth / 2;
    addScenery(seg, key, buildingX, buildingZ, s, rotY,
               randChoice(CityModels.VARIANT_KEYS), squash);

    // Rooftop billboard, occasional — row.rooftopBillboardChance is only set
    // on the row(s) short enough to still read from the chase camera (see
    // theme.js's CITY_ROWS comment). Deliberately NOT tied to the building's
    // own random rotY (that's just cosmetic building-facing variety) — the
    // billboard gets a fixed rotation (always 0, see addBillboard()), same
    // as every other billboard in the game: its face is built along Z (see
    // buildBillboard() in assets.js), which is the direction the camera
    // actually approaches from, so no left/right flip is needed regardless
    // of which side of the road the building is on.
    // Two guards, confirmed necessary from an actual screenshot, not just
    // reasoned about: squash > 0.6 skips a building squashed to a near-
    // invisible sliver at a segment boundary (tall enough to host a sign,
    // but rendered too thin to actually see under it); width >=
    // ROOFTOP_BILLBOARD_MIN_WIDTH skips a building narrower than the panel
    // itself, which otherwise overhangs the roofline on both sides — this
    // is the one actually seen floating in the screenshot.
    //
    // A building too narrow for the rooftop panel gets a shot at the
    // smaller face-mounted banner instead (bannerChance) — an independent
    // roll, not a fallback only reached when the rooftop roll fails, so a
    // wide building that didn't win the rooftop chance can still get a
    // banner too. The banner needs no width check of its own (see
    // theme.js's BILLBOARD.bannerWidth comment for why) and is positioned
    // at the building's own road-facing wall (side * (row.setback - 0.1))
    // rather than its center — every building in a row shares that exact
    // wall X by construction (center = setback + width/2, so inner edge is
    // always exactly setback), so this is correct regardless of how wide
    // the specific building turned out to be.
    if (squash > 0.6 && row.rooftopBillboardChance && width >= ROOFTOP_BILLBOARD_MIN_WIDTH
        && Math.random() < row.rooftopBillboardChance) {
      const creative = HAS_BILLBOARD_CREATIVES ? randChoice(RunnerBillboards) : null;
      addBillboard(seg, SCENERY_KEYS.billboard, buildingX, buildingZ, creative, fp.height * s);
    } else if (squash > 0.6 && row.bannerChance && Math.random() < row.bannerChance) {
      const creative = HAS_BILLBOARD_CREATIVES ? randChoice(RunnerBillboards) : null;
      const bannerX = side * (row.setback - 0.1);
      const bannerY = Math.min(fp.height * s * 0.55, 4.5);
      const bannerAspect = RunnerTheme.BILLBOARD.bannerWidth / RunnerTheme.BILLBOARD.bannerHeight;
      addBillboard(seg, SCENERY_KEYS.billboardBanner, bannerX, buildingZ, creative, bannerY, bannerAspect);
    }

    z -= depth;
    distanceSinceLastLot += depth;
  }
}

// The two divider lines sit exactly on the midpoints between adjacent lane
// centres, so they visually separate lane 0|1 and 1|2 regardless of TRACK_SCALE.
const LANE_DIVIDER_X = [(LANES[0] + LANES[1]) / 2, (LANES[1] + LANES[2]) / 2];
const LANE_DASH_LENGTH = RunnerTheme.LANE_DASH_LENGTH;
const LANE_DASH_GAP = RunnerTheme.LANE_DASH_GAP;
const LANE_DASH_PERIOD = LANE_DASH_LENGTH + LANE_DASH_GAP;

const SCENERY_KEYS = RunnerTheme.SCENERY_KEYS;

// ---------------------------------------------------------------------------
// BILLBOARDS — ad slots exist on individual buildings (rooftop, via
// spawnCityRow below) and in open lots between them (also spawnCityRow) —
// see theme.js's CITY_ROWS[0] comment for why there's no freestanding/
// interval-based placement. RunnerBillboards (billboards.js) is optional
// and only decides what's ON a given slot.
// ---------------------------------------------------------------------------
const HAS_BILLBOARD_CREATIVES = typeof RunnerBillboards !== 'undefined' && RunnerBillboards.length > 0;

// `key` picks the asset (SCENERY_KEYS.billboard for the full-size panel,
// .billboardBanner for the narrow face-mounted one) and `aspect` (optional)
// overrides which surface shape BillboardMedia composites the creative
// against — defaults to the main panel's own aspect if omitted, so existing
// billboard call sites don't need to pass it. Rotation is always 0 (faces
// +Z, see buildBillboard()'s header) for every placement, so it's set here
// rather than taken as a parameter — nothing left to vary it by.
function addBillboard(seg, key, x, localZ, creative, y, aspect) {
  const mesh = MeshPool.acquire(key);
  mesh.position.set(x, y || 0, localZ);
  mesh.scale.setScalar(TRACK_SCALE);
  mesh.rotation.y = 0;
  // Reassigned on every placement (pooled instances keep whatever texture
  // they last showed otherwise) — mirrors how addObstacle resets scale on
  // every reacquire rather than trusting the pool's leftover state.
  const panel = mesh.userData.panel;
  if (panel) {
    panel.material.map = BillboardMedia.getTexture(creative, aspect);
    panel.material.needsUpdate = true;
  }
  seg.group.add(mesh);
  seg.scenery.push(mesh);
}

const STREETLIGHT_INTERVAL = RunnerTheme.STREETLIGHT_INTERVAL * TRACK_SCALE;

// Same absolute-distance-keyed placement as isRestStretch below — exactly
// one streetlight lands per STREETLIGHT_INTERVAL regardless of where
// segment-recycling boundaries fall, alternating sides deterministically by
// index parity rather than a per-spawn coin flip (which could clump two on
// the same side back to back, and reset its own pattern at every segment
// boundary since each segment's old loop ran independently).
function spawnStreetlights(seg) {
  const segmentBase = -seg.group.position.z;
  const startIdx = Math.ceil(segmentBase / STREETLIGHT_INTERVAL);
  const endIdx = Math.ceil((segmentBase + SEGMENT_LENGTH) / STREETLIGHT_INTERVAL);
  for (let idx = startIdx; idx < endIdx; idx++) {
    const targetDistance = idx * STREETLIGHT_INTERVAL;
    const localZ = segmentBase - targetDistance;
    const side = (idx % 2 === 0) ? -1 : 1;
    // The lamp arm extends along +X in the model's own space, so it has to be
    // turned to face the road centre: poles on the RIGHT (+x) need a 180deg
    // flip, poles on the LEFT (-x) need none.
    addScenery(seg, SCENERY_KEYS.streetlight, side * (ROAD_WIDTH / 2 + 0.7), localZ, TRACK_SCALE, side < 0 ? 0 : Math.PI);
  }
}

function spawnLaneLines(seg) {
  for (const x of LANE_DIVIDER_X) {
    for (let z = -LANE_DASH_PERIOD / 2; z > -SEGMENT_LENGTH; z -= LANE_DASH_PERIOD) {
      addScenery(seg, SCENERY_KEYS.laneDash, x, z, 1);
    }
  }
}

function spawnScenery(seg) {
  spawnLaneLines(seg);
  for (const row of CITY_ROWS) {
    spawnCityRow(seg, -1, row);
    spawnCityRow(seg, 1, row);
  }
  spawnStreetlights(seg);
}

function spawnCoinLine(seg, lane, startLocalZ, count, height) {
  for (let i = 0; i < count; i++) {
    addCoin(seg, lane, startLocalZ - i * 1.15 * TRACK_SCALE, height);
  }
}

// ---- breather stretches ---------------------------------------------------
// Every REST_INTERVAL of track, obstacles stop for REST_LENGTH so the run has
// a rhythm instead of unbroken pressure. Kept deliberately SHORT relative to
// the interval — a breather is a couple of seconds of open road with a coin
// trail, not a stretch of nothing. Scenery is never paused (see below).
const REST_INTERVAL = RunnerTheme.REST_INTERVAL * TRACK_SCALE;
const REST_LENGTH = RunnerTheme.REST_LENGTH * TRACK_SCALE;

function isRestStretch(layoutDistance) {
  // no breather before the first interval — the run opens with real obstacles
  if (layoutDistance < REST_INTERVAL) return false;
  return (layoutDistance % REST_INTERVAL) < REST_LENGTH;
}

// ---------------------------------------------------------------------------
// BARRIER SELECTION — content-agnostic. Picks a class (jump-only / either /
// roll-only) by weight from RunnerTheme.OBSTACLE_KEYS, then a random key from
// within that class, so this pack's actual key names never appear here.
// Returns which of the two gameplay-relevant classes the pick belongs to
// (each mutually exclusive: 'either' triggers neither) so callers don't need
// to know or compare against literal key strings.
// ---------------------------------------------------------------------------
const OBSTACLE_KEYS = RunnerTheme.OBSTACLE_KEYS;
const OBSTACLE_CLASS_NAMES = Object.keys(OBSTACLE_KEYS);

// A content pack's vehicle module is optional — TrafficVehicles.pick()/.KEYS
// is the same duck-typed contract trafficVehicles.js implements today; a
// reskin can ship its own, or skip vehicles entirely and let vehicleChance
// fall to 0 below rather than crash on a missing global.
const HAS_VEHICLES = typeof TrafficVehicles !== 'undefined'
  && Array.isArray(TrafficVehicles.KEYS) && TrafficVehicles.KEYS.length > 0;

function pickBarrierKey() {
  let total = 0;
  for (const name of OBSTACLE_CLASS_NAMES) total += OBSTACLE_KEYS[name].weight;
  let roll = Math.random() * total;
  let cls = OBSTACLE_KEYS[OBSTACLE_CLASS_NAMES[OBSTACLE_CLASS_NAMES.length - 1]];
  let clsName = OBSTACLE_CLASS_NAMES[OBSTACLE_CLASS_NAMES.length - 1];
  for (const name of OBSTACLE_CLASS_NAMES) {
    roll -= OBSTACLE_KEYS[name].weight;
    if (roll <= 0) { cls = OBSTACLE_KEYS[name]; clsName = name; break; }
  }
  return {
    key: randChoice(cls.keys),
    forcesJump: clsName === 'jumpOnly',
    forcesRoll: clsName === 'rollOnly',
  };
}

// Fills one segment's obstacle/coin rows. `startGapZ` lets us skip
// generating right at the very front of the first ever segment.
function populateSegment(seg, startGapZ) {
  // Scenery is laid out for EVERY segment unconditionally, breather stretches
  // included — the city wall must never break, or the world reads as ending.
  spawnScenery(seg);

  // Absolute distance along the track that this segment covers. Segment
  // origins march steadily negative as the run goes on, so negating the origin
  // gives a monotonic layout cursor that survives recycling and resets with
  // the track on restart.
  const segmentBase = -seg.group.position.z;

  // Spacing owed from the previous segment's final row is carried across the
  // boundary. Without this, every segment restarted its cursor 8 units in and
  // could drop a row on top of a jump the player was still in the middle of.
  let localZ = -Math.max(startGapZ, carryGap, 8);
  const endZ = -(SEGMENT_LENGTH - 2);
  let pileupChain = 0; // remaining vehicle rows to chain as a pileup
  let pileupOpenLane = 1;
  let lastVehicleKey = null; // last model spawned, so the next pick can avoid it

  while (localZ > endZ) {
    // ---- breather stretch: a short obstacle-free run of coins ----
    if (isRestStretch(segmentBase - localZ)) {
      spawnCoinLine(seg, (Math.random() * 3) | 0, localZ, 5 + ((Math.random() * 4) | 0), 1.0);
      localZ -= 8;
      pileupChain = 0; // never resume a pileup on the far side of a rest
      continue;
    }

    const roll = Math.random();
    // Base/slope for each band lives in theme.js (RunnerTheme.ROW_MIX) — see
    // its comment for why they're weighted the way they are.
    const mix = RunnerTheme.ROW_MIX;
    let vehicleChance = HAS_VEHICLES ? mix.vehicleBase + difficulty * mix.vehicleSlope : 0;
    let barrierChance = mix.barrierBase + difficulty * mix.barrierSlope;
    let mixedChance = mix.mixedBase + difficulty * mix.mixedSlope;
    // These three are compared against a single `roll` as stacked bands
    // (below), so if their sum exceeds 1 the last band in the chain gets
    // silently clipped down to whatever sliver is left under 1.0 — which is
    // exactly what was happening here (they summed to 1.28 at difficulty 1,
    // crushing mixedChance's real share from an intended 0.40 down to an
    // effective 0.12). Normalizing keeps each band's PROPORTION intact no
    // matter how the constants above get tuned later, and always leaves at
    // least 5% of rolls for a plain clear/coin row.
    const bandSum = vehicleChance + barrierChance + mixedChance;
    if (bandSum > 0.95) {
      const scale = 0.95 / bandSum;
      vehicleChance *= scale;
      barrierChance *= scale;
      mixedChance *= scale;
    }
    let forcedJump = false; // did this row require leaving the ground?
    let forcedRoll = false; // did this row require going low?
    let requiresLaneSwitch = false; // did this row put a vehicle in some lane?
    let rowDepth = 0;       // longest obstacle in this row, for spacing

    if (pileupChain > 0 || roll < vehicleChance) {
      // ---- vehicle row: exactly one lane stays open ----
      if (pileupChain <= 0) {
        pileupOpenLane = (Math.random() * 3) | 0;
        // Capped shorter and grows slower with difficulty than before — an
        // uncapped chain at high difficulty could run 2-4 vehicle rows deep
        // back to back, which (combined with vehicleChance above) turned
        // late-game into long vehicle-only stretches with barriers rarely
        // getting a turn. +0..2 keeps pileups feeling chained without letting
        // them swallow the row budget mixedChance is now relying on.
        pileupChain = (Math.random() < 0.35 + difficulty * 0.25) ? 1 + ((Math.random() * 2) | 0) : 1;
      } else if (Math.random() < 0.5) {
        // occasionally shift the open lane by one for a chained-switch pileup
        const shift = Math.random() < 0.5 ? -1 : 1;
        pileupOpenLane = Math.min(2, Math.max(0, pileupOpenLane + shift));
      }

      // Weighted pick per blocked lane, threading the previous key through so
      // a pileup doesn't stack two identical models side by side or in a chain.
      requiresLaneSwitch = true;
      const pileupVehicles = [];
      for (let lane = 0; lane < 3; lane++) {
        if (lane === pileupOpenLane) continue;
        lastVehicleKey = TrafficVehicles.pick(lastVehicleKey);
        const placed = addObstacle(seg, lastVehicleKey, lane, localZ);
        pileupVehicles.push(placed);
        // Vehicles vary in length, so the next row has to clear the LONGEST
        // one placed here or a chained pileup would telescope into itself.
        rowDepth = Math.max(rowDepth, trackFootprint(lastVehicleKey).depth);
      }
      spaceRowVehiclesVisually(pileupVehicles);
      // coins guiding the player into the open lane, just ahead of the row
      if (Math.random() < 0.7) spawnCoinLine(seg, pileupOpenLane, localZ + 3.5, 3, 1.0);

      pileupChain--;
    } else if (roll < vehicleChance + barrierChance) {
      // ---- barrier row: independent per lane, always passable ----
      // jump-only barriers must be jumped, roll-only must be rolled under;
      // "either" (jump or roll) never dictates the next row's spacing.
      for (let lane = 0; lane < 3; lane++) {
        if (Math.random() < 0.20) continue;
        const pick = pickBarrierKey();
        addObstacle(seg, pick.key, lane, localZ);
        if (pick.forcesJump) {
          forcedJump = true;
          if (Math.random() < 0.5) {
            // reward arc of coins above the hurdle for jumping it
            // strung along the jump arc itself (measured chest height while
            // clearing this wall is ~2.4-3.1), not just above the 1.8 rail —
            // otherwise a well-timed jump sails clean over the reward.
            spawnCoinLine(seg, lane, localZ + 0.6, 3, 2.9);
          }
        } else if (pick.forcesRoll) {
          forcedRoll = true;
        }
      }
    } else if (roll < vehicleChance + barrierChance + mixedChance) {
      // ---- mixed row: one guaranteed-open lane, the other two each
      // independently a vehicle OR a barrier. This is the row type that
      // actually varies the READ from one row to the next — pure vehicle
      // rows and pure barrier rows each fall into their own rhythm, but a
      // vehicle in one lane next to a roll-only wall in another forces the
      // player to parse two different obstacle languages at once.
      const openLane = (Math.random() * 3) | 0;
      const mixedVehicles = [];
      for (let lane = 0; lane < 3; lane++) {
        if (lane === openLane) continue;
        if (HAS_VEHICLES && Math.random() < 0.5) {
          lastVehicleKey = TrafficVehicles.pick(lastVehicleKey);
          mixedVehicles.push(addObstacle(seg, lastVehicleKey, lane, localZ));
          rowDepth = Math.max(rowDepth, trackFootprint(lastVehicleKey).depth);
          requiresLaneSwitch = true;
        } else {
          const pick = pickBarrierKey();
          addObstacle(seg, pick.key, lane, localZ);
          if (pick.forcesJump) forcedJump = true;
          else if (pick.forcesRoll) forcedRoll = true;
        }
      }
      spaceRowVehiclesVisually(mixedVehicles);
      if (Math.random() < 0.7) spawnCoinLine(seg, openLane, localZ + 3.2, 3, 1.0);
    } else {
      // ---- clear row with a coin line ----
      const lane = (Math.random() * 3) | 0;
      spawnCoinLine(seg, lane, localZ, 4 + ((Math.random() * 3) | 0), 1.0);
    }

    // Advance by REACTION TIME rather than a fixed distance, so rows stay
    // equally readable as the run speeds up (and get denser as difficulty
    // ramps). A row that forces a jump reserves a full airtime of clearance,
    // guaranteeing the player lands before the next row can reach them.
    // 0.85s of reaction time at the start, tightening to 0.53s once the run is
    // fully ramped. Below ~0.5s a row stops being readable at max speed, so
    // that is the floor this is tuned against.
    let gapSeconds = 0.85 - difficulty * 0.32;
    if (forcedJump) gapSeconds = Math.max(gapSeconds, JUMP_AIRTIME + 0.18);
    // A roll is locked in for its full duration, so the next row can't arrive
    // until the player is upright again.
    if (forcedRoll) gapSeconds = Math.max(gapSeconds, SLIDE_DURATION + 0.2);
    // A vehicle in any lane means a lane switch is the ONLY way past it —
    // and a pileup's shape (2 lanes blocked, 1 open, out of 3 total) means
    // the open lane can be up to 2 lanes away from wherever the player
    // already is. This floor is what actually guarantees that's reachable
    // in time, rather than assuming the baseline above happens to cover it —
    // at full difficulty (0.53s) it doesn't quite, on its own.
    if (requiresLaneSwitch) gapSeconds = Math.max(gapSeconds, LANE_SWITCH_MIN_SECONDS);
    // Floor the step at this row's own length plus a car-length of daylight,
    // so bigger vehicles push the next row back instead of overlapping it.
    const minGap = Math.max(6.5, rowDepth + 1.5);
    localZ -= Math.max(minGap, Game.speed * gapSeconds);
  }

  // Whatever spacing ran off the end of this segment is owed to the next one.
  carryGap = Math.max(0, -localZ - SEGMENT_LENGTH);
}

function recycleSegmentIfNeeded() {
  for (const seg of segments) {
    if (seg.group.position.z > RECYCLE_Z) {
      // Anchor the recycled segment exactly SEGMENT_LENGTH behind wherever the
      // rest of the track ACTUALLY is right now, rather than a separately
      // maintained counter. Every segment (this one included, still at its
      // old position at this instant) advances by the same moveDelta every
      // frame in tick(), but the old `nextSpawnZ` counter only ever moved when
      // a recycle happened — it never got that same per-frame advance. So it
      // silently fell further and further behind the real, scrolling track
      // the longer a run went on, and every recycle baked in however much
      // drift had built up since the last one: a real, growing gap between
      // the newly recycled segment and the one in front of it. This segment
      // currently holds the FRONT-most position (it's the one crossing
      // RECYCLE_Z), so the minimum z over the other 10 is exactly the current
      // back of the queue — self-correcting every time, with no drift to
      // accumulate in the first place.
      const backZ = Math.min(...segments.filter((s) => s !== seg).map((s) => s.group.position.z));
      const newZ = backZ - SEGMENT_LENGTH;

      clearSegment(seg);
      seg.group.position.z = newZ;
      // populateSegment is randomized and runs continuously for as long as a
      // run lasts, so it WILL eventually hit a one-in-a-million edge case. A
      // bare scenery-only segment (still continuous city/road, just no
      // obstacles that lap) is far better than losing this recycle entirely,
      // so failure falls back to that instead of leaving the segment empty.
      try {
        populateSegment(seg, 0);
      } catch (err) {
        console.error('[populateSegment] failed, spawning scenery-only segment as a fallback', err);
        clearSegment(seg);
        carryGap = 0;
        try { spawnScenery(seg); } catch (err2) { console.error('[spawnScenery] fallback also failed', err2); }
      }
    }
  }
}

function initTrack() {
  carryGap = 0;
  let z = 0;
  segments.forEach((seg, i) => {
    clearSegment(seg);
    seg.group.position.z = z;
    populateSegment(seg, i === 0 ? SEGMENT_LENGTH : 0);
    z -= SEGMENT_LENGTH;
  });
}

// ---------------------------------------------------------------------------
// PARTICLES (coin burst) — small pooled sprite-like meshes
// ---------------------------------------------------------------------------
const PARTICLE_COUNT = 24;
const particles = [];
const particleMat = new THREE.MeshBasicMaterial({ color: Palette.gold });
for (let i = 0; i < PARTICLE_COUNT; i++) {
  const m = new THREE.Mesh(Geo.box, particleMat);
  m.scale.set(0.08, 0.08, 0.08);
  m.visible = false;
  scene.add(m);
  particles.push({ mesh: m, vel: new THREE.Vector3(), life: 0 });
}
let particleCursor = 0;

function burstParticles(pos) {
  for (let i = 0; i < 10; i++) {
    const p = particles[particleCursor];
    particleCursor = (particleCursor + 1) % PARTICLE_COUNT;
    p.mesh.position.copy(pos);
    p.mesh.visible = true;
    p.vel.set((Math.random() - 0.5) * 4, Math.random() * 4 + 1, (Math.random() - 0.5) * 4);
    p.life = 0.5;
  }
}

function updateParticles(dt) {
  for (const p of particles) {
    if (p.life <= 0) continue;
    p.life -= dt;
    if (p.life <= 0) { p.mesh.visible = false; continue; }
    p.vel.y += GRAVITY * 0.35 * dt;
    p.mesh.position.addScaledVector(p.vel, dt);
    const s = Math.max(0, p.life / 0.5) * 0.08;
    p.mesh.scale.set(s, s, s);
  }
}

// ---------------------------------------------------------------------------
// SCREEN JUICE: shake, flash, speed-lines
// ---------------------------------------------------------------------------
let shakeTime = 0, shakeMag = 0;
function triggerShake(mag, duration) { shakeTime = duration; shakeMag = mag; }

// A directional shake — a decaying LEFT-RIGHT wobble on the camera rig's X
// only, rather than the omnidirectional random jitter above. Used for the
// side-bounce off an obstacle, where the screen reading as "shoved sideways"
// matters more than a generic impact rattle.
let lateralShakeTime = 0, lateralShakeMag = 0, lateralShakeElapsed = 0;
const LATERAL_SHAKE_FREQ = 46; // radians/sec — slower swings read as bigger, sharper ones read as buzzy
function triggerLateralShake(mag, duration) {
  lateralShakeTime = duration;
  lateralShakeMag = mag;
  lateralShakeElapsed = 0;
}

const flashEl = document.getElementById('flash-overlay');
function triggerFlash() {
  flashEl.style.opacity = '0.55';
  setTimeout(() => { flashEl.style.opacity = '0'; }, 90);
}
const speedlinesEl = document.getElementById('speedlines');

// ---------------------------------------------------------------------------
// GAME STATE / SCORE / UI
// ---------------------------------------------------------------------------
// The only thing that persists between runs is the all-time best score —
// coins are scored within a run, not banked.
const Save = {
  high: parseInt(localStorage.getItem('laneDashHighScore') || '0', 10),
  persist() {
    localStorage.setItem('laneDashHighScore', String(this.high));
  },
};
// leftovers from the removed upgrade shop
['laneDashBank', 'laneDashSpeedLvl', 'laneDashMultLvl'].forEach((k) => localStorage.removeItem(k));

// Multiplier level earned by surviving: 1x at the start, +1 every
// MULT_DISTANCE, capped so a very long run can't run away with it.
function multiplierFor(distance) {
  return Math.min(MULT_MAX, 1 + Math.floor(distance / MULT_DISTANCE));
}

const Game = {
  state: 'start', // 'start' | 'playing' | 'paused' | 'gameover'
  speed: BASE_SPEED,
  score: 0,
  coins: 0,
  multiplier: 1,
};

const hud = document.getElementById('hud');
const hudScore = document.getElementById('hud-score');
const hudHigh = document.getElementById('hud-high');
const hudCoins = document.getElementById('hud-coins');
const startScreen = document.getElementById('start-screen');
const gameoverScreen = document.getElementById('gameover-screen');
const goScore = document.getElementById('go-score');
const goCoins = document.getElementById('go-coins');
const goHigh = document.getElementById('go-high');

const hudMult = document.getElementById('hud-mult');

const pauseScreen = document.getElementById('pause-screen');
const pauseScoreEl = document.getElementById('pause-score');
const pauseCoinsEl = document.getElementById('pause-coins');

// ---------------------------------------------------------------------------
// BRAND CONFIG — sponsor-controlled labels/color (brand.js), applied once
// here at startup. Kept as its own function, not inlined, so a future
// hot-reload handler can call it again after mutating RunnerBrand's fields
// without needing to know anything else about init — see brand.js's header.
// ---------------------------------------------------------------------------
const bankLineText = document.getElementById('bank-line-text');
const pauseLineLabel = document.getElementById('pause-line-label');

function applyBrandConfig() {
  const collectible = RunnerBrand.collectibleLabel.toLowerCase();
  const score = RunnerBrand.scoreLabel.toLowerCase();
  if (bankLineText) {
    bankLineText.textContent = collectible + ' × distance ' + RunnerBrand.multiplierLabel + ' = ' + score;
  }
  if (pauseLineLabel) pauseLineLabel.textContent = RunnerBrand.scoreLabel;
  // In-game 3D coin mesh (Mat.gold/Mat.coinFace, assets.js) follows the same
  // color as the HTML HUD dot unless a reskin's Palette.gold was already
  // tuned to match — this just makes sure a brand-set color actually
  // reaches the 3D mesh too.
  document.documentElement.style.setProperty(
    '--rd-collectible-color', '#' + RunnerBrand.collectibleColor.toString(16).padStart(6, '0')
  );
  if (typeof Mat !== 'undefined' && Mat.gold) Mat.gold.color.setHex(RunnerBrand.collectibleColor);
  if (typeof Mat !== 'undefined' && Mat.coinFace) {
    Mat.coinFace.color.setHex(RunnerBrand.collectibleColor);
    // Square aspect (1) since the coin face reads as a circular medallion,
    // not a wide billboard panel; backing = collectibleColor so a
    // transparent-background logo blends into the coin rather than showing
    // a mismatched letterbox rectangle. null clears back to the plain color.
    Mat.coinFace.map = RunnerBrand.collectibleImageUrl
      ? BillboardMedia.getImageTexture(RunnerBrand.collectibleImageUrl, 1, RunnerBrand.collectibleColor)
      : null;
    Mat.coinFace.needsUpdate = true;
  }
  hudHigh.textContent = RunnerBrand.bestLabel + ': ' + Save.high;
}
applyBrandConfig();

// The very first start requires a name (folded into the existing start
// screen rather than a separate gate — see the PLAYER IDENTITY block up
// top). Restarting after a run reuses whatever name was already entered, so
// it doesn't re-prompt. Also persisted to localStorage (same key-naming
// convention as Save.high above) so a RETURNING visitor — a fresh page load,
// not just a same-session restart — doesn't have to retype it.
const PLAYER_NAME_STORAGE_KEY = 'laneDashPlayerName';
const usernameInput = document.getElementById('username-input');
const savedPlayerName = localStorage.getItem(PLAYER_NAME_STORAGE_KEY);
if (savedPlayerName) usernameInput.value = savedPlayerName;

function tryStartFromNameEntry() {
  const name = usernameInput.value.trim();
  if (!name) {
    alert('Please enter a name to start the run.');
    return;
  }
  playerCurrentName = name;
  isGameStarted = true;
  localStorage.setItem(PLAYER_NAME_STORAGE_KEY, name);
  startGame();
}

// Starting is deliberately ONLY through this button now — no "tap anywhere
// on the canvas" or "press any key" shortcut, on desktop or mobile, so a name
// always gets entered (and validated) before a run can begin.
document.getElementById('start-btn').addEventListener('click', tryStartFromNameEntry);
// RESTART reuses whatever name is already in playerCurrentName/the input,
// unchanged — same run loop as before, scores keep accumulating under the
// same identity. MAIN MENU is the other way back in: it returns to the
// start screen with the name field still showing (and still editable)
// whatever was last typed there, so the player can tweak it — or not — and
// go through the normal validated tryStartFromNameEntry() path again rather
// than skipping straight back into a run.
document.getElementById('restart-btn').addEventListener('click', startGame);

function goToMainMenu() {
  Game.state = 'start';
  gameoverScreen.classList.add('hidden');
  startScreen.classList.remove('hidden');
}

document.getElementById('gameover-menu-btn').addEventListener('click', goToMainMenu);

// ---------------------------------------------------------------------------
// PAUSE
// ---------------------------------------------------------------------------
// A dedicated state rather than a flag layered onto 'playing': every other
// system already switches behaviour off of Game.state (HUD, camera idle
// drift, the tick() loop below), so pausing this way means nothing keeps
// running in the background by accident.
function pauseGame() {
  if (Game.state !== 'playing') return;
  Game.state = 'paused';
  pauseScoreEl.textContent = Math.floor(Game.score);
  pauseCoinsEl.textContent = Game.coins + ' ' + RunnerBrand.collectibleLabel.toLowerCase() + ' × ' + Game.multiplier;
  pauseScreen.classList.remove('hidden');
}

function resumeGame() {
  if (Game.state !== 'paused') return;
  Game.state = 'playing';
  pauseScreen.classList.add('hidden');
  // No delta-catch-up handling needed here: tick() drains clock.getDelta()
  // every animation frame regardless of pause state, so time spent paused
  // never accumulates into a single giant jump on resume.
}

function togglePause() {
  if (Game.state === 'playing') pauseGame();
  else if (Game.state === 'paused') resumeGame();
}

document.getElementById('pause-resume-btn').addEventListener('click', resumeGame);
document.getElementById('pause-end-btn').addEventListener('click', () => {
  pauseScreen.classList.add('hidden');
  endGame();
});

// On-screen pause button — the only way to pause on a touch device, since
// the P key obviously isn't there. Lives in the HUD corner, out of the way
// of the swipe gestures engine/touch-controls.js reads off the canvas.
document.getElementById('hud-pause-btn').addEventListener('click', togglePause);

function startGame() {
  if (Game.state === 'playing') return;
  Game.state = 'playing';
  Game.speed = BASE_SPEED;
  Game.score = 0;
  Game.coins = 0;
  Game.multiplier = 1;
  resetPlayer();
  initTrack();
  startScreen.classList.add('hidden');
  gameoverScreen.classList.add('hidden');
  hud.style.display = 'flex';
}

function endGame() {
  Game.state = 'gameover';
  const finalScore = Math.floor(Game.score);
  const isNew = finalScore > Save.high;
  if (isNew) Save.high = finalScore;
  Save.persist();

  // Fire-and-forget — submitScore (engine/leaderboard-client.js) is async and never
  // throws back into this function, so the game-over screen below renders
  // immediately regardless of how long (or whether) the network call takes.
  submitScore(playerCurrentName, finalScore);

  goScore.textContent = finalScore;
  // show the sum, so the coins x multiplier rule is obvious
  goCoins.innerHTML = Game.coins + ' ' + RunnerBrand.collectibleLabel.toLowerCase()
    + ' &nbsp;&times;&nbsp; ' + Game.multiplier + ' ' + RunnerBrand.multiplierLabel;
  goHigh.innerHTML = isNew ? '<span class="new-high">NEW BEST!</span>' : (RunnerBrand.bestLabel + ': ' + Save.high);
  gameoverScreen.classList.remove('hidden');
  hud.style.display = 'none';
  triggerShake(0.35, 0.4);
  triggerFlash();
}

function updateHUD() {
  hudScore.textContent = Math.floor(Game.score);
  hudCoins.textContent = Game.coins;
  hudMult.textContent = 'x' + Game.multiplier;
  hudHigh.textContent = RunnerBrand.bestLabel + ': ' + Save.high;
}

// ---------------------------------------------------------------------------
// COLLISION CHECK
// ---------------------------------------------------------------------------
// Only a HEAD-ON hit ends the run. "Head-on" means the body was genuinely in
// the obstacle's path when they met — it has to overlap by a real fraction of
// its OWN width and its OWN height. Every shallower contact is a graze: the
// sole of a shoe scuffing the top of a wall at the peak of a jump, a shoulder
// catching a corner mid-lane-change, hair brushing the underside of a beam.
// Those are survivable.
//
// The fractions are taken against the player's extent rather than the
// obstacle's, so they mean the same thing for a knee-high hurdle and a bus.
// They differ per axis because the two grazes are different sizes: clipping a
// ledge is a shoe-deep scuff, while being half a body into a lane is squarely
// in the way of whatever is coming down it.
const FATAL_OVERLAP_X = 0.5;  // half a body width into the lane
const FATAL_OVERLAP_Y = 0.2;  // ~ankle-deep through the top of a wall

function contactKind(pBox, oBox) {
  const fp = trackFootprint('player');
  const overlapX = Math.min(pBox.maxX, oBox.maxX) - Math.max(pBox.minX, oBox.minX);
  const overlapY = Math.min(pBox.maxY, oBox.maxY) - Math.max(pBox.minY, oBox.minY);
  const deepX = overlapX >= fp.width * FATAL_OVERLAP_X;
  const deepY = overlapY >= fp.height * FATAL_OVERLAP_Y;
  if (deepX && deepY) return 'fatal';
  return deepX ? 'graze-vertical' : 'graze-side';
}

// Scuff over/under the edge instead of dying. The jump arc is left intact —
// the runner is only lifted out of the overlap, not bounced or stopped.
function skimClear(oBox) {
  const fp = trackFootprint('player');
  const playerMid = playerState.y + fp.height / 2;
  if (playerMid > (oBox.minY + oBox.maxY) / 2) {
    playerState.y = oBox.maxY;
    playerState.prevY = playerState.y;
    player.position.y = playerState.y;
  }
  triggerShake(0.08, 0.12);
}

// Shove the runner clear of the obstacle and back toward the lane they came
// from. Deliberately not a death, not a speed penalty — just a nudge.
function bounceOff(oBox) {
  const fp = trackFootprint('player');
  const obstacleCentreX = (oBox.minX + oBox.maxX) / 2;
  const dir = playerState.x >= obstacleCentreX ? 1 : -1;
  const edge = dir > 0 ? oBox.maxX : oBox.minX;

  // out of the overlap, with a hair of clearance so the next frame is clean
  playerState.x = edge + dir * (fp.width / 2 + 0.02);
  playerState.prevX = playerState.x; // don't sweep across the shove itself

  // retarget the nearest lane on the side we were pushed toward
  let lane = playerState.lane;
  while (lane > 0 && LANES[lane] > playerState.x && dir < 0) lane--;
  while (lane < LANES.length - 1 && LANES[lane] < playerState.x && dir > 0) lane++;
  playerState.lane = lane;
  playerState.targetX = LANES[lane];

  triggerLateralShake(0.85, 0.32);
}

// `moveDelta` is how far the world advanced this frame. Obstacles are tested
// against the whole interval they SWEPT through, not just their final
// position — at 26 u/s a single frame can carry a thin barrier clean past
// the player's 0.7-unit depth, which would otherwise register as no hit.
function checkCollisions(moveDelta) {
  const pBox = playerAABB();
  for (const seg of segments) {
    const segZ = seg.group.position.z;
    // Quick reject. A segment's contents live in [segZ - SEGMENT_LENGTH, segZ],
    // so a segment whose ORIGIN is far behind the player can still hold
    // obstacles right on top of them — rejecting on the origin alone let the
    // player run straight through those.
    if (segZ < -10 || segZ > SEGMENT_LENGTH + 10) continue;

    for (const o of seg.obstacles) {
      const worldZ = segZ + o.localZ;
      if (worldZ < -8 || worldZ > 8) continue;
      const fp = o.footprint;
      const laneX = LANES[o.lane];
      const oBox = {
        minX: laneX - fp.width / 2, maxX: laneX + fp.width / 2,
        minY: fp.yBase, maxY: fp.yBase + fp.height,
        // swept: extend backwards to where this obstacle sat last frame
        minZ: worldZ - fp.depth / 2 - moveDelta, maxZ: worldZ + fp.depth / 2,
      };
      if (aabbIntersect(pBox, oBox)) {
        const kind = contactKind(pBox, oBox);
        if (kind === 'graze-side') { bounceOff(oBox); continue; }
        if (kind === 'graze-vertical') { skimClear(oBox); continue; }
        return true; // head-on
      }
    }

    for (const c of seg.coins) {
      if (c.collected) continue;
      const worldZ = segZ + c.localZ;
      if (worldZ < -8 || worldZ > 8) continue;
      const laneX = LANES[c.lane];
      const dx = Math.abs(playerState.x - laneX);
      const chestY = playerState.y + (isLowProfile() ? 0.45 : 0.9) * TRACK_SCALE;
      const dy = Math.abs(chestY - c.height);
      // swept on z as well, so coins are never skipped over at high speed
      const reach = 0.8 * TRACK_SCALE;
      const halfDepth = 0.4 * TRACK_SCALE;
      const czMin = worldZ - reach - moveDelta;
      const czMax = worldZ + reach;
      if (dx < 0.55 * TRACK_SCALE && dy < 0.6 * TRACK_SCALE &&
          czMin < halfDepth && czMax > -halfDepth) {
        c.collected = true;
        c.mesh.visible = false;
        Game.coins++;
        burstParticles(new THREE.Vector3(laneX, c.height, 0));
      }
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// PLAYER UPDATE (state machine: running / jumping / sliding / lane-switching)
// ---------------------------------------------------------------------------
function updatePlayer(dt) {
  // Where the body was before this frame moved it — collision sweeps from here
  // so nothing can be crossed without being tested (see playerAABB).
  playerState.prevX = playerState.x;
  playerState.prevY = playerState.y;

  // lane lerp (smooth, frame-rate independent)
  playerState.x += (playerState.targetX - playerState.x) * Math.min(1, LANE_LERP_SPEED * dt);
  player.position.x = playerState.x;

  // vertical (jump)
  if (playerState.isJumping) {
    playerState.velY += GRAVITY * dt;
    playerState.y += playerState.velY * dt;
    if (playerState.y <= 0) {
      playerState.y = 0;
      playerState.velY = 0;
      playerState.isJumping = false;
      // a dive converts into a roll the moment it touches down
      if (playerState.isDiving) {
        playerState.isDiving = false;
        playerState.isRolling = true;
        playerState.rollTimer = ROLL_DURATION;
        triggerShake(0.12, 0.16); // little impact thump
      }
    }
  }
  player.position.y = playerState.y;

  // sliding
  if (playerState.isSliding) {
    playerState.slideTimer -= dt;
    if (playerState.slideTimer <= 0) playerState.isSliding = false;
  }

  // rolling
  if (playerState.isRolling) {
    playerState.rollTimer -= dt;
    if (playerState.rollTimer <= 0) playerState.isRolling = false;
  }

  // forward distance / speed ramp
  playerState.distance += Game.speed * dt;
  Game.speed = Math.min(MAX_SPEED, BASE_SPEED + playerState.distance * SPEED_RAMP_PER_UNIT);
  Game.multiplier = multiplierFor(playerState.distance);
  Game.score = Game.coins * Game.multiplier;
  difficulty = Math.min(1, playerState.distance / DIFFICULTY_DISTANCE);

  // ---- procedural animation ----
  const speedFactor = Game.speed / BASE_SPEED;
  playerState.runPhase += dt * 9 * speedFactor * (isLowProfile() ? 0 : 1);
  const swing = Math.sin(playerState.runPhase);

  if (Character.isActive()) {
    // ---- rigged Mixamo character: the AnimationMixer owns the pose ----
    // The rig only carries position and the lane-switch lean; every limb is
    // driven by the bound clips (or, for the roll, character.js's stand-in).
    player.scale.setScalar(TRACK_SCALE);
    player.rotation.x = 0;
    player.position.y = playerState.y;

    // the roll clip is stretched to match whichever duck window is active,
    // so the animation stays down for as long as the hitbox does
    if (isLowProfile()) Character.playRoll(playerState.isSliding ? SLIDE_DURATION : ROLL_DURATION);
    else if (playerState.isJumping) Character.playJump(JUMP_AIRTIME);
    else Character.playRun();
  } else if (isLowProfile()) {
    // One shared ducking pose for BOTH low states — the ground slide and the
    // roll recovered into after an air dive. They stay separate states (they
    // have different durations) but read identically on screen.
    player.scale.setScalar(TRACK_SCALE);
    player.rotation.x = 1.15;
    player.position.y = playerState.y + 0.05 * TRACK_SCALE;
    playerParts.legL.rotation.x = 0.4;
    playerParts.legR.rotation.x = 0.4;
    playerParts.armL.rotation.x = -0.6;
    playerParts.armR.rotation.x = -0.6;
  } else {
    player.scale.setScalar(TRACK_SCALE);
    player.rotation.x = 0;
    if (playerState.isDiving) {
      // tucked head-down slam
      player.rotation.x = -0.55;
      playerParts.legL.rotation.x = 1.2;
      playerParts.legR.rotation.x = 1.0;
      playerParts.armL.rotation.x = -1.2;
      playerParts.armR.rotation.x = -1.2;
    } else if (playerState.isJumping) {
      playerParts.legL.rotation.x = -0.5;
      playerParts.legR.rotation.x = 0.35;
      playerParts.armL.rotation.x = 0.6;
      playerParts.armR.rotation.x = -0.6;
    } else {
      playerParts.legL.rotation.x = swing * 0.9;
      playerParts.legR.rotation.x = -swing * 0.9;
      playerParts.armL.rotation.x = -swing * 0.7;
      playerParts.armR.rotation.x = swing * 0.7;
      player.position.y = playerState.y + Math.abs(swing) * 0.05 * TRACK_SCALE;
    }
  }
  // slight lean into lane switches
  player.rotation.z = (playerState.targetX - playerState.x) * -0.15;
}

// ---------------------------------------------------------------------------
// CAMERA UPDATE
// ---------------------------------------------------------------------------
// Rig position without shake. Shake is added on top when the rig is written,
// never folded back into this, so a hit can't drag the framing off-centre.
let rigX = 0;

function updateCamera(dt) {
  const speedFactor = (Game.speed - BASE_SPEED) / (MAX_SPEED - BASE_SPEED);

  // ---- rig: forward follow + subtle lateral drift -------------------------
  // The runner is authored at z = 0 and the world scrolls past, so tracking
  // player.position.z is a no-op today — it is written out explicitly so the
  // rig stays correct if the runner is ever moved along z instead.
  const targetRigX = playerState.x * CAMERA.lateralFollow;
  rigX += (targetRigX - rigX) * Math.min(1, CAMERA.lateralLag * dt);

  let shakeX = 0, shakeY = 0;
  if (shakeTime > 0) {
    shakeTime -= dt;
    const m = shakeMag * (shakeTime > 0 ? shakeTime : 0);
    shakeX += (Math.random() - 0.5) * m;
    shakeY += (Math.random() - 0.5) * m;
  }
  if (lateralShakeTime > 0) {
    lateralShakeTime -= dt;
    lateralShakeElapsed += dt;
    const remaining = Math.max(0, lateralShakeTime);
    shakeX += lateralShakeMag * remaining * Math.sin(lateralShakeElapsed * LATERAL_SHAKE_FREQ);
  }
  cameraRig.position.set(rigX + shakeX, shakeY, player.position.z);

  // ---- camera local offsets: fixed framing, plus a hint of speed ----------
  // Note there is deliberately NO term here for playerState.y: the camera is a
  // steady platform the character moves within, so jumps and rolls read as the
  // character moving, not the world lurching.
  const settle = Math.min(1, CAMERA.speedSettle * dt);
  const targetY = (CAMERA.height + speedFactor * CAMERA.speedRise) * cameraZoom;
  const targetZ = (CAMERA.distance + speedFactor * CAMERA.speedPullback) * cameraZoom;
  camera.position.y += (targetY - camera.position.y) * settle;
  camera.position.z += (targetZ - camera.position.z) * settle;

  const targetFov = CAMERA.fov + speedFactor * CAMERA.speedFovGain;
  camera.fov += (targetFov - camera.fov) * settle;
  camera.updateProjectionMatrix();

  speedlinesEl.style.opacity = String(Math.max(0, speedFactor - 0.15) * 0.8);
}

// ---------------------------------------------------------------------------
// MAIN LOOP
// ---------------------------------------------------------------------------
const clock = new THREE.Clock();

function animateCoins(dt) {
  for (const seg of segments) {
    for (const c of seg.coins) {
      if (c.collected) continue;
      c.mesh.rotation.y += dt * 3;
    }
  }
}

function tick() {
  requestAnimationFrame(tick);
  const dt = Math.min(0.05, clock.getDelta());
  DevFPS.markStart(); // no-op unless ?debug/?fps — see engine/dev-fps.js

  // Paused: drain the clock so resuming doesn't see one giant delta, but
  // touch nothing else — no physics, no animation, no re-render. The last
  // frame stays on screen underneath the (opaque enough) pause overlay.
  if (Game.state === 'paused') return;

  if (Game.state === 'playing') {
    updatePlayer(dt);
    DevFPS.mark('player');

    const moveDelta = Game.speed * dt;
    for (const seg of segments) seg.group.position.z += moveDelta;
    DevFPS.mark('scroll');
    recycleSegmentIfNeeded();
    DevFPS.mark('recycle'); // the suspected burst-of-work phase — new buildings/
                             // obstacles/billboards spawn here whenever a
                             // segment cycles back to the front of the track
    animateCoins(dt);
    DevFPS.mark('coins');

    if (checkCollisions(moveDelta)) {
      triggerShake(0.4, 0.5);
      triggerFlash();
      endGame();
    }
    DevFPS.mark('collision');

    updateHUD();
    DevFPS.mark('hud');
  } else {
    // idle drift on menus — moved on the RIG, so the framing stays identical
    cameraRig.position.x = Math.sin(performance.now() * 0.0003) * 0.6;
    Character.playIdle(); // idle loop on the start / game-over screens
    DevFPS.mark('idle');
  }

  // advance the character's clips off the SAME delta driving the game
  Character.update(dt);
  updateParticles(dt);
  if (Game.state !== 'playing') updateCamera(dt); else updateCamera(dt);
  DevFPS.mark('anim+camera');
  renderer.render(scene, camera);
  DevFPS.mark('render');
  DevFPS.tick(); // no-op unless ?debug or ?fps is in the URL — see engine/dev-fps.js
}

initTrack();

// The first track is laid out before the GLBs finish parsing, so it uses
// placeholder footprints. Rebuild it once the real measured sizes are in
// (unless the player already started, in which case recycled segments will
// pick the real models up on their own).
CityModels.init().then(() => {
  if (Game.state !== 'playing') initTrack();
});

// LOADING SCREEN — stays up (blocking every other view, per its own z-index)
// until every asset-loading module has settled, success or failure alike, so
// the pop-in that used to happen after the start screen already showed can
// never be seen. Each of these three calls returns the SAME cached promise
// the module kicked off at file-load time; calling init() again here just
// lets this file hook onto it, it does not re-trigger any loading.
const loadingScreenEl = document.getElementById('loading-screen');
const loadingBarFillEl = document.getElementById('loading-bar-fill');
// The bar's CSS width transition (.15s) is still visually catching up to the
// last tick() call the instant this promise settles — hiding the screen
// immediately would cut the fill off short of 100%. Force it to full and
// give the transition time to actually finish painting before dismissing.
const LOADING_BAR_SETTLE_MS = 250;
Promise.all([characterLoadPromise, CityModels.init(), TrafficVehicles.init()]).then(() => {
  if (loadingBarFillEl) loadingBarFillEl.style.width = '100%';
  setTimeout(() => {
    if (loadingScreenEl) loadingScreenEl.classList.add('hidden');
  }, LOADING_BAR_SETTLE_MS);
});

tick();
