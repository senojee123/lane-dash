# Lane Dash engine

A 3-lane endless runner engine (jump / slide / roll, coins × distance
multiplier scoring), extracted from the original `Lane Dash` game so the same
mechanics can be reskinned into different branded games without editing
engine code. Plain `<script>` tags, no build step, no bundler — Three.js
loads from a CDN and every file here shares one global script scope, the
same way `touch-controls.js` already shared state with the old `game.js`.

## Files

- `asset-registry.js` — `AssetRegistry.create()` / `MeshPool` / `ModelCache`:
  turns a content pack's declared assets (primitives or glTF models) into
  spawnable, poolable meshes. Nothing game-specific.
- `leaderboard-client.js` — fire-and-forget `submitScore(name, score)`
  against Supabase. Table/project come from the pack's `config.js`.
- `touch-controls.js` — swipe gestures, calls the same
  `tryLaneChange/tryJump/trySlide` the keyboard handler uses.
- `runner.js` — the actual engine: scene/camera, input, player physics,
  track/segment generation, collision, scoring, HUD/pause/game-over state
  machine, main loop. This is the file that defines "Lane Dash" as a genre —
  it doesn't change per reskin.
- `runner.css` — structural CSS (layout, animation, HUD), themed via a
  handful of CSS custom properties a pack overrides in its own `index.html`.
- `billboard-media.js` — `BillboardMedia.getTexture(creative)`: turns a
  `{ type: 'image'|'video', url }` descriptor into a cached THREE.Texture
  (video textures muted/looping/autoplaying), or a placeholder panel if
  `creative` is missing/fails to load. Only depends on THREE, no game
  knowledge — same media-loading code works for any content pack.

## What a content pack owns

Everything under `games/<name>/` — see `games/lane-dash/` as the reference
pack. A new reskin is: copy that folder, then edit/replace:

| File | What it controls |
|---|---|
| `assets/` | Character rig + animations, city/vehicle GLBs, textures |
| `assets.js` | Palette, shared geometries/materials, procedural obstacle/coin/scenery builders, `AssetRegistry` entries + footprints |
| `cityModels.js` | Building GLB manifest — `CityModels.spawn/FULL_BUILDING_KEYS/LOW_BUILDING_KEYS/VARIANT_KEYS` |
| `trafficVehicles.js` | Vehicle GLB manifest — `TrafficVehicles.pick()/KEYS`. **Optional**: omit this file (and don't register any vehicle keys) to run a car-free reskin; `runner.js` detects a missing/empty `TrafficVehicles.KEYS` and forces vehicle-row chance to 0 instead of crashing |
| `character.js` | Player rig/animation loading. Falls back to a procedural box character if it fails, so this is optional too |
| `theme.js` | Every game-feel tuning number — speed, camera framing, track scale, scoring curve, city row layout, obstacle-class weights, rest-stretch cadence. Static per reskin, not meant to change live |
| `brand.js` | Sponsor-controlled: the collectible's name + color, and the score/multiplier/best labels. This is the layer meant to be live-patchable later (see its header) — separate from `theme.js` on purpose |
| `billboards.js` | Sponsor-controlled: `RunnerBillboards`, an array of `{ type, url }` ad creatives shown round-robin on the in-world billboards. Also live-patchable-later, same reasoning as `brand.js`. Billboard *placement* (how often, how far off the road) is `theme.js`'s `BILLBOARD` block instead — layout is game-feel, creatives are sponsor content |
| `index.html` | Branding copy (title/subtitle/game-over text) and the CSS custom-property overrides for brand colors (`:root` block — see `engine/runner.css`'s header) |
| `config.js` (gitignored, copy from `config.example.js`) | Supabase project URL/key + `SCORES_TABLE` for this deployment |

## Content contracts `runner.js` relies on

Since there's no module system, these are duck-typed globals `runner.js`
expects to exist after your pack's scripts load, keyed by shape rather than
import:

- `AssetRegistry` (declared in your `assets.js`) + `Palette`/`Geo` (used by
  `asset-registry.js`'s fallback-box placeholder).
- `CityModels.FULL_BUILDING_KEYS` / `LOW_BUILDING_KEYS` / `VARIANT_KEYS`, and
  `applyCityModelVariant()`.
- `TrafficVehicles.pick(avoidKey)` / `.KEYS` — optional, see table above.
- `Character.init/isActive/playRun/playJump/playRoll/playIdle/update` —
  falls back to the procedural placeholder if this pack skips it.
- `RunnerTheme` (your `theme.js`) — every field `runner.js` reads is
  documented inline in `games/lane-dash/theme.js`; `OBSTACLE_KEYS` and
  `SCENERY_KEYS` are the two places genre mechanics touch your specific
  `AssetRegistry` key names, so rename/add obstacle or scenery types there,
  never in `runner.js`. `SCENERY_KEYS.billboard` must resolve to an
  `AssetRegistry` entry whose built mesh tags its ad panel at
  `group.userData.panel` (see `buildBillboard()` in `games/lane-dash/assets.js`)
  — that's how `runner.js` finds the mesh to retexture per instance.
- `RunnerBillboards` (your `billboards.js`) — optional; an empty/missing
  array just means every billboard slot shows the placeholder panel.

## Script load order (index.html)

Content that *declares* globals must load before engine code that *attaches
to* them. See `games/lane-dash/index.html` for the working order and its
inline comment on why `assets.js` loads before `engine/asset-registry.js`
(not the other way around).

## Known gaps (not yet pulled into theme.js)

Sky color, fog distance, and scene lighting intensities are still hardcoded
in `runner.js`'s scene-setup section rather than themed — a reskin that
wants a different sky/mood edits those lines directly for now. Worth
extracting alongside `theme.js`'s other visual knobs if a second pack
actually needs it.

## Leaderboard

`leaderboard-display/` is a separate, independently-deployed static site
(its own README) that polls the same Supabase table this pack's
`config.js` writes to — point both at the same `SUPABASE_URL` +
`SCORES_TABLE` for one deployment.
