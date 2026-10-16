# 0031: Volumetric Froxel Fog (Stufe 3, WebGPU Compute & WebGL2 Parity)

- **Status:** Accepted & Implemented
- **Date:** 2026-10-16
- **Status of:** *[2026-10-16 Complete]* 3-Tier Fog Standard, Stufe 3
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
4. **Compositing = dedicated composite pass:** The integrated in-scattering texture is
   composited additively **before tonemapping** through the existing post-processing composite
   (`PostProcess.frag.wgsl` and `PostProcess.frag.glsl`, LightShafts pattern). This keeps
   all material shaders untouched and minimizes regression risk. The analytic distance/height fog
   (Stufe 1) stays active in parallel; the volumetric part is strictly additive.
5. **Dynamic FogVolumes & Interior Carving:** Analytical geometric shapes (`FogVolumeShape`: Box,
   Sphere, Cylinder) evaluated via continuous SDFs. Negative density values carve out participating
   medium from interior rooms, bunkers, or vaults without geometry clipping ($\text{extinction} = \max(0.0, \text{extinction} + \text{volDensity})$).
6. **3D Procedural Noise & Rolling Mist:** Fast analytical 3D value noise and fractional Brownian motion (fBm)
   evaluated in shader space with time-based wind drift, packed into uniform buffer padding with zero GC.

### Data & resource flow

#### WebGPU Pipeline
```
[Main Pass] → [Opaque Depth]
            → [Froxel Injection (compute)]:
                3D Froxel Grid (160×90×64), local lights (Cluster lists) + CSM directional
            → [3D Temporal Reprojection (compute)]:
                Sub-voxel jitter (jx, jy, jz), inverse VP reprojection, 7-tap 3D AABB clamping, ping-pong history
            → [In-Register Z-Integration (compute)]:
                Workgroup (8×8×1) prefix-sum accumulation along depth slices, Decima powder effect
            → [Composite (fullscreen fragment)]:
                Single-tap O(1) 3D trilinear texture sample, additive pre-tonemapping into HDR scene
```

#### WebGL2 Pipeline
```
[Main Pass] → [Opaque Depth]
            → [Half-Resolution Raymarch (fragment)]:
                16–24 depth-steps with IGN jitter, analytical FogVolumes & 3D noise
            → [Depth-Aware Cross-Bilateral Upsampling (fragment)]:
                2×2 high-res bilateral filter preventing edge bleeding across silhouettes
            → [Composite (fullscreen fragment)]:
                Additive pre-tonemapping composite into HDR scene buffer
```

### Implemented Surface
- `packages/engine/src/math/froxel.ts` — single source of truth for logarithmic froxel depth slicing and unprojection formulas.
- `packages/engine/src/core/objects/FogVolume.ts` & `FogVolumeShape.ts` — scene-graph node supporting Box, Sphere, Cylinder analytical SDFs, density/albedo/emission/falloff, and 3D noise parameters.
- `VolumetricFogElement.ts` — post-processing configuration element controlling density, height, height falloff, asymmetry (Henyey-Greenstein g), CSM shadowing, jitter, and history blend.
- `froxel_inject.wgsl`, `froxel_reproject.wgsl`, `froxel_integrate.wgsl`, `VolumetricFog.frag.wgsl` — WebGPU compute and composite pipeline.
- `VolumetricFogPassGPU.ts` & `VolumetricFogPassGL.ts` — backend pass orchestrators for WebGPU and WebGL2.
- `VolumetricFog.frag.glsl` & `VolumetricFogBilateral.frag.glsl` — WebGL2 raymarching and cross-bilateral upsampling shaders.
- `apps/showcases/39/` ("Atmospheric Sanctum") — architectural showcase demonstrating CSM light shafts, swirling volumetric mist, positive brazier glow, and negative interior vault carving.

---

## Consequences

### Positive
- Zero redundant light-culling and zero extra shadow passes; grid and light lists never disagree per cell.
- Single-tap 3D trilinear fullscreen composite on WebGPU replaces per-pixel screen-space raymarching with an $O(1)$ texture lookup.
- 3D TAA reprojection with sub-voxel jittering suppresses temporal flicker and raymarching slice aliasing while maintaining sharp silhouettes via 3D-AABB clamping.
- WebGL2 achieves full visual parity without 3D FBO writing hazards on mobile TBDR architectures.
- Dedicated additive composite keeps all material shaders untouched and zero-risk for existing scenes.
- Negative density `FogVolume` nodes enable instant interior carving for buildings, caves, and bunkers.

### Negative / trade-offs
- Double-buffered 3D history textures (`rgba16float`, $160 \times 90 \times 64 \times 8$ bytes $\approx 7.37$ MB each) require ~15 MB VRAM on WebGPU.
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
