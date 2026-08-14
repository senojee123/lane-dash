/* ============================================================================
   CHARACTER.JS — the player character: a Mixamo rig (Ch09_nonPBR.fbx) driven
   by three separately-supplied Mixamo animation files.

   This module fully replaces the earlier Kenney character implementation.
   ----------------------------------------------------------------------------
   Assets:
     assets/character/Ch09_nonPBR.fbx        rigged/skinned mesh, textures
                                             EMBEDDED in the FBX (diffuse,
                                             normal, specular, glossiness).
                                             Also carries a baked "Take 001"
                                             reference take that is discarded.
     assets/character/animations/
        Fast_Run.fbx  Jump.fbx  Quick_Roll_To_Run.fbx
                                             one clip each, in .animations[0].
                                             Quick_Roll_To_Run is a Mixamo
                                             "with skin" export, so it also
                                             carries a mesh + textures — only
                                             its clip is taken, the rest is
                                             never added to the scene.

   Two wrinkles this module handles:

   1. BONE NAMESPACE MISMATCH. The character exports its skeleton as
      `mixamorig6:Hips`, while the animation files use plain `mixamorig:Hips`.
      Same skeleton, same bone names after the colon — only the namespace
      differs. So rather than a hand-written bone map, each clip's track names
      are normalised (everything up to and including the first colon is
      stripped) and re-pointed at the character's real node names. Anything
      that still fails to resolve is logged rather than silently dropped.

   2. ROOT MOTION. Mixamo clips translate the hips through the world. The game
      moves the world past a stationary player, so the X/Z channels of the hip
      position track are flattened to their first frame — the character
      animates in place. Y is deliberately KEPT so the jump's vertical arc and
      the roll's dip still read.
============================================================================ */

const CHARACTER_BASE = 'assets/character/';
const MODEL_FILE = 'https://raw.githubusercontent.com/senojee123/engagements/main/large-assets/Ch09_nonPBR.fbx';
const ANIM_FILES = {
  run: CHARACTER_BASE + 'animations/Fast_Run.fbx',
  jump: CHARACTER_BASE + 'animations/Jump.fbx',
  roll: 'https://raw.githubusercontent.com/senojee123/engagements/main/large-assets/Quick_Roll_To_Run.fbx',
};

const FADE = 0.15;             // crossfade between actions (seconds)
const ONCE_ACTIONS = { jump: true, roll: true }; // play once + clamp

const Character = {
  root: new THREE.Group(),     // attach THIS to the player rig
  ready: false,
  usingFallback: true,
  mixer: null,
  actions: {},                 // { run, jump, roll }
  current: null,

  _model: null,
  _loadPromise: null,
};

/** True once the real rigged model is in place (i.e. not the box fallback). */
Character.isActive = function () {
  return Character.ready && !Character.usingFallback;
};

// ---------------------------------------------------------------------------
// LOADING HELPERS
// ---------------------------------------------------------------------------
function loadFBX(url, label) {
  return new Promise((resolve) => {
    new THREE.FBXLoader().load(
      url,
      (obj) => {
        if (window.AssetLoader) AssetLoader.tick();
        resolve(obj);
      },
      undefined,
      (err) => {
        console.warn('[Character] FAILED to load %s (%s)', label, url, err);
        if (window.AssetLoader) AssetLoader.tick();
        resolve(null);
      }
    );
  });
}

/**
 * Reduces a bone name to its namespace-free form so the character's skeleton
 * and the animation clips can be matched:
 *   `mixamorig6:LeftArm` -> `LeftArm`     (raw FBX form)
 *   `mixamorig6LeftArm`  -> `LeftArm`     (after FBXLoader sanitisation)
 *
 * The second form is the one that actually reaches us: three's FBXLoader runs
 * node names through PropertyBinding.sanitizeNodeName, which strips ':' —
 * so by load time the character reads `mixamorig6Hips` and the clips read
 * `mixamorigHips`, and a plain split-on-colon would match nothing at all.
 */
function stripNamespace(name) {
  const colon = name.indexOf(':');
  if (colon !== -1) return name.slice(colon + 1);
  const m = /^mixamorig\d*(.+)$/i.exec(name);
  return m ? m[1] : name;
}

/**
 * Re-points a clip's tracks at the character's actual node names by matching
 * on namespace-stripped names. Returns the number of tracks that could not be
 * resolved (those are dropped so the mixer doesn't throw on them).
 */
function retargetClip(clipName, clip, nodeNamesByStripped) {
  const unresolved = [];
  clip.tracks = clip.tracks.filter((track) => {
    const parsed = THREE.PropertyBinding.parseTrackName(track.name);
    const actual = nodeNamesByStripped.get(stripNamespace(parsed.nodeName));
    if (!actual) { unresolved.push(parsed.nodeName); return false; }
    // keep the ".position"/".quaternion" suffix, swap only the node portion
    track.name = track.name.startsWith(parsed.nodeName)
      ? actual + track.name.slice(parsed.nodeName.length)
      : actual + '.' + parsed.propertyName;
    return true;
  });

  if (unresolved.length) {
    const unique = Array.from(new Set(unresolved));
    console.warn(
      '[Character] clip "%s": %d track(s) had no matching bone after namespace ' +
      'normalisation and were dropped: %s',
      clipName, unique.length, unique.slice(0, 8).join(', ')
    );
  }
  return unresolved.length;
}

/**
 * Flattens the hips' X/Z translation so the character runs in place.
 * Y is preserved — the jump arc and the roll's crouch live on that channel.
 */
function stripRootMotion(clip) {
  let stripped = 0;
  clip.tracks.forEach((track) => {
    const parsed = THREE.PropertyBinding.parseTrackName(track.name);
    if (parsed.propertyName !== 'position') return;
    if (!/hips|^root$/i.test(stripNamespace(parsed.nodeName))) return;

    const v = track.values;
    const x0 = v[0];
    const z0 = v[2];
    for (let i = 0; i < v.length; i += 3) {
      v[i] = x0;       // X pinned to first frame
      v[i + 2] = z0;   // Z pinned to first frame
      // v[i + 1] (Y) left untouched on purpose
    }
    stripped++;
  });
  return stripped;
}

/**
 * The FBX ships a specular/glossiness (non-PBR) material set, which doesn't
 * map onto MeshStandardMaterial's metalness/roughness model. MeshPhongMaterial
 * is the closer match, so each material is rebuilt as Phong with the embedded
 * maps wired to their matching slots.
 *
 * NOTE: three r128 requires `skinning: true` on any material used by a
 * SkinnedMesh. A freshly-built material without it renders frozen in bind
 * pose, so it is set explicitly here.
 */
function convertToPhong(model) {
  const summary = { converted: 0, withDiffuse: 0, withNormal: 0, withSpecular: 0 };

  model.traverse((node) => {
    if (!node.isMesh || !node.material) return;
    const mats = Array.isArray(node.material) ? node.material : [node.material];

    const rebuilt = mats.map((src) => {
      if (src.isMeshPhongMaterial) {
        // already the workflow we want — just make sure it can skin
        src.skinning = true;
        if (src.map) summary.withDiffuse++;
        if (src.normalMap) summary.withNormal++;
        if (src.specularMap) summary.withSpecular++;
        // glossiness -> shininess (source gloss maps read as fairly matte skin/cloth)
        if (!src.shininess || src.shininess > 60) src.shininess = 18;
        src.needsUpdate = true;
        summary.converted++;
        return src;
      }

      const phong = new THREE.MeshPhongMaterial({
        name: src.name,
        color: src.color ? src.color.clone() : new THREE.Color(0xffffff),
        map: src.map || null,
        normalMap: src.normalMap || null,
        // spec/gloss: the specular map drives highlight colour directly
        specularMap: src.specularMap || src.metalnessMap || null,
        // glossiness ~= 1 - roughness, remapped into Phong's shininess range
        shininess: src.roughness !== undefined ? (1 - src.roughness) * 60 : 18,
        specular: new THREE.Color(0x222222),
        skinning: true,
        transparent: src.transparent,
        side: src.side,
      });
      if (phong.map) summary.withDiffuse++;
      if (phong.normalMap) summary.withNormal++;
      if (phong.specularMap) summary.withSpecular++;
      summary.converted++;
      return phong;
    });

    node.material = Array.isArray(node.material) ? rebuilt : rebuilt[0];
  });

  return summary;
}

/**
 * Uniformly scales the rig so its height matches the player footprint, centred
 * on x/z with feet on y=0. Derived from a measured Box3 — Mixamo FBX units are
 * centimetres, but that is confirmed rather than assumed.
 */
function normalize(model, targetHeight) {
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const s = size.y > 0 ? targetHeight / size.y : 1;
  model.scale.setScalar(s);
  model.position.set(-center.x * s, -box.min.y * s, -center.z * s);
  return { size, scale: s };
}

// ---------------------------------------------------------------------------
// INIT
// ---------------------------------------------------------------------------
Character.init = function (opts) {
  if (Character._loadPromise) return Character._loadPromise;
  const targetHeight = (opts && opts.targetHeight) || 1.85;
  const facingY = (opts && opts.facingY !== undefined) ? opts.facingY : Math.PI;

  if (window.AssetLoader) AssetLoader.add(4);

  Character._loadPromise = Promise.all([
    loadFBX(MODEL_FILE, 'character Ch09_nonPBR.fbx'),
    loadFBX(ANIM_FILES.run, 'run animation (Fast_Run.fbx)'),
    loadFBX(ANIM_FILES.jump, 'jump animation (Jump.fbx)'),
    loadFBX(ANIM_FILES.roll, 'roll animation (Quick_Roll_To_Run.fbx)'),
  ]).then(([model, runFbx, jumpFbx, rollFbx]) => {
    if (!model) {
      console.warn('[Character] character model missing — keeping placeholder character.');
      Character.ready = true;
      Character.usingFallback = true;
      return Character;
    }

    // The model's own baked take is Mixamo's reference pose, not gameplay —
    // drop it so it can never be bound to the mixer.
    const discarded = (model.animations && model.animations.length) || 0;
    model.animations = [];

    const mats = convertToPhong(model);
    const info = normalize(model, targetHeight);
    model.traverse((n) => { if (n.isMesh) n.frustumCulled = false; });

    Character._model = model;
    Character.root.rotation.y = facingY;
    Character.root.add(model);

    // ---- one lookup of stripped-name -> real node name, built once ----
    const nodeNamesByStripped = new Map();
    model.traverse((n) => {
      if (n.name) nodeNamesByStripped.set(stripNamespace(n.name), n.name);
    });

    Character.mixer = new THREE.AnimationMixer(model);

    const sources = { run: runFbx, jump: jumpFbx, roll: rollFbx };
    let bound = 0;
    Object.keys(sources).forEach((name) => {
      const fbx = sources[name];
      const clip = fbx && fbx.animations && fbx.animations[0];
      if (!clip) {
        console.warn('[Character] no AnimationClip in "%s" file — action unavailable.', name);
        return;
      }

      const unresolved = retargetClip(name, clip, nodeNamesByStripped);
      const rootTracks = stripRootMotion(clip);

      const action = Character.mixer.clipAction(clip);
      if (ONCE_ACTIONS[name]) {
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
      } else {
        action.setLoop(THREE.LoopRepeat, Infinity);
      }
      Character.actions[name] = action;
      bound++;

      console.log(
        '[Character]   %s -> "%s" %ss, %d tracks, %d root-motion track(s) flattened%s',
        name, clip.name, clip.duration.toFixed(3), clip.tracks.length, rootTracks,
        unresolved ? ', ' + unresolved + ' unresolved' : ''
      );
    });

    if (!bound) {
      console.warn('[Character] no animation clips bound — keeping placeholder character.');
      Character.root.remove(model);
      Character.ready = true;
      Character.usingFallback = true;
      return Character;
    }

    console.log(
      '[Character] Ch09_nonPBR ready — measured %s x %s x %s, scaled x%s to %su tall; ' +
      '%d material(s) -> Phong (diffuse %d / normal %d / specular %d); ' +
      '%d embedded take(s) discarded; %d/3 actions bound.',
      info.size.x.toFixed(1), info.size.y.toFixed(1), info.size.z.toFixed(1),
      info.scale.toFixed(5), targetHeight,
      mats.converted, mats.withDiffuse, mats.withNormal, mats.withSpecular,
      discarded, bound
    );

    Character.ready = true;
    Character.usingFallback = false;
    Character.playRun();
    return Character;
  });

  return Character._loadPromise;
};

// ---------------------------------------------------------------------------
// NAMED PLAY FUNCTIONS — the only surface the player state machine touches
// ---------------------------------------------------------------------------
/**
 * Crossfades to `name`, and is IDEMPOTENT: the player state machine calls
 * these every frame for as long as a state lasts, so re-requesting the action
 * that is already playing must be a no-op. (Resetting here instead would peg
 * the clip to frame 0 on every tick — the animation would look frozen.)
 * A fresh play-from-the-start happens naturally on a real state change, via
 * the reset() below.
 */
function fadeTo(name) {
  if (!Character.isActive()) return;
  const next = Character.actions[name];
  if (!next) return;

  if (Character.current === name) return;

  const prev = Character.actions[Character.current];
  next.enabled = true;
  next.setEffectiveWeight(1);
  next.reset().play();
  if (prev && prev !== next) prev.crossFadeTo(next, FADE, false);

  Character.current = name;
}

Character.playRun = function () { fadeTo('run'); };

/**
 * `windowSeconds` is the game's jump airtime. The source clip is ~2.2s but the
 * player is only off the ground for ~0.7s, so without scaling only the crouch
 * and take-off would ever be seen. Fitting the clip to the airtime makes the
 * take-off/apex/landing beats line up with the actual arc.
 */
Character.playJump = function (windowSeconds) {
  const action = Character.actions.jump;
  if (action && windowSeconds > 0) {
    action.timeScale = action.getClip().duration / windowSeconds;
  }
  fadeTo('jump');
};

/**
 * `windowSeconds` is the gameplay duck window (slide vs roll differ). The clip
 * is time-scaled to span exactly that window, so the character is still down
 * when the collision box is still low, instead of clamping upright early.
 */
Character.playRoll = function (windowSeconds) {
  const action = Character.actions.roll;
  if (action && windowSeconds > 0) {
    action.timeScale = action.getClip().duration / windowSeconds;
  }
  fadeTo('roll');
};

/** No idle clip ships with these assets — the run loop stands in on menus. */
Character.playIdle = function () { fadeTo('run'); };

// ---------------------------------------------------------------------------
// PER-FRAME UPDATE
// ---------------------------------------------------------------------------
Character.update = function (dt) {
  if (!Character.isActive()) return;
  if (Character.mixer) Character.mixer.update(dt);
};
