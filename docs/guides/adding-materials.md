# Adding a New Material

This guide is aimed at engine contributors: it explains how to add a new material to Small World Machine, not how to use the built-in ones (see [Materials & Shaders](/guides/materials) for that).

## Two Ways to Add a Material

**`CustomShaderMaterial`** - write raw shader source and hand it to a single, ready-made material class. No new TypeScript class, no engine changes. Good for one-off effects, Shadertoy/ComputeToys imports, or prototyping.

**A new `AbstractMaterial` subclass** - write a proper TypeScript class with typed constructor options and public properties (`material.roughness = 0.4`, etc.), backed by its own shader. Good for anything that should be reused project-wide, documented, and exported from the engine.

The rest of this guide covers the second path - it's also what `CustomShaderMaterial` does internally, just without a dedicated class wrapping it.

## Where Material Files Live

`packages/engine/src/core/materials/` is grouped by family; a family folder holds its material classes plus a
`shaders/` subfolder with the `.glsl` / `.glsl100` / `.wgsl` sources (imported as `./shaders/X.frag.glsl?raw`):

| Folder | Materials |
| --- | --- |
| `surface/` | `Basic`, `Lambert`, `Phong`, `Standard`, `Decal` |
| `glass/` | `Glass`, `Frostglass` |
| `liquid/` | `OpenWater`, `StylizedWater`, `LiquidWave`, `FluidSurface`, `Slime`, `Lava`, `StylizedLava` |
| *(root)* | `AbstractMaterial`, `CustomShaderMaterial`, single-purpose materials (`Depth`, `Skybox`, `Sprite`, `Terrain`, `Wireframe`, `World`, `RetroScreen`) and `shaders/chunks/` shared by several materials |

Post-processing shaders belong to the renderer, not to a material: `packages/engine/src/renderers/post/shaders/`.

## The Two Methods Every Material Implements

`AbstractMaterial` (`packages/engine/src/core/materials/AbstractMaterial.ts`) requires exactly two methods:

```typescript
public abstract getRenderManifest(): RenderManifest;
public abstract getShaderDefinition(): ShaderDefinition;
```

`getShaderDefinition()` is called once per shader variant and describes the shader itself: its source code for each renderer dialect, and its `layout` (which uniforms and textures it expects). `getRenderManifest()` is called every frame and returns the *current values* for those uniforms/textures - the renderer reads only this manifest; it never inspects your material's fields directly.

A minimal real example, abridged from `PhongMaterial.ts`:

```typescript
public override getShaderDefinition(): ShaderDefinition {
  return {
    id: this.type, // a unique string ID, e.g. MaterialType.PHONG or a custom string
    sources: {
      glsl300: { vs: "[BASE_VERTEX_HEADER][BASE_VERTEX_MAIN]", fs: fragGLSL },
      glsl100: { vs: "[BASE_VS]", fs: fragGLSL100 },
      wgsl: `[WGSL_STRUCTS]\n[WGSL_PBR_MATH]\n[WGSL_VS]\n${fragWGSL}`,
    },
    layout: {
      ...StandardWebGPULayout,
      textures: {
        u_diffuseMap: { type: ShaderPropertyType.TEXTURE },
        u_normalMap: { type: ShaderPropertyType.TEXTURE },
        u_specularMap: { type: ShaderPropertyType.TEXTURE },
      },
    },
  };
}

public override getRenderManifest(): RenderManifest {
  if (undefined === this._renderManifest) this._renderManifest = this._createBaseManifest();
  this._syncBaseManifestState();

  const props = this._renderManifest.properties as Record<string, unknown>;
  const texs = this._renderManifest.textures as Record<string, unknown>;
  props["u_color"] = this.color.toFloat32Array();
  props["u_shininess"] = this.shininess;
  texs["u_diffuseMap"] = this.diffuseMap;
  return this._renderManifest;
}
```

`AbstractMaterial._createBaseManifest()`/`_syncBaseManifestState()` already pre-fill the properties every material shares (color, culling, blending, fog parameters, ...) - call them first and override only what your material actually adds.

The tokens `[BASE_VERTEX_HEADER]`, `[WGSL_PBR_MATH]`, etc. are shared shader building blocks, registered in `CoreShaderChunks.ts` and expanded by the engine's `ShaderRegistry.assemble()` (`RendererContext.shaderRegistry`, one per engine). A material does not register its shader anywhere itself: the renderer hands it to its registry the first time it draws it (ADR 0032). Reuse them instead of re-deriving lighting/fog/PBR math by hand.

## The Three Shader Dialects

A material can supply up to three independent shader sources: `wgsl` (WebGPU), `glsl300` (WebGL2), `glsl100` (WebGL1). Each renderer compiles only its own dialect - there is no auto-transpiler between them. A material only needs to support the renderers relevant to it; if `glsl100` is omitted, that material simply throws an error when the app runs under `WebGL1Renderer` (this is intentional, e.g. for pure WGSL Shadertoy imports - see `CustomShaderMaterial`).

Since the three sources are maintained by hand and independently, they *will* drift apart - a uniform present in the WGSL version but missing (or misspelled) in the GLSL300 version is a common source of bugs, and it doesn't show up as a compile error, only as a texture/uniform silently never being set. After changing or adding a material's shaders, run:

```bash
npm run test:showcases
```

It loads each showcase headlessly and reports real GL compile/link/`GL_INVALID_OPERATION` errors - `scripts/check-showcases.js` forces all three renderer types (`WEB_GL1`/`WEB_GL2`/`WEB_GPU`) via Swiftshader flags and captures per-renderer console errors, which covers WebGL1/WebGL2 shader bugs; for WebGPU, headless Chrome remains unreliable (see the `showcases-smoke-test` CI job, intentionally non-blocking).

## Uniform and Texture Binding Is Automatic

The WebGL1/WebGL2 renderers determine a compiled shader's uniforms and sampler texture units by querying the linked GPU program directly (`gl.getActiveUniform`, in `renderers/gl/managers/WebGLProgramCache.ts`), instead of consulting a hand-maintained list of expected names. This means: **as soon as a uniform or texture is declared in the shader source and listed in `layout.uniforms`/`layout.textures`, it "just works"** - nothing in the renderers needs to be touched to support it, and there is no internal name list whose update could be forgotten.

The one thing that still has to match by convention: the property/texture keys written in `getRenderManifest()` (e.g. `texs["u_diffuseMap"]`) must be spelled exactly like the corresponding `uniform sampler2D u_diffuseMap;` in the shader source. A mismatch is not a compile error - the uniform simply never gets written, so the sampler is left at whatever the GPU driver defaults to.

If a name in `layout.uniforms`/`layout.textures` has no matching active uniform in the compiled shader (a typo, or the shader compiler optimized it away because it's actually unused), the WebGL1 (GLSL100) path logs a console warning naming the mismatch (names from `StandardWebGPULayout.uniforms` are deliberately not warned about) - a quick way to spot a typo without having to search through the render output.

Cube vs. 2D textures are also detected automatically, based on the sampler type declared in the shader (`samplerCube` vs. `sampler2D`), not on the uniform's name - so a new cube-sampler uniform likewise needs no name-based special case.

Shadow-map and IBL samplers (irradiance/prefilter/BRDF) are the one exception: they are scene-global rather than per-material, and are bound via dedicated code paths in `WebGL2Renderer` with fixed texture units, regardless of what a new material declares. Nothing needs to be done for this - it's only relevant if the shadow/IBL system itself is changed.

## A `CustomShaderMaterial` with a WGSL source

WGSL cannot look up uniforms by name: the per-object data is one fixed 512-byte block (`obj`), so a WGSL custom material follows a few rules (the voxel prototype's `BlockMaterial` and `SkyMaterial` are working examples):

- **Layout:** spread `StandardWebGPULayout` (`layout: { ...StandardWebGPULayout, textures: {...} }`) and carry your own values in the `u_matParam0 … u_matParam15` lanes (`obj.matParamN` in WGSL, `uniform vec4 u_matParamN` in GLSL). Hand the material one array per lane and write into it in place; nothing then allocates per frame. The other standard fields have neutral defaults, so a material only sets what it uses.
- **Textures:** the WGSL bind group knows a fixed set of texture names (`u_diffuseMap`, `u_normalMap`, … see `getOptionalMaterialTextureBindings`). A texture under another name is not bound on WebGPU.
- **Array textures:** a `TextureArray` bound as `u_diffuseMap` becomes a `texture_2d_array` (`CustomShaderMaterial` sets `USE_TEXTURE_ARRAY` for it). Sample it with `textureSampleLevel(u_diffuseMap, s, uv, layer, 0.0)`; the pipeline cache rewrites plain `textureSample(u_diffuseMap, …)` calls for the engine's own materials only. The sampler follows the filter and wrap settings of the `u_diffuseMap` texture (nearest/clamp for pixel art). Array views have no mip chain.
- **Vertex colours:** `flags: [VERTEX_COLOR_FLAG]` binds the mesh's colour buffer at `@location(11)` (`a_color` in GLSL). Not available together with instancing.
- **Vertex output:** name your output struct anything but `Out` and the variable anything but `o`: the pipeline cache rewrites the engine's default output variable textually.
- **Sky/far-plane geometry:** pin depth with `vec4(clip.xy, clip.w * 0.99999, clip.w)`; WebGPU compares `less-equal`, WebGL2 `less`.
