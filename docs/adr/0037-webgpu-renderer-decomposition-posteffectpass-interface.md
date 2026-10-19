# 0037: WebGPU Renderer Decomposition & GPU PostEffectPass Interface

- **Status:** Accepted
- **Accepted:** 2026-10-19 (maintainer approval)
- **Date:** 2026-10-18
- **Status of:** *Thermo audit 2026-10-14* (`02-renderers-webgpu-shaders.md`, `03-post-decals-culling-lights.md`), Wave 2, Package A
- **Decision Makers:** Small World Machine Architecture Team — approved by the maintainer on 2026-10-19

---

## Context & Motivation

`renderers/WebGPU/WebGPURenderer.ts` had grown to **2612 lines** (audit date; roadmap figure 2484
on ff3f3ab6, the file outgrew it). It bundles seven independent subsystems:

1. global-uniform + light-buffer writing (`_updateGlobalBuffers`, ~220 lines),
2. opaque texture / normal / depth capture (`captureOpaqueTexture`/`captureOpaqueNormal`/`captureOpaqueDepth`, ~150 lines),
3. render-target texture allocation (`_renderTargetTextures` / `_renderTargetCubeTextures` resize/alloc flows),
4. Hierarchical-Z occlusion culling (pipelines, pyramid build, visibility test dispatch, staging readback, ~330 lines),
5. post-effect orchestration (five GPU effect passes + their per-effect `_xxxPassGPU` fields and `?.destroy()` lists),
6. the render/`_renderSubgroup` hot path,
7. per-object/decal/sprite uniform packing.

Audit findings that drive decisions here: report 02 #9 (HZB visibility-test footprint, see
§7.4), report 02 #11 (system boundaries), report 03 (post orchestration, `PostProcessPass`,
HZB, resource caches, light shafts).

Additionally, Wave 2 runs four parallel packages; **Package B** (WebGL decomposition) consumes the
GPU-side `PostEffectPass` orchestration contract **by shape** for its GL passes. This ADR pins
that contract so B can build against it without waiting.

Prior Wave-1 artifacts this builds on (do not duplicate):
- `renderers/GlobalUniformLayout.ts` (single source for the `GlobalUniforms` block / light sub-layouts; created in Wave 1-a),
- `PostProcessingElement.packUniforms`/`structuralKey` + the `PostProcessPass` per-element uniform pipeline (Wave 1-b).

---

## Architectural Decision

### 1. `PostEffectPass` interface + one renderer registry (the interface contract)

The renderer routes the lifecycle of every GPU post-effect pass through a single registry
`Map<PostProcessingEffectType, PostEffectPass>` (field `WebGPURenderer._postEffectPasses`).
Lazy creation uses `_getOrCreatePostEffectPass(type, ctor)` where `ctor: new (device: GPUDevice) => PostEffectPass`
(zero closures on the hot path); the single `destroy()` sweep in `WebGPURenderer.destroy()`
replaces the former six `?.destroy()` calls.

**Binding interface signatures** (full contract):

```ts
export interface PostEffectPassContext {
  renderer: WebGPURenderer;
  ce: GPUCommandEncoder;
  element: PostProcessingElement;          // set per dispatch; passes cast to their own type
  colorTexture: GPUTexture | undefined;    // this frame's HDR scene color, if it exists
  colorView: GPUTextureView;               // the chained "current" color input
  depthView: GPUTextureView;               // captured opaque depth (or a safe dummy)
  width: number;
  height: number;
  vp: Float32Array;                        // ZO-corrected view-projection
  vMat: Float32Array | undefined;
  camPos: Vector3D;
  near: number;
  far: number;
  projMatrix: Float32Array | undefined;
  lights: LightDataInterface;
  fogVolumes: FogVolume[];
}

export interface PostEffectPass {
  execute(ctx: PostEffectPassContext): GPUTextureView | null;
  destroy(): void;
}
```

**Responsibility split (binding, part of the contract):**
- `execute(ctx)` runs the effect for the **current frame**, recording into `ctx.ce`. It returns the
  texture view the next chained effect (or the uber pass) consumes, or `null` when the effect could
  not produce output this frame (element disabled, missing inputs). It is called at most once per
  frame per registry entry, from `render()`.
- `destroy()` releases every GPU resource the pass allocated. Safe to call exactly once, during
  `WebGPURenderer.destroy()`, after the device stopped rendering.
- The `PostEffectPassContext` object is **reused** by the renderer across dispatches (zero
  allocation in the render loop); passes must read it synchronously inside `execute()` and never
  retain a reference past the call. Fields varying per effect (`colorView`, `element`,
  `fogVolumes`) are repopulated immediately before each dispatch.

**Not on the interface:** the effect type is NOT a member of `PostEffectPass`. The registry key
carries it — a pass may legitimately serve more than one effect type (one
`HistoryBlendPassGPU` instance per type in the registry, each with its own history buffer, serves
both `TAA` and `MOTION_TRAIL`).

### 2. `postProcessing.requiresOpaqueDepth` — single resource-need source

`PostProcessingGroup.requiresOpaqueDepth` is the **only** place that decides whether the opaque
(pre-transparent) depth capture must run for post-processing consumers on the GPU path:

```ts
public get requiresOpaqueDepth(): boolean {
  const hbao = this.get<HbaoElement>(PostProcessingEffectType.HBAO);
  const shafts = this.get<LightShaftsElement>(PostProcessingEffectType.LIGHT_SHAFTS);
  const volFog = this.get<VolumetricFogElement>(PostProcessingEffectType.VOLUMETRIC_FOG);
  return (hbao !== undefined && hbao.enabled)
      || (shafts !== undefined && shafts.enabled)
      || (volFog !== undefined && volFog.enabled);
}
```

An effect "requires opaque depth" exactly when its GPU implementation reads the captured depth
texture (`HBAO`, `LIGHT_SHAFTS`, `VOLUMETRIC_FOG`). Effects without such a consumer never do.
The render loop and `MainRenderPass` use this property instead of per-effect ad-hoc OR-chains.
The unrelated transparent-refraction capture and the decal depth/normal captures keep their own,
separate conditions. Behavior note: previously the no-transparent no-decal branch captured depth
only for HBAO/light shafts; the property now also covers volumetric fog, closing the corner case
where a volumetric-fog-only frame silently lost its fog. (Verified in-browser; see package report.)

GL consumption (Package B) follows the same property GL-side (`requiresOpaqueDepth` is on
`PostProcessingGroup`, which is renderer backends-agnostic). Package B builds the GL passes against
the SHAPE of this contract, adapted to GL resource types (no `GPUCommandEncoder`/`GPUTextureView`
on WebGL).

### 3. Decomposition of `WebGPURenderer.ts` (small → large, one commit per subsystem)

Each subsystem becomes a module under `renderers/WebGPU/` (new) or reuses the existing
`managers/` layer. Behavior stays byte-identical; the hot path stays zero-allocation (scratch
ownership moves WITH the writer, never re-created per frame):

- **`GlobalUniformWriter`** (`renderers/WebGPU/managers/GlobalUniformWriter.ts`): the entire
  `_updateGlobalBuffers` packing/upload for the global buffer + point/spot/area light buffers,
  driven by `WebGPUGGlobalUniformLayout` (Wave-1-a single source). Moves with it: the scratch
  `Float32Array`s and the write-side view-slot callback.
- **Opaque/deco capture** (`OpaqueCapture`): `captureOpaqueTexture`/`captureOpaqueNormal`/
  `captureOpaqueDepth` + the cached capture textures + the `_resolveOptionalMaterialTexture`
  fallback reads for `u_opaqueMap`/`u_opaqueDepthMap`/`u_normalBufferMap`.
- **`GPURenderTargetCache`**: the `_renderTargetTextures` / `_renderTargetCubeTextures`
  resize/alloc flows (create/destroy/re-register with `GPUTextureResourceCache`).
- **`HzbOcclusionSystem`**: everything HZB (pipelines, pyramid build, visibility test, staging
  ping-pong readback, `applyPendingOcclusionResults`), including the HZB footprint question
  (report 02 #9 — see §7.4).
- **Post-FX orchestration**: as §1 — already the single registry; `PostProcessPass.ts` (434
  lines) is structurally reduced by moving its pipeline-constant injection and bind-group
  selection into focused helpers without behavior change.

Acceptance target: `WebGPURenderer.ts` < 1200 lines **or** a verifiable decomposition with all
listed subsystems as own modules (the achieved value is reported transparently in the package's
DONE report, never silently dropped).

### 4. Hygiene

- Six+ inline `import("...")` **type-only** references in the touched renderer/pass files are
  hoisted to `import type` at the file head.
- `no any`, explicit return types, no `Math.random` (engine code uses `SeededRandom`), zero-allocation
  hot paths (coding-guide §3B).

---

## Consequences

**Positive:**
- One lifecycle path for GPU effect passes (create/execute/destroy) — the six `_xxxPassGPU`
  fields and their destroy lists are gone.
- The renderer shrinks toward a maintainable size; each subsystem gets a focused, testable home.
- B can implement GL `PostEffectPass` consumption against a written contract without blocking.
- The opaque-depth need is expressed in exactly one place, so adding a depth-consuming effect
  cannot silently forget a capture branch.

**Negative / trade-offs:**
- The GPU `PostEffectPassContext` is WebGPU-typed; the GL side adapts the shape (documented), it
  does not share the type.
- Reused-context mutation must be disciplined: any pass that retains `ctx` across frames would
  read stale data (contract documented on the interface).

**Compatibility:** additive refactor, no public API change; `PostProcessPassUniforms.test.ts` /
`RendererParityPostProcess.test.ts` and all WebGPU showcase smoke tests must stay green.

---

## Open items / follow-ups

- Report 02 #9 (HZB visibility-test footprint) — resolved in browser during Package A task 4;
  finding reported in the package DONE report.
- The remaining `import("...")` inline type refs in `renderers/post/passes/PostProcessPassGL.ts`
  are **Package B's** file (conflict matrix); B hoists them when it consumes the contract.
- ADR index line to be added centrally by the coordinator after acceptance.
