---
status: accepted
---

# 0062: Open Ocean Geometry, Material & Opaque-Depth Sub-Phase ("Open Ocean")

- **Status:** Accepted (Phase 1 Core + Phase 2 WebGPU Compute JONSWAP 2D IFFT + Phase 2b Fragment Foam Model)
- **Date:** 2026-11-18
- **Trigger:** Showcase 53 (`Fortress Inquisitorius` — Ocean Moon Nur) exposed structural limits of stretching pool-scale `OpenWaterMaterial` on a small rectangular `Ground` slab over a vast stormy ocean: visible square horizon edges at 380 m, striped Gerstner wave crests, absent distant IBL horizon continuity, flat shadow-dark surfaces lacking crest subsurface scattering, and missing multi-scale normal cascades.

## Decision

Introduce **Open Ocean** as a first-class core subsystem in `@small-world-machine/engine`:

1. **`OceanGridGeometry` (`packages/engine/src/geometry/OceanGridGeometry.ts`):**
   - Radial concentric ring mesh centered on the XZ origin (`Y = 0`, upward normal `(0, 1, 0)`, MikkTSpace-compatible `(1, 0, 0, 1)` tangent convention) whose ring radii follow $r(t) = R\big(w t + (1 - w)t^{\alpha}\big)$ with $w = \text{clamp}(d_{\text{detail}}/R, 0.02, 0.6)$.
   - Default configuration (`radius = 2400`, `radialSegments = 160`, `angularSegments = 192`, `radialExponent = 3.4`, `detailRadius = 380`) places ~1.5–2.5 m vertex spacing in the near zone while reaching the 2.4 km horizon with **30,721 vertices** ($\le 65{,}535$ `Uint16Array` limit for all three renderer tiers including WebGL1).
   - Provides `OceanGridGeometry.snapToTarget(mesh, x, z, snapStep)` for zero-allocation world-space snapping when tracking a roving camera. Vertex and fragment radial distances (`length(wp.xz - viewPos.xz)`) are camera-centered while all Gerstner, JONSWAP FFT, and normal/foam lookups stay anchored in world XZ coordinates so the sea glides smoothly beneath moving cameras.

2. **`OceanWaveNormalGenerator` (`packages/engine/src/core/materials/liquid/OceanWaveNormalGenerator.ts`):**
   - Generates a deterministic, mathematically seamless periodic 2D tangent-space wave normal `Texture` (`512×512` default, exact integer harmonics over $[0, 2\pi)$) with mipmaps and `TextureWrap.REPEAT` in browser environments; returns `undefined` cleanly in headless Node/Vitest contexts (`typeof document === "undefined"`).
   - Paired with a fix in `WebGPURenderer._getMaterialBindGroup` (`m.textures["u_diffuseMap"] ?? m.textures["u_normalMap"]`) so materials with `u_normalMap` and no `u_diffuseMap` still receive the `REPEAT` sampler.

3. **`OceanFftSystem` (`packages/engine/src/renderers/WebGPU/managers/OceanFftSystem.ts`, Phase 2):**
   - Synthesizes a periodic `256×256` directional JONSWAP sea spectrum ($\gamma = 3.3$, Hasselmann directional spread, deep-water dispersion $\omega = \sqrt{gk}$) in zero-allocation per-frame WebGPU compute passes (`ocean_spectrum_init.wgsl`, `ocean_spectrum_step.wgsl`, 1D Cooley-Tukey Radix-2 DIT `ocean_ifft_pass.wgsl`, `ocean_assemble.wgsl`).
   - Produces filterable `rgba16float` textures `u_oceanDispMap` (`@binding(30)`) and `u_oceanNormFoamMap` (`@binding(31)`, storing slope, Jacobian fold, and temporally persistent decaying foam) sampled at two incommensurate rotated octaves on `WEB_GPU` (`ShaderFlag.OCEAN_FFT`), while `WEB_GL2` and `WEB_GL1` seamlessly evaluate the analytical Gerstner + normal cascade without extra GPU work.

4. **`OceanMaterial` (`MaterialType.OCEAN`) & 3-Tier Shader Pipeline (`Ocean.{vert,frag}.{wgsl,glsl,glsl100}`):**
   - Extends `AbstractMaterial` directly (distinct from `LiquidWaveMaterial` pool semantics) with `transparent = false`, `depthWrite = true`, `depthTest = true`, and `state.skipDepthPrePass = true`.
   - **Vertex Stage (WGSL / GLSL300 / GLSL100):** Evaluates 5 incommensurate-direction/golden-ratio-wavelength Gerstner swells derived from `(windDirection, waveScale, waveWavelength, windSpeed)` (plus dual-octave JONSWAP FFT displacement + macro swell when `USE_OCEAN_FFT` is active), attenuated cleanly across camera-centered `[swellFadeStart, swellFadeEnd]` so the outer horizon ring stays flush (`Y = 0`, `N = (0, 1, 0)`).
   - **Fragment Stage (3 Tiers):**
     - **Multi-Scale Normal Cascade:** 3 rotated, incommensurate-scrolled layers of `u_normalMap` (blended with dual-octave `u_oceanNormFoamMap` slopes on WebGPU `USE_OCEAN_FFT`, or analytical capillary ripples when `u_normalMap` is unbound) attenuated smoothly with camera and horizon distance.
     - **Tokuyoshi Specular AA (ADR 0051):** Filters perceptual roughness from screen-space normal variance (`specularAntiAliasing`) to eliminate horizon specular scintillation.
     - **Sky/IBL + Planar Reflection + Fresnel:** Accurate Schlick Fresnel (`F0 = 0.02`), horizon-clamped cube/IBL environment reflection (`sRGBToLinear`), optional blended `PlanarReflectionNode` (`u_reflectionMap`, fading smoothly toward mirror boundaries/far distance into IBL), GGX + crisp glitter path directional specular with shadows (`sampleDirShadow`), wave-crest backlight subsurface scattering (`scatterColor`, `scatterStrength`), Beer-Lambert depth absorption over refracted solids (`u_opaqueMap` / `u_opaqueDepthMap`), organic noise-broken whitecaps, and broken/organic shoreline surf tongues with open rock contact gaps, shallow aeration, and receding wake. On `WEB_GL1`, `Ocean.frag.glsl100` blends the outer horizon rim cleanly into `u_envMap` after fog calculation so the ocean seam matches the unfogged skybox without a dark horizon ring.
     - **G-Buffer Normals & Fog:** Writes animated world-space wave normals (`g_shadingNormal = N`) into the thin normal buffer (ADR 0028) for HBAO / Volumetric Fog and finishes with `forwardToneMap` → `linearToSRGB` → `[FOG_CALC]`.

5. **Opaque-Ocean Pass Ordering (`MainRenderPass` & `WebGLMainPass`):**
   - Batches with `MaterialType.OCEAN` are drawn in their own opaque sub-phase (`"main:ocean"`) immediately **after** regular opaque geometry and `InstanceField` draws, and **before** decals, transparent objects, and post-processing depth captures:
     - Prior to drawing `Ocean`, the renderer captures `opaqueTexture` and `opaqueDepthTexture` (containing solid terrain/architecture below water for shoreline surf & Beer-Lambert absorption).
     - `Ocean` writes wave surface depth (`depthWrite = true`) and wave normals (`g_shadingNormal`).
     - Post-ocean depth/color capture flags remain cleared so decals, transparents, HBAO, and Volumetric Fog receive the final depth and normals **with** the ocean surface.

6. **Dedicated 512-byte Material Lane Mapping (`StandardWebGPULayout`):**
   - `u_color` ← `waterColor` (sRGB), `u_specColor` ← `deepWaterColor` (sRGB), `u_roughness` ← `roughness`, `u_reflectivity` ← `windSpeed`, `u_time` ← `time`, `u_useEnvMap` ← `envMap` mode.
   - `u_matParam0` ← `[waterAbsorption.x, waterAbsorption.y, waterAbsorption.z, refractionStrength]`
   - `u_matParam1` ← `[foamColor.r, foamColor.g, foamColor.b, foamDistance]`
   - `u_matParam2` ← `[windDirX, windDirZ, waveScale, waveWavelength]`
   - `u_matParam3` ← `[swellFadeStart, swellFadeEnd, foamCoverage, detailScale]`
   - `u_matParam4` ← `[scatterColor.r, scatterColor.g, scatterColor.b, scatterStrength]`
   - `u_matParam5` ← `[detailStrength, fftEnabled ? 1 : 0, fftPatchSize, choppiness]`
   - `u_matParam9` ← `[reflectionMap ? reflectionStrength : 0, reflectionDistortion, reflectionRoughness, 0]`
   - Zero legacy slot reads (`u_extraParams`, `u_liquidParams`, `u_thresholds`, `u_texOffset`, `u_texRepeat`).

## Rejected

- **Continuing to patch `OpenWaterMaterial` in Showcase 53:** Pool-basin uniform layout (`poolHalfExtent`, splat ripples) and transparent depth-off ordering break post-processing fog/HBAO over km-scale seas and force showcase-local shader duplication.
- **CPU `Ground` vertex buffers for 2 km ocean:** Even non-uniform grids on a square domain leave corner silhouette cuts and lack radial distance LOD.
- **Lowest-common-denominator capping:** Keeping analytical depth/IBL and compute JONSWAP wavefields absent from WebGPU/WebGL2 because WebGL1 lacks compute/`u_opaqueDepthMap` violates ADR 0057 (each tier renders its native fidelity cleanly).

## Consequences

- Showcases and games gain an out-of-the-box camera-tracked, horizon-to-shore open ocean (`OceanGridGeometry` + `OceanMaterial` + `OceanFftSystem`) with zero scene-specific shader hacks.
- `MainRenderPass` and `WebGLMainPass` incur zero extra work when a scene contains no `MaterialType.OCEAN` batches, and `WebGPURenderer` initializes/dispatches `OceanFftSystem` lazily only when an `OceanMaterial` with `fftEnabled = true` is visible.

## Doctrine Compliance

- **New public hot-scope parameters (classification):**
  - `OceanGridGeometryOptions` (`radius`, `radialSegments`, `angularSegments`, `radialExponent`, `detailRadius`) → `@domain`.
  - `OceanMaterialOptions` (`waterColor`, `deepWaterColor`, `scatterColor`, `scatterStrength`, `roughness`, `windSpeed`, `windDirection`, `waveScale`, `waveWavelength`, `swellFadeStart`, `swellFadeEnd`, `detailScale`, `detailStrength`, `foamColor`, `foamDistance`, `foamCoverage`, `waterAbsorption`, `refractionStrength`, `normalMap`, `envMap`, `reflectionMap`, `reflectionStrength`, `reflectionDistortion`, `reflectionRoughness`, `fftEnabled`, `fftPatchSize`, `choppiness`) → `@domain`.
  - `RainStreaksOptions.followCameraY` → `@domain`.
  - `OCEAN_FFT_RESOLUTION` (`256`), `OceanMaterial.DEFAULT_*` constants, octave angle/wavelength ratios (`[1.0, 0.64, 0.43, 0.27, 0.17]`), dielectric `F0 = 0.02`, JONSWAP $\gamma = 3.3$, and `skipDepthPrePass = true` → `@fixed`.
  - Packed typed-array lanes (`_matParam0Array.._matParam5Array`, `_matParam9Array`), cached JONSWAP initialization dirty-check state, and FFT output textures (`dispTexture`, `normFoamTexture`) → `@derived`.
- **Shared abstraction >= 3 consumers?** No speculative cross-material abstraction introduced; `OceanMaterial` directly implements `AbstractMaterial` and reuses existing engine shader chunks (`[WGSL_PBR_MATH]`, `[WGSL_DIR_SHADOW]`, `[WGSL_FOG_CALC]`, `[LIGHT_DEFS]`, `[PBR_MATH]`, `[DIR_SHADOW]`, `[FOG_CALC]`, `[WORLD_DIR_TO_SCREEN]`).
- **Modeful object?** Single boolean presence gating on `normalMap`, `envMap`, `reflectionMap`, and `fftEnabled` (`USE_OCEAN_FFT`); no multi-mode enum state machine.
- **Mathematical claims:** Horizon smoothness (`swellFade` reaches 0 at `swellFadeEnd`), radial monotonicity of `OceanGridGeometry`, `Uint16` vertex cap (`<= 65535`), camera-centered radial distance across all 3 dialects, JONSWAP directional energy peak, and 256-point Radix-2 DIT IFFT Hermitian parity are tested directly in `OceanGridGeometry.test.ts`, `OceanMaterial.test.ts`, and `OceanFftSystem.test.ts`; no new registered `@invariant` IDs claimed.
- **Fail-closed / honest fallback:** WebGL1 lacks compute shaders, an opaque depth capture, and directional shadow map (`AbstractWebGLRenderer`), so `Ocean.frag.glsl100` honestly substitutes a grazing-Fresnel absorption proxy, outer-rim `u_envMap` skybox match, and unshadowed specular/IBL fallback while keeping WebGPU and WebGL2 full-featured (ADR 0057). Headless Node omits canvas generation cleanly (`normalMap = undefined`).
- **Exceptions:** none.

## Phase 2b: Fragment Foam Model ("Gischtkronen & Wellenbrecher")

Pure fragment-shader upgrade of the foam in `Ocean.frag.{wgsl,glsl,glsl100}`; no new uniforms, lanes, textures, or public parameters (`u_matParam0..5/9` unchanged).

- **Bubble lace:** `oceanFoamCells` is an F1 Worley (cellular) distance (3×3 neighbourhood, `oceanHash2` feature points). `foamLace = mix(1, smoothstep(0.06, 0.46, F1), 0.6 * detailFade)` punches holes into the lacy FBM foam so crests read as bubble lace instead of smooth blobs; the lace fades out with `detailFade` so distant foam does not alias.
- **Crest texture:** `crestTexture = lacyFoam * foamLace * streakMod`, where `streakMod` is a wind-aligned stretched FBM (`0.62 + 0.75 * smoothstep(0.3, 0.7, windStreak)`) producing streaky, wind-combed foam. It modulates every foam source (analytic crest caps, FFT fold caps, persistent FFT foam).
- **Fold crest (WebGPU only):** `fftCrestAccum` reads the instantaneous Jacobian fold channel `nfA.z` / `nfB.z` of `u_oceanNormFoamMap` (the persistent channel `.w` stays the foam trail). `foldCaps = fftCrestAccum * crestTexture * foamCoverage * 1.25` places foam exactly where the displaced surface folds. Only `USE_OCEAN_FFT` builds have this texture.
- **Bore front (WGSL + WebGL2):** `borePhase = fract(t * 0.21 + depthDiff * 0.35 + surgeCellA * 0.9)` is a sawtooth whose constant-phase contours move toward smaller `depthDiff` (the rock) as `t` grows; `boreFront = smoothstep(0, 0.07, p) * (1 - smoothstep(0.07, 0.55, p))` is a sharp leading edge (breaking front) with a long tail (receding foam), zero for `p >= 0.55`. It replaces the pure `surfCycle` pulse in `denseSurf` (`max(surfCycle * 0.6, boreFront)`).
- **Contact splash (WGSL + WebGL2):** `contactSplash = boreFront * (1 - smoothstep(0, foamDistance * 0.5, shoreDepthWarp)) * rockContactGap * validShore` brightens the foam by `1 + 1.1 * contactSplash`, pushing the HDR value above 1 so Bloom picks up the flash where the bore hits the rock. Foam also receives an ambient fill (`ambientColor * 0.7`) so shadowed foam never turns grey.

**Tier differences (ADR 0057, no API-parity cap):**

| Tier | Lace / crest texture | Fold crest (`nfA.z`) | Bore front + contact splash |
| --- | --- | --- | --- |
| WebGPU (`Ocean.frag.wgsl`) | yes | **yes** (only tier with the FFT Jacobian) | yes |
| WebGL2 (`Ocean.frag.glsl`) | yes | no (analytic `crestCaps` only) | yes |
| WebGL1 (`Ocean.frag.glsl100`) | yes (reduced) | no | no — WebGL1 has no shore/depth terms (no opaque depth capture), so there is no `depthDiff` to drive a bore |

**Verification:** `OceanMaterial.test.ts` asserts the per-dialect identifier contract (`oceanFoamCells`, `foamLace`, `crestTexture` everywhere; `boreFront`/`contactSplash` in WGSL + GLSL300 only; `fftCrestAccum`/`foldCaps`/`nfA.z` in WGSL only; no legacy `matParam6..8` reads). `OceanFoamMath.test.ts` is a CPU mirror of the bore-front shape (range `[0, 1]`, zero at phase 0 and `>= 0.55`, peak at `0.07`, contours travel toward the rock) and of the Worley F1 cells (range `[0, sqrt(2)]`, ~0 at feature points). Classification: all constants (`0.21`, `0.35`, `0.9`, `0.07`, `0.55`, lace thresholds) → `@fixed` shader look-tuning; no new `@domain` parameters; no new `@invariant` IDs.
