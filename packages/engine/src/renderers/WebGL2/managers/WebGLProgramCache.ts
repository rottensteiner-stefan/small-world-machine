import { Object3D } from "../../../core/index.js";
import { ShaderRegistry } from "../../shaders/index.js";
import { WebGL2UniformBuffer } from "../WebGL2UniformBuffer.js";
import { VERTEX_COLOR_LOCATION } from "../../Mesh.js";
import { NORMAL_OUTPUT_FLAG, wrapFragmentWithNormalOutputGL } from "./NormalOutputWrapperGL.js";

export interface WebGL2ProgramCacheEntry {
  prog: WebGLProgram;
  uniforms: Map<string, WebGLUniformLocation | undefined>;
  attributes: Map<string, number>;
  /** Texture unit assigned to each active sampler uniform in THIS program, discovered via introspection. */
  samplerUnits: Map<string, number>;
  /** GL sampler type (SAMPLER_2D/SAMPLER_CUBE/...) of each active sampler uniform in THIS program. */
  samplerTypes: Map<string, number>;
  /** Number of live Object3D instances currently referencing this compiled program. */
  refCount: number;
}

/**
 * Compiled-GLSL300-program cache, with refcounting so a program shared across many objects (e.g.
 * every shadow-caster shares the single DEPTH program) is only compiled once and only deleted
 * once nothing references it anymore.
 *
 * Extracted from `WebGL2Renderer` -- see .agents/collaborate/god-objects-refactoring.md Phase 4.
 * No behavior change.
 */
export class WebGLProgramCache {
  private readonly _gl: WebGL2RenderingContext;
  private readonly _globalUBO: WebGL2UniformBuffer;

  /**
   * Texture units 8-15 are permanently reserved for global (non-material) samplers: 8-11 the
   * spot shadow maps (4x), 12 the directional/CSM shadow map (and dummy fallback), 13 the
   * directional shadow map's raw-depth read for PCSS's blocker search
   * (`WebGL2Renderer._RAW_DEPTH_UNIT`), and 14-15 the clustered light culling grid/index
   * textures (see docs/adr/0007-clustered-lighting-webgl2-webgpu-only.md) -- all bound via
   * hardcoded `activeTexture` calls (`WebGL2Renderer._bindDummyShadowMaps`/`_renderSubgroup`/
   * `WebGLClusterCullPass`) rather than through `samplerUnits`. The dynamic sampler-unit
   * assignment in `getProgram()` skips this whole range for every other sampler so an unrelated
   * material texture can never land on the same unit as one of these. Material textures occupy
   * units 0-7 -- 8 reserved units (8-15) plus those 8 fit completely within the WebGL2
   * spec's guaranteed minimum `MAX_TEXTURE_IMAGE_UNITS` of 16 (units 0-15).
   */
  private static readonly _RESERVED_GLOBAL_UNIT_START = 8;
  private static readonly _RESERVED_GLOBAL_UNIT_END = 15;

  /**
   * Fixed attribute-location reservations, bound via `bindAttribLocation` BEFORE linking.
   * Making these locations deterministic across every compiled program is what lets a single
   * per-mesh VAO (`Mesh.bindVAO`) be valid for any program; without it the driver could assign
   * different locations per program and a cached VAO would silently point at the wrong buffers.
   * `a_instanceMatrix` is a `mat4` and thus occupies locations 6-9; `a_instanceData` sits at 10;
   * `a_color` (vertex color, white when the mesh has none) sits at 11.
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

  private _programs = new Map<string, WebGL2ProgramCacheEntry>();
  private _lastKnownProgramKey = new WeakMap<Object3D, string>();
  private readonly _shaderRegistry: ShaderRegistry;

  constructor(
    gl: WebGL2RenderingContext,
    globalUBO: WebGL2UniformBuffer,
    shaderRegistry: ShaderRegistry,
  ) {
    this._gl = gl;
    this._globalUBO = globalUBO;
    this._shaderRegistry = shaderRegistry;
  }

  public programCacheKey(shaderId: string, isInstanced: boolean, flags: string[]): string {
    const flagKey = flags.length > 0 ? "_" + flags.join("_") : "";
    return isInstanced ? `${shaderId}_instanced${flagKey}` : `${shaderId}${flagKey}`;
  }

  public getProgram(
    shaderId: string,
    isInstanced: boolean = false,
    flags: string[] = [],
  ): WebGL2ProgramCacheEntry {
    const key = this.programCacheKey(shaderId, isInstanced, flags);
    let cache = this._programs.get(key);
    if (!cache) {
      const def = this._shaderRegistry.get(shaderId);
      if (!def || !def.sources.glsl300) {
        throw new Error(
          `[WebGL2Renderer] Shader definition for ${shaderId} not found or missing GLSL 300 source.`,
        );
      }

      let vs = this._shaderRegistry.assemble(def.sources.glsl300.vs, "glsl300");
      let fs = this._shaderRegistry.assemble(def.sources.glsl300.fs, "glsl300");

      if (flags.includes(NORMAL_OUTPUT_FLAG)) fs = wrapFragmentWithNormalOutputGL(fs);

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
      const prog = this._createShaderProgram(vs, fs);

      const uniforms = new Map<string, WebGLUniformLocation | undefined>();
      const attributes = new Map<string, number>();
      const samplerUnits = new Map<string, number>();
      const samplerTypes = new Map<string, number>();

      this._globalUBO.bindToProgram(prog, "GlobalUniforms");

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
        attributes.set(name, this._gl.getAttribLocation(prog, name));
      });

      // Ask the linked program for its actually-active uniforms instead of guessing names up
      // front: a hand-maintained list can silently omit one (that's how a whole class of this
      // project's rendering bugs happened), while introspection can't drift out of sync with the
      // shader source. Every sampler uniform also gets a texture unit assigned here, dynamically
      // per-program, except the shadow-map samplers (bound to fixed units 8-13 by the dedicated,
      // unrelated shadow code below) and skybox's own single-texture path.
      const samplerTypeSet = new Set<number>([
        this._gl.SAMPLER_2D,
        this._gl.SAMPLER_CUBE,
        this._gl.SAMPLER_2D_SHADOW,
        this._gl.SAMPLER_2D_ARRAY,
      ]);
      const activeCount = this._gl.getProgramParameter(prog, this._gl.ACTIVE_UNIFORMS) as number;
      let nextSamplerUnit = 0;
      for (let i = 0; i < activeCount; i++) {
        const info = this._gl.getActiveUniform(prog, i);
        if (!info) continue;
        const isArray = info.size > 1 && info.name.endsWith("[0]");
        const names = isArray
          ? Array.from({ length: info.size }, (_, j) => `${info.name.slice(0, -3)}[${j}]`)
          : [info.name];

        const isShadowSampler =
          "u_dirShadowMap" === info.name ||
          "u_dirShadowMapRaw" === info.name ||
          info.name.startsWith("u_spotShadowMap[");
        const isSampler = samplerTypeSet.has(info.type) && !isShadowSampler;

        for (const name of names) {
          uniforms.set(name, this._gl.getUniformLocation(prog, name) ?? undefined);
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

      cache = { prog, uniforms, attributes, samplerUnits, samplerTypes, refCount: 0 };
      this._programs.set(key, cache);
    }
    return cache;
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

  // Compiles and links a shader program -- same logic as `AbstractWebGLRenderer.createShaderProgram()`,
  // duplicated here (rather than depending on the renderer's inheritance chain) since this class
  // has no other reason to reference the renderer at all.
  private _createShaderProgram(vSrc: string, fSrc: string): WebGLProgram {
    const v: WebGLShader = this._gl.createShader(this._gl.VERTEX_SHADER)!;
    this._gl.shaderSource(v, vSrc);
    this._gl.compileShader(v);

    if (!this._gl.getShaderParameter(v, this._gl.COMPILE_STATUS)) {
      console.error("[WebGL] Vertex Shader Error:", this._gl.getShaderInfoLog(v));
    }

    const f: WebGLShader = this._gl.createShader(this._gl.FRAGMENT_SHADER)!;
    this._gl.shaderSource(f, fSrc);
    this._gl.compileShader(f);

    if (!this._gl.getShaderParameter(f, this._gl.COMPILE_STATUS)) {
      console.error("[WebGL] Fragment Shader Error:", this._gl.getShaderInfoLog(f));
    }

    const p: WebGLProgram = this._gl.createProgram()!;
    this._gl.attachShader(p, v);
    this._gl.attachShader(p, f);
    for (const [location, name] of WebGLProgramCache._FIXED_ATTRIBUTE_LOCATIONS) {
      this._gl.bindAttribLocation(p, location, name);
    }
    this._gl.linkProgram(p);

    if (!this._gl.getProgramParameter(p, this._gl.LINK_STATUS)) {
      console.error("[WebGL] Program Link Error:", this._gl.getProgramInfoLog(p));
    }

    this._gl.deleteShader(v);
    this._gl.deleteShader(f);
    return p;
  }

  public dispose(): void {
    for (const cache of this._programs.values()) this._gl.deleteProgram(cache.prog);
    this._programs.clear();
  }
}
