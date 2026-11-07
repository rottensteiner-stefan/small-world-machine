# 0030: Volumetric Light Shafts (God Rays) Across Hybrid WebGL1/WebGL2/WebGPU Pipelines

> **Status note (2026-10-21):** Local point/spot volumetrics, listed here as future roadmap, were implemented by ADR 0031.

- **Status:** Accepted & Implemented
- **Date:** 2026-10-14
- **Decision Makers:** Small World Machine Architecture Team

---

## Context & Motivation

Atmospheric lighting and crepuscular rays ("god rays") provide crucial spatial depth, scale, and emotional mood in 3D scenes. In Small World Machine, our hybrid pipeline spans WebGL 1.0 (legacy fallback), WebGL 2.0 (modern standard), and WebGPU (cutting-edge low-overhead).

A full 3D Froxel volume grid (e.g., $160 \times 90 \times 64$ with 3D texture integration) is computationally expensive, memory bandwidth intensive on mobile devices, and architecturally impossible on WebGL 1.0.

We needed a unified, high-performance, and visually convincing volumetric light shaft solution that:
1. Fits within existing post-processing pipelines and the `PostProcessingElement` API (`LightShaftsElement`).
2. Introduces **zero redundant shadow rendering passes** (reuses the existing Directional Cascaded Shadow Map).
3. Produces zero memory allocations during the render loop.
4. Adapts cleanly across hardware tiers.

---

## Architectural Decision: 2-Tier Hybrid Architecture

We established a 2-tier hybrid architecture:

### Tier 1: Screen-Space Radial Pull-Blur (WebGL 1.0)
- **Technique:** Screen-space radial blur pulling samples along the 2D vector towards the projected sun position on screen (derived from Mitchell / Crytek 2007).
- **Resolution:** Half-resolution offscreen target (`halfW x halfH`).
- **Behind-Camera Inversion Guard:** When the sun direction is behind the camera plane ($clipW \le 0$), screen-space projection mirrors rays 180° across screen center. We guard this by checking $clipW$ and smoothly fading out shafts to 0.0 when the sun moves behind the viewing frustum.
- **Occlusion:** Luminance masking of the scene color buffer against deep silhouettes.

### Tier 2: Half-Resolution Raymarching against CSM + Cross-Bilateral Upsample (WebGL 2.0 & WebGPU)
- **Technique:** Raymarching through participating media along primary camera rays from near to either the opaque surface depth or `maxDistance`.
- **Shadow Map Reuse:** Reuses the Directional Cascaded Shadow Map (CSM, WebGL2 texture unit 1) already computed during `WebGLShadowPass` / `CascadedShadowPassGPU`. No second shadow pass is executed.
- **Phase Function:** Schlick (1993) phase function approximation of Henyey-Greenstein ($k \approx 1.55g - 0.55g^3$), saving expensive floating-point powers (`pow(..., 1.5)`) while preserving forward scattering peaks around the sun.
- **Jittering:** Interleaved Gradient Noise (IGN, Jorge Jimenez 2014) offset per ray to break step banding into low-discrepancy high-frequency noise.
- **Upsampling Filter:** 2x2 Depth-Aware Cross-Bilateral Filter. Naive bilinear interpolation produces bright halos and bleeding around sharp silhouette edges. The cross-bilateral filter weights neighboring half-resolution samples by exponential depth distance ($\exp(-|\Delta z| / \tau)$) and falls back to the nearest depth tap if all four taps cross a silhouette discontinuity.
- **In-Scattering Composite:** Additive blending of the upsampled volumetric in-scattering texture into the scene HDR buffer **before** tonemapping and color grading in `PostProcess.frag.glsl` / `PostProcess.frag.wgsl`.

---

## Detailed Data & Resource Flow

```
[Main Pass] ---> [Opaque Color Target (HDR)] + [Opaque Depth Texture]
                       |                                |
                       |                                v
                       |                   [LightShaftsPassGL / GPU]
                       |                                |
                       |                                |-- Pass 1: Half-Res Raymarch (CSM + Schlick + IGN)
                       |                                |-- Pass 2: Full-Res Bilateral Depth Upsample
                       |                                |
                       v                                v
               [PostProcessPass: Additive In-Scattering Blit]
                                       |
                                       v
                         [Tonemapping (ACES) & Dithering]
                                       |
                                       v
                              [Canvas Framebuffer]
```

---

## Consequences & Trade-offs

### Advantages
1. **Zero Shadow Redundancy:** Reusing the CSM cascade atlas avoids re-rendering the entire scene from the light perspective, saving CPU draw call overhead and GPU vertex/rasterization time.
2. **Sharp Silhouettes Without Banding:** The combination of IGN jitter + 2x2 depth-aware cross-bilateral upsample resolves the trade-off between sample count (16 steps) and edge bleed.
3. **Hardware Parity:** Seamless fallback from WebGPU to WebGL1 with matching API knobs (`intensity`, `density`, `asymmetry`, `maxDistance`, `color`).

### Limitations & Mitigations
- Directional light only (crepuscular sun/moon beams). Local point/spot volumetrics remain out of scope for Tier 2 and will be addressed in future roadmap milestones.
- Moving camera with high-contrast sun occlusion can exhibit slight grain from IGN jitter; mitigated by TAA integration and low variance distribution.
