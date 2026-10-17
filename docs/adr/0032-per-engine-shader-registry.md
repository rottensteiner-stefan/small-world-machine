# 0032: Per-Engine Shader Registry (No Process-Wide Shader State)

- **Status:** Accepted & Implemented (phases 1 to 3, 2026-10-17)
- **Date:** 2026-10-17
- **Decision Makers:** Small World Machine Architecture Team

---

## Context & Motivation

The architectural law "No Global Singletons: multiple engine instances per page" is only half true for shaders. `RendererContext` already gives every engine its own `ShaderRegistry`, `DeviceCaps` and `AssetManager`, but shader lookup still leaks through process-wide state (thermo review 2026-10-14, cross-cutting item 1.1):

1. **`ShaderRegistry.instance`** (deprecated static default) is still used by production code: `PostProcessPass` (WGSL) and `PostProcessPassGL` assemble their post shader through it instead of `renderer.context.shaderRegistry`. `CoreShaderChunks.init()` and `ShaderBootstrap.init()` default to it. Two engines on one page therefore share post-process chunks, and a chunk registered on one engine's registry is invisible to the passes.
2. **A module-global `materialShaderProviders` map** (`ShaderRegistry.ts`). `AbstractMaterial`'s constructor registers `this` under `this.type` ("first wins", silently). Consequences: (a) the first material instance of a type pins its provider for the whole process, (b) `CustomShaderMaterial` uses a per-instance type (`"CustomShaderMaterial_<uuid>"`), so every instance adds a map entry that retains the material forever (a leak), (c) built-in programs such as `MaterialType.DEPTH` only resolve because *some* code happened to construct a `DepthMaterial` earlier, an invisible load-order dependency.
3. **Silent fallbacks to the singleton.** `ShaderRegistry.get()` and `getChunk()` fall back to `ShaderRegistry._instance` on a miss and only `console.warn`, which hides a missing registration on the instance registry.

## Decision

`RendererContext.shaderRegistry` is the **only** owner of shader definitions, chunks and material providers. There is no process-wide shader state.

1. **Remove the singleton.** Delete `ShaderRegistry.instance`/`_instance`, the singleton fallbacks in `get()`/`getChunk()`, and the default parameters of `CoreShaderChunks.init(registry)` and `ShaderBootstrap.init(registry)` (the registry becomes a required argument). Post passes take the registry from the renderer's context.
2. **Remove the global provider map and the constructor self-registration.** A material no longer registers itself anywhere. Instead the renderer hands the provider to its own registry when it first meets a material: `ShaderRegistry.ensureProvider(shaderId, provider)` (idempotent, a `Map.has` per batch, no allocation) is called at the three batch entry points (WebGL1 `_renderSubgroup`, WebGL2 `_renderSubgroup`, WebGPU pipeline lookup) from the batch's first material. Per-instance providers (`CustomShaderMaterial`) are therefore owned by the registry of the engine that renders them and are released with it.
3. **Built-in programs are registered by the bootstrap, not by accident.** `ShaderBootstrap.init(registry)` registers the definitions the renderers request by id without a material (`DEPTH`, ...), so no load-order dependency remains.
4. **Fail fast.** A missing shader id still throws in `getProgram`/`getShaderModule` (already the case); the silent `console.warn` fallbacks disappear with the singleton.

### Rejected alternatives

- **Keep the global provider map but fix "first wins".** Still process-wide state: it cannot support two engines that load different `liquid-extras` versions, and the `CustomShaderMaterial` leak needs a separate fix.
- **Give every material a back-reference to a registry at construction.** Materials are created before (and independently of) any engine, in apps, tests and loaders; this would force a context argument through every constructor.
- **Put the provider into `RenderManifest`.** 23 manifest builders would change for no gain over handing it over once per batch.

## Consequences

- **Breaking (API):** `ShaderRegistry.instance`, `registerMaterialShaderProvider` and the argument-less `CoreShaderChunks.init()` / `ShaderBootstrap.init()` disappear (all were `@deprecated`, removal target v1.0.0). Tests that used the singleton get a small helper that builds a bootstrapped registry.
- Two engines on one page no longer share any shader state; destroying an engine releases its custom-material providers.
- One more call per batch in each renderer (a `Map.has`); no per-frame allocation.

## Implementation Phases

1. **Production singleton users:** `PostProcessPass`, `PostProcessPassGL` use the context registry; `ShaderRegistry.instance` is no longer referenced from `src/` (except its own deprecated definition).
2. **Provider hand-over:** `ensureProvider` at the batch entry points, built-ins in the bootstrap, remove the global map and the `AbstractMaterial` constructor registration; `CustomShaderMaterial` leak test.
3. **Delete the singleton:** migrate the tests to the helper, remove `instance`, the fallbacks and the default parameters.

Each phase is a separate commit with its own gates; phase 3 is the only breaking one.
