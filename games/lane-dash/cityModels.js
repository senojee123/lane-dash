/* ============================================================================
   CITYMODELS.JS — loads & caches the Kenney "City Kit: Commercial" GLB pack
   and registers every model into the existing AssetRegistry (see assets.js).
   ----------------------------------------------------------------------------
   Pipeline:
     1. MANIFEST lists every model key -> .glb path (+ a rough fallback
        footprint used only if that file ever fails to load).
     2. init() kicks off one GLTFLoader.load() per manifest entry, ONCE, at
        startup, plus one TextureLoader.load() per color atlas. Results are
        cached (CityModels / ModelCache) — nothing here re-parses a GLB per
        spawn; AssetRegistry.create() (assets.js) just clones the cached
        template.
     3. Every manifest key is written into AssetRegistry as type:"model" so
        the rest of the game (scenery generator, prop placement, etc.) asks
        for e.g. "building_a" or "detail_awning" exactly like it would ask
        for any procedural primitive — it never needs to know a GLB was
        involved.
     4. On load, each model's real bounding box is measured and logged, and
        used to correct that key's AssetRegistry footprint (the fallback
        numbers in MANIFEST are only guesses for the failure case).
     5. If a file 404s or fails to parse, that key is marked failed in
        ModelCache and AssetRegistry.create() will keep silently handing out
        a same-footprint placeholder box for it — one clear console.warn is
        emitted at the moment of failure, not on every spawn.
============================================================================ */

const CityModels = {
  textures: { colormap: null, variationA: null, variationB: null },
  ready: false,
  _loadPromise: null,
};

// key -> { file, footprint (fallback guess, overwritten by measured size on load), tier }
const CITY_MODEL_MANIFEST = {
  // ---- full-detail buildings (14) — use near the road / close to camera ----
  building_a: { file: 'building-a.glb', tier: 'full', footprint: { width: 4, height: 10, depth: 4, yBase: 0 } },
  building_b: { file: 'building-b.glb', tier: 'full', footprint: { width: 4, height: 10, depth: 4, yBase: 0 } },
  building_c: { file: 'building-c.glb', tier: 'full', footprint: { width: 4, height: 10, depth: 4, yBase: 0 } },
  building_d: { file: 'building-d.glb', tier: 'full', footprint: { width: 4, height: 10, depth: 4, yBase: 0 } },
  building_e: { file: 'building-e.glb', tier: 'full', footprint: { width: 4, height: 10, depth: 4, yBase: 0 } },
  building_f: { file: 'building-f.glb', tier: 'full', footprint: { width: 4, height: 12, depth: 4, yBase: 0 } },
  building_g: { file: 'building-g.glb', tier: 'full', footprint: { width: 4, height: 12, depth: 4, yBase: 0 } },
  building_h: { file: 'building-h.glb', tier: 'full', footprint: { width: 4, height: 12, depth: 4, yBase: 0 } },
  building_i: { file: 'building-i.glb', tier: 'full', footprint: { width: 4, height: 14, depth: 4, yBase: 0 } },
  building_j: { file: 'building-j.glb', tier: 'full', footprint: { width: 4, height: 16, depth: 4, yBase: 0 } },
  building_k: { file: 'building-k.glb', tier: 'full', footprint: { width: 4, height: 14, depth: 4, yBase: 0 } },
  building_l: { file: 'building-l.glb', tier: 'full', footprint: { width: 4, height: 14, depth: 4, yBase: 0 } },
  building_m: { file: 'building-m.glb', tier: 'full', footprint: { width: 4, height: 14, depth: 4, yBase: 0 } },
  building_n: { file: 'building-n.glb', tier: 'full', footprint: { width: 4, height: 16, depth: 4, yBase: 0 } },

  // ---- skyscrapers (5) — tallest full-detail buildings ----
  building_skyscraper_a: { file: 'building-skyscraper-a.glb', tier: 'full', footprint: { width: 5, height: 22, depth: 5, yBase: 0 } },
  building_skyscraper_b: { file: 'building-skyscraper-b.glb', tier: 'full', footprint: { width: 5, height: 24, depth: 5, yBase: 0 } },
  building_skyscraper_c: { file: 'building-skyscraper-c.glb', tier: 'full', footprint: { width: 5, height: 26, depth: 5, yBase: 0 } },
  building_skyscraper_d: { file: 'building-skyscraper-d.glb', tier: 'full', footprint: { width: 5, height: 26, depth: 5, yBase: 0 } },
  building_skyscraper_e: { file: 'building-skyscraper-e.glb', tier: 'full', footprint: { width: 5, height: 20, depth: 5, yBase: 0 } },

  // ---- low-detail buildings (14) — cheaper, for background/distant use ----
  low_detail_building_a: { file: 'low-detail-building-a.glb', tier: 'low', footprint: { width: 4, height: 8, depth: 4, yBase: 0 } },
  low_detail_building_b: { file: 'low-detail-building-b.glb', tier: 'low', footprint: { width: 4, height: 8, depth: 4, yBase: 0 } },
  low_detail_building_c: { file: 'low-detail-building-c.glb', tier: 'low', footprint: { width: 4, height: 8, depth: 4, yBase: 0 } },
  low_detail_building_d: { file: 'low-detail-building-d.glb', tier: 'low', footprint: { width: 4, height: 8, depth: 4, yBase: 0 } },
  low_detail_building_e: { file: 'low-detail-building-e.glb', tier: 'low', footprint: { width: 4, height: 8, depth: 4, yBase: 0 } },
  low_detail_building_f: { file: 'low-detail-building-f.glb', tier: 'low', footprint: { width: 4, height: 8, depth: 4, yBase: 0 } },
  low_detail_building_g: { file: 'low-detail-building-g.glb', tier: 'low', footprint: { width: 4, height: 8, depth: 4, yBase: 0 } },
  low_detail_building_h: { file: 'low-detail-building-h.glb', tier: 'low', footprint: { width: 4, height: 10, depth: 4, yBase: 0 } },
  low_detail_building_i: { file: 'low-detail-building-i.glb', tier: 'low', footprint: { width: 4, height: 8, depth: 4, yBase: 0 } },
  low_detail_building_j: { file: 'low-detail-building-j.glb', tier: 'low', footprint: { width: 4, height: 10, depth: 4, yBase: 0 } },
  low_detail_building_k: { file: 'low-detail-building-k.glb', tier: 'low', footprint: { width: 4, height: 8, depth: 4, yBase: 0 } },
  low_detail_building_l: { file: 'low-detail-building-l.glb', tier: 'low', footprint: { width: 4, height: 8, depth: 4, yBase: 0 } },
  low_detail_building_m: { file: 'low-detail-building-m.glb', tier: 'low', footprint: { width: 4, height: 10, depth: 4, yBase: 0 } },
  low_detail_building_n: { file: 'low-detail-building-n.glb', tier: 'low', footprint: { width: 4, height: 8, depth: 4, yBase: 0 } },
  low_detail_building_wide_a: { file: 'low-detail-building-wide-a.glb', tier: 'low', footprint: { width: 8, height: 8, depth: 4, yBase: 0 } },
  low_detail_building_wide_b: { file: 'low-detail-building-wide-b.glb', tier: 'low', footprint: { width: 8, height: 8, depth: 4, yBase: 0 } },

  // ---- attachable detail props (6) — loadable/retrievable by key only ----
  detail_awning: { file: 'detail-awning.glb', tier: 'prop', footprint: { width: 2, height: 0.6, depth: 1, yBase: 0 } },
  detail_awning_wide: { file: 'detail-awning-wide.glb', tier: 'prop', footprint: { width: 3.5, height: 0.6, depth: 1, yBase: 0 } },
  detail_overhang: { file: 'detail-overhang.glb', tier: 'prop', footprint: { width: 2, height: 0.4, depth: 1, yBase: 0 } },
  detail_overhang_wide: { file: 'detail-overhang-wide.glb', tier: 'prop', footprint: { width: 3.5, height: 0.4, depth: 1, yBase: 0 } },
  detail_parasol_a: { file: 'detail-parasol-a.glb', tier: 'prop', footprint: { width: 2, height: 2.2, depth: 2, yBase: 0 } },
  detail_parasol_b: { file: 'detail-parasol-b.glb', tier: 'prop', footprint: { width: 2, height: 2.2, depth: 2, yBase: 0 } },
};

const MODEL_BASE_PATH = 'assets/models/';
const TEXTURE_BASE_PATH = 'assets/textures/';

CityModels.FULL_BUILDING_KEYS = Object.keys(CITY_MODEL_MANIFEST).filter((k) => CITY_MODEL_MANIFEST[k].tier === 'full');
CityModels.LOW_BUILDING_KEYS = Object.keys(CITY_MODEL_MANIFEST).filter((k) => CITY_MODEL_MANIFEST[k].tier === 'low');
CityModels.PROP_KEYS = Object.keys(CITY_MODEL_MANIFEST).filter((k) => CITY_MODEL_MANIFEST[k].tier === 'prop');
CityModels.VARIANT_KEYS = ['colormap', 'variationA', 'variationB'];

// Register every manifest entry into the shared AssetRegistry right away
// (as type:"model") so other systems can reference these keys immediately —
// AssetRegistry.create() will hand out placeholder boxes for them until the
// real GLBs finish loading, per the fallback contract in assets.js.
Object.keys(CITY_MODEL_MANIFEST).forEach((key) => {
  const entry = CITY_MODEL_MANIFEST[key];
  AssetRegistry[key] = {
    type: 'model',
    path: MODEL_BASE_PATH + entry.file,
    footprint: entry.footprint,
    tier: entry.tier,
  };
});

/**
 * Re-skins an already-spawned instance by swapping its material's color
 * atlas. variantKey is one of CityModels.VARIANT_KEYS ('colormap' is the
 * pack's default look; 'variationA' / 'variationB' are the alternate
 * recolors that ship in Models/Textures/). Zero extra geometry cost — same
 * mesh, different texture.
 */
function applyCityModelVariant(instance, variantKey) {
  const tex = CityModels.textures[variantKey];
  if (!tex) return instance;
  instance.traverse((node) => {
    if (!node.isMesh || !node.material) return;
    const mats = Array.isArray(node.material) ? node.material : [node.material];
    mats.forEach((m) => {
      if ('map' in m) { m.map = tex; m.needsUpdate = true; }
    });
  });
  return instance;
}

/**
 * Spawns a keyed city model (optionally re-skinned with a color variant).
 * This is the one entry point the scenery/city-wall generator should use.
 * Goes through AssetRegistry.create() -> cache-first clone (or placeholder
 * box fallback) — never re-parses a GLB.
 */
CityModels.spawn = function (key, variantKey) {
  const instance = AssetRegistry.create(key);
  if (variantKey) applyCityModelVariant(instance, variantKey);
  return instance;
};

function loadAtlasTexture(loader, filename) {
  return new Promise((resolve) => {
    loader.load(
      TEXTURE_BASE_PATH + filename,
      (tex) => {
        tex.flipY = false; // match glTF UV convention
        if (THREE.sRGBEncoding) tex.encoding = THREE.sRGBEncoding;
        if (window.AssetLoader) AssetLoader.tick();
        resolve(tex);
      },
      undefined,
      (err) => {
        console.warn('[CityModels] failed to load color atlas', filename, err);
        if (window.AssetLoader) AssetLoader.tick();
        resolve(null);
      }
    );
  });
}

function loadOneModel(loader, key, entry) {
  return new Promise((resolve) => {
    loader.load(
      MODEL_BASE_PATH + entry.file,
      (gltf) => {
        const inner = gltf.scene;
        const box = new THREE.Box3().setFromObject(inner);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());

        // NORMALIZE THE PIVOT. The pack's models aren't authored around a
        // consistent origin, so placing them by raw position let some drift
        // sideways onto the road. Wrapping each in a group and offsetting the
        // inner scene gives every model the same contract: centered in x/z,
        // base sitting exactly on y=0. Placement code can then rely on
        // "x = setback + width/2" never intruding past the setback.
        const template = new THREE.Group();
        inner.position.set(-center.x, -box.min.y, -center.z);
        template.add(inner);

        console.log(
          '[CityModels] loaded "%s" — size %s x %s x %s (yMin %s)',
          key, size.x.toFixed(2), size.y.toFixed(2), size.z.toFixed(2), box.min.y.toFixed(2)
        );
        // Real measured footprint replaces the fallback guess so downstream
        // placement/spacing logic works off actual dimensions.
        AssetRegistry[key].footprint = {
          width: size.x || entry.footprint.width,
          height: size.y || entry.footprint.height,
          depth: size.z || entry.footprint.depth,
          yBase: 0,
        };
        ModelCache[key] = { template };
        if (window.AssetLoader) AssetLoader.tick();
        resolve();
      },
      undefined,
      (err) => {
        console.warn('[CityModels] FAILED to load model "%s" (%s) — using placeholder box.', key, entry.file, err);
        ModelCache[key] = { failed: true };
        if (window.AssetLoader) AssetLoader.tick();
        resolve();
      }
    );
  });
}

/**
 * Kicks off loading every GLB + color atlas exactly once. Safe to call
 * multiple times (returns the same in-flight/completed promise). Does NOT
 * need to be awaited before the game starts — AssetRegistry.create() falls
 * back to placeholder boxes for anything still loading, and already-spawned
 * scenery gets swapped for the real model the next time it's recycled.
 */
// PROP_KEYS (awnings/overhangs/parasols) are registered into AssetRegistry
// above like everything else, but nothing in engine/runner.js's scenery
// generator actually spawns a 'prop' tier key today — they were dead weight
// on the loading screen (6 GLB downloads + parses for models nothing ever
// placed). Registration stays (cheap, and ready for whenever prop placement
// gets built), only the network load is skipped.
const LOADED_MODEL_KEYS = Object.keys(CITY_MODEL_MANIFEST).filter((k) => CITY_MODEL_MANIFEST[k].tier !== 'prop');

CityModels.init = function () {
  if (CityModels._loadPromise) return CityModels._loadPromise;

  if (window.AssetLoader) AssetLoader.add(LOADED_MODEL_KEYS.length + 3);

  const gltfLoader = new THREE.GLTFLoader();
  const textureLoader = new THREE.TextureLoader();

  const modelPromises = LOADED_MODEL_KEYS.map((key) =>
    loadOneModel(gltfLoader, key, CITY_MODEL_MANIFEST[key])
  );

  const texturePromises = [
    loadAtlasTexture(textureLoader, 'colormap.png').then((t) => { CityModels.textures.colormap = t; }),
    loadAtlasTexture(textureLoader, 'variation-a.png').then((t) => { CityModels.textures.variationA = t; }),
    loadAtlasTexture(textureLoader, 'variation-b.png').then((t) => { CityModels.textures.variationB = t; }),
  ];

  CityModels._loadPromise = Promise.all([...modelPromises, ...texturePromises]).then(() => {
    CityModels.ready = true;
    console.log('[CityModels] %d models (of %d registered; prop-tier skipped) + 3 color atlases attempted.',
                LOADED_MODEL_KEYS.length, Object.keys(CITY_MODEL_MANIFEST).length);
  });

  return CityModels._loadPromise;
};

CityModels.init();
