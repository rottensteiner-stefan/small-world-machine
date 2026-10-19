# Shadows

Small World Machine renders real-time shadows via shadow mapping: Cascaded Shadow Maps (CSM) for
`DirectionalLight`, and single shadow maps for `SpotLight`. Both are implemented only on
**WebGL2 and WebGPU** — WebGL1 has no shadow-mapping path at all today; shadow-related
properties there are simply ignored.

## Overview

Any light can cast shadows, and any object can receive and/or cast them:

```typescript
import { DirectionalLight, Object3D, Color } from "@small-world-machine/engine";

const sun = new DirectionalLight({ color: Color.WHITE, intensity: 1.0 });
sun.direction.set(-1, -1, -1);
sun.castShadow = true;
scene.add(sun);

const cube = new Object3D("Cube");
cube.castShadow = true;
cube.receiveShadow = true;
scene.add(cube);
```

- `light.castShadow` (boolean, default `false`) — whether this light renders a shadow map at all.
- `object.castShadow` / `object.receiveShadow` (boolean, each default `false`) — whether this
  object is rendered into shadow maps, and whether its own shading samples them.

## Shared light properties (`AbstractLight`)

Every shadow-casting light shares these controls:

- `shadowResolution` (number, default `512`) — shadow map texture size. Directional lights
  pack all of their cascades into a single atlas of this size (see below); spot lights get
  one map of this size per light.
- `shadowBias` (number) — depth bias used to avoid shadow acne. Too small causes acne
  (self-shadowing stripes); too large causes peter-panning (the shadow visibly detaches
  from its caster).
- `shadowNormalBias` (number) — normal-offset bias: instead of just offsetting the compared
  depth value, the shadow map's *sample position* is offset along the surface normal
  (scaled by NdotL, see `REFERENCES.md`'s Catlike Coding source reference). Reduces acne and
  peter-panning simultaneously, so in practice you need much less `shadowBias` once this is
  tuned.

## Cascaded Shadow Maps (directional light)

`DirectionalLight` splits the camera frustum into multiple cascades — near cascades get more
of the shadow map's texel budget (sharper shadows near the camera), far cascades cover more
world-space area at lower texel density.

```typescript
const sun = new DirectionalLight({
  numCascades: 4, // default; 1-4 supported
  cascadeSplitLambda: 0.5, // 0 = uniform splits, 1 = logarithmic splits
});
```

On WebGL2, all cascades share a single shadow map **texture atlas** (packed into a
`ceil(sqrt(numCascades))`-column grid), so `shadowResolution` is the size of the *atlas*,
not the resolution of each individual cascade. On WebGPU, each cascade is a full-resolution
layer of a `texture_depth_2d_array` — no atlas packing is needed there.

Two polish passes run automatically, with no configuration needed:

- **Texel snapping** — each cascade's light-space center is rounded to that cascade's own
  texel grid before the ortho projection is built, so it doesn't drift by sub-texel amounts
  as the camera moves smoothly. Without this, CSM shadows visibly "flicker"/"crawl" from
  frame to frame.
- **Cascade blending** — near the far edge of a cascade, the shader blends toward the
  next cascade's shadow sample instead of cutting off hard, so the resolution seam between
  cascades doesn't visibly pop as the camera moves through the scene.

## Spot light shadows

`SpotLight` renders a single perspective shadow map from the light's position, shaped by
its own `angle`/`penumbra`/`distance` values. No cascades, no texel snapping (a single
perspective frustum doesn't flicker the same way CSM's tiled ortho frustums do).

## Filtering: PCF and PCSS

Both light types use **Percentage-Closer Filtering** (PCF) — a 3x3-tap average around the
shadow map sample that softens the hard binary in-shadow/out-of-shadow edge (see
`REFERENCES.md` for the original 1987 Reeves/Salesin/Cook paper).

Directional light shadows take this a step further with **PCSS** (Percentage-Closer Soft
Shadows, Fernando 2005): a *blocker search* reads the raw (non-comparison) shadow map depth
around the sample to estimate how far away the nearest occluder is, then scales the PCF
radius based on that distance — shadows read as sharp right at the contact point and
progressively softer the farther they are from their caster, instead of being uniformly soft
everywhere. This only applies to the **primary** cascade a fragment falls into; the secondary
cascade-blend sample (see above) still uses fixed-radius PCF, so as not to double the cost in
the blend zone. **Spot light shadows use only fixed-radius PCF** — no PCSS — since they are
typically smaller/less prominent in today's scenes; see
`docs/research/aaa-engine-techniques.md` for the exact scope and the reasoning behind that
trade-off.

## Tuning tips

- Start with `shadowNormalBias` around `0.02–0.05` and `shadowBias` around `0.001–0.005`;
  increase `shadowNormalBias` first if you see acne, since that fixes acne without
  introducing peter-panning the way increasing `shadowBias` does.
- Increasing `numCascades` sharpens near shadows, but costs more atlas space per cascade on
  WebGL2 (each cascade gets a smaller slice of the same `shadowResolution` atlas) — increase
  `shadowResolution` alongside it if cascades start looking blocky.
- Shadows are relatively expensive; the static per-tier policy (ADR 0035) lowers caps such as
  `maxShadowResolution` on `LOW`/`MEDIUM` devices. The former single `autoDowngrade` boolean no
  longer exists — the engine now resolves a quality tier exactly once at startup
  (`QualityConfigResolver` over `DeviceCaps.getPerformanceTier()`, URL override
  `?tier=low|medium|high`), and any value you set explicitly in `quality` wins against the tier
  (see `docs/guides/configuration.md`).
