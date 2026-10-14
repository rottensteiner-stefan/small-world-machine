# Multi-Agent Deliberation Dossier: Volumetric Light Shafts & God Rays (Roadmap Step 2)

**Topic:** `volumetric-light-shafts`  
**Document Type:** Multi-Agent Architecture, Research & Industry Benchmark Dossier  
**Date:** 2026-10-14  
**Context:** Small World Machine — Hybrid WebGL1 / WebGL2 / WebGPU 3D Engine  
**Milestone:** Fog & Volumetric Lighting Roadmap — Step 2: Screen-Space Light Shafts / God Rays  
**Authors / Panel:**
- **Alice** (Lead Coordinator & Synthesis)
- **Bob** (Implementation & Core Dev / Shaders)
- **Charlie** (QA, Testing, Benchmarks & Boundary Verification)
- **Dave** (Architecture & Systems Review / ADR)

---

## 1. Executive Summary & Problem Framing

Following the successful stabilization of **Step 1 (Analytic Distance & Height Fog)** in `Fog.ts` and `fog_calc.glsl`, the engine roadmap calls for **Step 2: Atmospheric Light Shafts ("God Rays" / Crepuscular Rays)**. 

### The Core Dilemma: Radial Blur vs. Shadow-Map Raymarching
In real-time rendering, crepuscular rays arise when participating atmospheric media (haze, dust, humidity) scatters direct light toward the eye, interrupted by foreground occluders. Engines typically pick between two distinct paradigms:

| Metric / Dimension | Paradigm A: Screen-Space Radial Blur ("Fake" God Rays) | Paradigm B: Half-Res Shadow-Map Raymarching ("True" Volumetric Shafts) |
| :--- | :--- | :--- |
| **Pioneering Reference** | Kenny Mitchell (GPU Gems 3, 2007) / Crysis Sun Shafts post-pass | Crytek (Sousa 2008), Wronski (2014), Frostbite (Hillaire 2015) |
| **Input Data** | Color buffer + Scene Depth mask (Sky/Sun visibility) | Directional Cascaded Shadow Map (CSM) + Scene Depth |
| **Mathematical Basis** | 2D image-space radial integration along projected sun vector | 1D numerical quadrature of Radiative Transfer Equation (RTE) |
| **Off-Screen Sun Handling** | **Fails / clips abruptly** when sun leaves viewport or is behind camera | **Rock solid in 360°**; independent of sun screen-space coordinates |
| **Geometric Occlusion** | Only foreground silhouettes visible on screen cast rays | Arbitrary 3D geometry (even off-screen occluders) casts true 3D volumetric shadows |
| **Cost & Complexity** | Extremely cheap (~0.1–0.2 ms), 2D texture taps only | Moderate (~0.5–1.2 ms at half-res), requires shadow texture samples |
| **Small World Machine Backend Compatibility** | Runs on **WebGL1, WebGL2, WebGPU** | Runs on **WebGL2 and WebGPU** (WebGL1 has no shadow maps) |

### The Deliberation Objective
Determine whether Small World Machine should:
1. Implement a pure Screen-Space Radial Blur pass,
2. Implement a dedicated Half-Res Shadow-Map Raymarching pass with bilateral upsampling, or
3. Adopt a **pragmatic tiered hybrid architecture**: A unified post-processing element `LightShaftsElement` that leverages **Half-Res CSM Raymarching on WebGL2 & WebGPU** while providing an **automatic, low-overhead Radial Blur fallback for WebGL1** (and low-spec devices).

---

## 2. Industry Benchmark Analysis (State of the Art)

### 2.1 Unreal Engine 4 & 5 (Epic Games)
Unreal Engine maintains two distinct tiers for light shafts on directional lights:
1. **Light Shaft Occlusion (Screen-Space):**
   - Samples the full-res Scene Depth buffer and masks pixels closer than `OcclusionDepthRange`.
   - Projects the directional light source to screen space and applies a directional/radial blur outwards.
   - The blurred occlusion mask is multiplied onto the **Exponential Height Fog** and atmospheric in-scattering pass.
   - *Limitation:* Disappears when looking away from the sun; occluders behind the camera do not cast volumetric shadows.
2. **Light Shaft Bloom (Screen-Space):**
   - Extracts bright HDR texels around the sun disc exceeding `BloomThreshold`.
   - Multi-step radial pull-blur generating radiant sun glint and starburst rays.
   - Additively composited onto the HDR color buffer.
3. **Volumetric Fog (3D Froxel Grid — UE 4.16+ / UE5):**
   - True 3D frustum grid (e.g. $160 \times 90 \times 64$).
   - Evaluates all local lights + directional CSM per voxel.
   - *Roadmap note:* This matches our **Step 3 (Froxel Fog)**, confirming that Step 2 in UE evolved from screen-space occlusion/bloom.

### 2.2 EA Frostbite (Sébastien Hillaire, DICE / Frostbite)
- Landmark SIGGRAPH 2015 publication: *"Physically-based & Unified Volumetric Fog"*.
- Emphasized decoupling volumetric evaluation from full-resolution screen buffers.
- For non-froxel mobile / low-tier paths, Frostbite demonstrated half-resolution screen raymarching with:
  - 8 to 16 samples along the camera ray.
  - Interleaved / stochastic ray start offsets (jitter).
  - Depth-aware cross-bilateral filter during composite to prevent silhouette bleeding.

### 2.3 Crytek / CryEngine (Crysis, Ryse, Hunt: Showdown)
- Tiago Sousa (2008) *"Real-Time Atmospheric Effects in Games"*:
  - Pioneered screen-space directional occlusion rays.
  - Combined depth-buffer masking with radial attenuation.
- Bart Wronski (2014) *"Volumetric Fog and Light Shafts"*:
  - Evaluated raymarching against CSM in half-res buffers.
  - Identified the primary artifact: **silhouette bleeding** (halos around foreground characters against distant fog). Solved via joint bilateral upsampling using camera depth gradients.

### 2.4 Unity Engine (Legacy Sun Shafts vs. URP / HDRP)
- **Legacy Sun Shafts (Image Effects):** Classic implementation of Kenny Mitchell's GPU Gems 3 algorithm. Still widely copied in WebGL shaders due to simplicity.
- **Universal Render Pipeline (URP):** Uses screen-space depth masking for mobile, and half-res raymarching against main light shadow maps for desktop.
- **High Definition Render Pipeline (HDRP):** Standardized on 3D froxel volumes, dropping pure screen-space radial blur due to off-screen popping.

### 2.5 Web 3D Peers: Three.js and Babylon.js
- **Babylon.js:**
  - `VolumetricLightScatteringPostProcess`: Direct implementation of Kenny Mitchell radial blur.
  - Creates a dedicated render pass rendering meshes with black unlit shaders and an emissive sun mesh, then blurs outward in 2D screen space.
  - Highly susceptible to camera rotations (sun exiting viewport).
- **Three.js:**
  - Official examples rely on `GodRaysFakeShader` (screen-space radial blur).
  - Community extensions (`three-good-godrays`) implement half-resolution raymarching against shadow maps, observing 60 FPS on mid-range GPUs with 16 samples + bilateral blur.

---

## 3. Mathematical Foundations & Formulations

### 3.1 Radiative Transfer Equation (RTE)
Light propagating through a participating medium (air with fog/dust) along ray $\vec{x}(t) = \vec{C} + t \cdot \vec{V}$ from distance $0$ to surface distance $d$:

$$L(\vec{C}, \vec{V}) = L(\vec{x}(d), \vec{V}) \cdot T(0, d) + \int_{0}^{d} T(t, d) \cdot \sigma_s(\vec{x}(t)) \cdot L_i(\vec{x}(t)) \cdot p(\theta) \, dt$$

Where:
- $\vec{C}$ = Camera position.
- $\vec{V}$ = Normalized ray direction.
- $T(t_1, t_2) = \exp\left(-\int_{t_1}^{t_2} \sigma_t(s) \, ds\right)$ is the **Transmittance** (Beer-Lambert law).
- For a homogeneous medium: $T(0, t) = \exp(-\sigma_t \cdot t)$, where $\sigma_t = \sigma_s + \sigma_a$ (extinction = scattering + absorption).
- $L_i(\vec{x}(t)) = V(\vec{x}(t)) \cdot L_{sun}$ is the incident light modulated by the shadow map visibility $V \in \{0, 1\}$.
- $p(\theta)$ is the **Phase Function** where $\cos\theta = \vec{V} \cdot \vec{L}_{dir}$.

---

### 3.2 Phase Functions: Anisotropic Scattering

Direct sunlight scattering in mist/haze exhibits strong forward scattering (Mie scattering).

#### 1. Henyey-Greenstein (1941)
The industry standard single-parameter phase function:

$$p_{HG}(\theta, g) = \frac{1}{4\pi} \frac{1 - g^2}{(1 + g^2 - 2g \cos\theta)^{3/2}}$$

Where $g \in (-1, 1)$ is the asymmetry factor:
- $g = 0$: Isotropic Rayleigh scattering (equal in all directions).
- $g \in (0.5, 0.85)$: Haze / fog forward scattering (creates intense halo around the sun disk).

#### 2. Schlick Approximation (1993) — Hot-Path GPU Optimization
Henyey-Greenstein requires an expensive power-of-$3/2$ evaluation (`pow(..., 1.5)`). Philippe Schlick proposed a rational polynomial approximation that eliminates square roots and powers:

$$k \approx 1.55 g - 0.55 g^3$$

$$p_S(\theta, k) = \frac{1}{4\pi} \frac{1 - k^2}{(1 - k \cos\theta)^2}$$

> **Performance Finding:** In fragment/compute shaders running 16 raymarch steps across half-res targets, Schlick produces visually indistinguishable results from Henyey-Greenstein while saving ~15 ALU cycles per sample step.

---

### 3.3 Screen-Space Radial Blur Formulation (Mitchell 2007)

For the 2D post-process path (WebGL1 tier), the radial accumulation from screen pixel $\vec{s} = (u, v)$ toward projected sun position $\vec{s}_{sun} = (u_{sun}, v_{sun})$:

$$\Delta \vec{s} = (\vec{s} - \vec{s}_{sun}) \times \frac{1}{N} \times \text{Density}$$

$$\text{RayColor}(\vec{s}) = \sum_{i=0}^{N-1} M(\vec{s} - i \cdot \Delta \vec{s}) \times \text{Decay}^i \times \text{Weight}$$

Where:
- $N$ = Number of blur samples (typically 32 to 64 for smooth streaks).
- $M(\vec{x})$ = Mask value ($1.0$ for unoccluded sky/sun, $0.0$ for occluding geometry closer than `MaxDepth`).
- $\text{Decay} \in (0.92, 0.98)$ = Exponential attenuation per step.
- $\text{Density} \in (0.5, 1.0)$ = Step spacing factor.

#### The Behind-Camera Inversion Hazard:
If the sun is behind the camera plane ($\vec{D}_{sun} \cdot \vec{F}_{cam} < 0$), $\vec{s}_{sun}$ flips across the screen center. The shader **must evaluate the sign of the camera-space Z**:
$$\text{if } (\vec{L}_{cam}.z \le 0) \implies \text{Fade out shafts to zero to prevent mirror artifacts!}$$

---

### 3.4 Raymarched Shadow Map Formulation (Half-Res)

For each half-resolution pixel at coordinate $(x, y)$:
1. Reconstruct world-space camera ray $\vec{V}$ and linear depth $Z_{scene}$ from downsampled depth buffer.
2. Clamp ray distance to maximum volumetric range $D = \min(Z_{scene}, D_{max})$.
3. Step size $\Delta t = \frac{D}{N}$ (e.g. $N = 16$).
4. **Stochastic Jitter:** Displace the ray start to break banding into high-frequency noise:
   $$t_i = \left(i + \xi(x, y)\right) \cdot \Delta t$$
   Where $\xi(x, y)$ is the **Interleaved Gradient Noise (IGN)**:
   $$\text{IGN}(x, y) = \text{fract}\left(52.9829189 \times \text{fract}(0.06711056 \cdot x + 0.00583715 \cdot y)\right)$$
5. Sample Cascaded Shadow Map at $\vec{P}_i = \vec{C} + t_i \cdot \vec{V}$:
   $$V_i = \text{sampleShadowCascade}(\vec{P}_i)$$
6. Accumulate in-scattering:
   $$L_{in} = \sum_{i=0}^{N-1} V_i \cdot L_{sun} \cdot p_S(\vec{V} \cdot \vec{L}_{dir}, k) \cdot \exp(-\sigma_t \cdot t_i) \cdot \Delta t$$

---

### 3.5 Bilateral Depth-Aware Upsampling

Compositing a half-resolution volumetric buffer ($0.5 \times W, 0.5 \times H$) directly onto full-resolution color using bilinear interpolation causes **severe edge bleeding / haloing** around foreground objects.

To eliminate halos, we apply a **$2 \times 2$ Depth-Aware Cross-Bilateral Filter**:
For each full-res pixel with linear depth $Z_{full}$, inspect the four corresponding half-res taps $k \in \{0, 1, 2, 3\}$:

$$w_k = \exp\left(-\frac{|Z_{full} - Z_{half, k}|}{\sigma_Z}\right)$$

$$\hat{L}_{vol} = \frac{\sum_{k=0}^{3} w_k \cdot L_{half, k}}{\sum_{k=0}^{3} w_k}$$

- If all depth weights drop below a critical threshold (indicating a sharp silhouette boundary):
  $$\text{Fallback:} \quad \hat{L}_{vol} = L_{half, \text{nearest\_depth}}$$
  *(The half-res tap whose depth is closest to $Z_{full}$ wins completely).*

---

## 4. Architectural Analysis for Small World Machine

### 4.1 Existing Engine Infrastructure Inventory
Small World Machine already contains the foundational components required for this effect:

1. **Directional Cascaded Shadow Map (CSM):**
   - Implemented in `CascadedShadowPassGPU.ts` and `WebGL2Renderer.renderShadowMaps()`.
   - Atlas texture unit 14 (`u_dirShadowMapRaw`) with 3–4 cascades, texel snapping, and cascade blend factors.
2. **Opaque Depth Buffer Capture:**
   - Active on WebGL2 (`WebGLMainPass.ts`) and WebGPU (`MainRenderPass.ts`) when transparents, HBAO, or decals are present.
   - Texture uniform: `u_opaqueDepthMap` (`DEPTH_COMPONENT24` or `depth24plus`).
3. **Post-Processing Framework:**
   - `PostProcessingGroup`, `PostProcessPassGL`, `PostProcessPass` (WebGPU).
   - `PostProcessingEffectType` enum (contains ToneMapping, Vignette, Bloom, HBAO, TAA, etc.).
   - Full HDR render targets (`rgba16float` or `rgb10a2` on WebGL2/WebGPU; `rgba8unorm` fallback on WebGL1).
4. **History Blend & TAA Infrastructure:**
   - `HistoryBlendPassGL/GPU`: Ping-pong frame accumulation. Can temporally smooth the jittered raymarch samples.

---

### 4.2 Proposed Engine Architecture: The 2-Tier Strategy

To balance visual quality against strict three-backend parity (WebGL1, WebGL2, WebGPU), the panel recommends a **unified hybrid system**:

```
                       ┌───────────────────────────────┐
                       │      LightShaftsElement       │
                       │   (PostProcessingElement)     │
                       └──────────────┬────────────────┘
                                      │
              ┌───────────────────────┴───────────────────────┐
              ▼                                               ▼
   [Tier 1: WebGL1 Fallback]                    [Tier 2: WebGL2 & WebGPU Core]
  Screen-Space Radial Blur                      Half-Res CSM Raymarching Pass
  ────────────────────────                      ─────────────────────────────
  1. Downsample Scene Color & Depth             1. Downsample Depth to Half-Res
  2. Extract Sky/Sun Luminance Mask             2. March 8-16 steps against CSM Cascades
  3. 32-Tap Radial Pull-Blur Shader             3. Schlick Phase & In-Scattering Accumulation
  4. Camera-Z Inversion Fade Guard              4. Joint Bilateral Depth-Aware Upsample
  5. Additive Composite onto Scene              5. Additive Composite onto HDR Color Target
```

---

## 5. Proposed Multi-Agent Roster & Work Packages

To drive implementation cleanly under the `collaborate` protocol, tasks are decomposed across four specialist roles:

### Alice — Lead Coordinator & Moderation
- Oversee board event log (`volumetric-light-shafts.board.jsonl`).
- Coordinate consensus on mathematical parameters ($g$-factor, step count, resolution divisor).
- Finalize consensus and document the ADR (Architecture Decision Record).

### Bob — Implementation & Core Dev (Shaders & Passes)
- **Task `T1`:**
  - Create `LightShaftsPassGL.ts` and `LightShaftsPassGPU.ts`.
  - Implement Tier 2 Half-Res Raymarch Shaders (`LightShafts.frag.glsl`, `LightShafts.frag.wgsl`).
  - Implement Bilateral Depth-Aware Composite Shaders (`LightShaftsComposite.frag.glsl`, `LightShaftsComposite.frag.wgsl`).
  - Implement Tier 1 Radial Blur Fallback Shader (`LightShafts100.frag.glsl`).

### Charlie — QA, Benchmarking & Boundary Verification
- **Task `T2`:**
  - Design numerical verification suite (`scripts/check-light-shafts.mjs`).
  - Test boundary conditions:
    1. Camera looking directly at sun vs. sun behind camera (inversion check).
    2. Silhouette boundary test (verify zero edge-bleeding / dark halos around thin objects).
    3. Performance budget test: Half-res raymarch must stay under **0.75 ms** on modern desktop GPU and under **1.8 ms** on integrated GPU.
    4. WebGL1 graceful degradation test (no GL errors, clean radial blur).

### Dave — Architecture, Engine Integration & ADR
- **Task `T3`:**
  - Register `PostProcessingEffectType.LIGHT_SHAFTS = "LightShafts"`.
  - Expose `LightShaftsElement` API in `@small-world-machine/engine`.
  - Manage texture FBO lifecycles (half-res depth and half-res color FBOs resized cleanly on viewport changes).
  - Draft **ADR 0030: Screen-Space & Shadow-Map Volumetric Light Shafts**.

---

## 6. Open Technical Decisions for the Panel

1. **Raymarch Sample Count vs. Performance:**
   - *Option A:* Fixed 16 samples without temporal accumulation (predictable cost, mild noise with IGN).
   - *Option B:* Dynamic 8 samples with temporal accumulation via `HistoryBlendPass` (super cheap, but risks ghosting on fast camera turns).
   - *Recommendation:* Fixed 12–16 samples with IGN jitter + spatial bilateral filter for v1; temporal accumulation as opt-in flag.

2. **CSM Cascade Selection during Raymarch:**
   - Should the raymarcher evaluate all 4 cascades or clamp to cascades 0 and 1?
   - *Recommendation:* Clamp volumetric sampling to **Cascade 0 and 1** (near/mid range, e.g. within 30–50 meters). Distant fog is handled by analytic `Fog.ts` (Step 1), avoiding expensive cascade transitions in the loop.

3. **Artist Parameters on `LightShaftsElement`:**
   - `intensity: number` (multiplier, default 1.0)
   - `density: number` (scattering coefficient $\sigma_s$, default 0.05)
   - `asymmetry: number` (Schlick $k$ or HG $g$, default 0.7 for strong sun forward-scattering)
   - `maxDistance: number` (maximum raymarch travel distance, default 40.0 meters)
   - `decay: number` (for Radial Blur tier, default 0.95)

---

## 7. Next Steps & Execution Command

The blackboard session has been initialized. Parallel sub-agents may be invoked or tasks claimed using:
```bash
node .agents/skills/collaborate/collab.mjs board volumetric-light-shafts
```
All implementation steps will adhere to the fail-fast principle, zero-allocation render loop rules, and strict TypeScript types.
