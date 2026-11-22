---
status: accepted
---

# 0064: Per-Slot `KHR_texture_transform` & `TEXCOORD_1` (`u_uvTransforms`, `AlphaCutoutGroups`)

- **Status:** Accepted (2026-11-22)
- **Date:** 2026-11-22
- **Trigger:** Showcase 13 glTF 2.0 extension audit (`KHR_texture_transform` + multi-UV `texCoord` compliance across shared `Texture` assets and alpha-cutout depth/shadow passes).

## Decision

- **Material-owned per-slot transforms (`TextureTransform.ts`, `StandardMaterial.textureTransforms`):** Replaced `GltfMaterialParser`'s sibling-`Texture`-cloning workaround with `Partial<Record<TextureSlotName, TextureTransform>>` stored on `StandardMaterial`. Nineteen ordered slots (`TEXTURE_SLOT_ORDER` `0..18`) pack into a single `Float32Array(152)` (`UV_TRANSFORM_VEC4_COUNT = 38` `vec4` entries: `[offsetX, offsetY, scaleX, scaleY]` and `[cos(rotation), sin(rotation), texCoord, 0]`) uploaded via `u_uvTransforms` without mutating or duplicating shared `Texture` GPU resources.
- **Compile-gated zero-cost default (`ShaderFlag.UV_TRANSFORMS` & `ShaderFlag.UV1`):** Materials without explicit non-identity per-slot transforms omit `USE_UV_TRANSFORMS` and `USE_UV1`, keeping legacy `v_uv` (`Texture.{offset,repeat,rotation}`) byte-for-byte intact with zero extra uniform upload or shader ALU cost. When `textureTransforms` is active, `swmTransformUv` selects `uv0` (`TEXCOORD_0`) or `uv1` (`TEXCOORD_1`, gated by `ShaderFlag.UV1`) and applies glTF's `offset + R(rotation) * (scale * uv)` transform, while `swmTransformTbn` rotates TBN tangents (or recomputes screen-space derivative TBN when a normal map samples `TEXCOORD_1`, matching MikkTSpace/glTF).
- **`TEXCOORD_1` (`uvs1` / `a_uv1`) across core, Draco, GL, and WebGPU:** Added optional `GeometryDataInterface.uvs1` (`AbstractGeometry`, `ModelGeometry`, `GltfGeometryParser`, `DracoDecoder`/`DracoWasmDecoder`, `WorldWriter`), vertex attribute binding `a_uv1` (WebGL1/WebGL2 + instancing managers) and `@location(5) uv1: vec2f` (WebGPU `GPUGeometryCache`/`GPUPipelineCache`). `texCoord` values `0` and `1` resolve silently; `texCoord >= 2` warns once per parser/writer and falls back to `0`.
- **Alpha-cutout depth & shadow parity (`AlphaCutoutGroups` + `DepthMaterial`/`EvsmMomentMaterial`):** Added `diffuseTransform` + `UV_TRANSFORMS`/`UV1` support across all six depth/EVSM fragment shaders (`wgsl`, `glsl`, `glsl100`) and introduced `AlphaCutoutGroups` (Rule of Three: shared across `DepthPrePassGPU`, `CascadedShadowPassGPU`, `SpotShadowPassGPU`), grouping cutout draws by `(diffuseMap, alphaTest, diffuseTransform)` with stable `groupUuid` keys so pre-submit `queue.writeBuffer` calls never overwrite shared-texture `u_uvTransforms` buffers. WebGL2 `_bindShadowBatchUniforms` uploads `u_uvTransforms` plus legacy `u_texOffset`/`u_texRepeat`/`u_texRotation`.

## Rejected

- **Sibling `Texture` cloning in `GltfMaterialParser`:** Duplicated GPU textures in VRAM whenever two slots or materials shared an image with different UV transforms, mutated `Texture.repeat`/`offset` on uncloned textures, and could not support `texCoord: 1` or independent normal/metallic/ao/emissive transforms on packed maps.
- **Expanding `ObjectUniforms` UBO beyond 512 bytes (ADR 0027):** Adding 38 `vec4` entries (608 bytes) per object would double every non-transformed draw's uniform footprint; keeping `u_uvTransforms` as an opt-in material uniform / WebGPU binding pays zero overhead when inactive.
- **Per-slot `vec4` matrices per shader stage unconditionally:** Always executing matrix multiplies and `uv1` vertex attributes would penalize terrain/prop materials that never use `KHR_texture_transform`.

## Consequences

- Shared `Texture` instances remain single-upload GPU resources even when baseColor, normal, metallicRoughness, occlusion, or extension maps apply distinct `offset`, `scale`, `rotation`, or `texCoord` (`0` vs `1`).
- Alpha-cutout foliage/grates using transformed or `TEXCOORD_1` diffuse textures cast matching shadows across WebGPU depth/EVSM/spot cascades and WebGL2 shadow passes.
- `ShaderFlag` bitbudget consumes bits `16` (`UV1`) and `17` (`UV_TRANSFORMS`) out of `WebGLProgramCache`'s compile-flag table across `WEB_GPU`, `WEB_GL2`, and `WEB_GL1`.

## Doctrine Compliance

- **New public hot-scope parameters:** `StandardMaterial.textureTransforms`, `DepthMaterial.diffuseTransform`, and `EvsmMomentMaterial.diffuseTransform` are tagged `@domain` optional per-slot UV transform descriptors (additive defaults = identity on `TEXCOORD_0`); `TextureTransform.ts` helpers (`packUvTransformSlot`) are zero-allocation on pre-allocated `Float32Array(152)`.
- **Shared abstraction >= 3 consumers?** `AlphaCutoutGroups` (`renderers/passes/AlphaCutoutGroups.ts`) serves three independent pass consumers: `DepthPrePassGPU`, `CascadedShadowPassGPU`, and `SpotShadowPassGPU`.
- **Modeful object?** `StandardMaterial`, `DepthMaterial`, and `EvsmMomentMaterial` convert explicitly between legacy `Texture.{offset,repeat,rotation}` (`!USE_UV_TRANSFORMS`) and per-slot `u_uvTransforms` (`USE_UV_TRANSFORMS`, forcing legacy vertex UV uniforms to identity `[0,0]` / `[1,1]` / `0`); verified in `TextureTransform.test.ts`.
- **Mathematical claims:** Rotation + scale order strictly obeys glTF 2.0 `KHR_texture_transform` (`offset + R(rot) * (scale * uv)`), TBN rotation preserves handedness and falls back to normalized derivative tangent frame on `texCoord == 1`.
- **Fail-closed / honest fallback:** `texCoord >= 2` warns once and clamps cleanly to `TEXCOORD_0`; meshes omitting `uvs1` bind zero/default `(0,0)` on GL/WebGPU without NaN; WebGL1 without `OES_standard_derivatives` degrades cleanly from derivative TBN to angle-rotated vertex TBN.
- **Exceptions:** None.
