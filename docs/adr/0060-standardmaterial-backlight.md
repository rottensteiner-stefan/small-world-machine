---
status: proposed
---

# 0060: `StandardMaterial.backlight` — thin-surface sun transmission, lane `u_matParam1`

- **Status:** Accepted (2026-11-09, moderator; proposed 2026-11-08 on branch `veg-look`)
- **Date:** 2026-11-08
- **Trigger:** ADR 0059 addendum (reference forest demo critique: light through leaves was praised) + showcase 52: under a low backlit sun, canopies render near black from the camera side.

## Decision

- **Feature:** `StandardMaterial.backlight: Color` (sRGB, black = off, Godot `StandardMaterial3D.backlight`) and `backlightThickness: number` (metres, default 0.5). Consumers: foliage, grass, paper, curtains, ears (≥ 3 semantic consumers, ADR 0047).
- **Model (directional light only):** `Lo += backlight_lin * diffuseAlbedo / pi * sunColor * shadowT * (max(dot(-N, L), 0) + pow(max(dot(-V, L), 0), 6))` — wrap from the unlit side plus a forward lobe when looking toward the sun. Point/spot lights unchanged.
- **Transmission shadow (`shadowT`):** sampled at `worldPos + L * backlightThickness` in the same cascade. Closed crowns (low-poly trees) would otherwise occlude their own back side completely; offsetting by the crown depth lets light through the own crown while other casters still shadow it (Crysis-style thickness trick, one extra cascade lookup only for backlit materials).
- **Compile gate:** `ShaderFlag.BACKLIGHT` (`USE_BACKLIGHT`) iff the tint is not black; zero cost otherwise (transition test: back to black removes the flag).
- **Lane:** `u_matParam1 = (backlight.rgb, backlightThickness)`. Lane tables are per material (ADR 0039); lanes 1..9 carry other materials' semantics (OpenWater, Lava, Decal) but no program that shares the PBR chunk writes lane 1 (Decal uses 4/6, guarded by test). This refines ADR 0055's "bank full" statement: the bank is full for lanes StandardMaterial shares with no one (10..15); a lane from 1..9 is usable by StandardMaterial when no chunk-sharing program owns it. Bank growth stays the route once that is exhausted.
- **Tiers (ADR 0057):** WebGPU + WebGL2 full (shadowed transmission). WebGL1: transmission unshadowed — its PBR chunk has no directional shadows at all, so this matches the tier.

## Rejected

- **`FoliageMaterial` in `vegetation-extras` with a private shader:** duplicates the cascade/PCSS/EVSM shadow code per dialect or needs an engine hook anyway; the lighting chunk is the single place that has the sun shadow in scope.
- **Unshadowed transmission everywhere:** interior leaves of a forest would glow; the reference look depends on canopy self-occlusion.
- **Plain shadow without thickness offset:** kills transmission on every closed crown (verified in showcase 52).
- **Growing the lane bank now:** UBO size change for all materials and tiers (ADR 0055) for a feature that fits an unshared lane.

## Consequences

- One extra shadow lookup per fragment for backlit materials on WebGPU/WebGL2.
- Glossy back-face specular is not modelled; leaves stay diffuse-transmissive.
- Tests: `MaterialBacklight.test.ts` (lane + flag transition, three-dialect parity, GLSL 1.00/3.00 compile with the flag, WGSL parse). Visual check: showcase 52 (`K` toggles), WebGPU/WebGL2/WebGL1.

## Doctrine Compliance

- **New public hot-scope parameters (classification):** `StandardMaterial.backlight` and `backlightThickness` are `@domain` (authoring values, defaults black / 0.5 m). Lane `u_matParam1` contents are `@derived` (copied verbatim).
- **Shared abstraction >= 3 consumers?** No new abstraction; reuses the typed-lane mechanism (ADR 0027 / 0039) and the existing cascade shadow helpers. The feature itself has ≥ 3 semantic consumers (foliage, paper/curtains, skin edges).
- **Modeful object?** Single enable basis (`backlight` not black) for the `USE_BACKLIGHT` flag. Transition test: returning to black removes the flag (`MaterialBacklight.test.ts`).
- **Mathematical claims:** none beyond the lobe definition; no energy-conservation claim (artistic tint, like Godot). No registry invariant claimed.
- **Fail-closed / honest fallback:** not render-critical. WebGL1 renders the transmission unshadowed because the tier has no PBR sun shadows; documented above.
- **Exceptions:** none.
