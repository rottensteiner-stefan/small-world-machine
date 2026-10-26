# Showcase 10 – Waterworld & Liquid Gallery – Dev Log

Living log. Newest entries at the bottom, nothing is deleted.

## Pool inventory (state 2026-10-10)

16 pools on a 4 x 4 grid (`PoolLayout.ts`, pitch 9 x 15 m, centered on the origin). Each pool is one entry in `PoolPresets.ts`.

| Row | Pools |
|---|---|
| 0 | clear-water, wave-rider (buoyancy, density 1.0), dead-sea (buoyancy, density 1.24), toon-water |
| 1 | bold-anime, soft-watercolor, painterly-sparkle, dredge |
| 2 | noir-graphic, molten-lava, toxic-slime, petroleum-oil |
| 3 | lava-volcanic, lava-infernal, lava-plasma, lava-toxic (Stylized Lava) |

`POOL_GRID_ROWS` stays 3 on purpose: row 3 hangs southward off the original grid, so rows 0-2 keep their world positions and goldens.

## Tools

- **LiveTunePad** (`LiveTunePad.ts`): keyboard tuning of the toon pool's `StylizedWaterMaterial` (keys 0, G, arrows). Only active with `?tune=1`; detached in `destroy()`.
- **Golden mode** (`GoldenCapture.ts`): `?rendererType=<R>&__golden=<poolKey>&__goldenView=top|oblique&__goldenFrames=<N>`. Pins a 1024x576 surface, resets the clock and the buoyancy bodies, steps N frames at 1/60 s, then replays `step(0)` so the buffer stays presentable. Driven by `scripts/goldens/capture.js`. The tile textures use a seeded RNG injected into the texture factories (no global `Math.random` override any more).
- **`?__rampVerify=1`**: installs `window.__rampVerify` for scratch checks of `StylizedWaterMaterial.rampMap`.

## 2026-10-10 – Stylized Lava port (v0.100.x)

Decision: the four south-terrace pools use the engine's `StylizedLavaMaterial` (port of MinionsArt "Astro Kat"), one pool per `RampLUT` preset; `lava-volcanic` is the faithful two-color reference without ramp, the other three differ only in ramp, flow speeds and fissure/shore colors.

- The shader needs the PolyBrush vertex-color mask. We paint it in code: `createLavaSurface()` builds a horizontal `Ground` and writes red = 1 in the pool, falling to 0.15 at the walls (smoothstep over 0.45 m) so crust and waves calm down at the rim. This is why `Mesh` got vertex-color plumbing (separate vertex-color buffer, GL1/GL2/WebGPU), and why `PoolPreset.createSurface` replaces the default vertical `Plane`.
- `waveHeight` 0.07 instead of Astro Kat's 0.28 (that value is scaled for a lake).
- With a ramp the HDR-hot ramp colors get `brightnessUnderLava 0.9 / brightnessTopLava 2.2 / tintOffset 0.85`.
- Inputs `lava_main.webp` / `lava_distort.webp` come from `scripts/gen-lava-textures.mjs`, sampled at world XZ, so they repeat.

## 2026-10-10 – Decomposition of showcase.ts

`showcase.ts` had grown to 2766 lines (`setupScene` ~700 lines with 12 near-identical pool blocks). Split without behavior change:

| File | Content |
|---|---|
| `PoolLayout.ts` | constants, `PoolKey`, grid cells, `poolWorldPosition` |
| `PoolPresets.ts` | the 16 pools as data (`POOL_PRESETS`), lava surface painting |
| `PoolProps.ts` | `PropSpec` + `PoolProps` (crate, ball, debris, barrel, buoy, gear, pipe) |
| `PoolTextures.ts` | procedural tile / crate / buoy canvas textures, tile palettes |
| `PoolBehaviors.ts` | `PoolHomeBehavior`, `SplashDropBehavior` (magic numbers now named) |
| `GoldenCapture.ts` | golden mode, ramp verify hook |
| `showcase.ts` | scene assembly (~800 lines), pool building, signboards, per-frame update |

Review fixes done in the same pass: global `Math.random` override removed (RNG injected), golden resize listener / repaint rAF released in `destroy()`, LiveTunePad behind `?tune=1` and detached, noir ripple tuples reused per frame, noir pool position computed once, orphaned `_buildPool` JSDoc restored.

Verification: pixel comparison of all 16 pools (GL2, top view) before/after = 0 differing pixels. Note: other agents edit the engine concurrently, so the comparison is only meaningful when old and new showcase are built back to back against the same engine state.

Assets: removed unused `crate_*.webp` (16) and `grass.png` from this app's assets (about 9.5 MB; Showcase 12 has its own copies). Known leftovers, not touched: other unreferenced maps in `assets/` (`lava*`, `rock*`, `sand`, `slime*` non-bubble variants), and the scratched-steel texture set is duplicated in Showcases 12, 28 and 30.

Not done: procedural canvas textures have no dispose path (`Texture` has no `dispose()`), so they are only released with the engine instance.

## 2026-10-21 – 3D Depth & Foliage for Grass Surface

Upgraded the flat ground plane to full PBR lighting and 3D silhouette foliage:
- **Ground Material (PBR):** Replaced `WorldMaterial` (flat Lambert diffuse) with `StandardMaterial`.
- **Texture Maps:** Generated multi-scale Sobel `grass_normal.webp`, micro-roughness `grass_roughness.webp`, and cavity `grass_ao.webp` from `grass.webp`. Directional sun, point lights (lava/slime), and cascaded shadow maps now react plastically with blade micro-relief.
- **3D Foliage & Silhouette (`BillboardInstancer`):** Generated `grass_tuft.webp` (512x512 alpha-tested blade clump). Instantiated 750 camera-facing billboard tufts hugging the concrete pool curb edges and scattered along walkways, breaking up the harsh 90-degree pool rim intersections.


### 2026-10-25 (WebGL2: PCSS-Schatten auf Flüssigkeiten)
- Die Liquid-Shader (`dir_shadow.glsl`, eigener Header) nutzen unter WebGL2 jetzt dieselbe PCSS-Funktion wie die Standard-Materialien (Chunk `DIR_PCSS`, ADR 0006) statt festem 3×3-PCF. `quality.shadowSoftness`/`shadowMaxPcfRadius` wirken damit auch auf Schatten auf Wasseroberflächen. Live geprüft: alle 12 Flüssigkeiten rendern unter WebGL2, Konsole fehlerfrei.

### 2026-10-26 (Planar-Reflexion auf Wasser)
- Alle OpenWater- und StylizedWater-Becken (Noir ausgenommen) spiegeln die Szene über **einen** gemeinsamen `PlanarReflectionNode` auf `LIQUID_Y` (alle Becken teilen die Ebene); die Flächen aller Becken stehen in `excludedObjects`. Der Node schneidet per schräger Near-Plane alles unter Wasserlinie − 0,15 m ab (`REFLECTION_CLIP_DEPTH`): Beckenböden (−1,35 m) fallen raus, Gras und Randsteine bleiben.
- `?reflection=0|1` erzwingt aus/an; ohne Parameter an, im Golden-Modus aus (die Baselines kennen die Spiegelung nicht, Golden-Aufnahmen bleiben pixelgleich). `?__golden=<pool>&__goldenView=oblique&reflection=1` liefert eine deterministische Nahaufnahme zur Sichtprüfung.
- Live geprüft auf WebGPU, WebGL2, WebGL1 (Kiste, Ball, Fass und Himmel spiegeln sich unter der Wasserlinie, Orientierung stimmt). Kosten: eine zweite Szenen-Pass pro Frame.
