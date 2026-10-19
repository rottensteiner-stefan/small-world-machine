import type { DeviceCaps, Object3D } from "../../../core/index.js";
import { DeviceLimit } from "../../../core/index.js";
import type { RenderManifest, ShaderRegistry } from "../../shaders/index.js";
import { VERTEX_COLOR_FLAG } from "../../shaders/index.js";
import { BlendingMode, CullMode, NormalTargetMode } from "../../../enums/index.js";
import {
  NORMAL_TARGET_FORMAT,
  canWrapFragmentWithNormalOutput,
  wrapFragmentWithNormalOutput,
} from "./NormalOutputWrapper.js";

export interface WebGPUPipelineCacheEntry {
  pipeline: GPURenderPipeline;
  layout: GPUPipelineLayout;
  bgLayouts: GPUBindGroupLayout[];
  /** Number of live Object3D instances currently referencing this pipeline. */
  refCount: number;
}

/**
 * GPU binding-slot metadata for every material texture that ISN'T always bound (see
 * `GPUPipelineCache.getMaterialBGL`'s fixed set: sampler/normalMap/envMap/emissiveMap). Mirrors
 * `structs.wgsl`'s `@group(1)` binding numbers 1:1 -- this is stable GPU-type metadata (what
 * shape is this texture?), not a "which material uses this?" list. That answer comes from each
 * material's own `getShaderDefinition().layout.textures`, which is what `getMaterialBGL()` and
 * `WebGPURenderer._getMaterialBindGroup()` actually consult to decide which of these entries a
 * given material's bind group needs.
 *
 * Built lazily (not a module-scope literal): it references the `GPUShaderStage` global, which
 * only exists where the WebGPU API is present -- eagerly evaluating it at import time would break
 * every environment without that global (e.g. Vitest), even for tests unrelated to WebGPU, since
 * they transitively import this module via `RendererFactory`.
 */
let _optionalMaterialTextureBindings:
  Record<string, { binding: number; layoutEntry: GPUBindGroupLayoutEntry }> | undefined;

export function getOptionalMaterialTextureBindings(): Record<
  string,
  { binding: number; layoutEntry: GPUBindGroupLayoutEntry }
> {
  if (!_optionalMaterialTextureBindings) {
    _optionalMaterialTextureBindings = {
      u_diffuseMap: {
        binding: 2,
        layoutEntry: {
          binding: 2,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: "float" },
        },
      },
      u_specularMap: {
        binding: 4,
        layoutEntry: {
          binding: 4,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: "float" },
        },
      },
      u_sandMap: {
        binding: 5,
        layoutEntry: {
          binding: 5,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: "float" },
        },
      },
      u_grassMap: {
        binding: 6,
        layoutEntry: {
          binding: 6,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: "float" },
        },
      },
      u_rockMap: {
        binding: 7,
        layoutEntry: {
          binding: 7,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: "float" },
        },
      },
      u_snowMap: {
        binding: 8,
        layoutEntry: {
          binding: 8,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: "float" },
        },
      },
      u_metallicMap: {
        binding: 9,
        layoutEntry: {
          binding: 9,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: "float" },
        },
      },
      u_roughnessMap: {
        binding: 10,
        layoutEntry: {
          binding: 10,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: "float" },
        },
      },
      u_alphaMap: {
        binding: 13,
        layoutEntry: {
          binding: 13,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { viewDimension: "2d", sampleType: "float" },
        },
      },
      u_opaqueMap: {
        binding: 14,
        layoutEntry: {
          binding: 14,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { viewDimension: "2d", sampleType: "float" },
        },
      },
      u_reflectionMap: {
        binding: 15,
        layoutEntry: {
          binding: 15,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { viewDimension: "2d", sampleType: "float" },
        },
      },
      u_opaqueDepthMap: {
        binding: 16,
        layoutEntry: {
          binding: 16,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { viewDimension: "2d", sampleType: "depth" },
        },
      },
      u_aoMap: {
        binding: 17,
        layoutEntry: {
          binding: 17,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { viewDimension: "2d", sampleType: "float" },
        },
      },
      u_rampMap: {
        binding: 18,
        layoutEntry: {
          binding: 18,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { viewDimension: "2d", sampleType: "float" },
        },
      },
      u_distortMap: {
        binding: 19,
        layoutEntry: {
          binding: 19,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { viewDimension: "2d", sampleType: "float" },
        },
      },
      // Per-frame copy of the ADR 0028 normal buffer, read by decals via textureLoad.
      u_normalBufferMap: {
        binding: 20,
        layoutEntry: {
          binding: 20,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { viewDimension: "2d", sampleType: "unfilterable-float" },
        },
      },
    };
  }
  return _optionalMaterialTextureBindings;
}

/**
 * Names from `shaderId`'s own `layout.textures` that also appear in
 * `getOptionalMaterialTextureBindings()` -- i.e. the material-specific textures (beyond the
 * always-bound sampler/normalMap/envMap/emissiveMap) this material's bind group actually needs.
 */
export function getOptionalMaterialTextureNames(
  shaderId: string,
  shaderRegistry: ShaderRegistry,
): string[] {
  const declared = shaderRegistry.get(shaderId)?.layout.textures;
  if (!declared) return [];
  const bindings = getOptionalMaterialTextureBindings();
  return Object.keys(declared).filter((name) => name in bindings);
}

/**
 * Number of sampled-texture bindings in the global bind group (irradianceMap, prefilterMap,
 * brdfLUT, dirShadowMap, spotShadowMap -- bindings 4/5/6/8/9; binding 7 and 10 are samplers, not
 * counted against the per-stage sampled-texture budget). Every material bind group's own texture
 * count is added on top of this fixed cost when checking against the device's real per-stage
 * limit.
 */
const GLOBAL_BIND_GROUP_TEXTURE_COUNT = 5;

const ALWAYS_DECLARED_FLAGS: ReadonlySet<string> = new Set([
  "USE_TEXTURE_ARRAY",
  "USE_NORMAL_MAP",
  "USE_RAMP_LUT",
  "USE_INSTANCING",
  "USE_INSTANCE_COLOR",
  "USE_DECAL_GRADIENTS",
  "USE_DECAL_UNLIT",
]);
const SHADER_FLAG_PATTERN = /^[A-Z][A-Z0-9_]*$/;

/**
 * Sorted, de-duplicated and validated flag list. Each flag becomes a WGSL `const`, so a
 * duplicate would not compile and an invalid identifier would corrupt the shader prefix.
 */
/**
 * WebGPU bakes blending into the pipeline, WebGL toggles it from `transparent` at draw time
 * (AbstractWebGLRenderer: transparent => SRC_ALPHA/ONE_MINUS_SRC_ALPHA unless `blending` picks
 * another function). A transparent material that never set `blending` must therefore resolve to
 * ALPHA here too, or it is written unblended on WebGPU only.
 */
export function resolveBlendingMode(state: {
  transparent?: boolean | undefined;
  blending?: BlendingMode | undefined;
}): BlendingMode {
  if (state.blending) return state.blending;
  return state.transparent ? BlendingMode.ALPHA : BlendingMode.DEFAULT;
}

function normalizeShaderFlags(flags: readonly string[]): string[] {
  for (const flag of flags) {
    if (!SHADER_FLAG_PATTERN.test(flag)) {
      throw new Error(
        `[GPUPipelineCache] Invalid shader flag name "${flag}" (expected ^[A-Z][A-Z0-9_]*$).`,
      );
    }
  }
  return [...new Set(flags)].sort();
}

/**
 * Render pipeline / shader module / material bind-group-layout caches, plus the pipeline
 * refcounting that lets a pipeline no longer referenced by any live object be dropped.
 *
 * Extracted from `WebGPURenderer` -- see .agents/collaborate/god-objects-refactoring.md Phase 4.
 * No behavior change. `_globalBGL`/`_objectBGL`/`_viewBGL` are captured once at construction
 * (created once during `WebGPURenderer._initGlobalBuffers()`, never reassigned afterwards); the
 * render target format is NOT captured -- it depends on `postProcessing.enabled`, which can
 * toggle at runtime, so callers pass the current target format in on every call instead.
 */
export class GPUPipelineCache {
  private readonly _device: GPUDevice;
  private readonly _deviceCaps: DeviceCaps;
  private readonly _globalBGL: GPUBindGroupLayout;
  private readonly _objectBGL: GPUBindGroupLayout;
  private readonly _viewBGL: GPUBindGroupLayout;
  private readonly _shaderRegistry: ShaderRegistry;

  private _pipelines = new Map<string, WebGPUPipelineCacheEntry>();
  private _shaderModules = new Map<string, GPUShaderModule>();
  /** Normal-output modules whose `fs` could not be wrapped (no @location(1) output). */
  private _unwrappedNormalModules = new WeakSet<GPUShaderModule>();
  private _materialBGLCache = new Map<string, GPUBindGroupLayout>();
  /**
   * Every pipeline key an object is currently counted in. An object is drawn into several targets
   * per frame (main pass, planar reflection, probe faces), each with its own key; tracking only the
   * last key made each pass release the previous pass's pipeline, which was then deleted at
   * refCount 0 and rebuilt on the next draw, every frame. Keys stay counted until the object
   * itself is released (bounded by the number of pipeline variants).
   */
  private _pipelineKeysByObject = new WeakMap<Object3D, Set<string>>();
  /** `shaderId`s already warned about in `_checkSampledTextureBudget`'s budget guard. */
  private _warnedMaterialTextureBudget = new Set<string>();

  constructor(
    device: GPUDevice,
    deviceCaps: DeviceCaps,
    globalBGL: GPUBindGroupLayout,
    objectBGL: GPUBindGroupLayout,
    viewBGL: GPUBindGroupLayout,
    shaderRegistry: ShaderRegistry,
  ) {
    this._device = device;
    this._deviceCaps = deviceCaps;
    this._globalBGL = globalBGL;
    this._objectBGL = objectBGL;
    this._viewBGL = viewBGL;
    this._shaderRegistry = shaderRegistry;
  }

  /**
   * Builds the material bind group layout for `shaderId`, containing only the texture bindings
   * that material actually declares (plus normalMap/envMap/emissiveMap, which the shared PBR
   * lighting chunk references regardless of what an individual material's own layout declares).
   * A layout with every possible material texture bound at once (diffuse, normal, specular,
   * terrain x4, metallic, roughness, env, emissive, alpha, opaque, reflection, opaqueDepth = 15,
   * plus the 5 IBL/shadow textures in the global bind group = 20) exceeds WebGPU's guaranteed
   * per-stage sampled-texture minimum of 16 on any device that doesn't happen to allow more.
   */
  public getMaterialBGL(shaderId: string, flags: string[]): GPUBindGroupLayout {
    flags = normalizeShaderFlags(flags);
    const key = shaderId + "_" + flags.join("|");
    let bgl = this._materialBGLCache.get(key);
    if (!bgl) {
      const matEntries: GPUBindGroupLayoutEntry[] = [
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 11, visibility: GPUShaderStage.FRAGMENT, texture: { viewDimension: "cube" } },
        {
          binding: 12,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { viewDimension: "2d", sampleType: "float" },
        },
      ];
      const bindingInfo = getOptionalMaterialTextureBindings();
      for (const name of getOptionalMaterialTextureNames(shaderId, this._shaderRegistry)) {
        const info = bindingInfo[name]!;
        if ("u_diffuseMap" === name && flags.includes("USE_TEXTURE_ARRAY")) {
          matEntries.push({
            binding: info.binding,
            visibility: GPUShaderStage.FRAGMENT,
            texture: { viewDimension: "2d-array", sampleType: "float" },
          });
        } else {
          matEntries.push(info.layoutEntry);
        }
      }
      this._checkSampledTextureBudget(shaderId, matEntries);
      bgl = this._device.createBindGroupLayout({ entries: matEntries });
      this._materialBGLCache.set(key, bgl);
    }
    return bgl;
  }

  /**
   * Warns (once per `shaderId`) if `shaderId`'s material bind group, combined with the global
   * bind group's fixed textures, would exceed this device's real per-stage sampled-texture
   * budget -- or the WebGPU spec's guaranteed minimum if the real device limit isn't known yet.
   * `createBindGroupLayout` itself doesn't validate this (the failure only surfaces later, as a
   * cryptic "Invalid PipelineLayout"/"Invalid RenderPipeline" cascade at actual pipeline creation
   * time); this gives an early, actionable diagnostic naming the actual offending material.
   */
  private _checkSampledTextureBudget(
    shaderId: string,
    matEntries: GPUBindGroupLayoutEntry[],
  ): void {
    if (this._warnedMaterialTextureBudget.has(shaderId)) return;

    const materialTextureCount = matEntries.filter((e) => "texture" in e).length;
    const total = GLOBAL_BIND_GROUP_TEXTURE_COUNT + materialTextureCount;
    const deviceLimit = this._deviceCaps.getLimit(
      DeviceLimit.WEBGPU_MAX_SAMPLED_TEXTURES_PER_STAGE,
    );
    const limit =
      deviceLimit > 0
        ? deviceLimit
        : this._deviceCaps.getGuaranteedMinimum(DeviceLimit.WEBGPU_MAX_SAMPLED_TEXTURES_PER_STAGE);

    if (total > limit) {
      this._warnedMaterialTextureBudget.add(shaderId);
      console.warn(
        `[WebGPURenderer] Material '${shaderId}' needs ${total} sampled textures in the ` +
          `fragment stage (${GLOBAL_BIND_GROUP_TEXTURE_COUNT} global + ${materialTextureCount} ` +
          `material-specific), exceeding this device's per-stage limit of ${limit}. Pipeline ` +
          `creation for this material will likely fail.`,
      );
    }
  }

  public pipelineCacheKey(
    manifest: RenderManifest,
    topology: GPUPrimitiveTopology,
    isInstanced: boolean,
    targetFormat: GPUTextureFormat,
    normalMode: NormalTargetMode = NormalTargetMode.DEFAULT,
  ): string {
    const shaderId = manifest.shaderId;
    const flags = normalizeShaderFlags(manifest.flags || []);
    const flagKey = flags.length > 0 ? "_" + flags.join("|") : "";
    const state = manifest.state || {};
    return (
      shaderId +
      "_" +
      topology +
      "_" +
      (state.culling || CullMode.DEFAULT) +
      "_" +
      resolveBlendingMode(state) +
      "_" +
      (state.depthWrite !== false) +
      "_" +
      (state.depthTest !== false) +
      "_" +
      targetFormat +
      (normalMode === NormalTargetMode.NONE ? "" : "_nrm-" + normalMode) +
      (isInstanced ? "_instanced" : "") +
      flagKey
    );
  }

  public getPipeline(
    manifest: RenderManifest,
    topology: GPUPrimitiveTopology,
    isInstanced: boolean,
    targetFormat: GPUTextureFormat,
    normalMode: NormalTargetMode = NormalTargetMode.DEFAULT,
  ): WebGPUPipelineCacheEntry {
    const shaderId = manifest.shaderId;
    const flags = manifest.flags || [];
    const state = manifest.state || {};
    const key = this.pipelineCacheKey(manifest, topology, isInstanced, targetFormat, normalMode);
    let cache = this._pipelines.get(key);
    if (!cache) {
      const sm = this.getShaderModule(
        shaderId,
        isInstanced,
        flags,
        normalMode !== NormalTargetMode.NONE,
      );
      // A shader the wrapper could not rewrite has no @location(1) output. WebGPU rejects a
      // pipeline whose second target has a non-zero writeMask without such an output, but the
      // 2-attachment main pass still needs the second target slot, so it runs masked (no write).
      const effectiveNormalMode =
        normalMode !== NormalTargetMode.NONE && this._unwrappedNormalModules.has(sm)
          ? NormalTargetMode.MASKED
          : normalMode;
      const materialBGL = this.getMaterialBGL(shaderId, flags);
      const pipelineLayout = this._device.createPipelineLayout({
        bindGroupLayouts: [this._globalBGL, materialBGL, this._objectBGL, this._viewBGL],
      });

      const vertexBuffers: GPUVertexBufferLayout[] = [
        { arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }] },
        { arrayStride: 12, attributes: [{ shaderLocation: 1, offset: 0, format: "float32x3" }] },
        { arrayStride: 8, attributes: [{ shaderLocation: 2, offset: 0, format: "float32x2" }] },
        { arrayStride: 12, attributes: [{ shaderLocation: 3, offset: 0, format: "float32x3" }] },
        { arrayStride: 16, attributes: [{ shaderLocation: 4, offset: 0, format: "float32x4" }] },
        { arrayStride: 16, attributes: [{ shaderLocation: 5, offset: 0, format: "float32x4" }] },
      ];

      // Vertex colors (RGBA) ride in buffer slot 6 only for materials that opt in. Instanced
      // pipelines already use slots 6-7 and the default maxVertexBuffers is 8, so the two
      // cannot be combined.
      if (flags.includes(VERTEX_COLOR_FLAG)) {
        if (isInstanced) {
          throw new Error(
            `[WebGPUPipelineCache] ${shaderId}: ${VERTEX_COLOR_FLAG} cannot be combined with instancing (vertex buffer slot budget).`,
          );
        }
        vertexBuffers.push({
          arrayStride: 16,
          attributes: [{ shaderLocation: 11, offset: 0, format: "float32x4" }],
        });
      }

      if (isInstanced) {
        vertexBuffers.push({
          arrayStride: 64, // 16 floats * 4 bytes
          stepMode: "instance",
          attributes: [
            { shaderLocation: 6, offset: 0, format: "float32x4" },
            { shaderLocation: 7, offset: 16, format: "float32x4" },
            { shaderLocation: 8, offset: 32, format: "float32x4" },
            { shaderLocation: 9, offset: 48, format: "float32x4" },
          ],
        });

        vertexBuffers.push({
          arrayStride: 16, // 4 floats * 4 bytes for instanceData
          stepMode: "instance",
          attributes: [{ shaderLocation: 10, offset: 0, format: "float32x4" }],
        });
      }

      const targets: GPUColorTargetState[] = [{ format: targetFormat }];
      const blending = resolveBlendingMode(state);
      if (blending === BlendingMode.ALPHA) {
        targets[0]!.blend = {
          color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha", operation: "add" },
          alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
        };
      } else if (blending === BlendingMode.ADDITIVE) {
        targets[0]!.blend = {
          color: { srcFactor: "one", dstFactor: "one", operation: "add" },
          alpha: { srcFactor: "one", dstFactor: "one", operation: "add" },
        };
      } else if (blending === BlendingMode.PREMULTIPLIED_ALPHA) {
        targets[0]!.blend = {
          color: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
          alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
        };
      }
      if (effectiveNormalMode !== NormalTargetMode.NONE) {
        const normalTarget: GPUColorTargetState = {
          format: NORMAL_TARGET_FORMAT,
          writeMask: effectiveNormalMode === NormalTargetMode.MASKED ? 0 : GPUColorWrite.ALL,
        };
        if (effectiveNormalMode === NormalTargetMode.BLEND) {
          // The fragment alpha rides in the normal output's w component (see NormalOutputWrapper).
          normalTarget.blend = {
            color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha", operation: "add" },
            alpha: { srcFactor: "zero", dstFactor: "one", operation: "add" },
          };
        }
        targets.push(normalTarget);
      }
      const pipeline = this._device.createRenderPipeline({
        layout: pipelineLayout,
        vertex: { module: sm, entryPoint: "vs", buffers: vertexBuffers },
        fragment: { module: sm, entryPoint: "fs", targets },
        primitive: { topology, cullMode: state.culling || CullMode.DEFAULT },
        depthStencil: {
          depthWriteEnabled: state.depthWrite !== false,
          depthCompare: state.depthTest === false ? "always" : "less-equal",
          format: "depth32float",
        },
      });
      cache = {
        pipeline,
        layout: pipelineLayout,
        bgLayouts: [this._globalBGL, materialBGL, this._objectBGL, this._viewBGL],
        refCount: 0,
      };
      this._pipelines.set(key, cache);
    }
    return cache;
  }

  /**
   * Tracks that `obj` currently depends on the pipeline identified by `key` (same key format
   * `pipelineCacheKey()` computes). Called once per object per frame from the render loop,
   * independent from `getPipeline()`'s own batch-level lookup-or-create, since one pipeline is
   * typically shared by many objects at once.
   */
  public acquirePipeline(obj: Object3D, key: string): void {
    let keys = this._pipelineKeysByObject.get(obj);
    if (!keys) {
      keys = new Set();
      this._pipelineKeysByObject.set(obj, keys);
    }
    if (keys.has(key)) return;

    keys.add(key);
    const cache = this._pipelines.get(key);
    if (cache) cache.refCount++;
  }

  /** Releases every pipeline this object was counted in; each is dropped once its refCount hits zero. */
  public releasePipelineFor(obj: Object3D): void {
    const keys = this._pipelineKeysByObject.get(obj);
    if (!keys) return;
    this._pipelineKeysByObject.delete(obj);

    for (const key of keys) {
      const cache = this._pipelines.get(key);
      if (!cache) continue;
      cache.refCount--;
      if (cache.refCount <= 0) {
        // GPURenderPipeline has no explicit destroy(); dropping the cache entry (and all
        // other references) lets it be garbage-collected. The dependent GPUPipelineLayout
        // has no destroy() either.
        this._pipelines.delete(key);
      }
    }
  }

  public getShaderModule(
    shaderId: string,
    isInstanced: boolean = false,
    flags: string[] = [],
    withNormalOutput: boolean = false,
  ): GPUShaderModule {
    flags = normalizeShaderFlags(flags);
    const flagKey = flags.length > 0 ? "_" + flags.join("|") : "";
    const normalKey = withNormalOutput ? "_nrm" : "";
    const key = isInstanced
      ? `${shaderId}_instanced${normalKey}${flagKey}`
      : `${shaderId}${normalKey}${flagKey}`;
    let sm = this._shaderModules.get(key);
    if (!sm) {
      const def = this._shaderRegistry.get(shaderId);
      if (!def || !def.sources.wgsl) {
        throw new Error(
          `[WebGPURenderer] Shader definition for ${shaderId} not found or missing WGSL source.`,
        );
      }

      let code = this._shaderRegistry.assemble(def.sources.wgsl, "wgsl");

      let wgslConstants = "";
      if (flags.includes("USE_TEXTURE_ARRAY")) {
        wgslConstants += "const USE_TEXTURE_ARRAY: bool = true;\n";
        code = code.replace(
          /var u_diffuseMap:\s*texture_2d<f32>;/g,
          "var u_diffuseMap: texture_2d_array<f32>;",
        );
        code = code.replace(
          /textureSample\(u_diffuseMap,\s*s,\s*([^)]+)\)/g,
          "textureSample(u_diffuseMap, s, $1, u32(i.texIndex))",
        );
      } else {
        wgslConstants += "const USE_TEXTURE_ARRAY: bool = false;\n";
      }
      if (isInstanced) {
        wgslConstants += "const USE_INSTANCING: bool = true;\n";
      } else {
        wgslConstants += "const USE_INSTANCING: bool = false;\n";
      }
      // Always declared so material fragments can reference it via a compile-time `select`
      // (e.g. per-instance color tinting) even when no instance-color pipeline requested it.
      wgslConstants += flags.includes("USE_INSTANCE_COLOR")
        ? "const USE_INSTANCE_COLOR: bool = true;\n"
        : "const USE_INSTANCE_COLOR: bool = false;\n";
      if (flags.includes("USE_NORMAL_MAP")) {
        wgslConstants += "const USE_NORMAL_MAP: bool = true;\n";
      } else {
        wgslConstants += "const USE_NORMAL_MAP: bool = false;\n";
      }
      if (flags.includes("USE_RAMP_LUT")) {
        wgslConstants += "const USE_RAMP_LUT: bool = true;\n";
      } else {
        wgslConstants += "const USE_RAMP_LUT: bool = false;\n";
      }
      wgslConstants += flags.includes("USE_DECAL_UNLIT")
        ? "const USE_DECAL_UNLIT: bool = true;\n"
        : "const USE_DECAL_UNLIT: bool = false;\n";
      if (flags.includes("USE_DECAL_GRADIENTS")) {
        wgslConstants += "const USE_DECAL_GRADIENTS: bool = true;\n";
      } else {
        wgslConstants += "const USE_DECAL_GRADIENTS: bool = false;\n";
      }
      // Inject any arbitrary user/material flags (e.g. STYLE_TOON, STYLE_BOLD, STYLE_SPARKLE, etc.)
      for (const flag of flags) {
        if (!ALWAYS_DECLARED_FLAGS.has(flag)) {
          wgslConstants += `const ${flag}: bool = true;\n`;
        }
      }
      code = wgslConstants + "\n" + code;

      if (isInstanced) {
        // Replace obj.model with modelMat first, then inject vs signature with modelMat definition
        code = code.replace(/obj\.model/g, "modelMat");
        // Match the entire function signature fn vs(...) -> Out {
        code = code.replace(
          /fn\s+vs\s*\(([\s\S]*?)\)\s*->\s*Out\s*\{/,
          (_match: string, params: string) => {
            const trimmedParams = params.trim();
            const comma = trimmedParams.length > 0 ? "," : "";
            return `fn vs(
  ${trimmedParams}${comma}
  @location(6) inst_col0: vec4f,
  @location(7) inst_col1: vec4f,
  @location(8) inst_col2: vec4f,
  @location(9) inst_col3: vec4f,
  @location(10) inst_data: vec4f
) -> Out {
  let instMatrix = mat4x4f(inst_col0, inst_col1, inst_col2, inst_col3);
  let modelMat = (obj.model * instMatrix);`;
          },
        );

        code = code.replace(
          /return\s+o;/g,
          "o.texIndex = inst_data.x;\n    o.instColor = inst_data;\n    return o;",
        );
      } else {
        code = code.replace(
          /return\s+o;/g,
          "o.texIndex = 0.0;\n    o.instColor = vec4f(1.0, 1.0, 1.0, 1.0);\n    return o;",
        );
      }

      const unwrapped = withNormalOutput && !canWrapFragmentWithNormalOutput(code);
      if (unwrapped) {
        console.warn(
          `[WebGPU] ${shaderId}: fragment entry point does not match the normal-buffer wrapper ` +
            "(expected `@fragment fn fs(x: T) -> @location(0) vec4f`); it will not write the normal buffer.",
        );
      } else if (withNormalOutput) {
        code = wrapFragmentWithNormalOutput(code);
      }

      sm = this._device.createShaderModule({ code });

      // Async compile check to surface WGSL errors
      sm.getCompilationInfo().then((info) => {
        const errors = info.messages.filter((m) => m.type === "error");
        if (errors.length > 0) {
          console.error("[WebGPU] WGSL Compilation Failed. Source:\n", code);
          for (const err of errors) {
            console.error(`[WebGPU] Line ${err.lineNum}, Pos ${err.linePos}: ${err.message}`);
          }
        }
      });

      if (unwrapped) this._unwrappedNormalModules.add(sm);
      this._shaderModules.set(key, sm);
    }
    return sm;
  }

  public dispose(): void {
    this._pipelines.clear();
    this._shaderModules.clear();
    this._materialBGLCache.clear();
    this._warnedMaterialTextureBudget.clear();
  }
}
