import type { Object3D } from "../../../core/index.js";
import { compileProgram } from "../../compileProgram.js";
import type { ShaderDefinition, ShaderRegistry } from "../../shaders/index.js";
import { StandardWebGPULayout } from "../../shaders/index.js";
import type { WebGL2UniformBuffer } from "../../WebGL2/WebGL2UniformBuffer.js";
import { VERTEX_COLOR_LOCATION } from "../../Mesh.js";
import {
  NORMAL_OUTPUT_FLAG,
  canWrapFragmentWithNormalOutputGL,
  wrapFragmentWithNormalOutputGL,
} from "./NormalOutputWrapperGL.js";

/** GLSL dialect a `WebGLProgramCache` instance compiles for -- the shared layer's strategy
 * selector. `glsl100` (WebGL1) has no global UBO, no `#version 300 es`, no fixed attribute
 * locations, no ADR 0028 normal output and no shadow/array samplers; `glsl300` (WebGL2) has all
 * of those. See `docs/adr/0038<...>` and the thermo report 01 #25. */
export type GlslDialect = "glsl100" | "glsl300";

/** Per-program pre-queried point-light uniform locations, only populated for `glsl100` (WebGL1
 * has no clustered lighting / global UBO -- see docs/adr/0007). WebGL2 keeps lights in the UBO
 * and leaves these arrays empty. */
export interface WebGLPointLightUniformLocations {
  pos: WebGLUniformLocation | undefined;
  col: WebGLUniformLocation | undefined;
  distance: WebGLUniformLocation | undefined;
  decay: WebGLUniformLocation | undefined;
}

export interface WebGLSpotLightUniformLocations {
  pos: WebGLUniformLocation | undefined;
  dir: WebGLUniformLocation | undefined;
  col: WebGLUniformLocation | undefined;
  params: WebGLUniformLocation | undefined;
}

export interface WebGLAreaLightUniformLocations {
  pos: WebGLUniformLocation | undefined;
  col: WebGLUniformLocation | undefined;
  normal: WebGLUniformLocation | undefined;
  right: WebGLUniformLocation | undefined;
  up: WebGLUniformLocation | undefined;
  size: WebGLUniformLocation | undefined;
}

export interface WebGLProgramCacheEntry {
  prog: WebGLProgram;
  uniforms: Map<string, WebGLUniformLocation | undefined>;
  attributes: Map<string, number>;
  /** Texture unit assigned to each active sampler uniform in THIS program, discovered via introspection. */
  samplerUnits: Map<string, number>;
  /** GL sampler type (SAMPLER_2D/SAMPLER_CUBE/...) of each active sampler uniform in THIS program. */
  samplerTypes: Map<string, number>;
  /**
   * True when the fragment shader writes output 1 (the ADR 0028 normal buffer). False for shaders
   * the wrapper could not rewrite: draw buffer 1 must be disabled for them, otherwise they write
   * undefined values into the normal buffer. Always false for `glsl100` (WebGL1 has no normal buffer).
   */
  writesNormalOutput: boolean;
  /** Fixed-location light uniforms, `glsl100` only (empty for `glsl300`). */
  pointLightLocs: WebGLPointLightUniformLocations[];
  spotLightLocs: WebGLSpotLightUniformLocations[];
  areaLightLocs: WebGLAreaLightUniformLocations[];
  /** Number of live Object3D instances currently referencing this compiled program. */
  refCount: number;
}

/**
 * Compiled-program cache for BOTH WebGL dialects, with refcounting so a program shared across
 * many objects (e.g. every shadow-caster shares the single DEPTH program) is only compiled once
 * and only deleted once nothing references it anymore.
 *
 * This is the shared GL manager layer's program half (see `.agents/collaborate/god-objects-refactoring.md`
 * Phase 4 and the thermo report 01 #25): the same class is mounted by `WebGL1Renderer`
 * (`glsl100`) and `WebGL2Renderer` (`glsl300`), which previously reimplemented it against each
 * other. The dialect selects the compile strategy (`#define` injection, fixed attribute locations,
 * global-UBO binding, normal-output wrapping, shadow/array sampler handling). No behavior change.
 */
/** Constructor options for `WebGLProgramCache`. */
export interface WebGLProgramCacheOptions {
  /** Bound to every compiled GLSL300 program (WebGL2); absent on WebGL1. */
  globalUBO?: WebGL2UniformBuffer;
  /** GLSL dialect to compile for -- `glsl300` (WebGL2) unless WebGL1 selects `glsl100`. */
  dialect?: GlslDialect;
}

export class WebGLProgramCache {
  private readonly _gl: WebGLRenderingContext | WebGL2RenderingContext;
  private readonly _dialect: GlslDialect;
  private readonly _shaderRegistry: ShaderRegistry;
  /** Bound to every compiled GLSL300 program; unused (absent) on WebGL1. */
  private readonly _globalUBO: WebGL2UniformBuffer | undefined;

  /**
   * Texture units 11-15 are permanently reserved for global (non-material) samplers: 11 the
   * spot shadow depth array (`u_spotShadowMap`, one layer per spot slot), 12 the directional/CSM
   * shadow map (and dummy fallback), 13 the directional shadow map's raw-depth read for PCSS's
   * blocker search (`WebGL2Renderer._RAW_DEPTH_UNIT`), and 14-15 the clustered light culling
   * grid/index textures (see docs/adr/0007-clustered-lighting-webgl2-webgpu-only.md) -- all bound
   * via hardcoded `activeTexture` calls (`WebGL2Renderer._bindDummyShadowMaps`/`_renderSubgroup`/
   * `WebGLClusterCullPass`) rather than through `samplerUnits`. The dynamic sampler-unit
   * assignment in `getProgram()` skips this whole range for every other sampler so an unrelated
   * material texture can never land on the same unit as one of these. Material, IBL and EVSM
   * samplers occupy units 0-10 -- all within the WebGL2 spec's guaranteed minimum
   * `MAX_TEXTURE_IMAGE_UNITS` of 16. The GLSL linker counts every active sampler against that
   * limit, the reserved ones included, which is why spot shadows are one array, not four maps.
   */
  private static readonly _RESERVED_GLOBAL_UNIT_START = 11;
  private static readonly _RESERVED_GLOBAL_UNIT_END = 15;

  /**
   * Fixed attribute-location reservations, bound via `bindAttribLocation` BEFORE linking.
   * Making these locations deterministic across every compiled program is what lets a single
   * per-mesh VAO (`Mesh.bindVAO`) be valid for any program; without it the driver could assign
   * different locations per program and a cached VAO would silently point at the wrong buffers.
   * `a_instanceMatrix` is a `mat4` and thus occupies locations 6-9; `a_instanceData` sits at 10;
   * `a_color` (vertex color, white when the mesh has none) sits at 11. GLSL300 only -- WebGL1
   * binds implicitly and looks locations up per program.
   */
  private static readonly _FIXED_ATTRIBUTE_LOCATIONS: ReadonlyArray<readonly [number, string]> = [
    [0, "a_position"],
    [1, "a_normal"],
    [2, "a_uv"],
    [3, "a_tangent"],
    [4, "a_joints"],
    [5, "a_weights"],
    [6, "a_instanceMatrix"],
    [10, "a_instanceData"],
    [VERTEX_COLOR_LOCATION, "a_color"],
  ];

  private _programs = new Map<string, WebGLProgramCacheEntry>();
  private _lastKnownProgramKey = new WeakMap<Object3D, string>();

  constructor(
    gl: WebGLRenderingContext | WebGL2RenderingContext,
    shaderRegistry: ShaderRegistry,
    options: WebGLProgramCacheOptions = {},
  ) {
    this._gl = gl;
    this._shaderRegistry = shaderRegistry;
    this._globalUBO = options.globalUBO;
    this._dialect = options.dialect ?? "glsl300";
  }

  /**
   * Fails fast when a program needs more fragment texture units than the device offers (WebGL1's
   * guaranteed minimum is only 8): binding past the limit is a silent GL error that leaves the
   * material sampling the wrong texture, so name the culprit instead.
   */
  private _assertTextureUnits(shaderId: string, unitsNeeded: number): void {
    const available = this._gl.getParameter(this._gl.MAX_TEXTURE_IMAGE_UNITS) as number;
    if (unitsNeeded > available) {
      throw new Error(
        `[WebGLProgramCache] Shader "${shaderId}" needs ${unitsNeeded} texture units but the device ` +
          `only exposes ${available} (MAX_TEXTURE_IMAGE_UNITS).`,
      );
    }
  }

  public programCacheKey(shaderId: string, isInstanced: boolean, flags: readonly string[]): string {
    // Order-independent: ["A","B"] and ["B","A"] are the same program (sort a copy only if needed).
    let sorted = true;
    for (let i = 1; i < flags.length; i++) {
      if (flags[i - 1]! > flags[i]!) {
        sorted = false;
        break;
      }
    }
    const ordered = sorted ? flags : [...flags].sort();
    const flagKey = ordered.length > 0 ? "_" + ordered.join("_") : "";
    return isInstanced ? `${shaderId}_instanced${flagKey}` : `${shaderId}${flagKey}`;
  }

  public getProgram(
    shaderId: string,
    isInstanced: boolean = false,
    flags: string[] = [],
  ): WebGLProgramCacheEntry {
    const key = this.programCacheKey(shaderId, isInstanced, flags);
    let cache = this._programs.get(key);
    if (!cache) {
      const def = this._shaderRegistry.get(shaderId);
      if (this._dialect === "glsl100") {
        if (!def || !def.sources.glsl100) {
          throw new Error(
            `[WebGL1Renderer] Shader definition for ${shaderId} not found or missing GLSL 100 source.`,
          );
        }
        cache = this._buildGlsl100(def, shaderId, isInstanced, flags);
      } else {
        if (!def || !def.sources.glsl300) {
          throw new Error(
            `[WebGL2Renderer] Shader definition for ${shaderId} not found or missing GLSL 300 source.`,
          );
        }
        cache = this._buildGlsl300(def, isInstanced, flags);
      }
      this._programs.set(key, cache);
    }
    return cache;
  }

  /** GLSL100 compile strategy (previously WebGL1Renderer._getProgram): no fixed attribute
   * locations, no global UBO, no shadow/array samplers, per-program light locations, and the
   * layout-vs-`StandardWebGPULayout` missing-uniform warning. */
  private _buildGlsl100(
    def: ShaderDefinition,
    shaderId: string,
    isInstanced: boolean,
    flags: readonly string[],
  ): WebGLProgramCacheEntry {
    const gl = this._gl;
    let vs = this._shaderRegistry.assemble(def.sources.glsl100!.vs, "glsl100");
    let fs = this._shaderRegistry.assemble(def.sources.glsl100!.fs, "glsl100");
    let defines = "";
    if (isInstanced) defines += "#define USE_INSTANCING 1\n";
    for (const flag of flags) defines += `#define ${flag} 1\n`;
    if (defines) {
      vs = defines + vs;
      fs = defines + fs;
    }
    const prog = compileProgram(gl, vs, fs, "AbstractWebGLRenderer");

    const uniforms = new Map<string, WebGLUniformLocation | undefined>();
    const attributes = new Map<string, number>();
    const samplerUnits = new Map<string, number>();
    const samplerTypes = new Map<string, number>();

    const attribsToQuery = ["a_position", "a_normal", "a_uv", "a_tangent", "a_color"];
    if (isInstanced) attribsToQuery.push("a_instanceMatrix", "a_instanceData");
    attribsToQuery.forEach((name) => {
      attributes.set(name, gl.getAttribLocation(prog, name));
    });

    // WebGL1 has no shadow-map/IBL samplers to reserve units for -- every sampler gets a unit.
    const samplerTypeSet = new Set<number>([gl.SAMPLER_2D, gl.SAMPLER_CUBE]);
    const activeCount = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS) as number;
    let nextSamplerUnit = 0;
    for (let i = 0; i < activeCount; i++) {
      const info = gl.getActiveUniform(prog, i);
      if (!info) continue;
      const isArray = info.size > 1 && info.name.endsWith("[0]");
      const names = isArray
        ? Array.from({ length: info.size }, (_, j) => `${info.name.slice(0, -3)}[${j}]`)
        : [info.name];
      const isSampler = samplerTypeSet.has(info.type);

      for (const name of names) {
        uniforms.set(name, gl.getUniformLocation(prog, name) ?? undefined);
        if (isSampler) {
          samplerUnits.set(name, nextSamplerUnit);
          samplerTypes.set(name, info.type);
          nextSamplerUnit++;
        }
      }
    }
    this._assertTextureUnits(shaderId, nextSamplerUnit);

    // `layout.uniforms` is near-universally `...StandardWebGPULayout.uniforms` (the fixed set
    // every material spreads in to match WebGPU's shared `ObjectUniforms` struct) -- a lean
    // shader legitimately using only a handful of those 16 names is the norm, not a mistake, so
    // warning about the rest would just be noise. WebGL2's UBO path makes this whole class of
    // warning moot (see _buildGlsl300) -- it is glsl100-only.
    const genericUniformNames = new Set(Object.keys(StandardWebGPULayout.uniforms));
    for (const name of Object.keys(def.layout.uniforms)) {
      if (!uniforms.has(name) && !genericUniformNames.has(name)) {
        console.warn(
          `[WebGL1Renderer] Uniform '${name}' defined in material layout but not found in shader '${shaderId}'. It might be unused or optimized away.`,
        );
      }
    }

    const pointLightLocs: WebGLPointLightUniformLocations[] = [];
    const spotLightLocs: WebGLSpotLightUniformLocations[] = [];
    const areaLightLocs: WebGLAreaLightUniformLocations[] = [];
    for (let i = 0; i < 16; i++) {
      pointLightLocs.push({
        pos: gl.getUniformLocation(prog, `u_pointLightPos[${i}]`) ?? undefined,
        col: gl.getUniformLocation(prog, `u_pointLightColor[${i}]`) ?? undefined,
        distance: gl.getUniformLocation(prog, `u_pointLightDistance[${i}]`) ?? undefined,
        decay: gl.getUniformLocation(prog, `u_pointLightDecay[${i}]`) ?? undefined,
      });
      spotLightLocs.push({
        pos: gl.getUniformLocation(prog, `u_spotLightPos[${i}]`) ?? undefined,
        dir: gl.getUniformLocation(prog, `u_spotLightDir[${i}]`) ?? undefined,
        col: gl.getUniformLocation(prog, `u_spotLightColor[${i}]`) ?? undefined,
        params: gl.getUniformLocation(prog, `u_spotLightParams[${i}]`) ?? undefined,
      });
    }
    for (let i = 0; i < 4; i++) {
      areaLightLocs.push({
        pos: gl.getUniformLocation(prog, `u_areaLightPos[${i}]`) ?? undefined,
        col: gl.getUniformLocation(prog, `u_areaLightColor[${i}]`) ?? undefined,
        right: gl.getUniformLocation(prog, `u_areaLightRight[${i}]`) ?? undefined,
        up: gl.getUniformLocation(prog, `u_areaLightUp[${i}]`) ?? undefined,
        normal: gl.getUniformLocation(prog, `u_areaLightNormal[${i}]`) ?? undefined,
        size: gl.getUniformLocation(prog, `u_areaLightSize[${i}]`) ?? undefined,
      });
    }

    return {
      prog,
      uniforms,
      attributes,
      samplerUnits,
      samplerTypes,
      writesNormalOutput: false,
      pointLightLocs,
      spotLightLocs,
      areaLightLocs,
      refCount: 0,
    };
  }

  /** GLSL300 compile strategy (previously WebGL2Renderer's WebGLProgramCache): fixed attribute
   * locations, global-UBO binding, ADR 0028 normal-output wrapping, shadow/array samplers and
   * reserved-unit skipping. */
  private _buildGlsl300(
    def: ShaderDefinition,
    isInstanced: boolean,
    flags: readonly string[],
  ): WebGLProgramCacheEntry {
    const gl = this._gl as WebGL2RenderingContext;
    let vs = this._shaderRegistry.assemble(def.sources.glsl300!.vs, "glsl300");
    let fs = this._shaderRegistry.assemble(def.sources.glsl300!.fs, "glsl300");

    const writesNormalOutput =
      flags.includes(NORMAL_OUTPUT_FLAG) && canWrapFragmentWithNormalOutputGL(fs);
    if (writesNormalOutput) fs = wrapFragmentWithNormalOutputGL(fs);

    let defines = "";
    if (isInstanced) defines += "#define USE_INSTANCING 1\n";
    for (const flag of flags) {
      defines += `#define ${flag} 1\n`;
    }

    if (defines) {
      if (vs.includes("#version 300 es")) {
        vs = vs.replace("#version 300 es", `#version 300 es\n${defines}`);
      } else {
        vs = `#version 300 es\n${defines}${vs}`;
      }
      if (fs.includes("#version 300 es")) {
        fs = fs.replace("#version 300 es", `#version 300 es\n${defines}`);
      } else {
        fs = `#version 300 es\n${defines}${fs}`;
      }
    }

    vs = vs.trimStart();
    fs = fs.trimStart();
    const prog = compileProgram(
      gl,
      vs,
      fs,
      "WebGLProgramCache",
      WebGLProgramCache._FIXED_ATTRIBUTE_LOCATIONS,
    );

    const uniforms = new Map<string, WebGLUniformLocation | undefined>();
    const attributes = new Map<string, number>();
    const samplerUnits = new Map<string, number>();
    const samplerTypes = new Map<string, number>();

    this._globalUBO?.bindToProgram(prog, "GlobalUniforms");

    const attribsToQuery = [
      "a_position",
      "a_normal",
      "a_uv",
      "a_tangent",
      "a_joints",
      "a_weights",
      "a_color",
    ];
    if (isInstanced) {
      attribsToQuery.push("a_instanceMatrix", "a_instanceData");
    }
    attribsToQuery.forEach((name) => {
      attributes.set(name, gl.getAttribLocation(prog, name));
    });

    const samplerTypeSet = new Set<number>([
      gl.SAMPLER_2D,
      gl.SAMPLER_CUBE,
      gl.SAMPLER_2D_SHADOW,
      gl.SAMPLER_2D_ARRAY,
    ]);
    const activeCount = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS) as number;
    let nextSamplerUnit = 0;
    for (let i = 0; i < activeCount; i++) {
      const info = gl.getActiveUniform(prog, i);
      if (!info) continue;
      const isArray = info.size > 1 && info.name.endsWith("[0]");
      const names = isArray
        ? Array.from({ length: info.size }, (_, j) => `${info.name.slice(0, -3)}[${j}]`)
        : [info.name];

      const isShadowSampler =
        "u_dirShadowMap" === info.name ||
        "u_dirShadowMapRaw" === info.name ||
        "u_spotShadowMap" === info.name;
      const isSampler = samplerTypeSet.has(info.type) && !isShadowSampler;

      for (const name of names) {
        uniforms.set(name, gl.getUniformLocation(prog, name) ?? undefined);
        if (isSampler) {
          if (
            nextSamplerUnit >= WebGLProgramCache._RESERVED_GLOBAL_UNIT_START &&
            nextSamplerUnit <= WebGLProgramCache._RESERVED_GLOBAL_UNIT_END
          ) {
            nextSamplerUnit = WebGLProgramCache._RESERVED_GLOBAL_UNIT_END + 1;
          }
          samplerUnits.set(name, nextSamplerUnit);
          samplerTypes.set(name, info.type);
          nextSamplerUnit++;
        }
      }
    }
    this._assertTextureUnits(def.id, nextSamplerUnit);

    return {
      prog,
      uniforms,
      attributes,
      samplerUnits,
      samplerTypes,
      writesNormalOutput,
      pointLightLocs: [],
      spotLightLocs: [],
      areaLightLocs: [],
      refCount: 0,
    };
  }

  /**
   * Tracks that `obj` currently depends on the compiled program identified by `key`
   * (same key format `getProgram()` computes internally). Called once per object per
   * frame from the render loop, independent from `getProgram()`'s own batch-level
   * lookup-or-create, since one program is typically shared by many objects at once
   * (e.g. every shadow-caster shares the single DEPTH program).
   */
  public acquireProgram(obj: Object3D, key: string): void {
    const lastKey = this._lastKnownProgramKey.get(obj);
    if (lastKey === key) return;
    if (lastKey) this.releaseObjectProgram(obj);

    const cache = this._programs.get(key);
    if (cache) cache.refCount++;
    this._lastKnownProgramKey.set(obj, key);
  }

  /** Releases the compiled program this object was referencing, if its refCount drops to zero. */
  public releaseObjectProgram(obj: Object3D): void {
    const key = this._lastKnownProgramKey.get(obj);
    if (!key) return;
    this._lastKnownProgramKey.delete(obj);

    const cache = this._programs.get(key);
    if (!cache) return;
    cache.refCount--;
    if (cache.refCount <= 0) {
      this._gl.deleteProgram(cache.prog);
      this._programs.delete(key);
    }
  }

  public dispose(): void {
    for (const cache of this._programs.values()) this._gl.deleteProgram(cache.prog);
    this._programs.clear();
  }
}
