# Showcase 52 – Foliage Look Lab – Dev Log

Living log. Newest entries at the bottom, nothing is deleted.

## 2026-11-08 — Look presets for vegetation scenes

Trigger: ADR 0059 addendum (reference forest demo critique): tonemapping / colour management was the most praised non-geometry quality; cheapest visible lever.

- **Scene:** meadow (r 26 m) ringed by forest (to r 95 m), ~3.9 k scene objects via ADR 0046 auto-instancing. Kenney CC0 props loaded from `../51/assets/` (shared, not duplicated). Orbit camera at eye height.
- **Albedo fix:** Kenney palette is stylized (leaves `0.16,0.79,0.67` teal, bark salmon). Looks cannot be judged on it → lab swaps palette entries for measured-foliage sRGB ballparks, keyed by glTF-linear `baseColorFactor` (loader keeps no material names; `GltfMaterialParser.engineSRGBToLinear`).
- **Dropped:** `card_grass` / `card_bush` / `leaf_pile` (alpha cards) render as white discs with black back faces on WebGPU (texture/cutout path) → excluded here, finding reported to the showcase-51 owner.
- **Presets** (`@small-world-machine/vegetation-extras` → `FOLIAGE_LOOKS`, `applyFoliageLook`), tuned against `NEUTRAL` per sun situation:
  - `SUNNY_MEADOW`: PBR Neutral, exposure 1.25, contrast 1.05, saturation 1.08, temp 0.04. AgX was rejected for sunlit scenes: clear sky turned grey even at saturation 1.3 (AgX desaturates bright values).
  - `FOREST_SHADE`: AgX, exposure 1.35, saturation 1.15 — holds the bright sky behind dark canopies, brings shaded greens back.
  - `OVERCAST`: AgX, exposure 1.2, slightly cool, contrast 0.98 — soft and believable.
- **Sun situations:** high sun, low backlight, overcast (`L`). Backlight exposes the missing leaf translucency: sun-facing canopies are near black from the camera side → next step (foliage material, needs a lighting-chunk flag).
- **Controls:** `1–4` presets, `B` A/B against neutral, `L` sun, `R` reset view. QA hook `window.__qaSwm52` (`setLook`, `setSun`, `setReference`, `tune(patch)` for live tuning, `sample`).

## 2026-11-09 — Fly navigation

- Default camera = engine spectator flight (`defaultCameraController = "fly"`): WASD/arrows, Space/E up, C/Q down, Shift ×2.5, Alt ×0.35, click = pointer-lock mouse look, Esc releases. Base speed 12 m/s.
- Mouse wheel over the canvas scales the base speed ×1.25 per notch (1–120 m/s), shown in the readout.
- A/B reference moved from `B` to `V`: the engine base class toggles its debug overlay on `B`.
