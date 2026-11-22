---
status: accepted
---

# 0063: PBR Ambient $1/\pi$ Alignment, `HemisphereLight`, Multi-Scattering IBL & Specular AO

- **Status:** Accepted (2026-11-22)
- **Date:** 2026-11-22
- **Trigger:** Showcase 13 (`AmbientLight` + `DirectionalLight` toggle audit) + PBR/IBL energy-conservation comparison against Khronos glTF Sample Viewer, Filament, Three.js r155+ (`useLegacyLights = false`), and Godot 4.

## Decision

- **Additive ambient accumulation (`AmbientLight.applyTo`):** Multiple ambient/hemisphere lights now accumulate additively into `LightDataInterface.aCol` and `aGroundCol` instead of overwriting the previous light's buffer (`AmbientLight.ts`, `HemisphereLight.ts`).
- **`HemisphereLight` (`LightType.HEMISPHERE`):** First-class sky/ground light interpolating along world up `+Y` via `mix(ambientGround, ambientColor, clamp(N.y * 0.5 + 0.5, 0.0, 1.0))` across WebGPU, WebGL2, WebGL1, and volumetric fog. Uses existing `GlobalUniformLayout` tail extension (`ambientGround`, appended after `clusterDims` in WebGL2 std140 and after `toneMapping` in WebGPU so existing prefixes remain intact) with a zero-GC dirty-check cache (`linearGroundColor`).
- **PBR $1/\pi$ ambient irradiance normalization:** PBR shaders divide `hemiAmbient` by $\pi$ (matching Lambertian diffuse exitance $\int_{\Omega} L_i \cos\theta \, d\omega / \pi = L_{\text{ambient}} / \pi$ and Three.js r155+ physical light units) and add it to `iblIrradiance` instead of replacing IBL when an environment map is active or dropping the `/ pi` denominator. Non-PBR Phong shaders keep direct artistic `[0..1]` scaling (`light_calc.frag.glsl`, `lighting.wgsl`); scene `AmbientLight` presets were rescaled (`× π`) to preserve visual baselines.
- **Multi-scattering IBL (`FmsEms`, Fdez-Agüera 2019, JCGT 8(1)):** WebGPU and WebGL2 (`lighting_pbr.wgsl`, `light_calc_pbr.frag.glsl`) replace single-scattering `Fss` split-sum with dual-scattering `FssEss + FmsEms`: `FssEss = kS_ambient * envBRDF.x + F90 * envBRDF.y`, `Ems = max(1 - (envBRDF.x + envBRDF.y), 0)`, `Favg = F0 + (F90 - F0) / 21`, `FmsEms = (FssEss * Favg / max(1 - Ems * Favg, 1e-5)) * Ems`, and `kD_ambient = max(1 - (FssEss + FmsEms), 0) * (1 - metallic)` (`@invariant PBR-ENERGY-CONSERVATION`). Rough conductors no longer darken past single-bounce energy loss. WebGL1 keeps single-scattering analytical split-sum (`G01`) with the `F_Schlick90` energy split (`G04`).
- **Specular ambient occlusion (`computeSpecularOcclusion`):** All 3 tiers (`pbr_math.{wgsl,frag.glsl}`) apply Lagarde & de Rousiers 2014 (`clamp(pow(dotNV + ao, exp2(-16.0 * roughness - 1.0)) - 1.0 + ao, 0.0, 1.0)`) to IBL specular, `USE_ENV_MAP` probes, and clearcoat IBL specular (`ao == 1` evaluates to `1.0`, preserving neutral cavity-free look).
- **WebGL2 no-IBL `u_envIntensity` parity:** Multiplies `u_envMap` fallback probe radiance by `u_envIntensity` in the `#else` (`!USE_IBL`) branch of `light_calc_pbr.frag.glsl`, aligning with WebGPU and WebGL1.

## Rejected

- **Keeping non-$\pi$-normalized ambient on PBR:** Left an arbitrary $3.14\times$ energy discrepancy between diffuse direct/IBL lights and scene `AmbientLight`, forcing authors to invent unphysical low fractions and causing double-counting or suppression when combined with IBL.
- **Replacing `AmbientLight` with `HemisphereLight` only:** Breaks existing `AmbientLight` scenes and requires extra ground-color allocation on uniform ambient rigs; keeping both additive into `(aCol, aGroundCol)` adds zero shader branching.
- **Full directional-albedo lookup tables for multi-scattering IBL:** Unnecessary extra texture fetch when Fdez-Agüera's 5-line analytical approximation reuses the existing BRDF LUT `(envBRDF.x, envBRDF.y)`.

## Consequences

- Scene `AmbientLight` intensity in PBR workflows represents hemispherically integrated irradiance $\pi \cdot L$ (matching Three.js r155+): e.g. `intensity: Math.PI` gives unit diffuse response `1.0 * diffuseAlbedo` on white lambertian surfaces. Existing showcase intensities were calibrated (`× π`) to preserve golden parity.
- Rough metals under IBL gain realistic warm/saturated multi-bounce reflectance without white blowouts.
- Tests: `AmbientEnergySplitParity.test.ts`, `HemisphereLight.test.ts`, `GlobalUniformLayout.test.ts`, `ClusteredLightingAlignment.test.ts`, `ColorSpaceContract.test.ts`, `WebGPUProbeSplitSumContract.test.ts`.

## Doctrine Compliance

- **New public hot-scope parameters:** `HemisphereLight.groundColor` (`@domain`, sRGB color, default `(0.25, 0.25, 0.25)`), `skyColor` (`@domain`, aliases `color`), `linearGroundColor` (`@derived`, lazy dirty-cached linear conversion matching `linearColor`).
- **Shared abstraction >= 3 consumers?** Reuses existing `AbstractLight.applyTo` / `GlobalUniformLayout` pipeline across WebGPU, WebGL2, WebGL1, and volumetric fog (4 consumers); no new abstraction introduced.
- **Modeful object?** None (`HemisphereLight` reduces smoothly to `AmbientLight` when `groundColor == color`).
- **Mathematical claims:** `@invariant PBR-ENERGY-CONSERVATION` tagged on `FmsEms` split in `lighting_pbr.wgsl` and `light_calc_pbr.frag.glsl`; `computeSpecularOcclusion(dotNV, 1.0, r) == 1.0`.
- **Fail-closed / honest fallback:** No capability failures introduced; WebGL1 uses analytical BRDF split-sum (`G01`) with `computeSpecularOcclusion` and `1/π` hemisphere irradiance.
- **Exceptions:** None.
