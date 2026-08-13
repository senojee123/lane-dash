# Branding opportunities — Lane Dash

Reference for whoever wires this game into the platform's sponsor/brand
admin UI later. Two kinds of surface below: **live today** (edit a file,
see it in-game) and **identified but not built** (a real opportunity,
scoped, with the reason it's not done yet).

Every "live today" surface funnels through two content-pack files —
`games/lane-dash/brand.js` (`RunnerBrand`) and `games/lane-dash/billboards.js`
(`RunnerBillboards`) — applied by one function, `applyBrandConfig()` in
`engine/runner.js`. That function is written to be safe to call again with
new values, which is the seam a live hot-reload transport plugs into later
without touching game mechanics (see `brand.js`'s header comment).

## Live today

| Surface | Field | File | Notes |
|---|---|---|---|
| Sponsor logo | `RunnerBrand.sponsorLogoUrl` | `brand.js` | Shown above the title on **every** overlay screen — loading, start, game-over, pause. The one guaranteed-seen placement; every player passes through these screens, unlike billboards which are peripheral to actual gameplay. Plain `<img>`, own aspect ratio, `null` = no logo shown (no reserved gap). |
| Collectible name | `RunnerBrand.collectibleLabel` | `brand.js` | Renames "coins" everywhere it appears: HUD, bank-line, game-over, pause. |
| Collectible color | `RunnerBrand.collectibleColor` | `brand.js` | Recolors both the HTML HUD dot and the in-game 3D coin mesh. |
| Collectible face image | `RunnerBrand.collectibleImageUrl` | `brand.js` | Optional logo composited onto the coin's flat face (ring stays plain `collectibleColor`). `null` = plain color disc. |
| Score / multiplier / best labels | `RunnerBrand.scoreLabel` / `.multiplierLabel` / `.bestLabel` | `brand.js` | UI copy only, no visual asset. |
| In-game billboards | `RunnerBillboards` array | `billboards.js` | `{ type: 'image'\|'video', url }` entries, picked at random per billboard slot (rooftop-mounted or in open-lot car parks — see `theme.js`'s `CITY_ROWS[0]` for placement odds). Empty array = every slot shows a neutral "YOUR AD HERE" placeholder, so ad inventory always reads as intentional even unconfigured. |
| Brand color palette | CSS custom properties (`--rd-gold-1`, `--rd-gold-2`, `--rd-accent-3`, `--rd-accent-4`, `--rd-highlight`, `--rd-mult-color`, `--rd-collectible-color`, `--rd-bg`) | `index.html`'s `:root` block (values), `engine/runner.css`'s `:root` (what each one controls) | Title gradient, HUD accents, buttons, background. Not currently driven by `RunnerBrand` / hot-reloadable — a reskin edits the CSS block directly today. Worth promoting into `RunnerBrand` if the platform needs to push color changes live. |

All of the above currently point at one placeholder image (a user-supplied
logo URL) across every optional slot, just to exercise the full surface —
swap each field independently once real per-sponsor assets exist.

## Identified, not built

| Idea | Why it's not done |
|---|---|
| **Vehicle livery** — sponsor logo/colors on the traffic cars, reusing the same texture-compositing (`BillboardMedia`) the billboards already use. Seen constantly during gameplay rather than glanced at peripherally. | Explicitly deferred by request — not wanted right now. |
| **Character outfit branding** — a jersey logo on the player rig. | Needs a different approach than the other image-composite surfaces: the player is a rigged/skinned Mixamo FBX (`games/lane-dash/character.js`), not a simple primitive or a flat UI panel, so texture-painting a logo onto it isn't a drop-in of the existing `BillboardMedia` pattern — would need its own scoped design pass. |
| **End-of-run shareable result card** | Not scoped yet — a static image/canvas render of the score screen a player could save/share, watermarked with the sponsor logo. Pure UI, no 3D work; reuses the same `sponsorLogoUrl` already in place. |
| **Audio branding** (jingles/stings tied to brand) | Not scoped — no sponsor-audio system exists at all today (game has no music/SFX layer yet to hook into). |

## Content-pack boundary, for context

Everything above lives in `games/lane-dash/` (this reskin's content pack),
never in `engine/` (generic mechanics, shared by any reskin — see
`engine/README.md`). A different sponsor reskin is a copy of the
`games/lane-dash/` folder with its own `brand.js` / `billboards.js` /
`index.html` `:root` block; `engine/runner.js`'s `applyBrandConfig()` and
the billboard placement code don't change per reskin.
