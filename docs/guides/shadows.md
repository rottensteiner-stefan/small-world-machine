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
radius based on that distance. The engine's WebGPU PCSS is *principled and stable*: the radius
is derived from the perspective-normalized receiver/blocker depth gap (decoupled from the
acne `bias`, which only guards the depth compare) over a **deterministic** sunflower blocker
disk, so the result is reproducible run-to-run and the softness knobs below re-tune the
penumbra cleanly. **Status note (0.115.7):** *contact-hardening is demonstrated and gated.* A
`?probe=pole` thin-cylinder probe on Showcase 42 shows the PCSS "sharp at the caster, soft in
distance" signature: the contact line at the caster base stays hard and deep while the penumbra
grows with distance and the far zone diffuses into a wide, shallow gradient — measured on-screen
as near-zone umbra contrast `0.61` collapsing to `0.26` at max distance, versus a WebGL2
negative control (fixed PCF) that holds `0.60` everywhere (see
`scripts/check-swm42-pole.mjs`, live gate: `SWM42 POLE GATE: OK`). The previously-anticipated
*adaptive* blocker search proved unnecessary for that hardening — the fixed sunflower disk does
not destroy it for a thin occluder. A wide, box-shaped blocker *remains* uniformly soft, which
is fundamental geometry: the search disk then averages the occluder's whole depth span. This
only applies to the **primary** cascade a fragment falls into; the
secondary cascade-blend sample (see above) still uses fixed-radius PCF, so as not to double
the cost in the blend zone. **Spot light shadows use PCSS on WebGPU only**; on WebGL2 they
stay at fixed-radius PCF. See [ADR 0006](/adr/0006-pcss-directional-light-only) for the
scope. Only the first 4 spot lights get a shadow map.

### PCSS softness tuning (WebGPU)

The PCSS penumbra (the *softness* of the shadow, i.e. how wide the gradient band is) is a global,
quality-style knob — not per light — and lives on `EngineOptions.quality` like every other quality
axis (config hint > tier > heuristic; the ADR 0035 override-lock applies: anything you set explicitly
wins against the tier policy):

```typescript
const engine = new Engine({
  // ...
  quality: {
    // Since 0.115.6 the radius is principled (perspective-normalized receiver/blocker gap,
    // decoupled from the acne bias) and the default cap governs the look — the gate proves the
    // knob re-tunes the penumbra and WebGL2 stays a byte-exact no-op. Set these to resize it.
    shadowSoftness: 1.0,       // penumbra scale multiplier; >1 widens, <1 narrows the soft band
    shadowMaxPcfRadius: 4.0,   // cap on the variable-radius PCF kernel, in shadow-map texels
  },
});
```

- `shadowSoftness` (default `1`) multiplies the PCSS penumbra estimate. It is the honest "softness"
  control for directional/spot PCSS on WebGPU.
- `shadowMaxPcfRadius` (default `4`) caps how many shadow-map texels the variable-radius PCF may
  reach. To get genuinely wider penumbras you normally raise both together — a `shadowSoftness` far
  above 1 with the default cap just saturates the kernel back to the cap.
- These knobs are **WebGPU-only today**: they are no-ops on WebGL2 (which has no PCSS, only fixed
  PCF) and WebGL1 (no shadow mapping at all).

## Tuning tips

- Start with `shadowNormalBias` around `0.02–0.05` and `shadowBias` around `0.001–0.005`;
  increase `shadowNormalBias` first if you see acne, since that fixes acne without
  introducing peter-panning the way increasing `shadowBias` does.
- Increasing `numCascades` sharpens near shadows, but costs more atlas space per cascade on
  WebGL2 (each cascade gets a smaller slice of the same `shadowResolution` atlas) — increase
  `shadowResolution` alongside it if cascades start looking blocky.
- Shadows are relatively expensive; the static per-tier policy (ADR 0035) lowers caps such as
  MSAA/anisotropy and disables post effects on `LOW`/`MEDIUM` devices (there is no separate
  shadow-resolution cap — the directional light's own `shadowResolution` is the resolution).
  The former single `autoDowngrade` boolean no
  longer exists — the engine now resolves a quality tier exactly once at startup
  (`QualityConfigResolver` over `DeviceCaps.getPerformanceTier()`, URL override
  `?tier=low|medium|high`), and any value you set explicitly in `quality` wins against the tier
  (see `docs/guides/configuration.md`).
- If a WebGPU PCSS shadow reads too soft or too hard for a scene, adjust `shadowSoftness`
  (direction) and `shadowMaxPcfRadius` (bandwidth ceiling) instead of fighting the depth `bias` —
  those tune the penumbra, not the acne/peter-panning trade.

## EVSM — Exponential Variance Shadow Mapping (opt-in)

**EVSM** (ADR 0043) filters **variance moments** instead of tap-counting PCF/PCSS. The moment
atlas stores the exponentially warped depth `(e^{40·d}, e^{80·d}, -e^{-40·d}, e^{-80·d})` with
`d ∈ [-1,1]` (Filament-style warp, `c = 40`), and the evaluation runs a one-sided Chebyshev upper
bound hardened by a **dynamic** variance-floor multiplier and a light-bleed reduction. Because
moments are filtered ahead of time, soft penumbras do not cost extra PCF taps — the smoothing is
baked into the moment atlas.

```typescript
const engine = new Engine({
  quality: {
    shadowMode: "evsm", // opt-in; default "pcss" stays byte-identical
  },
});
```

- `quality.shadowMode` (`"pcss" | "evsm"`, default `"pcss"`) — switches directional-light shadow
  filtering to the EVSM moment path. The default `pcss` code path is **byte-identical** whether or
  not `evsm` exists (guarded by `EvsmGlslGuards.test.ts` plus the golden default run).
- **Backend support:** WebGPU and WebGL2 both implement EVSM (Tiered-Renderer autonomy — the API
  tier never removes a feature the hardware can run). On **WebGL2** the moment atlas requires the
  `EXT_color_buffer_float` extension; without it the engine **honestly falls back** to the default
  shadow method with a console warning instead of rendering a broken frame.
- **Tuning lanes** (GlobalUniforms `evsmParams`, WebGPU lanes `[216..218]`; mirrored on WebGL2):
  mode flag, variance-floor **multiplier** (default `0.002`), light-bleed-reduction amount (default
  `0.004`). The floor is a multiplier on the squared first moment, not a flat floor — the exponential
  warp expands variance enormously, so a flat floor is wrong.

> **Status note (0.116.0):** The WebGPU EVSM path renders and is live-gated on showcase 42
> (`scripts/check-swm42-evsm.mjs`: error-free run, `evsmParams[0]=1` mode lane under `shadowMode=evsm`,
> plausible frame). Its look is currently **washed-out** (the contact zone reads shallow) — that is a
> calibration matter of the tuning default lanes, not an architecture gap. WebGL2 EVSM was black on
> the software stack at the start of Stage C; root cause was **not** a driver float-sampling issue but
> two real engine state bugs (the material-sampler loop re-pointed `u_dirEVSMMap` to a white
> default texel after the atlas bind, and the fixed unit 14 collided with the cluster-grid unit).
> Both are fixed in 0.116.0 — WebGL2 EVSM renders a real shadow with the default path untouched
> (see ADR 0043 for the full record).
