/* ============================================================================
   ASSET REGISTRY — CONTENT (Lane Dash pack)
   ----------------------------------------------------------------------------
   This file is what makes a reskin a *reskin*: the palette, shared
   geometries/materials, every procedural primitive builder, and the
   AssetRegistry entries that key them (footprints included). The generic
   machinery that turns these entries into spawnable/poolable meshes —
   AssetRegistry.create(), MeshPool, ModelCache — lives in
   engine/asset-registry.js and is loaded right after this file (it attaches
   .create onto the AssetRegistry object this file declares, and its
   fallback-box builder reads this file's Palette/Geo — see that file's
   header for the exact contract).

   HOW TO SWAP A PRIMITIVE FOR A REAL MODEL LATER
   ----------------------------------------------------------------------------
   1. Drop your .glb file somewhere under this pack's assets/ (e.g.
      assets/models/car.glb).
   2. Change that entry's `type` to "model" and add a `path` (and optional
      `scale` / `rotationY` to align it to the same footprint/orientation the
      primitive used).
   3. That's it — nothing in engine/runner.js references geometry directly,
      it always calls `AssetRegistry.create(key)`, which transparently uses
      GLTFLoader for "model" entries. Keep the footprint numbers matching the
      visual size of the new model so collisions still feel fair.

   HOW TO BUILD A NEW RESKIN
   ----------------------------------------------------------------------------
   Copy this whole games/lane-dash/ folder, replace assets/ and the builders/
   entries below (and cityModels.js / trafficVehicles.js / character.js's
   manifests) with your new theme's content, then edit theme.js + config.js.
   engine/ never needs to change.

   Example of a swapped-in entry:
     car: {
       type: "model",
       path: "models/car.glb",
       scale: 1.2,
       rotationY: Math.PI,
       footprint: { width: 2.0, height: 1.4, depth: 4.0, yBase: 0 }
     }
============================================================================ */

const Palette = {
  playerSkin: 0xffc79e,
  playerShirt: 0xff5f8f,
  playerPants: 0x2e3a59,
  playerShoe: 0x1a1a1a,

  stripeRed: 0xe63946,
  stripeWhite: 0xf1faee,

  road: 0x3a3a44,
  roadLine: 0xf2f2f2,
  sidewalk: 0x8d99ae,
  grass: 0x5fb85f,

  buildings: [0xffb703, 0xfb8500, 0x8ecae6, 0x219ebc, 0xffafcc, 0xa663cc, 0xef9d8f],
  vehicles: [0xe63946, 0x1d8feb, 0xf4a300, 0x2ecc71, 0x9b5de5, 0xf15bb5],
  treeFoliage: [0x2d9d5b, 0x3bb273, 0x1f8a4c],
  gold: 0xffd166,
};

// -------- shared geometries & materials (created ONCE, reused everywhere) --------
const Geo = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cylinder: new THREE.CylinderGeometry(1, 1, 1, 12),
  sphere: new THREE.SphereGeometry(1, 12, 10),
  cone: new THREE.ConeGeometry(1, 1, 10),
  circle: new THREE.CircleGeometry(1, 20),
  torus: new THREE.TorusGeometry(1, 0.35, 8, 20),
  capsule: (function () {
    // simple capsule approximation using a cylinder + two spheres, built per-use in buildPlayer
    return null;
  })(),
};

const Mat = {
  skin: new THREE.MeshToonMaterial({ color: Palette.playerSkin }),
  shirt: new THREE.MeshToonMaterial({ color: Palette.playerShirt }),
  pants: new THREE.MeshToonMaterial({ color: Palette.playerPants }),
  shoe: new THREE.MeshToonMaterial({ color: Palette.playerShoe }),
  stripeRed: new THREE.MeshToonMaterial({ color: Palette.stripeRed }),
  stripeWhite: new THREE.MeshToonMaterial({ color: Palette.stripeWhite }),
  pole: new THREE.MeshToonMaterial({ color: 0x666666 }),
  road: new THREE.MeshLambertMaterial({ color: Palette.road }),
  roadLine: new THREE.MeshBasicMaterial({ color: Palette.roadLine }),
  sidewalk: new THREE.MeshLambertMaterial({ color: Palette.sidewalk }),
  grass: new THREE.MeshLambertMaterial({ color: Palette.grass }),
  gold: new THREE.MeshToonMaterial({ color: Palette.gold, emissive: 0x664400, emissiveIntensity: 0.15 }),
  // Coin FACE only (the ring above stays `gold`) — split out so a sponsor
  // image (RunnerBrand.collectibleImageUrl, see applyBrandConfig() in
  // engine/runner.js) can be applied to just the flat face without also
  // texturing the rim. MeshBasicMaterial (unlit) so a logo reads at its own
  // brightness regardless of scene lighting, same reasoning as the
  // billboard panel material.
  coinFace: new THREE.MeshBasicMaterial({ color: Palette.gold }),
  glassDark: new THREE.MeshToonMaterial({ color: 0x1b1b2a }),
  tireBlack: new THREE.MeshToonMaterial({ color: 0x111111 }),
  lampGlow: new THREE.MeshBasicMaterial({
    color: 0xfff4c2, transparent: true, opacity: 0.11, depthWrite: false,
    side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
  }),
  lampPool: new THREE.MeshBasicMaterial({
    color: 0xfff0b8, transparent: true, opacity: 0.15, depthWrite: false,
    blending: THREE.AdditiveBlending,
  }),
};

function randChoice(arr) { return arr[(Math.random() * arr.length) | 0]; }

// ---------------------------------------------------------------------------
// PLAYER
// ---------------------------------------------------------------------------
// Uniform shrink applied to both the visual model (below) and the collision
// footprint (AssetRegistry.player.footprint, computed from this same
// constant so the two can never drift apart). The character previously
// read as tall/capable enough to plausibly jump over vehicles, which are
// deliberately unjumpable no matter how short they look (see
// VEHICLE_BLOCK_HEIGHT's comment in trafficVehicles.js) — this doesn't
// change that rule, it just makes the character's own presence match it
// better. Verified this doesn't tighten anything before applying it: jump
// apex (2.91 scaled) and every barrier/vehicle collision height are fixed,
// independent of player size; the one clearance that DOES scale with the
// player — rolling under barrier_high — only gets MORE forgiving as the
// player shrinks (0.094 -> 0.231 unit margin), never less.
const PLAYER_SCALE = 0.88;

function buildPlayer() {
  const group = new THREE.Group();

  const torso = new THREE.Mesh(Geo.box, Mat.shirt);
  torso.scale.set(0.62, 0.6, 0.36);
  torso.position.y = 1.18;
  group.add(torso);

  const head = new THREE.Mesh(Geo.sphere, Mat.skin);
  head.scale.set(0.28, 0.3, 0.28);
  head.position.y = 1.68;
  group.add(head);

  const hips = new THREE.Mesh(Geo.box, Mat.pants);
  hips.scale.set(0.56, 0.26, 0.34);
  hips.position.y = 0.82;
  group.add(hips);

  function makeLimb(mat, w, h, d, isArm) {
    const pivot = new THREE.Group();
    const mesh = new THREE.Mesh(Geo.box, mat);
    mesh.scale.set(w, h, d);
    mesh.position.y = -h / 2;
    pivot.add(mesh);
    if (!isArm) {
      const shoe = new THREE.Mesh(Geo.box, Mat.shoe);
      shoe.scale.set(w * 1.15, 0.14, d * 1.3);
      shoe.position.y = -h - 0.05;
      pivot.add(shoe);
    }
    return pivot;
  }

  const legL = makeLimb(Mat.pants, 0.22, 0.62, 0.24, false);
  legL.position.set(-0.16, 0.78, 0);
  const legR = makeLimb(Mat.pants, 0.22, 0.62, 0.24, false);
  legR.position.set(0.16, 0.78, 0);

  const armL = makeLimb(Mat.skin, 0.16, 0.52, 0.18, true);
  armL.position.set(-0.42, 1.42, 0);
  const armR = makeLimb(Mat.skin, 0.16, 0.52, 0.18, true);
  armR.position.set(0.42, 1.42, 0);

  group.add(legL, legR, armL, armR);

  // Applied to the whole group (not each limb individually) — scales every
  // child's size AND local position together, so the character shrinks as
  // one coherent whole rather than needing every hardcoded dimension above
  // hand-edited. Doesn't interfere with the per-frame limb rotations
  // runner.js's updatePlayer() sets on legL/legR/armL/armR — scale and
  // rotation are independent transform components.
  group.scale.setScalar(PLAYER_SCALE);

  group.userData.parts = { torso, head, hips, legL, legR, armL, armR };
  return group;
}

// ---------------------------------------------------------------------------
// OBSTACLES
// ---------------------------------------------------------------------------
function buildBarrierLow() {
  // JUMP-ONLY wall. Its top is at y=1.8 — level with `barrier_high`'s beam —
  // and it is SOLID all the way to the ground, so there is no hole to roll
  // through. Jumping is the only way past it.
  const group = new THREE.Group();

  const slab = new THREE.Mesh(Geo.box, Mat.stripeRed);
  slab.scale.set(2.2, 1.8, 0.3);
  slab.position.y = 0.9;
  group.add(slab);

  // vertical hazard stripes down the face
  for (let i = -1; i <= 1; i += 2) {
    const stripe = new THREE.Mesh(Geo.box, Mat.stripeWhite);
    stripe.scale.set(0.4, 1.8, 0.32);
    stripe.position.set(i * 0.75, 0.9, 0);
    group.add(stripe);
  }
  // capping rail, so the top edge you have to clear reads clearly
  const rail = new THREE.Mesh(Geo.box, Mat.pole);
  rail.scale.set(2.28, 0.16, 0.38);
  rail.position.y = 1.72;
  group.add(rail);

  return group;
}

function buildBarrierHigh() {
  // Suspended beam, spanning y = 1.0 .. 1.8. Deliberately low enough that the
  // jump arc clears its top AND high enough that a roll fits underneath —
  // this is the "player's choice" obstacle.
  const group = new THREE.Group();
  const beam = new THREE.Mesh(Geo.box, Mat.stripeRed);
  beam.scale.set(2.3, 0.8, 0.35);
  beam.position.y = 1.4;
  group.add(beam);
  for (let i = -1; i <= 1; i += 2) {
    const stripe = new THREE.Mesh(Geo.box, Mat.stripeWhite);
    stripe.scale.set(0.42, 0.82, 0.37);
    stripe.position.set(i * 0.78, 1.4, 0);
    group.add(stripe);
  }
  const postGeo = Geo.cylinder;
  const postL = new THREE.Mesh(postGeo, Mat.pole);
  postL.scale.set(0.09, 1.0, 0.09);
  postL.position.set(-1.05, 0.5, 0);
  const postR = postL.clone();
  postR.position.x = 1.05;
  group.add(postL, postR);
  return group;
}

function buildBarrierGap() {
  // A wall too tall to jump, with a gap cut out underneath — the ROLL-ONLY
  // obstacle. Solid slab spans y = 1.0 .. 3.6; the clear hole below it is
  // exactly the height a rolling player occupies.
  const group = new THREE.Group();

  const slab = new THREE.Mesh(Geo.box, Mat.stripeRed);
  slab.scale.set(2.3, 2.6, 0.34);
  slab.position.y = 2.3;
  group.add(slab);

  // hazard chevrons along the bottom lip, so the hole reads at a glance
  for (let i = -1; i <= 1; i++) {
    const stripe = new THREE.Mesh(Geo.box, Mat.stripeWhite);
    stripe.scale.set(0.46, 0.3, 0.37);
    stripe.position.set(i * 0.72, 1.18, 0);
    group.add(stripe);
  }
  // and a lintel band across the top
  const cap = new THREE.Mesh(Geo.box, Mat.stripeWhite);
  cap.scale.set(2.34, 0.22, 0.38);
  cap.position.y = 3.48;
  group.add(cap);

  // side posts framing the hole — visual only, the footprint is the slab
  const postL = new THREE.Mesh(Geo.cylinder, Mat.pole);
  postL.scale.set(0.1, 1.0, 0.1);
  postL.position.set(-1.08, 0.5, 0);
  const postR = postL.clone();
  postR.position.x = 1.08;
  group.add(postL, postR);

  return group;
}

// ---------------------------------------------------------------------------
// COLLECTIBLE
// ---------------------------------------------------------------------------
function buildCoin() {
  const group = new THREE.Group();
  // CylinderGeometry's default cap UVs place a square-ish image centered
  // and circularly cropped onto the flat face — exactly what an optional
  // logo image (coinFace's .map, see applyBrandConfig()) needs, with no
  // extra geometry/UV work required here.
  const coin = new THREE.Mesh(Geo.cylinder, Mat.coinFace);
  coin.scale.set(0.34, 0.07, 0.34);
  coin.rotation.z = Math.PI / 2;
  group.add(coin);
  const ring = new THREE.Mesh(Geo.torus, Mat.gold);
  ring.scale.set(0.36, 0.36, 0.08);
  ring.rotation.y = Math.PI / 2;
  group.add(ring);
  group.userData.spin = true;
  return group;
}

// ---------------------------------------------------------------------------
// SCENERY
// ---------------------------------------------------------------------------
function buildTree() {
  const group = new THREE.Group();
  const trunk = new THREE.Mesh(Geo.cylinder, new THREE.MeshToonMaterial({ color: 0x7a4a2b }));
  trunk.scale.set(0.22, 1.1, 0.22);
  trunk.position.y = 0.55;
  group.add(trunk);
  const foliageColor = randChoice(Palette.treeFoliage);
  const foliageMat = new THREE.MeshToonMaterial({ color: foliageColor });
  for (let i = 0; i < 3; i++) {
    const cone = new THREE.Mesh(Geo.cone, foliageMat);
    const s = 1.3 - i * 0.28;
    cone.scale.set(s, s * 1.1, s);
    cone.position.y = 1.3 + i * 0.75;
    group.add(cone);
  }
  return group;
}

function buildBuilding() {
  const group = new THREE.Group();
  const color = randChoice(Palette.buildings);
  const mat = new THREE.MeshToonMaterial({ color });
  const w = 3 + Math.random() * 2.5;
  const h = 5 + Math.random() * 14;
  const d = 3 + Math.random() * 2.5;
  const body = new THREE.Mesh(Geo.box, mat);
  body.scale.set(w, h, d);
  body.position.y = h / 2;
  group.add(body);

  // windows: a lit-window trim strip using emissive-ish flat color blocks
  const winMat = new THREE.MeshBasicMaterial({ color: 0xfff2b0 });
  const rows = Math.floor(h / 1.6);
  const cols = Math.max(1, Math.floor(w / 1.1));
  for (let r = 1; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (Math.random() > 0.55) continue;
      const win = new THREE.Mesh(Geo.box, winMat);
      win.scale.set(0.5, 0.7, 0.05);
      win.position.set(-w / 2 + (c + 0.5) * (w / cols), r * 1.6, d / 2 + 0.02);
      group.add(win);
    }
  }
  return group;
}

function buildStreetlight() {
  const group = new THREE.Group();
  const pole = new THREE.Mesh(Geo.cylinder, Mat.pole);
  pole.scale.set(0.09, 3.2, 0.09);
  pole.position.y = 1.6;
  group.add(pole);
  const arm = new THREE.Mesh(Geo.box, Mat.pole);
  arm.scale.set(0.8, 0.08, 0.08);
  arm.position.set(0.4, 3.15, 0);
  group.add(arm);
  const lamp = new THREE.Mesh(Geo.sphere, new THREE.MeshBasicMaterial({ color: 0xfff4c2 }));
  lamp.scale.set(0.22, 0.22, 0.22);
  lamp.position.set(0.78, 3.05, 0);
  group.add(lamp);

  // Light spill onto the road. These are plain additive meshes, NOT real
  // lights — there are ~30 streetlights alive at once and that many
  // THREE.SpotLights would blow past the renderer's light limits and tank
  // the frame rate for a purely cosmetic effect.
  // Everything below leans along +X, the same direction as the arm, so the
  // whole fixture reads as facing the road once the group is turned.
  const cone = new THREE.Mesh(Geo.cone, Mat.lampGlow);
  cone.scale.set(1.5, 3.1, 1.5);
  cone.position.set(1.06, 1.53, 0);
  cone.rotation.z = 0.18; // splay the wide end out over the tarmac
  group.add(cone);

  const pool = new THREE.Mesh(Geo.circle, Mat.lampPool);
  pool.rotation.x = -Math.PI / 2;
  pool.scale.set(1.7, 2.4, 1);
  pool.position.set(1.6, 0.02, 0);
  group.add(pool);

  return group;
}

// Ad billboard: two support poles + a frame + a panel that engine/runner.js
// retextures per instance with a sponsor creative (see
// engine/billboard-media.js). Used both freestanding in open lots and
// mounted on rooftops — see spawnCityRow() in engine/runner.js for both
// placement paths.
//
// FACING: the panel's readable faces are its ±Z sides, NOT ±X — this is the
// direction the chase camera actually approaches from (it trails behind the
// player looking down -Z the whole game; billboards scroll toward it along
// Z regardless of which side of the road they're on). An earlier version of
// this faced ±X instead (built to match buildStreetlight()'s "faces +X,
// flip for the right side" convention just above), which is right for a
// streetlight's arm — that has to reach laterally IN toward the road — but
// wrong for a billboard's face, which needs to point back down the track
// toward the camera, not sideways across it. Fixed: no more left/right
// rotation flip needed at placement either (see spawnCityRow()'s open-lot
// and rooftop billboard calls in engine/runner.js) — since the face is now
// along Z and the camera always approaches from the same Z direction
// regardless of which side of the road the billboard sits on, one fixed
// orientation works for every placement.
//
// Built from thin boxes rather than a plane, matching every other primitive
// in this file — the box's ±Z faces carry the texture, the barely-visible
// edges are an acceptable tradeoff for staying consistent with the rest of
// the pack's geometry style.
function buildBillboard() {
  const group = new THREE.Group();
  const poleHeight = 1.6;
  // Read from theme.js, not hardcoded here, so this geometry and
  // billboard-media.js's image-compositing aspect ratio can never drift
  // out of sync with each other — see RunnerTheme.BILLBOARD's comment.
  const panelWidth = RunnerTheme.BILLBOARD.panelWidth;
  const panelHeight = RunnerTheme.BILLBOARD.panelHeight;

  const poleL = new THREE.Mesh(Geo.cylinder, Mat.pole);
  poleL.scale.set(0.13, poleHeight, 0.13);
  poleL.position.set(-panelWidth / 2 + 0.35, poleHeight / 2, 0);
  group.add(poleL);
  const poleR = poleL.clone();
  poleR.position.x = panelWidth / 2 - 0.35;
  group.add(poleR);

  // frame: a hair larger than the panel all around, so its edge reads as a
  // border rather than exactly overlapping the panel's own thin edge faces
  const frame = new THREE.Mesh(Geo.box, Mat.pole);
  frame.scale.set(panelWidth + 0.3, panelHeight + 0.3, 0.1);
  frame.position.set(0, poleHeight + panelHeight / 2, 0);
  group.add(frame);

  // ad panel — MeshBasicMaterial so the creative reads at the texture's own
  // brightness regardless of scene lighting (like a lit screen/print),
  // DoubleSide so it's never blank from the rare angle it's seen from
  // behind. Starts on the shared placeholder texture; engine/runner.js
  // assigns the real creative (or leaves the placeholder) at spawn time —
  // see addBillboard() in engine/runner.js.
  const panelMat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
  const panel = new THREE.Mesh(Geo.box, panelMat);
  panel.scale.set(panelWidth, panelHeight, 0.08);
  panel.position.set(0, poleHeight + panelHeight / 2, 0.09);
  group.add(panel);

  group.userData.panel = panel;
  return group;
}

// Lane divider dash — one short bright stripe painted flat on the road. The
// generator lays a row of these down each scrolling segment (with gaps
// between them) so they read as scrolling dashes, same as any highway lane
// marking, rather than a static texture on the non-scrolling road plane.
function buildLaneDash() {
  const group = new THREE.Group();
  const mesh = new THREE.Mesh(Geo.box, Mat.roadLine);
  mesh.scale.set(0.14, 0.015, 1.6);
  mesh.position.y = 0.012; // just proud of the road surface to avoid z-fighting
  group.add(mesh);
  return group;
}

// Parking lot pavement — a flat patch spawned under an open lot (see
// spawnCityRow()'s open-lot branch in engine/runner.js) so the gap where a
// building would otherwise be reads as an intentional car park, not an
// unexplained hole in the city. Built at base size 1x1 (X/Z); the caller
// sets a non-uniform scale directly (mesh.scale.set(width, 1, depth)) since
// every lot's depth varies — this is the one piece of scenery in the file
// that doesn't go through addScenery()'s uniform-scale-plus-squash contract
// for exactly that reason. Reuses Mat.sidewalk rather than a new material —
// visually close enough to pavement, and one less thing to add.
function buildParkingPavement() {
  const group = new THREE.Group();
  const mesh = new THREE.Mesh(Geo.box, Mat.sidewalk);
  mesh.scale.set(1, 0.01, 1);
  mesh.position.y = 0.006; // proud of the grass, but below lane_dash's 0.012 so parking-line stripes drawn on top never z-fight
  group.add(mesh);
  return group;
}

// ---------------------------------------------------------------------------
// REGISTRY
// ---------------------------------------------------------------------------
// `AssetRegistry.create`, `MeshPool`, and `ModelCache` (the generic machinery
// that turns these entries into spawnable/poolable meshes) are attached by
// engine/asset-registry.js, loaded right after this file — see its header.
const AssetRegistry = {
  player: {
    type: 'primitive',
    build: buildPlayer,
    // Derived from PLAYER_SCALE (see its comment above buildPlayer()) so
    // the collision box can never drift out of sync with the visual model
    // — both are the same base 0.72/1.85/0.7 numbers, shrunk together.
    footprint: { width: 0.72 * PLAYER_SCALE, height: 1.85 * PLAYER_SCALE, depth: 0.7 * PLAYER_SCALE, yBase: 0 },
  },
  // JUMP-ONLY: solid from the ground up to y=1.8, no gap underneath.
  barrier_low: {
    type: 'primitive',
    build: buildBarrierLow,
    footprint: { width: 2.2, height: 1.8, depth: 0.5, yBase: 0 },
  },
  // EITHER: beam from 1.0 to 1.8 — roll under it or jump over it.
  barrier_high: {
    type: 'primitive',
    build: buildBarrierHigh,
    footprint: { width: 2.3, height: 0.8, depth: 0.5, yBase: 1.0 },
  },
  // ROLL-ONLY: wall from 1.0 to 3.6, far above the jump apex, with the hole
  // underneath as the only way through.
  barrier_gap: {
    type: 'primitive',
    build: buildBarrierGap,
    footprint: { width: 2.3, height: 2.6, depth: 0.5, yBase: 1.0 },
  },
  // VEHICLES live in trafficVehicles.js — they are Kenney Car Kit GLBs
  // registered as type:"model" entries at startup, not primitives.
  coin: {
    type: 'primitive',
    build: buildCoin,
    footprint: { width: 0.4, height: 0.4, depth: 0.4, yBase: 0 },
  },
  tree: {
    type: 'primitive',
    build: buildTree,
    footprint: { width: 1, height: 1, depth: 1, yBase: 0 },
  },
  building: {
    type: 'primitive',
    build: buildBuilding,
    footprint: { width: 1, height: 1, depth: 1, yBase: 0 },
  },
  streetlight: {
    type: 'primitive',
    build: buildStreetlight,
    footprint: { width: 1, height: 1, depth: 1, yBase: 0 },
  },
  lane_dash: {
    type: 'primitive',
    build: buildLaneDash,
    footprint: { width: 0.14, height: 0.015, depth: 1.6, yBase: 0 },
  },
  // Pure scenery, like streetlight/lane_dash above — never passed to
  // addObstacle, so this footprint is unused (kept only for consistency
  // with every other registry entry).
  billboard: {
    type: 'primitive',
    build: buildBillboard,
    footprint: { width: 1, height: 1, depth: 1, yBase: 0 },
  },
  parking_lot: {
    type: 'primitive',
    build: buildParkingPavement,
    footprint: { width: 1, height: 1, depth: 1, yBase: 0 },
  },
};
