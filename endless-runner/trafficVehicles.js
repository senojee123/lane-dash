/* ============================================================================
   TRAFFICVEHICLES.JS — loads & caches the Kenney "Car Kit" GLB pack (CC0) and
   registers the city-appropriate subset into the existing AssetRegistry.
   ----------------------------------------------------------------------------
   This module OWNS every vehicle that appears as traffic. The old procedural
   car/truck/bus primitives are gone; the obstacle generator asks this module
   which vehicle to spawn next and then goes through AssetRegistry like it does
   for every other asset.

   Deliberately excluded from the pack (never loaded, never referenced):
     go-karts (kart-*), race cars (race, race-future), farm vehicles
     (tractor*), generic props (box, cone, cone-flat), all debris-* wreckage
     and all standalone wheel-* models. Only intact city traffic ships here.

   Pipeline mirrors cityModels.js:
     1. WHITELIST maps key -> file + spawn weight + a rough fallback footprint
        used only if that file fails to load.
     2. init() runs one GLTFLoader.load() per entry, ONCE, at startup. The pack
        bakes its materials against a shared Textures/colormap.png sitting
        beside the GLBs, so the atlas resolves through the glTF's own relative
        URI — there is no separate texture load here.
     3. Each parsed scene is cached as a template; spawning clones the cached
        template (assets.js AssetRegistry.create) rather than re-parsing.
     4. Real bounds are measured with Box3 on load and written back as that
        key's footprint, so collision and lane-fit spacing use each vehicle's
        actual size — a firetruck is not a sedan.
     5. A model that fails to load is dropped from the random-selection pool
        for the session with one named console.warn.
============================================================================ */

const TrafficVehicles = {
  ready: false,
  _loadPromise: null,
  _pool: [],     // keys currently eligible for random selection
  _lastPicked: null,
};

const VEHICLE_BASE_PATH = 'assets/vehicles/';

// ---------------------------------------------------------------------------
// SPAWN WEIGHTS — tune traffic mix here. Everyday city cars dominate; the
// special-purpose vehicles are seasoning, not the meal.
// ---------------------------------------------------------------------------
const VEHICLE_WEIGHTS = {
  // common commuter traffic
  car_sedan: 10,
  car_suv: 9,
  car_taxi: 8,
  car_hatchback_sports: 8,
  car_van: 7,
  // less common, still ordinary
  car_sedan_sports: 5,
  car_suv_luxury: 5,
  car_delivery: 5,
  car_delivery_flat: 4,
  car_truck: 4,
  car_truck_flat: 3,
  // special-purpose — sparing, for visual interest
  car_police: 2,
  car_ambulance: 1.5,
  car_garbage_truck: 1.5,
  car_firetruck: 1,
};

// key -> { file, footprint (fallback guess only; overwritten by measured size) }
const VEHICLE_MANIFEST = {
  car_sedan: { file: 'sedan.glb', footprint: { width: 2.0, height: 1.6, depth: 4.2, yBase: 0 } },
  car_sedan_sports: { file: 'sedan-sports.glb', footprint: { width: 2.0, height: 1.5, depth: 4.2, yBase: 0 } },
  car_hatchback_sports: { file: 'hatchback-sports.glb', footprint: { width: 2.0, height: 1.6, depth: 3.8, yBase: 0 } },
  car_suv: { file: 'suv.glb', footprint: { width: 2.0, height: 1.9, depth: 4.4, yBase: 0 } },
  car_suv_luxury: { file: 'suv-luxury.glb', footprint: { width: 2.0, height: 1.9, depth: 4.6, yBase: 0 } },
  car_taxi: { file: 'taxi.glb', footprint: { width: 2.0, height: 1.7, depth: 4.2, yBase: 0 } },
  car_van: { file: 'van.glb', footprint: { width: 2.0, height: 2.1, depth: 4.4, yBase: 0 } },
  car_delivery: { file: 'delivery.glb', footprint: { width: 2.0, height: 2.2, depth: 4.8, yBase: 0 } },
  car_delivery_flat: { file: 'delivery-flat.glb', footprint: { width: 2.0, height: 2.2, depth: 4.8, yBase: 0 } },
  car_truck: { file: 'truck.glb', footprint: { width: 2.1, height: 2.6, depth: 5.6, yBase: 0 } },
  car_truck_flat: { file: 'truck-flat.glb', footprint: { width: 2.1, height: 2.6, depth: 5.6, yBase: 0 } },
  car_police: { file: 'police.glb', footprint: { width: 2.0, height: 1.7, depth: 4.2, yBase: 0 } },
  car_ambulance: { file: 'ambulance.glb', footprint: { width: 2.1, height: 2.4, depth: 5.0, yBase: 0 } },
  car_firetruck: { file: 'firetruck.glb', footprint: { width: 2.1, height: 2.6, depth: 5.8, yBase: 0 } },
  car_garbage_truck: { file: 'garbage-truck.glb', footprint: { width: 2.1, height: 2.6, depth: 5.8, yBase: 0 } },
};

TrafficVehicles.KEYS = Object.keys(VEHICLE_MANIFEST);

// ---------------------------------------------------------------------------
// FITTING — the pack is authored at its own scale, and a lane is only so wide.
// ---------------------------------------------------------------------------
// One shared multiplier is applied to every vehicle so the size differences
// BETWEEN them survive (a firetruck stays visibly bigger than a hatchback);
// it is derived at load time from the widest vehicle so that even the largest
// fits its lane. Individual models are never rescaled independently.
// Raising this scales every vehicle up together. The hard ceiling is set by
// the player still fitting through the open lane of a pileup: lanes are 2.2
// apart and the runner is 0.72 wide, so anything past 2*(2.2 - 0.36) = 3.68
// would clip someone running the open lane dead centre. 3.0 keeps 0.34 of
// clearance on each side of them, and puts a sedan at ~2.6x the runner's
// height in length — the real-world car-to-person ratio, which is what the
// smaller settings were reading wrong.
const LANE_FIT_WIDTH = 3.0;    // widest permitted vehicle width, pre-TRACK_SCALE
// Vehicles are impassable by design: a lane change is the only way past one.
// Their COLLISION height is therefore floored above the jump apex even though
// their width/depth/visual height are the measured values. Matching collision
// to the real roof would make a sedan a lower hurdle than a barrier.
const VEHICLE_BLOCK_HEIGHT = 3.6;
// The measured Box3 is an exact fit around the mesh, but that reads as an
// overly generous hitbox in play — a graze past a bumper or side mirror
// shouldn't count as a full hit. Shrinks the COLLISION footprint only
// (width/depth); the rendered model is untouched, so cars look the same
// size, they just have to actually reach the runner to hit them. Height is
// NOT included here — it stays governed by VEHICLE_BLOCK_HEIGHT, a gameplay
// floor (vehicles must never be jumpable), not a feel tweak.
const HITBOX_SCALE_FACTOR = 0.8;
// Purely cosmetic multiplier on top of the lane-fit baseline above — applied
// ONLY to the rendered mesh (see fitLoadedVehicles below), never folded into
// the footprint HITBOX_SCALE_FACTOR shrinks. This is what makes a car look
// bigger without making it any harder (or easier) to dodge: the collision
// math never reads mesh.scale, only the stored footprint, so this constant
// can move independently of hitbox fairness. Tune freely.
const CAR_VISUAL_SCALE = 1.15 * 0.75 * 0.88; // = 0.759 — still reading a touch large at 0.8625; another ~12% off
// Heading, in radians, applied to every template. The pack's vehicles are
// authored nose-along-Z; PI turns them to face back down the track at the
// oncoming runner. Set to 0 to have traffic face away instead.
const VEHICLE_FACING_Y = Math.PI;

// Register every whitelisted entry immediately as type:"model" so the obstacle
// generator can reference these keys before the GLBs have finished parsing —
// AssetRegistry.create() hands out same-footprint placeholder boxes until then.
TrafficVehicles.KEYS.forEach((key) => {
  AssetRegistry[key] = {
    type: 'model',
    path: VEHICLE_BASE_PATH + VEHICLE_MANIFEST[key].file,
    footprint: VEHICLE_MANIFEST[key].footprint,
  };
});

// Everything starts eligible; failures are removed as they come in, so traffic
// keeps generating from whatever subset loaded.
TrafficVehicles._pool = TrafficVehicles.KEYS.slice();

/**
 * Weighted-random vehicle key. `avoidKey` (pass the previous pick) is skipped
 * where possible so a pileup doesn't stack two identical models back-to-back;
 * if it's the only thing left, it is returned rather than failing.
 */
TrafficVehicles.pick = function (avoidKey) {
  const pool = TrafficVehicles._pool.length ? TrafficVehicles._pool : TrafficVehicles.KEYS;
  let candidates = pool;
  if (avoidKey && pool.length > 1) {
    candidates = pool.filter((k) => k !== avoidKey);
  }

  let total = 0;
  for (const k of candidates) total += VEHICLE_WEIGHTS[k] || 1;
  let roll = Math.random() * total;
  for (const k of candidates) {
    roll -= VEHICLE_WEIGHTS[k] || 1;
    if (roll <= 0) {
      TrafficVehicles._lastPicked = k;
      return k;
    }
  }
  const last = candidates[candidates.length - 1];
  TrafficVehicles._lastPicked = last;
  return last;
};

function measure(object) {
  const box = new THREE.Box3().setFromObject(object);
  return { box, size: box.getSize(new THREE.Vector3()), center: box.getCenter(new THREE.Vector3()) };
}

function loadOneVehicle(loader, key, entry) {
  return new Promise((resolve) => {
    loader.load(
      VEHICLE_BASE_PATH + entry.file,
      (gltf) => {
        const inner = gltf.scene;

        // Orient first: a vehicle whose long axis lies along X is authored
        // side-on, and has to be turned before anything is measured or the
        // footprint would come out with width and depth swapped.
        let pre = measure(inner);
        if (pre.size.x > pre.size.z) inner.rotation.y += Math.PI / 2;
        inner.rotation.y += VEHICLE_FACING_Y;
        inner.updateMatrixWorld(true);

        // NORMALIZE THE PIVOT, same contract as the city models: centered in
        // x/z, wheels sitting exactly on y=0, so lane placement is just
        // "position.x = lane centre".
        const m = measure(inner);
        const template = new THREE.Group();
        inner.position.set(-m.center.x, -m.box.min.y, -m.center.z);
        template.add(inner);

        console.log(
          '[TrafficVehicles] loaded "%s" — raw size %s x %s x %s',
          key, m.size.x.toFixed(2), m.size.y.toFixed(2), m.size.z.toFixed(2)
        );
        ModelCache[key] = { template, rawSize: m.size.clone() };
        if (window.AssetLoader) AssetLoader.tick();
        resolve();
      },
      undefined,
      (err) => {
        console.warn(
          '[TrafficVehicles] FAILED to load "%s" (%s) — dropping it from the traffic pool for this session.',
          key, entry.file, err
        );
        ModelCache[key] = { failed: true };
        TrafficVehicles._pool = TrafficVehicles._pool.filter((k) => k !== key);
        if (window.AssetLoader) AssetLoader.tick();
        resolve();
      }
    );
  });
}

/**
 * Applies the shared fit multiplier and writes each vehicle's real measured
 * footprint into the registry. Runs once, after every load has settled, since
 * the multiplier depends on the widest model in the set.
 *
 * `fit` alone is the FAIR baseline every collision number is built from — the
 * one shared multiplier (same for every vehicle) that keeps the widest one
 * inside the LANE_FIT_WIDTH ceiling, so the player can still fit through a
 * pileup's open lane, while each vehicle keeps its own raw size relative to
 * the others (a firetruck stays visibly bigger than a hatchback).
 * `fit * CAR_VISUAL_SCALE` is a SEPARATE number, stored as
 * AssetRegistry[key].meshScaleMultiplier — read only by addObstacle (game.js)
 * when it sets the SPAWNED mesh's scale, never by anything in this file. The
 * footprint below is computed from `fit` alone, on purpose: that split is
 * what lets a car be told to look bigger without the hitbox ever hearing
 * about it.
 */
function fitLoadedVehicles() {
  let widest = 0;
  TrafficVehicles.KEYS.forEach((key) => {
    const cached = ModelCache[key];
    if (cached && cached.rawSize) widest = Math.max(widest, cached.rawSize.x);
  });
  if (widest <= 0) return;

  const fit = LANE_FIT_WIDTH / widest;
  TrafficVehicles.fitScale = fit;

  TrafficVehicles.KEYS.forEach((key) => {
    const cached = ModelCache[key];
    if (!cached || !cached.rawSize) return;
    AssetRegistry[key].meshScaleMultiplier = fit * CAR_VISUAL_SCALE;
    const s = cached.rawSize;
    AssetRegistry[key].footprint = {
      width: s.x * fit * HITBOX_SCALE_FACTOR,
      depth: s.z * fit * HITBOX_SCALE_FACTOR,
      // measured height/width/depth kept for reference (visualWidth is also
      // read by the pileup lateral-spacing logic in game.js, since THAT is a
      // purely visual placement concern, deliberately separate from the
      // collision footprint above) — never fed into collision math.
      visualHeight: s.y * fit * CAR_VISUAL_SCALE,
      visualWidth: s.x * fit * CAR_VISUAL_SCALE,
      visualDepth: s.z * fit * CAR_VISUAL_SCALE,
      height: Math.max(s.y * fit * HITBOX_SCALE_FACTOR, VEHICLE_BLOCK_HEIGHT),
      yBase: 0,
    };
  });

  console.log(
    '[TrafficVehicles] fit scale %s (widest raw width %s) applied to %d vehicles.',
    fit.toFixed(3), widest.toFixed(2), TrafficVehicles._pool.length
  );
}

/**
 * Loads and caches every whitelisted vehicle exactly once. Safe to call more
 * than once. Does not need awaiting — the generator spawns placeholder boxes
 * of the right footprint until the real models land.
 */
TrafficVehicles.init = function () {
  if (TrafficVehicles._loadPromise) return TrafficVehicles._loadPromise;

  if (window.AssetLoader) AssetLoader.add(TrafficVehicles.KEYS.length);

  const loader = new THREE.GLTFLoader();
  const jobs = TrafficVehicles.KEYS.map((key) => loadOneVehicle(loader, key, VEHICLE_MANIFEST[key]));

  TrafficVehicles._loadPromise = Promise.all(jobs).then(() => {
    fitLoadedVehicles();
    TrafficVehicles.ready = true;
    console.log(
      '[TrafficVehicles] %d/%d city vehicles available.',
      TrafficVehicles._pool.length, TrafficVehicles.KEYS.length
    );
  });

  return TrafficVehicles._loadPromise;
};

TrafficVehicles.init();
