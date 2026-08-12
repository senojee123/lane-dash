/* ============================================================================
   ASSET REGISTRY — ENGINE (generic, shared by every content pack)
   ----------------------------------------------------------------------------
   The mechanism half of the asset system: turns whatever entries a content
   pack's assets.js declared on `AssetRegistry` into spawnable, poolable
   meshes. Nothing in here is Lane-Dash-specific — a different reskin's
   assets.js/cityModels.js/trafficVehicles.js/character.js can define
   entirely different entries and this file doesn't change.

   LOAD ORDER CONTRACT: this file must load AFTER the content pack's
   assets.js, because `AssetRegistry.create = function(){...}` below assigns
   onto an `AssetRegistry` object that assets.js is the one declaring
   (`const AssetRegistry = {...}`). It must load BEFORE any module that
   calls AssetRegistry.create/MeshPool.acquire or writes into ModelCache
   (cityModels.js, trafficVehicles.js, game.js).

   One deliberate leak: buildFallbackBox() below (used when a "model" entry
   is still loading or failed) reaches into the content pack's `Palette` and
   `Geo` globals for its placeholder color/box geometry, same contract as
   every other content module — see assets.js's header.
   ----------------------------------------------------------------------------
     ModelCache[key] = { template: THREE.Group } on success
     ModelCache[key] = { failed: true } on permanent failure
   A key missing from ModelCache simply means "still loading" — create()
   falls back to a same-footprint placeholder box in the meantime; once the
   load resolves, the NEXT spawn of that key (e.g. the next recycled
   segment) will pick up the real model automatically.
============================================================================ */
const ModelCache = {};

function buildFallbackBox(key, fp) {
  const group = new THREE.Group();
  const mat = new THREE.MeshToonMaterial({ color: randChoice(Palette.buildings) });
  const mesh = new THREE.Mesh(Geo.box, mat);
  mesh.scale.set(fp.width, fp.height, fp.depth);
  mesh.position.y = fp.height / 2 + (fp.yBase || 0);
  group.add(mesh);
  group.userData.isFallback = true;
  return group;
}

// Clones a cached model template with INDEPENDENT materials per instance
// (Object3D.clone() shares material references by default), so a color
// variant applied to one spawned instance never bleeds into any other.
function cloneModelInstance(template) {
  const instance = template.clone(true);
  instance.traverse((node) => {
    if (node.isMesh && node.material) {
      node.material = Array.isArray(node.material)
        ? node.material.map((m) => m.clone())
        : node.material.clone();
    }
  });
  return instance;
}

/**
 * Creates a fresh instance of `key`. This is the ONLY place gameplay code
 * should go through to get a mesh — never build geometry inline elsewhere.
 * Handles both "primitive" (built procedurally) and "model" (glTF, loaded
 * and cached by cityModels.js) modes transparently.
 */
AssetRegistry.create = function (key) {
  const def = AssetRegistry[key];
  if (!def) throw new Error('Unknown asset key: ' + key);

  if (def.type === 'model') {
    const cached = ModelCache[key];
    const mesh = (cached && cached.template)
      ? cloneModelInstance(cached.template)
      : buildFallbackBox(key, def.footprint);
    mesh.userData.assetKey = key;
    return mesh;
  }

  const mesh = def.build();
  mesh.userData.assetKey = key;
  return mesh;
};

// ---------------------------------------------------------------------------
// LIGHTWEIGHT OBJECT POOL — reuse Group instances instead of allocating new
// geometry/materials every time a segment recycles.
// ---------------------------------------------------------------------------
const MeshPool = {
  _free: {},
  acquire(key) {
    const bucket = this._free[key];
    while (bucket && bucket.length) {
      const m = bucket.pop();
      // A placeholder pooled *before* its GLB finished loading must never be
      // handed back out once the real model exists. Its geometry is baked to
      // the guessed fallback footprint, so callers scaling it against the
      // real measured footprint produce wildly wrong sizes (and buildings
      // wide enough to spill across the road). Drop it and build fresh.
      if (m.userData.isFallback && ModelCache[key] && ModelCache[key].template) continue;
      m.visible = true;
      return m;
    }
    return AssetRegistry.create(key);
  },
  release(mesh) {
    const key = mesh.userData.assetKey;
    mesh.visible = false;
    if (mesh.parent) mesh.parent.remove(mesh);
    (this._free[key] = this._free[key] || []).push(mesh);
  },
};
