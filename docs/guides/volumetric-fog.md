# Volumetric Fog (Froxels)

True 3D volumetric fog ("Froxel Stage 3", Stufe 3 of the fog & volumetric lighting roadmap) —
a frustum-aligned 3D volume that accumulates in-scattering against local and directional lights
and composites it into the scene *before* tonemapping. Design and decisions: ADR 0031; the
binding grid formula lives in `packages/engine/src/math/froxel.ts`.

This effect is **opt-in and WebGPU-only in V1**. WebGL2 (CPU culling + data texture, same
formula) is a planned follow-up (P2); WebGL1 stays on the analytic fog of `Scene.fog`.

## Relationship to the other fog layers

| Layer | Purpose | Backends |
|---|---|---|
| `Scene.fog` (analytic) | Stufe 1 distance/height fog, always available | WebGL1 / WebGL2 / WebGPU |
| `LightShaftsElement` | Stufe 2 crepuscular rays against CSM | All (hybrid tiers) |
| `VolumetricFogElement` | Stufe 3 true 3D volume, local + directional light | WebGPU only (V1) |

The analytic fog stays active in parallel; the volumetric contribution is **strictly additive**
to it, never a replacement.

## Enabling the effect

`VolumetricFogElement` is a post-processing element, off by default like `LightShaftsElement`:

```ts
const fog = new VolumetricFogElement();
fog.enabled = true;
fog.density = 0.02;        // scattering extinction coefficient of the medium
fog.maxDistance = 80;      // clamped against the scene far plane
fog.intensity = 1.0;       // overall in-scattering multiplier
app.postProcessing.add(fog);
```

## Parameters

| Property | Default | Meaning |
|---|---|---|
| `density` | `0.02` | Scattering/extinction coefficient; denser volume = more pronounced shafts. |
| `height` | `0.0` | World-space baseline of the fog layer; density falls off above it. |
| `heightFalloff` | `1.0` | Exponential height falloff coefficient (`0` = uniform density volume). |
| `maxDistance` | `80.0` | Max world-space evaluation distance (clamped to the far plane). |
| `intensity` | `1.0` | Overall multiplier of the accumulated in-scattering. |
| `asymmetry` | `0.4` | Henyey-Greenstein `g`, `-1..1`. Positive = forward scattering towards the light. |
| `castDirectionalShadow` | `true` | Directional (sun/moon) self-shadowing through the existing CSM. |
| `color` | white | Tint of the in-scattered light (multiplied by each light's color). |
| `jitter` | `0.25` | Interleaved gradient noise strength to break raymarch banding (`0` disables). |

## How it works (V1 data flow)

1. **Injection (compute)** — every froxel cell takes its density (analytic height falloff) and
   accumulates local-light in-scattering from the light list the *same* cluster cell already
   culls (ADR 0007 / Option R). Grid and volume can never disagree about which lights reach a cell.
2. **Integration (ray-march)** — per pixel, from near to the opaque surface depth (or
   `maxDistance`), with the directional contribution and **CSM self-shadowing** evaluated per
   step. Interleaved gradient noise breaks up banding.
3. **Composite** — the integrated scattering texture adds into the HDR buffer **before
   tonemapping** through the dedicated post-processing composite (same pattern as
   `u_lightShaftsEnabled`).

Because the volume reuses the cluster grid, neither a second culling pass nor any extra shadow
pass exists — the directional shadowing reuses the existing CSM of Stage 2 (ADR 0030).

## Notes & roadmap

- **WebGL2 tier (P2):** CPU culling + data-texture lookup on the *same* grid formula is the
  documented parity path; `froxel.ts` is the single source of truth both backends mirror.
- **Performance gate:** the full volumetric path targets ≤ ~1.5–2 ms on desktop GPU (P3);
  grid resolution follows the cluster grid screen tiles in V1.
- **Rejected:** Voxel Cone Tracing (VCT/VXGI) — too much VRAM (`O(N³)`), aliasing/leaking on
  dynamic geometry, unsuitable for web/mobile.
