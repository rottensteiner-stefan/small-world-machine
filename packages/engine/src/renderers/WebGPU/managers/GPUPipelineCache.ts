import type { DeviceCaps, Object3D } from "../../../core/index.js";
import { DeviceLimit } from "../../../core/index.js";
import type { RenderManifest, ShaderRegistry } from "../../shaders/index.js";
import { VERTEX_COLOR_FLAG, preprocessConditionals } from "../../shaders/index.js";
import { BlendingMode, CullMode, NormalTargetMode, ShaderFlag } from "../../../enums/index.js";
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
  /** The `pipelineCacheKey()` this entry is stored under; lets callers skip recomputing it. */
  key: string;
  /**
   * The optional material texture names this pipeline's material bind group layout actually
   * contains, in binding order (`@group(1)`). The per-frame material bind group (`WebGPURenderer.
   * _getMaterialBindGroup`) must bind exactly these names and no more: the layout is the
   * authoritative side (every bind group entry must be filled, and the shader must not reference
   * more). Derived once from the budget-fitted flags that built this pipeline's layout, so bind
   * group and layout can never drift apart -- including when the budget fit dropped extension-map
   * groups (clearcoat/sheen/transmission/specular maps, ADR 0054 revisit).
   */
  materialTextureNames: readonly string[];
}

/** One entry of `getOptionalMaterialTextureBindings()`. */
export interface OptionalMaterialBinding {
  binding: number;
  layoutEntry: GPUBindGroupLayoutEntry;
  /**
   * When set, the binding is added to a material bind group only when the material's compile
   * flags contain this flag (per-flag layouts, ADR 0054/0055). Legacy entries without a gate stay
   * bound for every shader that declares them, as before the restructure.
   */
  requiredFlag?: string;
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
let _optionalMaterialTextureBindings: Record<string, OptionalMaterialBinding> | undefined;

export function getOptionalMaterialTextureBindings(): Record<string, OptionalMaterialBinding> {
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
      // ── Flag-gated extension maps (ADR 0054 revisit, bindings 21-29) ───────────────────────────
      // KHR_materials_clearcoat / sheen / transmission / specular maps reach WebGPU behind
      // the per-flag layouts of ADR 0054/0055. Each binding is declared in `structs.wgsl` inside
      // the matching `#ifdef` and added to a material bind group only when the material's flags
      // activate the feature; the budget fit (GPUPipelineCache) then drops whole groups lowest-
      // priority-first instead of letting the per-stage texture budget overflow.
      u_clearcoatMap: {
        binding: 21,
        requiredFlag: ShaderFlag.CLEARCOAT_MAP,
        layoutEntry: {
          binding: 21,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { viewDimension: "2d", sampleType: "float" },
        },
      },
      u_clearcoatRoughnessMap: {
        binding: 22,
        requiredFlag: ShaderFlag.CLEARCOAT_ROUGHNESS_MAP,
        layoutEntry: {
          binding: 22,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { viewDimension: "2d", sampleType: "float" },
        },
      },
      u_clearcoatNormalMap: {
        binding: 23,
        requiredFlag: ShaderFlag.CLEARCOAT_NORMAL_MAP,
        layoutEntry: {
          binding: 23,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { viewDimension: "2d", sampleType: "float" },
        },
      },
      u_sheenColorMap: {
        binding: 24,
        requiredFlag: ShaderFlag.SHEEN_COLOR_MAP,
        layoutEntry: {
          binding: 24,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { viewDimension: "2d", sampleType: "float" },
        },
      },
      u_sheenRoughnessMap: {
        binding: 25,
        requiredFlag: ShaderFlag.SHEEN_ROUGHNESS_MAP,
        layoutEntry: {
          binding: 25,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { viewDimension: "2d", sampleType: "float" },
        },
      },
      u_transmissionMap: {
        binding: 26,
        requiredFlag: ShaderFlag.TRANSMISSION_MAP,
        layoutEntry: {
          binding: 26,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { viewDimension: "2d", sampleType: "float" },
        },
      },
      u_thicknessMap: {
        binding: 27,
        requiredFlag: ShaderFlag.THICKNESS_MAP,
        layoutEntry: {
          binding: 27,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { viewDimension: "2d", sampleType: "float" },
        },
      },
      u_specularWeightMap: {
        binding: 28,
        requiredFlag: ShaderFlag.SPECULAR_WEIGHT_MAP,
        layoutEntry: {
          binding: 28,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { viewDimension: "2d", sampleType: "float" },
        },
      },
      u_specularColorMap: {
        binding: 29,
        requiredFlag: ShaderFlag.SPECULAR_COLOR_MAP,
        layoutEntry: {
          binding: 29,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { viewDimension: "2d", sampleType: "float" },
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
 * Legacy flag-agnostic variant kept for read-only diagnostics; the build paths use
 * `getMaterialTextureBindingNames` below, which additionally applies the per-flag gates.
 */
export function getOptionalMaterialTextureNames(
  shaderId: string,
  shaderRegistry: ShaderRegistry,
): readonly string[] {
  const declared = shaderRegistry.get(shaderId)?.layout?.textures;
  if (!declared) return NO_NAMES;
  // Called once per draw group: memoized per declared-textures object so a re-registered shader
  // (new layout object) naturally invalidates it.
  const hit = _optionalNamesCache.get(declared);
  if (hit) return hit;
  const bindings = getOptionalMaterialTextureBindings();
  const names = Object.keys(declared).filter((name) => name in bindings);
  _optionalNamesCache.set(declared, names);
  return names;
}
const NO_NAMES: readonly string[] = [];
const _optionalNamesCache = new WeakMap<object, readonly string[]>();

/**
 * Optional material texture names whose binding a material bind group for `shaderId` with `flags`
 * actually needs, in binding order. The single source of truth for both `getMaterialBGL` and the
 * per-frame bind group (via `WebGPUPipelineCacheEntry.materialTextureNames`):
 * - Legacy names (no `requiredFlag` in `getOptionalMaterialTextureBindings()`) stay bound for every
 *   shader that declares them, exactly as before the per-flag restructure.
 * - Flag-gated extension maps (clearcoat/sheen/transmission/specular, bindings 21-29, ADR 0054
 *   revisit) are bound only when the material's compile flags activate them.
 * - Packed specular textures (`USE_SPECULAR_MAPS_SHARED`) bind the colour map only; the shader
 *   reads the strength from its alpha channel, so no `u_specularWeightMap` binding exists in that
 *   configuration (mirrors the WebGL2 sampler saving of ADR 0054).
 * Returns the names exactly once per input combination; callers must not mutate the array.
 */
export function getMaterialTextureBindingNames(
  shaderId: string,
  shaderRegistry: ShaderRegistry,
  flags: readonly string[],
): readonly string[] {
  const declared = shaderRegistry.get(shaderId)?.layout?.textures;
  if (!declared) return NO_NAMES;
  const bindings = getOptionalMaterialTextureBindings();
  const names: string[] = [];
  const specularShared = flags.includes(ShaderFlag.SPECULAR_MAPS_SHARED);
  for (const name of Object.keys(declared)) {
    const info = bindings[name];
    if (!info) continue;
    if (name === "u_specularWeightMap" && specularShared) continue;
    if (info.requiredFlag && !flags.includes(info.requiredFlag)) continue;
    names.push(name);
  }
  return names;
}

/**
 * Number of sampled-texture bindings a material bind group layout for `shaderId` with `flags`
 * will hold in the fragment stage: the three always-bound material textures (binding 3 = normal,
 * 11 = env cube, 12 = emissive) plus every flag-active optional binding of `flags`. Matches
 * `getMaterialBGL` entry-for-entry by construction (both build on
 * `getMaterialTextureBindingNames`), so the budget fit below can drop groups until the real
 * constraint `GLOBAL_BIND_GROUP_TEXTURE_COUNT + this` fits the device's per-stage limit.
 */
export function countMaterialFragmentTextures(
  shaderId: string,
  shaderRegistry: ShaderRegistry,
  flags: readonly string[],
): number {
  return (
    ALWAYS_BOUND_MATERIAL_TEXTURE_COUNT +
    getMaterialTextureBindingNames(shaderId, shaderRegistry, flags).length
  );
}

/** The three sampler bindings `getMaterialBGL` always puts in a material layout (3, 11, 12). */
const ALWAYS_BOUND_MATERIAL_TEXTURE_COUNT = 3;

/**
 * Extension-map groups the WebGPU budget fit may drop, highest priority to drop first. Mirrors the
 * WebGL2 resolver order of `EXTENSION_MAP_GROUPS` (ADR 0056) restricted to the groups that already
 * have WebGPU bindings (anisotropy/iridescence maps stay WebGL2-only, ADR 0055, and therefore add
 * no bindings here). Each group drops as a whole and a dropped feature falls back to its factor
 * values with one warning per program.
 */
const WEBGPU_EXTENSION_MAP_GROUPS: ReadonlyArray<readonly string[]> = [
  [ShaderFlag.SPECULAR_WEIGHT_MAP, ShaderFlag.SPECULAR_COLOR_MAP, ShaderFlag.SPECULAR_MAPS_SHARED],
  [ShaderFlag.SHEEN_COLOR_MAP, ShaderFlag.SHEEN_ROUGHNESS_MAP],
  [ShaderFlag.CLEARCOAT_MAP, ShaderFlag.CLEARCOAT_ROUGHNESS_MAP, ShaderFlag.CLEARCOAT_NORMAL_MAP],
  [ShaderFlag.TRANSMISSION_MAP, ShaderFlag.THICKNESS_MAP],
];

/** `flags` minus the next WebGPU extension-map group that is present, or `undefined` when none is left. */
export function dropNextWebGpuExtensionMapGroup(flags: readonly string[]): string[] | undefined {
  for (const group of WEBGPU_EXTENSION_MAP_GROUPS) {
    if (group.some((flag) => flags.includes(flag))) {
      return flags.filter((flag) => !group.includes(flag));
    }
  }
  return undefined;
}

/**
 * Number of sampled-texture bindings in the global bind group (irradianceMap, prefilterMap,
 * brdfLUT, dirShadowMap, spotShadowMap -- bindings 4/5/6/8/9; binding 7 and 10 are samplers, not
 * counted against the per-stage sampled-texture budget). Every material bind group's own texture
 * count is added on top of this fixed cost when checking against the device's real per-stage
 * limit.
 */
const GLOBAL_BIND_GROUP_TEXTURE_COUNT = 5;

const ALWAYS_DECLARED_FLAGS: ReadonlySet<string> = new Set<string>([
  ShaderFlag.TEXTURE_ARRAY,
  ShaderFlag.NORMAL_MAP,
  ShaderFlag.RAMP_LUT,
  ShaderFlag.INSTANCING,
  ShaderFlag.INSTANCE_COLOR,
  ShaderFlag.DECAL_GRADIENTS,
  ShaderFlag.DECAL_UNLIT,
]);

/** WGSL module-scope constant for a shader flag, declared either way so fragments can `select` on it. */
const declareWgslFlag = (flag: string, enabled: boolean): string =>
  `const ${flag}: bool = ${enabled};\n`;
const SHADER_FLAG_PATTERN = /^[A-Z][A-Z0-9_]*$/;

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

/**
 * Sorted, de-duplicated and validated flag list. Hot path (called per draw group): flags that are already strictly
 * ascending -- the common case, materials declare them sorted -- are returned as-is without
 * allocating. Each flag becomes a WGSL `const`, so a
 * duplicate would not compile and an invalid identifier would corrupt the shader prefix.
 */
function normalizeShaderFlags(flags: readonly string[]): readonly string[] {
  let sortedUnique = true;
  for (let i = 0; i < flags.length; i++) {
    const flag = flags[i]!;
    if (!SHADER_FLAG_PATTERN.test(flag)) {
      throw new Error(
        `[GPUPipelineCache] Invalid shader flag name "${flag}" (expected ^[A-Z][A-Z0-9_]*$).`,
      );
    }
    if (i > 0 && flags[i - 1]! >= flag) sortedUnique = false;
  }
  if (sortedUnique) return flags;
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
  /** `shaderId`s already warned about in `_fitFlagsToBudget` (extension-map groups dropped). */
  private _warnedBudgetFit = new Set<string>();

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
  public getMaterialBGL(shaderId: string, flags: readonly string[]): GPUBindGroupLayout {
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
      for (const name of getMaterialTextureBindingNames(shaderId, this._shaderRegistry, flags)) {
        const info = bindingInfo[name]!;
        if ("u_diffuseMap" === name && flags.includes(ShaderFlag.TEXTURE_ARRAY)) {
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

  /**
   * Per-stage sampled-texture budget of this device (`DeviceCaps` real limit, else the WebGPU
   * guaranteed minimum). 0 only when no adapter limits are known yet; the guaranteed minimum is
   * always authoritative enough for `_fitFlagsToBudget`'s pre-flight check.
   */
  private _sampledTextureStageLimit(): number {
    // `_deviceCaps` is always set in production (constructor); the object-literal test doubles
    // (Object.create(GPUPipelineCache.prototype)) skip it, and the guaranteed minimum is the
    // correct conservative assumption when no limit info exists at all.
    if (!this._deviceCaps) return 16;
    const deviceLimit = this._deviceCaps.getLimit(
      DeviceLimit.WEBGPU_MAX_SAMPLED_TEXTURES_PER_STAGE,
    );
    return deviceLimit > 0
      ? deviceLimit
      : this._deviceCaps.getGuaranteedMinimum(DeviceLimit.WEBGPU_MAX_SAMPLED_TEXTURES_PER_STAGE);
  }

  /**
   * Fits `flags` to the device's per-stage sampled-texture budget by dropping whole WebGPU
   * extension-map groups (`WEBGPU_EXTENSION_MAP_GROUPS`, lowest priority first) until the material
   * bind group plus the global bind group's fixed textures fit — the WebGPU analogue of the WebGL2
   * budget resolver of ADR 0056. Dropping happens BEFORE any shader module / bind group layout /
   * pipeline is built, so the material degrades gracefully (its flags revert to the factor-only
   * path of ADR 0054/0055) instead of failing pipeline creation with a cryptic layout error.
   * Core textures (diffuse..opaqueDepth) are never dropped; a material beyond budget with no
   * extension maps passes through unfitted and falls to `_checkSampledTextureBudget`'s warning.
   * One warning per `shaderId` names the dropped groups. Deterministic per device, so the shipped
   * raw-flags `pipelineCacheKey` may produce more entries than strictly needed, never a wrong one.
   */
  private _fitFlagsToBudget(shaderId: string, flags: readonly string[]): readonly string[] {
    let fitted = flags;
    const limit = this._sampledTextureStageLimit();
    while (
      GLOBAL_BIND_GROUP_TEXTURE_COUNT +
        countMaterialFragmentTextures(shaderId, this._shaderRegistry, fitted) >
      limit
    ) {
      const next = dropNextWebGpuExtensionMapGroup(fitted);
      if (!next) break;
      if (!this._warnedBudgetFit.has(shaderId)) {
        this._warnedBudgetFit.add(shaderId);
        const dropped = fitted.filter((flag) => !next.includes(flag)).join(", ");
        console.warn(
          `[WebGPURenderer] Material '${shaderId}' exceeds this device's per-stage sampled-texture ` +
            `limit of ${limit}; dropped extension-map flag(s) (${dropped}). The affected features ` +
            `fall back to their factor values.`,
        );
      }
      fitted = next;
    }
    return fitted;
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
      // Budget fit only on a cache miss (Zero-GC hit path): extension-map groups are dropped BEFORE
      // the shader module / bind group layout / pipeline are built, so module and layout use the
      // same final flag set (ADR 0054 revisit). The cache key keeps the raw flags on purpose: the
      // fit is deterministic per device, so the entry is fitted exactly once per key.
      const finalFlags = this._fitFlagsToBudget(shaderId, flags);
      const sm = this.getShaderModule(
        shaderId,
        isInstanced,
        finalFlags,
        normalMode !== NormalTargetMode.NONE,
      );
      // A shader the wrapper could not rewrite has no @location(1) output. WebGPU rejects a
      // pipeline whose second target has a non-zero writeMask without such an output, but the
      // 2-attachment main pass still needs the second target slot, so it runs masked (no write).
      const effectiveNormalMode =
        normalMode !== NormalTargetMode.NONE && this._unwrappedNormalModules.has(sm)
          ? NormalTargetMode.MASKED
          : normalMode;
      const materialBGL = this.getMaterialBGL(shaderId, finalFlags);
      const pipelineLayout = this._device.createPipelineLayout({
        bindGroupLayouts: [this._globalBGL, materialBGL, this._objectBGL, this._viewBGL],
      });

      const vertexBuffers: GPUVertexBufferLayout[] = [
        { arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }] },
        { arrayStride: 12, attributes: [{ shaderLocation: 1, offset: 0, format: "float32x3" }] },
        { arrayStride: 8, attributes: [{ shaderLocation: 2, offset: 0, format: "float32x2" }] },
        // Tangent contract is vec4 (tx, ty, tz, w) -- stride 16.
        { arrayStride: 16, attributes: [{ shaderLocation: 3, offset: 0, format: "float32x4" }] },
        { arrayStride: 16, attributes: [{ shaderLocation: 4, offset: 0, format: "float32x4" }] },
        { arrayStride: 16, attributes: [{ shaderLocation: 5, offset: 0, format: "float32x4" }] },
      ];

      // Vertex colors (RGBA) ride in buffer slot 6 only for materials that opt in. Instanced
      // pipelines already use slots 6-7 and the default maxVertexBuffers is 8, so the two
      // cannot be combined.
      if (finalFlags.includes(VERTEX_COLOR_FLAG)) {
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
        key,
        materialTextureNames: getMaterialTextureBindingNames(
          shaderId,
          this._shaderRegistry,
          finalFlags,
        ),
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
    flags: readonly string[] = [],
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

      // `#ifdef USE_*` blocks of the WGSL chunks (e.g. anisotropy, iridescence) are stripped here, so a
      // material without the feature does not pay to compile it.
      let code = preprocessConditionals(
        this._shaderRegistry.assemble(def.sources.wgsl, "wgsl"),
        flags,
      );

      const hasTextureArray = flags.includes(ShaderFlag.TEXTURE_ARRAY);
      let wgslConstants = declareWgslFlag(ShaderFlag.TEXTURE_ARRAY, hasTextureArray);
      if (hasTextureArray) {
        code = code.replace(
          /var u_diffuseMap:\s*texture_2d<f32>;/g,
          "var u_diffuseMap: texture_2d_array<f32>;",
        );
        code = code.replace(
          /textureSample\(u_diffuseMap,\s*s,\s*([^)]+)\)/g,
          "textureSample(u_diffuseMap, s, $1, u32(i.texIndex))",
        );
      }
      wgslConstants += declareWgslFlag(ShaderFlag.INSTANCING, isInstanced);
      // Always declared so material fragments can reference it via a compile-time `select`
      // (e.g. per-instance color tinting) even when no instance-color pipeline requested it.
      wgslConstants += declareWgslFlag(
        ShaderFlag.INSTANCE_COLOR,
        flags.includes(ShaderFlag.INSTANCE_COLOR),
      );
      wgslConstants += declareWgslFlag(
        ShaderFlag.NORMAL_MAP,
        flags.includes(ShaderFlag.NORMAL_MAP),
      );
      wgslConstants += declareWgslFlag(ShaderFlag.RAMP_LUT, flags.includes(ShaderFlag.RAMP_LUT));
      wgslConstants += declareWgslFlag(
        ShaderFlag.DECAL_UNLIT,
        flags.includes(ShaderFlag.DECAL_UNLIT),
      );
      wgslConstants += declareWgslFlag(
        ShaderFlag.DECAL_GRADIENTS,
        flags.includes(ShaderFlag.DECAL_GRADIENTS),
      );
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
