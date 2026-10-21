# 0031: Volumetric Froxel Fog (Stufe 3, WebGPU Compute & WebGL2 Parity)

> **Status note (2026-10-21):** Status of the scope question: V1 was WebGPU only; WebGL2 parity followed on 2026-10-17 (hybrid architecture, see the update above). Later look retunings are recorded only in `CHANGELOG.md`. Test and performance numbers are a snapshot.

- **Status:** Accepted & Implemented
- **Date:** 2026-10-16 (Updated 2026-10-17 for v0.110.0)
- **Status of:** *[2026-10-16 Complete, 2026-10-17 v0.110.0 Refinements]* 3-Tier Fog Standard, Stufe 3
- **Decision Makers:** Small World Machine Architecture Team (human-approved 2026-10-16)

---

## Context & Motivation

The fog & volumetric lighting roadmap (`.agents/notes/backlog.md`, Stufe 1..3) mandates a true
3D volumetric fog layer as the third tier:

- **Stufe 1** — classic analytic distance/height fog (`Fog.ts`, all backends). ✅
- **Stufe 2** — volumetric light shafts (God Rays, ADR 0030), 2-tier hybrid across all backends. ✅
- **Stufe 3** — real 3D in-scattering against local + directional lights ("froxels"). ✅

W1 of `docs/research/aaa-engine-techniques.md` explicitly requires a Frustum-aligned voxel grid
("froxels", e.g. 160×90×64 in the reference texts) that **reuses the clustered-light
infrastructure** for per-cell light lists (ADR 0007), with a Mie/Henyey-Greenstein phase function,
raymarch/Z-integration in compute, and additive compositing before tonemapping.

### Open questions that had to be decided

1. **Grid coupling** — build an own dense 3D grid (full freedom, own culling/storage path,
   ~3.7× more cells than the 190k-cluster grid, higher VRAM) or reuse the existing 16×16-tile
   cluster grid (ADR 0007) as the froxel grid.
2. **Backend scope of V1** — WebGPU compute plus WebGL2 CPU-culling data texture, or WebGPU only.
3. **Shadow interaction** — whether directional CSM self-shadowing is part of V1 or a follow-up.
4. **Compositing** — forward-pass in-scattering lookup (invasive, touches every material shader)
   vs. a dedicated fullscreen composite pass (LightShafts pattern, ADR 0030).

---

## Architectural Decision

The human approved the following binding decisions on 2026-10-16 (do not re-litigate in future
sessions):

1. **Option R — Cluster-Reuse:** The froxel grid **is** the existing clustered light grid
   (`ClusterGrid` / `computeClusterCounts` / `zSliceFromViewDepth`, 16×16-tile + log-staggered
   Z-slices). No second culling/storage path. A denser grid stays a measured candidate later.
   The single source of truth for the grid formula is extracted into `packages/engine/src/math/froxel.ts`.
2. **Hybrid WebGPU + WebGL2 Architecture:**
   - **WebGPU (Compute Tier):** Injection compute shader (`froxel_inject.wgsl`), 3D temporal reprojection shader (`froxel_reproject.wgsl`), in-register prefix-sum Z-integration (`froxel_integrate.wgsl`), and single-tap 3D trilinear fullscreen composite (`VolumetricFog.frag.wgsl`).
   - **WebGL2 (Fragment Tier):** Half-resolution screen-space raymarching pass (`VolumetricFogPassGL`, `VolumetricFog.frag.glsl`) with interleaved gradient noise (IGN) jitter and 2×2 depth-aware cross-bilateral upsampling (`VolumetricFogBilateral.frag.glsl`) to eliminate TBDR tile-flush hazards.
   - **WebGL1:** Stays on Stufe 1 analytic distance/height fog.
3. **CSM self-shadowing:** Local-light and media in-scattering considers directional-light shadow
   self-occlusion through the existing Directional CSM of Stufe 2 (ADR 0030) — zero extra
   shadow passes.
4. **Compositing = dedicated composite pass with transmittance attenuation:** The integrated
   in-scattering texture is composited **before tonemapping** through the existing post-processing
   composite (`PostProcess.frag.wgsl` and `PostProcess.frag.glsl`, LightShafts pattern). This keeps
   all material shaders untouched and minimizes regression risk. Background scene radiance is
   attenuated by media transmittance ($L_{\text{final}} = L_{\text{scene}} \cdot T + L_{\text{fog}}$,
   where $T = e^{-\tau}$), while the analytic distance/height fog (Stufe 1) stays active in parallel.
5. **Dynamic FogVolumes & Interior Carving:** Analytical geometric shapes (`FogVolumeShape`: Box,
   Sphere, Cylinder) evaluated via continuous SDFs. Negative density values carve out participating
   medium from interior rooms, bunkers, or vaults without geometry clipping ($\text{extinction} = \max(0.0, \text{extinction} + \text{volDensity})$).
6. **3D Procedural Noise & Rolling Mist:** Fast analytical 3D value noise and fractional Brownian motion (fBm)
   evaluated in shader space with time-based wind drift, packed into uniform buffer padding with zero GC.
7. **Single-Scattering Albedo (`scatteringAlbedo`) & Absorption:** Extinction is decomposed into
   scattering ($\sigma_s = \omega \cdot \sigma_t$) and absorption ($\sigma_a = (1 - \omega) \cdot \sigma_t$),
   governed by single-scattering albedo $\omega \in [0.0, 1.0]$ (`VolumetricFogElement.scatteringAlbedo`).
   Enables physically realistic dark smoke, soot, and dust that darken background scenes without glowing.
8. **Ambient In-Scattering (`ambientInject`):** Scene ambient light and diffuse IBL irradiance (mean of the cube over its six axis directions, since the fog scatters isotropically)
   (`Scene.irradianceMap`) scatter directly within the medium. On WebGPU, global bind group bindings 4 and 7
   (irradiance cube & sampler) are exposed to compute pipelines (`@group(0) @binding(4/7)`), lifting shadows
   inside thick fog banks. On WebGL2, `VolumetricFogPassGL` samples `Scene.irradianceMap` directly.
9. **Per-Light Volumetric Scaling (`volumetricIntensity`):** Configurable per-light multiplier
   (`AbstractLight.volumetricIntensity`, defaulting to `1.0`) controlling in-scattering for Point, Spot,
   and Directional Sun lights. Setting to `0.0` completely eliminates a light's volumetric presence while
   preserving surface illumination on opaque geometry.
10. **Deterministic Frame Context (`FrameInfo`, `captureFrameRate`):** Eliminates uncoordinated
    `performance.now()` calls in passes and shaders. Passes receive `renderer.frameInfo` (`time`, `realTime`,
    `deltaTime`, `frameIndex`) driven strictly by `SmallWorldMachine.step()`. Enabling
    `SmallWorldMachine.captureFrameRate` advances simulation by constant $\Delta t = 1.0 / \text{captureFrameRate}$,
    enabling frame-accurate offline recording with reproducible simulation input (the rendered pixels are equal only on the same device and driver, and temporal effects need a few warm-up `step()` frames to converge).
11. **Local-light (spot) shadows in the fog (`localLightShadows`, default on):** Spot lights that cast a
    shadow also shadow their in-scattering. The existing spot shadow maps are reused (no extra render pass):
    WebGPU samples them in `froxel_inject.wgsl` (4-tap PCF, bind group 0 bindings 9 and 10 made visible to
    compute), WebGL2 in the raymarch (`sampler2DShadow` on texture units 3 to 6, 2x2 hardware PCF). The
    engine has at most 4 spot shadow maps, indexed like the lit surfaces (light index < 4), and **no shadow
    maps for point lights**, so point lights still scatter unshadowed; shadows for point lights would need a
    new shadow system and are a separate decision. Cost: one shadow-map lookup per froxel (WebGPU) or per
    raymarch step (WebGL2) and shadowed spot. Alternative considered: Unreal's separate volume shadow
    textures per light (about three times the cost of an unshadowed light), rejected because the existing
    maps are enough at the froxel resolution. Limitation: shadow casters outside the camera frustum are not rendered into any spot shadow map (both shadow passes use the camera's visible-object list, on WebGL2 and WebGPU, for lit surfaces as well), so an off-screen occluder does not cut visible fog; set `frustumCulled = false` on such an object to include it.

### Data & resource flow

#### WebGPU Pipeline
```
[Main Pass] → [Opaque Depth]
            → [Froxel Injection (compute)]:
                3D Froxel Grid (= clustered light grid: 16 px screen tiles x 24 log depth slices), local lights (Cluster lists) + CSM directional,
                ambient injection from Scene.irradianceMap (@group(0) bindings 4 & 7)
            → [3D Temporal Reprojection (compute)]:
                Sub-voxel jitter (jx, jy, jz) via FrameInfo, inverse VP reprojection,
                7-tap 3D AABB clamping, ping-pong history
            → [In-Register Z-Integration (compute)]:
                Workgroup (8×8×1) prefix-sum accumulation along depth slices, Decima powder effect,
                slice-center depth integration, optical depth tau and transmittance T = exp(-tau)
            → [Composite (fullscreen fragment)]:
                Single-tap O(1) 3D trilinear texture sample, attenuates scene by T and adds L_fog
                pre-tonemapping into HDR scene buffer
```

#### WebGL2 Pipeline
```
[Main Pass] → [Opaque Depth]
            → [Half-Resolution Raymarch (fragment)]:
                16–24 depth-steps with IGN jitter, analytical FogVolumes & 3D noise,
                Scene.irradianceMap ambient injection, height & heightFalloff evaluation
            → [Depth-Aware Cross-Bilateral Upsampling (fragment)]:
                2×2 high-res bilateral filter preventing edge bleeding across silhouettes
            → [Composite (fullscreen fragment)]:
                Attenuates scene by transmittance T and adds L_fog pre-tonemapping into HDR scene buffer
```

### Implemented Surface
- `packages/engine/src/math/froxel.ts` — single source of truth for logarithmic froxel depth slicing and unprojection formulas (`sliceCenterViewDepth`).
- `packages/engine/src/interfaces/FrameInfo.ts` — frame context timing contract (`time`, `realTime`, `deltaTime`, `realDeltaTime`, `frameIndex`).
- `packages/engine/src/core/SmallWorldMachine.ts` — `frameInfo` writer and `captureFrameRate` fixed-step clock.
- `packages/engine/src/core/lights/AbstractLight.ts` — `volumetricIntensity` per-light in-scattering multiplier.
- `packages/engine/src/core/objects/FogVolume.ts` & `packages/engine/src/enums/FogVolumeShape.ts` — scene-graph node supporting Box, Sphere, Cylinder analytical SDFs, density/albedo/emission/falloff, and 3D noise parameters.
- `VolumetricFogElement.ts` — post-processing configuration element controlling density, height, height falloff, asymmetry (Henyey-Greenstein g), CSM shadowing, jitter, `scatteringAlbedo`, and `ambientInject`.
- `froxel_inject.wgsl`, `froxel_reproject.wgsl`, `froxel_integrate.wgsl`, `VolumetricFog.frag.wgsl` — WebGPU compute and composite pipeline.
- `VolumetricFogPassGPU.ts` & `VolumetricFogPassGL.ts` — backend pass orchestrators for WebGPU and WebGL2.
- `VolumetricFog.frag.glsl` & `VolumetricFogBilateral.frag.glsl` — WebGL2 raymarching and cross-bilateral upsampling shaders.
- `PostProcess.frag.wgsl` & `PostProcess.frag.glsl` — pre-tonemapping composite with transmittance scene attenuation.
- `apps/showcases/39/` ("Atmospheric Sanctum") — architectural showcase demonstrating CSM light shafts, swirling volumetric mist, positive brazier glow, and negative interior vault carving.

---

## Consequences

### Positive
- Zero redundant light-culling and zero extra shadow passes; grid and light lists never disagree per cell.
- Single-tap 3D trilinear fullscreen composite on WebGPU replaces per-pixel screen-space raymarching with an $O(1)$ texture lookup.
- 3D TAA reprojection with sub-voxel jittering suppresses temporal flicker and raymarching slice aliasing while maintaining sharp silhouettes via 3D-AABB clamping.
- WebGL2 achieves visual parity without 3D FBO writing hazards on mobile TBDR architectures.
- Transmittance-aware compositing physically attenuates background objects behind dense media, eliminating over-bright milky blowouts.
- Single-scattering albedo and ambient inject provide full artistic control between bright glowing mist and dark absorbing smoke.
- Deterministic frame context decouples rendering and simulation from wall-clock variance, enabling frame-accurate video capture and reproducible test inputs (pixel equality is only expected on the same device and driver).
- Negative density `FogVolume` nodes enable instant interior carving for buildings, caves, and bunkers.

### Negative / trade-offs
- Four cluster-grid-sized `rgba16float` volumes on WebGPU (inject, two history textures, integrated; ~1.6 MB each at 1920x1080 = 120x68x24 cells) plus one full-resolution `rgba16float` fog target (~16.6 MB), i.e. ~23 MB VRAM.
- Extreme camera velocity can cause brief clamping disocclusion until temporal history reconverges.

### Performance Verification
- WebGPU compute pipeline executes comfortably within the $\le 1.5$ ms budget on desktop GPUs (Injection $\approx 0.4$ ms, Reprojection $\approx 0.3$ ms, Integration $\approx 0.2$ ms, Composite $\approx 0.1$ ms).
- Tested and verified: 283 test suites / 1928 tests pass (`npm run test`), 0 TypeScript errors, 0 ESLint warnings.

---

## References

- Fog & Volumetric Lighting Roadmap — `.agents/notes/backlog.md` (Stufe 3).
- Approved plan — `.agents/scratches/volumetric-froxel-step3-plan.md`.
- Clustered light grid — ADR 0007.
- Light Shafts (3-tier Stufe 2, composite pattern) — ADR 0030.
- W1 (AAA reference techniques) — `docs/research/aaa-engine-techniques.md`.
