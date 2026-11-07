---
status: accepted
---

# 0056: WebGL2 sampler-budget resolver — drop extension maps instead of failing the program

- **Status:** Accepted (human-approved 2026-11-01)
- **Date:** 2026-11-01
- **Trigger:** ADR 0055 measured that a WebGL2 program has only 11 free texture units on a device with the guaranteed 16 (units 11–15 belong to the renderer) and that a program needing more used to throw, so the material was not drawn at all. With specular, anisotropy and iridescence maps on top of a glTF PBR material this is reachable (14 maps need 18 units).

## Decision

- **Where:** `WebGLProgramCache` on the GLSL 300 path (WebGL2). WebGL1 never declares the extension maps, WebGPU has its own bind-group budget (ADR 0054) and is not touched.
- **Count before linking, from the real source.** `countMaterialSamplers` (`gl/managers/SamplerBudget.ts`) runs the preprocessor directives of the assembled fragment source (`#define`, `#ifdef`, `#ifndef`, `#if` with `defined()`, `!`, `&&`, `||`, `==`, `#else`, `#endif`, `#undef`) and counts the active `sampler2D` / `samplerCube` / `sampler2DArray` declarations, array sizes included, minus the renderer-owned shadow samplers. It sees exactly the text that would be compiled (flags already injected as `#define`), so there is no hand-kept per-flag table that could drift. It has to run before linking: on a 16-unit device a program over the limit fails to link and then offers nothing to inspect.
- **Fit by dropping, lowest priority first.** `fitFlagsToTextureUnits` removes whole feature groups of extension maps until the program fits the device's actual `MAX_TEXTURE_IMAGE_UNITS` (`nextUnitAfter` mirrors the allocator that skips the reserved units 11–15): iridescence maps, specular maps, anisotropy map, sheen maps, clearcoat maps, transmission/thickness maps (`EXTENSION_MAP_GROUPS`). A dropped group falls back to its factor values; its sharing flags (`USE_IRIDESCENCE_MAPS_SHARED`) go with it because they would reference a sampler that no longer exists. The core maps (diffuse, normal, metallic, roughness, AO, emissive, environment, reflection) are never dropped. The `EXTENSION_MAP_GROUPS` order is the only hand-kept list; it is a priority policy, not derived data.
- **Honest and visible.** One `console.warn` per program build names the shader, the device limit and the dropped flags. The program is cached under the key of the original flags, so the decision runs once per program.
- **Cost:** a material without extension maps (nearly all) pays nothing, the shader is not even assembled for the check. A material with maps pays one extra assembly and one preprocessor pass per candidate; on a 32-unit device nothing is dropped.
- If nothing droppable is left and the program is still over budget, the existing `_assertTextureUnits` error fires as before.

## Rejected alternatives (kept for later)

- **Retry after a failed link.** Needs a driver-specific classification of the link error (ANGLE, Metal, Mesa word it differently) and wastes compiles; counting first is deterministic.
- **Always budget for the guaranteed minimum (11), even on 32-unit devices.** Would degrade capable devices for the sake of the weakest, against the Tiered Renderer Autonomy rule.
- **Keep throwing (status quo).** The material disappears silently from the scene (measured: a 14-map material was not drawn at all), the worst outcome for a cosmetic extension.
- **A hand-kept samplers-per-flag table.** The very thing that drifts when a shader gains a map; deriving the count from the source cannot.
- **Packing maps into shared textures at runtime.** Texture composition per material is expensive and does not work for compressed (KTX2) textures.

## Revisit when

- A material needs its own priority (e.g. an authored brushed-metal asset whose anisotropy map matters more than its specular map): add a per-material priority override instead of changing the global order.
- Core maps alone exceed the budget (not reachable today): then the program is genuinely too big and needs another answer than dropping.

## Doctrine Compliance

- **New public hot-scope parameters (classification):** none; `EXTENSION_MAP_GROUPS` is an internal policy constant, the rest are internal functions of the program cache.
- **Shared abstraction >= 3 consumers?** Not applicable; the allocator and the counter now share one source for the renderer-owned samplers and the reserved range (`SamplerBudget.ts`), which removed two duplicated constants.
- **Modeful object?** No modes; the fit is a pure function of (flags, source, device limit), cached per program.
- **Mathematical claims:** none beyond the unit arithmetic (`nextUnitAfter`), checked against the allocator's behaviour in `SamplerBudget.test.ts` (counts of the real assembled Standard program agree with `GL2SamplerBudget.test.ts`).
- **Fail-closed / honest fallback:** honest fallback with a warning, for a cosmetic capability only (maps, never the surface itself), as ADR 0043's calibration asks; the render-critical failure (nothing droppable left) still throws.
- **Exceptions:** none.

## Consequences

- On a 16-unit device a glTF material with many extension textures renders with the factors of the lowest-priority features instead of disappearing; the warning says which.
- Verified on the GPU with a pretended 16-unit limit on a 13-sampler material: committed HEAD threw "needs 18 texture units" and did not draw the object, the resolver build drew it after dropping the two iridescence maps.
- The 32-unit software renderer used for the repo's checks never triggers the drop; the unit tests and the pretended-limit probe are the coverage.
