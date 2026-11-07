---
status: accepted
---

# 0054: `KHR_materials_specular` textures are WebGL2-only; WebGPU/WebGL1 carry factors and F90 only

> **Revisit 2026-11-01 — RESOLVED** (backlog 💡, human-approved plan): clearcoat/sheen/transmission/specular maps now reach **WebGPU** as one change; the WebGL2-only restriction of this ADR is lifted for those four groups. Anisotropy/iridescence maps stay WebGL2-only (ADR 0055 follow-up on the same mechanism). See `## Revisit resolution (2026-11-01)` below; everything above it records the decision as originally shipped.

- **Status:** Accepted (human-approved 2026-10-31); the WebGPU-facing parts are superseded for clearcoat/sheen/transmission/specular maps by the 2026-11-01 revisit — factor lanes and WebGL1 behaviour are unchanged.
- **Date:** 2026-10-31 (revisited 2026-11-01)
- **Trigger:** Showcase 13 glTF audit listed `KHR_materials_specular` as missing. Factors, tint and F90 weighting were implemented on all three tiers; the two textures (`specularTexture` alpha = strength, `specularColorTexture` RGB = tint) hit the WebGPU sampled-texture budget.

## Decision

- `StandardMaterial.specularFactor` / `specularColor` map to two typed lanes on **all tiers**: `u_matParam12` (rgb = linear `f0(ior) * specularColor`, unclamped; w = enable flag) and `u_matParam13.x` (`specularFactor`, the dielectric F90). Metals keep F90 = 1. All main-lobe, ambient and fallback Fresnel terms use `F_Schlick90` / `F_SchlickRoughness90`; the fixed 0.04 clearcoat lobe stays plain Schlick.
- `StandardMaterial.specularMap` (alpha) and `specularColorMap` (RGB, sRGB-decoded in shader) are sampled on **WebGL2 only**, behind compile flags `USE_SPECULAR_WEIGHT_MAP` / `USE_SPECULAR_COLOR_MAP` (samplers `u_specularWeightMap`, `u_specularColorMap`). WebGPU and WebGL1 ignore the maps and use the factors.
- No WebGPU binding is added for either map (guarded by `MaterialSpecularLane.test.ts`).

## Why textures stop at WebGL2

- `StandardMaterial` already binds about 15 of the 16 guaranteed sampled textures per fragment stage on WebGPU (5 global + 3 always-bound + 7 optional from `getOptionalMaterialTextureBindings()`; counted from the binding table, 2026-10-31).
- Two more bindings give 17. `GPUPipelineCache._checkSampledTextureBudget` only warns; pipeline creation then fails on devices whose limit is 16.
- Precedent: `clearcoatMap`, `sheenColorMap`, `transmissionMap` etc. are also WebGL2-only today. This ADR does not widen that gap; it records it for specular.

This is a **budget constraint, not an API-capability one**: it does not contradict "WebGPU must never be degraded because a lower tier lacks a feature" (Tiered Renderer Autonomy). It is a revisit item (below), not a permanent ceiling.

## Rejected alternatives (kept for later)

- **B: pack both textures into one RGBA texture in the loader** (RGB = tint, A = strength; one WebGPU binding, exactly 16/16).
  - Zero headroom left for any further binding.
  - KTX2/Basis textures cannot be packed through a canvas.
  - Differently sized source images must be resampled to a common size; offset/scale transforms differ per source.
  - Adds load-time pixel work to the loader.
- **C: separate shader variant (own `shaderId`/bind-group layout) for materials with specular maps.**
  - Own pipeline per variant, and a layout split the cache keys on `shaderId` not flags.
  - More moving parts than the feature warrants; best long-term shape if more extension maps should reach WebGPU.
- **Raise the budget instead:** request `maxSampledTexturesPerShaderStage` above 16 where the adapter offers it. Not guaranteed; Apple/Metal adapters commonly report 16.

## Revisit when

- ~~WebGPU material bindings are restructured (e.g. per-flag layouts or bindless/texture-array packing): then bring clearcoat/sheen/transmission/specular maps to WebGPU together, as one change.~~ **Triggered and resolved 2026-11-01** (per-flag layouts + budget resolver; see resolution above — clearcoat/sheen/transmission/specular shipped, anisotropy/iridescence remain thanks to ADR 0055's separate texture step).
- The per-stage texture budget gets headroom (global bind group slimmed, or `Standard` optional bindings trimmed).
- A real asset needs specular maps on WebGPU/WebGL1 and the factor-only look is visibly wrong.

## Doctrine Compliance

- **New public hot-scope parameters (classification):** `StandardMaterial.specularFactor`, `specularColor`, `specularMap`, `specularColorMap` are `@domain` (glTF authoring values, spec defaults 1 / white / unset). Lane contents `u_matParam12` / `u_matParam13` are `@derived` (CPU-folded from `ior`, `specularColor`, `specularFactor`).
- **Shared abstraction >= 3 consumers?** `F_Schlick90` / `F_SchlickRoughness90` have one semantic consumer (specular F90) and are tier-local math helpers next to `F_Schlick`; they reuse the existing typed-lane mechanism (ADR 0027 / 0039) instead of adding a new one. At `F90 = 1` they equal `F_Schlick`, so non-specular materials are unchanged.
- **Modeful object?** The enable state has a single basis (`hasSpecularSetup`) for both the `USE_MATERIAL_SPECULAR` compile flag and the `u_matParam12.w` runtime flag, mirroring sheen. Transition test: returning to the defaults re-disables lane and flag (`MaterialSpecularLane.test.ts`).
- **Mathematical claims:** no registry invariant claimed; F90 = 1 equivalence to plain Schlick is covered by the parity test (no plain F0 Fresnel call left in the three chunks).
- **Fail-closed / honest fallback:** ignoring the maps on WebGPU/WebGL1 is a cosmetic degradation, not render-critical (ADR 0043 calibration); it is documented here and on the material fields rather than silent.
- **Exceptions:** none.

## Consequences

- glTF files with specular textures render with factors only on WebGPU/WebGL1 (a visible difference from WebGL2 only where the textures vary strongly across the surface).
- Lane 12 and 13 on `StandardMaterial` are taken (`u_matParam12`, `u_matParam13`); `RainPuddleMaterial` (`AbstractMaterial`) uses the same lane numbers for its own shader and is unaffected.
- **WebGL2 texture-unit budget (measured later, ADR 0055):** WebGL2 has only 11 free units, and the two specular samplers cost 2 of them. A helmet-class glTF material (diffuse, normal, metallic, roughness, AO, emissive, IBL) plus EVSM plus both specular maps needs 12 and would make the program throw; the shared metallic/roughness sampler (`USE_METALLIC_ROUGHNESS_SHARED`, ADR 0055) brings it to exactly 11 (`GL2SamplerBudget.test.ts`). Adding separate iridescence textures on top does not fit.
- **Packed specular textures share one sampler:** when `specularMap` and `specularColorMap` are the same texture object (packed RGBA: alpha = strength, rgb = tint), `StandardMaterial` adds `USE_SPECULAR_MAPS_SHARED`; the WebGL2 chunk then reads the strength from the alpha channel of `u_specularColorMap` and `Standard.frag.glsl` declares no `u_specularWeightMap` (1 unit instead of 2). The sampler-budget resolver (ADR 0056) removes the flag together with the specular map group. Separate textures keep two samplers; no runtime packing.
- `KHR_texture_transform` is a separate topic: offset/scale/rotation go through the vertex-shader UV path (`u_texRotation`) on all tiers and need no texture binding.

## Revisit resolution (2026-11-01)

The first "Revisit when" trigger ("WebGPU material bindings are restructured ... per-flag layouts") became true: the specular **and** the sibling clearcoat/sheen/transmission groups were brought to WebGPU together as one change, exactly as the revisit clause demanded.

**Mechanism (all work in `packages/engine/src`, verified by full suite + `lint:wgsl`):**
- **Per-flag WGSL gating:** `structs.wgsl` declares the 9 extension textures (`u_clearcoatMap`/`u_clearcoatRoughnessMap`/`u_clearcoatNormalMap`/`u_sheenColorMap`/`u_sheenRoughnessMap`/`u_transmissionMap`/`u_thicknessMap`/`u_specularWeightMap`/`u_specularColorMap`, `@group(1)` bindings 21–29) behind `#ifdef USE_*` gates, stripped by the existing `preprocessConditionals` (ADR 0055 mechanism). A shader only ever statically references the samplers its budget-fitted flags activate.
- **Per-flag bind group layouts:** `getOptionalMaterialTextureBindings()` gained `requiredFlag` metadata; `getMaterialBGL` and the per-frame bind group both iterate the flag-filtered name list (`getMaterialTextureBindingNames` — single source of truth). `cache.materialTextureNames` in `WebGPUPipelineCacheEntry` pins the per-frame bind group to the exact layout it was built from, so fit and bind group can never drift.
- **Budget resolver (WebGPU analogue of the WebGL2 ADR 0056 flow):** `GPUPipelineCache._fitFlagsToBudget` drops whole `WEBGPU_EXTENSION_MAP_GROUPS` (priority specular → sheen → clearcoat → transmission) before ANY shader module / bind group layout / pipeline is built, with one warning per `shaderId`. On a 16-limit device (SwiftShader/CI) a fully-mapped Standard material degrades to its factor path instead of failing pipeline creation; on devices with per-stage headroom the maps render at full fidelity.
- **WebGL2 parity ports:** the map-sampling math is ported verbatim to WGSL — specular (`lighting_pbr.wgsl`, both unpacked and `USE_SPECULAR_MAPS_SHARED` paths), clearcoat incl. the `N_cc`/`dotNV_cc`/`dotNL_cc`/`dotNH_cc` clearcoat lobe and its own ambient `R_cc`, sheen tint/roughness, and transmission/thickness (`Standard.frag.wgsl`). Without a clearcoat normal map `N_cc = N`, so the lobe stays pixel-identical to the previous base-normal implementation.
- **Packed specular layout:** `USE_SPECULAR_MAPS_SHARED` still binds only `u_specularColorMap` (strength from alpha) — no `u_specularWeightMap` binding, one unit, not two, exactly as WebGL2.
- **Guards updated to the new contract:** `MaterialSpecularLane.test.ts` now asserts the maps ARE flag-gated WebGPU bindings; `GL2SamplerBudget.test.ts` keeps anisotropy/iridescence in the WebGL2-only list and pins the ported groups as flag-gated; new `WebGPUExtensionMapBindings.test.ts` covers name gating, shared-layout packing, budget counting and drop order, plus a preprocessed-assembly parse check for all four groups (off / on / shared).

**Still WebGL2-only (documented follow-up, same mechanism):** `u_anisotropyMap`, `u_iridescenceMap`, `u_iridescenceThicknessMap` (bindings/pipelines would follow the identical per-flag + budget-fit pattern of ADR 0055).

**Budget arithmetic (unchanged constraint):** `GLOBAL_BIND_GROUP_TEXTURE_COUNT = 5`; guaranteed minimum per stage = 16. A Standard material with the full legacy set is 3 always + 7 legacy optional = 10 material bindings (15 with global) — the 9 gated maps only pass the fit when the device limit leaves headroom. This is honest graceful degradation, not a capability cap (Tiered Renderer Autonomy is untouched).
