import { AbstractWebGLRenderer } from "../AbstractWebGLRenderer.js";
import { WebGLMainPass } from "../passes/WebGLMainPass.js";
import { WebGLPostProcessPass } from "../passes/WebGLPostProcessPass.js";
import { PostProcessPassGL, BloomPassGL, LightShaftsPassGL } from "../post/passes/index.js";
import { CubeTexture, Texture, RenderTarget, RenderTargetCube } from "../../core/textures/index.js";
import { StandardWebGPULayout, resolveManifestFlags } from "../shaders/index.js";
import { DeviceLimit, InstancedMesh, Object3D, Scene } from "../../core/index.js";
import { applyAnisotropy } from "../anisotropy.js";
import {
  EngineOptions,
  GeometryDataInterface,
  LightDataInterface,
} from "../../interfaces/index.js";
import {
  MaterialType,
  RendererType,
  TextureFilter,
  CullMode,
  BlendingMode,
  Topology,
  PostProcessingEffectType,
} from "../../enums/index.js";
import { Mesh } from "../Mesh.js";
import { Vector3D } from "../../math/index.js";

interface ProgramCache {
  prog: WebGLProgram;
  uniforms: Map<string, WebGLUniformLocation | undefined>;
  attributes: Map<string, number>;
  pointLightLocs: {
    pos: WebGLUniformLocation | undefined;
    col: WebGLUniformLocation | undefined;
    distance: WebGLUniformLocation | undefined;
    decay: WebGLUniformLocation | undefined;
  }[];
  spotLightLocs: {
    pos: WebGLUniformLocation | undefined;
    dir: WebGLUniformLocation | undefined;
    col: WebGLUniformLocation | undefined;
    params: WebGLUniformLocation | undefined;
  }[];
  areaLightLocs: {
    pos: WebGLUniformLocation | undefined;
    col: WebGLUniformLocation | undefined;
    normal: WebGLUniformLocation | undefined;
    right: WebGLUniformLocation | undefined;
    up: WebGLUniformLocation | undefined;
    size: WebGLUniformLocation | undefined;
  }[];
  /** Texture unit assigned to each active sampler uniform in THIS program, discovered via introspection. */
  samplerUnits: Map<string, number>;
  /** GL sampler type (SAMPLER_2D/SAMPLER_CUBE) of each active sampler uniform in THIS program. */
  samplerTypes: Map<string, number>;
  /** Number of live Object3D instances currently referencing this compiled program. */
  refCount: number;
}

/**
 * WebGL 1.0 implementation of the renderer.
 */
export class WebGL1Renderer extends AbstractWebGLRenderer {
  /** @inheritdoc */
  public override readonly type: RendererType = RendererType.WEB_GL1;
  declare protected gl: WebGLRenderingContext;

  private _stateCullFaceEnabled: boolean | null = null;
  private _stateCullFaceMode: number = -1;
  private _stateBlendEnabled: boolean | null = null;
  private _stateBlendSrc: number = -1;
  private _stateBlendDst: number = -1;
  private _stateDepthMask: boolean | null = null;
  private _stateDepthTest: boolean | null = null;

  /** Satisfies Renderer interface */
  public override get webglContext(): WebGLRenderingContext {
    return this.gl;
  }

  private _programs: Map<string, ProgramCache> = new Map();

  private _cache: Map<GeometryDataInterface, Mesh> = new Map();
  private _lastKnownGeometry: WeakMap<Object3D, GeometryDataInterface> = new WeakMap();
  private _lastKnownProgramKey: WeakMap<Object3D, string> = new WeakMap();
  private _texCubeCache: Map<CubeTexture, WebGLTexture> = new Map();
  private _texRefCounts: Map<Texture, number> = new Map();
  private _texCubeRefCounts: Map<CubeTexture, number> = new Map();
  private _lastKnownTextures: WeakMap<Object3D, Record<string, Texture | CubeTexture | undefined>> =
    new WeakMap();

  private _opaqueTexture?: WebGLTexture;

  protected _hdrFbo: WebGLFramebuffer | undefined = undefined;
  protected _hdrTexture: WebGLTexture | undefined = undefined;
  protected _hdrRenderBuffer: WebGLRenderbuffer | undefined = undefined;
  private _hdrW: number = 0;
  private _hdrH: number = 0;
  protected _postPassGL: PostProcessPassGL | undefined = undefined;
  protected _bloomPassGL: BloomPassGL | undefined = undefined;
  protected _lightShaftsPassGL: LightShaftsPassGL | undefined = undefined;

  protected _activeRenderTarget: RenderTarget | RenderTargetCube | null = null;
  private _activeCubeFace: number = 0;
  private _renderTargetFbos: Map<RenderTarget, WebGLFramebuffer> = new Map();
  private _renderTargetDepthBuffers: Map<RenderTarget, WebGLRenderbuffer> = new Map();
  /** Cube counterpart of `_renderTargetFbos`/`_renderTargetDepthBuffers` -- `DynamicReflectionProbe`
   * and other `RenderTargetCube` consumers render into these via `bindMainRenderTarget()`, one
   * face at a time (see `setRenderTarget`'s `activeCubeFace` param). */
  private _renderTargetCubeFbos: Map<RenderTargetCube, WebGLFramebuffer> = new Map();
  private _renderTargetCubeDepthBuffers: Map<RenderTargetCube, WebGLRenderbuffer> = new Map();

  private _scratchModelMatrix: Float32Array = new Float32Array(16);

  /** Cached once at init instead of re-querying `DeviceCaps` on every texture bind. */
  private _maxTextureUnits: number = 0;
  /** `${uniformName}:${unit}` keys already warned about in `_isTextureUnitAvailable`. */
  private _warnedTextureUnits: Set<string> = new Set();

  /** `ANGLE_instanced_arrays` -- WebGL1's equivalent of WebGL2's native instancing entry points
   * (`drawArraysInstanced`/`vertexAttribDivisor`). Universally supported by any device that
   * exposes WebGL1 at all, but still queried defensively rather than assumed. */
  private _instancedArraysExt: ANGLE_instanced_arrays | null = null;
  private _warnedNoInstancedArrays = false;
  private _instanceMatrixBuffers: WeakMap<InstancedMesh, WebGLBuffer> = new WeakMap();

  /** @inheritdoc */
  public async initialize(
    canvas: HTMLCanvasElement,
    attributes?: Record<string, unknown>,
    config?: EngineOptions,
  ): Promise<void> {
    const gl =
      canvas.getContext("webgl", attributes) || canvas.getContext("experimental-webgl", attributes);
    if (!gl) throw new Error("[WebGL1Renderer] WebGL1 context could not be initialized.");
    this.gl = gl as WebGLRenderingContext;

    if (config?.quality) {
      this._quality = { ...this._quality, ...config.quality };
    }
    if (config?.postProcessing) {
      this.postProcessing.loadConfig(config.postProcessing);
    }

    this._maxTextureUnits = this.context.deviceCaps.getLimit(
      DeviceLimit.WEBGL1_MAX_TEXTURE_IMAGE_UNITS,
    );
    this._instancedArraysExt = this.gl.getExtension("ANGLE_instanced_arrays");

    this.gl.pixelStorei(this.gl.UNPACK_FLIP_Y_WEBGL, false);
    this.initDefaultTextures();
    this.gl.enable(this.gl.DEPTH_TEST);

    this.addPass(new WebGLMainPass());
    this.addPass(new WebGLPostProcessPass());
  }

  /**
   * Whether `unit` is within the device's texture-unit budget. Centralizes the "not enough
   * units" check + warning so it can't drift out of sync between multiple bind sites -- see the
   * matching helper in WebGL2Renderer for the full rationale.
   */
  private _isTextureUnitAvailable(unit: number, uniformName: string): boolean {
    if (unit < this._maxTextureUnits) return true;
    // Warn once per (uniform, unit) instead of every draw call -- see WebGL2Renderer's matching
    // helper for the full rationale.
    const warnKey = `${uniformName}:${unit}`;
    if (!this._warnedTextureUnits.has(warnKey)) {
      this._warnedTextureUnits.add(warnKey);
      console.warn(
        `[WebGL1Renderer] Exceeded MAX_TEXTURE_IMAGE_UNITS (${this._maxTextureUnits}). Cannot bind material texture ${uniformName} to unit ${unit}.`,
      );
    }
    return false;
  }

  /** Cache key for a compiled program variant -- shared by `_getProgram` (which builds it) and
   * `_acquireProgram`/`_releaseObjectProgram` (which just need it as an opaque refcounting key). */
  private _programCacheKey(
    shaderId: string,
    isInstanced: boolean,
    flags: readonly string[],
  ): string {
    const flagKey = flags.length > 0 ? "_" + flags.join("_") : "";
    return isInstanced ? `${shaderId}_instanced${flagKey}` : `${shaderId}${flagKey}`;
  }

  /**
   * @param flags Material feature flags (e.g. `USE_AO_MAP`, from `RenderManifest.flags`) that
   * become `#define`s in the compiled shader -- mirrors `WebGL2Renderer`'s equivalent, needed so a
   * `StandardMaterial` with e.g. a reflection map actually gets `USE_REFLECTION_MAP` compiled in,
   * instead of every WebGL1 program silently compiling as if no material ever had any optional
   * texture (metallic/roughness/ao/emissive/alpha/env/normal/reflection map) assigned at all.
   */
  private _getProgram(
    shaderId: string,
    isInstanced: boolean = false,
    flags: readonly string[] = [],
  ): ProgramCache {
    const cacheKey = this._programCacheKey(shaderId, isInstanced, flags);
    let cache = this._programs.get(cacheKey);
    if (!cache) {
      const def = this.context.shaderRegistry.get(shaderId);
      if (!def || !def.sources.glsl100) {
        throw new Error(
          `[WebGL1Renderer] Shader definition for ${shaderId} not found or missing GLSL 100 source.`,
        );
      }

      let vs = this.context.shaderRegistry.assemble(def.sources.glsl100.vs, "glsl100");
      let fs = this.context.shaderRegistry.assemble(def.sources.glsl100.fs, "glsl100");
      let defines = "";
      if (isInstanced) defines += "#define USE_INSTANCING 1\n";
      for (const flag of flags) defines += `#define ${flag} 1\n`;
      if (defines) {
        vs = defines + vs;
        fs = defines + fs;
      }
      const prog = this.createShaderProgram(vs, fs);

      const uniforms = new Map<string, WebGLUniformLocation | undefined>();
      const attributes = new Map<string, number>();
      const samplerUnits = new Map<string, number>();
      const samplerTypes = new Map<string, number>();

      const attribsToQuery = ["a_position", "a_normal", "a_uv", "a_tangent", "a_color"];
      if (isInstanced) attribsToQuery.push("a_instanceMatrix");
      attribsToQuery.forEach((name) => {
        attributes.set(name, this.gl.getAttribLocation(prog, name));
      });

      // Ask the linked program for its actually-active uniforms instead of guessing names up
      // front: a hand-maintained list can silently omit one, while introspection can't drift out
      // of sync with the shader source. Every sampler uniform also gets a texture unit assigned
      // here, dynamically per-program (WebGL1 has no shadow-map/IBL samplers to reserve units for).
      const samplerTypeSet = new Set<number>([this.gl.SAMPLER_2D, this.gl.SAMPLER_CUBE]);
      const activeCount = this.gl.getProgramParameter(prog, this.gl.ACTIVE_UNIFORMS) as number;
      let nextSamplerUnit = 0;
      for (let i = 0; i < activeCount; i++) {
        const info = this.gl.getActiveUniform(prog, i);
        if (!info) continue;
        const isArray = info.size > 1 && info.name.endsWith("[0]");
        const names = isArray
          ? Array.from({ length: info.size }, (_, j) => `${info.name.slice(0, -3)}[${j}]`)
          : [info.name];
        const isSampler = samplerTypeSet.has(info.type);

        for (const name of names) {
          uniforms.set(name, this.gl.getUniformLocation(prog, name) ?? undefined);
          if (isSampler) {
            samplerUnits.set(name, nextSamplerUnit);
            samplerTypes.set(name, info.type);
            nextSamplerUnit++;
          }
        }
      }

      // `layout.uniforms` is near-universally `...StandardWebGPULayout.uniforms` (the fixed set
      // every material spreads in to match WebGPU's shared `ObjectUniforms` struct) -- a lean
      // shader legitimately using only a handful of those 16 names is the norm, not a mistake, so
      // warning about the rest would just be noise.
      //
      // `layout.textures` is deliberately NOT checked here (unlike before per-material `flags`
      // existed): it lists every texture slot the material COULD ever use (e.g. `u_aoMap`), not
      // just the ones THIS compiled variant actually declares -- most of them are wrapped in
      // `#ifdef USE_..._MAP` and only compiled in when the corresponding flag is passed to this
      // very function, so a variant compiled without that flag legitimately doesn't have the
      // uniform, and warning about it would misreport a working, intentional feature gate as a bug.
      const genericUniformNames = new Set(Object.keys(StandardWebGPULayout.uniforms));
      for (const name of Object.keys(def.layout.uniforms)) {
        if (!uniforms.has(name) && !genericUniformNames.has(name)) {
          console.warn(
            `[WebGL1Renderer] Uniform '${name}' defined in material layout but not found in shader '${shaderId}'. It might be unused or optimized away.`,
          );
        }
      }

      const pointLightLocs = [];
      const spotLightLocs = [];
      const areaLightLocs = [];
      for (let i = 0; i < 16; i++) {
        pointLightLocs.push({
          pos: this.gl.getUniformLocation(prog, `u_pointLightPos[${i}]`) ?? undefined,
          col: this.gl.getUniformLocation(prog, `u_pointLightColor[${i}]`) ?? undefined,
          distance: this.gl.getUniformLocation(prog, `u_pointLightDistance[${i}]`) ?? undefined,
          decay: this.gl.getUniformLocation(prog, `u_pointLightDecay[${i}]`) ?? undefined,
        });
        spotLightLocs.push({
          pos: this.gl.getUniformLocation(prog, `u_spotLightPos[${i}]`) ?? undefined,
          dir: this.gl.getUniformLocation(prog, `u_spotLightDir[${i}]`) ?? undefined,
          col: this.gl.getUniformLocation(prog, `u_spotLightColor[${i}]`) ?? undefined,
          params: this.gl.getUniformLocation(prog, `u_spotLightParams[${i}]`) ?? undefined,
        });
      }
      for (let i = 0; i < 4; i++) {
        areaLightLocs.push({
          pos: this.gl.getUniformLocation(prog, `u_areaLightPos[${i}]`) ?? undefined,
          col: this.gl.getUniformLocation(prog, `u_areaLightColor[${i}]`) ?? undefined,
          right: this.gl.getUniformLocation(prog, `u_areaLightRight[${i}]`) ?? undefined,
          up: this.gl.getUniformLocation(prog, `u_areaLightUp[${i}]`) ?? undefined,
          normal: this.gl.getUniformLocation(prog, `u_areaLightNormal[${i}]`) ?? undefined,
          size: this.gl.getUniformLocation(prog, `u_areaLightSize[${i}]`) ?? undefined,
        });
      }

      cache = {
        prog,
        uniforms,
        attributes,
        samplerUnits,
        samplerTypes,
        pointLightLocs,
        spotLightLocs,
        areaLightLocs,
        refCount: 0,
      };
      this._programs.set(cacheKey, cache);
    }
    return cache;
  }

  /**
   * Tracks that `obj` currently depends on the compiled program identified by `shaderId`.
   * Called once per object per frame from the render loop, independent from `_getProgram`'s
   * own lookup-or-create, since one program is typically shared by many objects at once.
   */
  private _acquireProgram(obj: Object3D, shaderId: string): void {
    const lastKey = this._lastKnownProgramKey.get(obj);
    if (lastKey === shaderId) return;
    if (lastKey) this._releaseObjectProgram(obj);

    const cache = this._programs.get(shaderId);
    if (cache) cache.refCount++;
    this._lastKnownProgramKey.set(obj, shaderId);
  }

  /** Releases the compiled program this object was referencing, if its refCount drops to zero. */
  private _releaseObjectProgram(obj: Object3D): void {
    const shaderId = this._lastKnownProgramKey.get(obj);
    if (!shaderId) return;
    this._lastKnownProgramKey.delete(obj);

    const cache = this._programs.get(shaderId);
    if (!cache) return;
    cache.refCount--;
    if (cache.refCount <= 0) {
      this.gl.deleteProgram(cache.prog);
      this._programs.delete(shaderId);
    }
  }

  /** Applies filter + (for NPOT) wrap state for a 2D texture. WebGL1 only supports mipmaps and
   * REPEAT/MIRRORED_REPEAT wrapping for power-of-two textures -- see the `needsUpdate` branch.
   * Kept in one place so the first-upload and `needsUpdate` paths stay in lockstep. */
  private _setWebGL1SamplerParams(
    img: HTMLImageElement | ImageBitmap | HTMLCanvasElement,
    tex: Texture,
  ): void {
    const isPOT = 0 === (img.width & (img.width - 1)) && 0 === (img.height & (img.height - 1));
    const useMipmaps = this._quality.mipmapping && tex.generateMipmaps && isPOT;
    if (useMipmaps) this.gl.generateMipmap(this.gl.TEXTURE_2D);
    this.gl.texParameteri(
      this.gl.TEXTURE_2D,
      this.gl.TEXTURE_MAG_FILTER,
      TextureFilter.NEAREST === tex.magFilter ? this.gl.NEAREST : this.gl.LINEAR,
    );
    this.gl.texParameteri(
      this.gl.TEXTURE_2D,
      this.gl.TEXTURE_MIN_FILTER,
      useMipmaps ? this.gl.LINEAR_MIPMAP_LINEAR : this.gl.LINEAR,
    );
    if (!isPOT) {
      this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
      this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
    }
    // Anisotropic filtering sharpens mip-selected sampling -- same mipmap gate as the min filter.
    applyAnisotropy(this.gl, this.gl.TEXTURE_2D, tex, this._quality, Boolean(useMipmaps));
  }

  private _getWebGLTexture(tex: Texture): WebGLTexture {
    const fastPath = this._getWebGLTextureFastPath(tex);
    if (fastPath) return fastPath;
    let glTex: WebGLTexture | undefined = this._texCache.get(tex);
    if (!glTex) {
      // Guaranteed defined here: `_getWebGLTextureFastPath()` already returned early for a
      // texture with no `.image` (TS can't carry that narrowing across the method call).
      const img = tex.image!;
      glTex = this.gl.createTexture()!;
      this.gl.bindTexture(this.gl.TEXTURE_2D, glTex);
      this.gl.texImage2D(
        this.gl.TEXTURE_2D,
        0,
        this.gl.RGBA,
        this.gl.RGBA,
        this.gl.UNSIGNED_BYTE,
        img,
      );

      // WebGL1 only supports mipmaps and REPEAT/MIRRORED_REPEAT wrapping for power-of-two
      // textures: generateMipmap() throws GL_INVALID_OPERATION on an NPOT texture, and leaving
      // wrap at the REPEAT default makes an NPOT texture "incomplete" (silently samples black) --
      // same underlying WebGL1 constraint as the cube-texture fix in `_getWebGLCubeTexture`.
      this._setWebGL1SamplerParams(img, tex);
      this._texCache.set(tex, glTex);
    } else if (tex.needsUpdate) {
      // Guaranteed defined here: `_getWebGLTextureFastPath()` already returned early for a
      // texture with no `.image` (TS can't carry that narrowing across the method call).
      const img = tex.image!;
      this.gl.bindTexture(this.gl.TEXTURE_2D, glTex);
      this.gl.texImage2D(
        this.gl.TEXTURE_2D,
        0,
        this.gl.RGBA,
        this.gl.RGBA,
        this.gl.UNSIGNED_BYTE,
        img,
      );
      this._setWebGL1SamplerParams(img, tex);
      tex.needsUpdate = false;
    }
    return glTex;
  }

  private _getWebGLCubeTexture(tex: CubeTexture): WebGLTexture {
    if (this._quality?.disableTextures) return this.defaultCubeTexture;
    // A RenderTargetCube's GL texture is allocated/populated by bindMainRenderTarget() (it has no
    // CPU-side images to upload here) -- just return whatever it has already produced.
    if (tex instanceof RenderTargetCube) {
      const glTex = this._texCubeCache.get(tex);
      return glTex ?? this.defaultCubeTexture;
    }
    if (!tex.isLoaded || tex.images.length !== 6) return this.defaultCubeTexture;
    let glTex: WebGLTexture | undefined = this._texCubeCache.get(tex);
    if (!glTex) {
      glTex = this.gl.createTexture()!;
      this.gl.bindTexture(this.gl.TEXTURE_CUBE_MAP, glTex);
      for (let i: number = 0; i < 6; i++) {
        this.gl.texImage2D(
          this.gl.TEXTURE_CUBE_MAP_POSITIVE_X + i,
          0,
          this.gl.RGBA,
          this.gl.RGBA,
          this.gl.UNSIGNED_BYTE,
          tex.images[i] as ImageBitmap,
        );
      }
      this.gl.texParameteri(this.gl.TEXTURE_CUBE_MAP, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR);
      this.gl.texParameteri(this.gl.TEXTURE_CUBE_MAP, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);
      // WebGL1 requires CLAMP_TO_EDGE for any non-power-of-two texture -- the default wrap mode
      // is REPEAT, and leaving that in place makes an NPOT cubemap "incomplete" per spec, which
      // silently samples as solid black (no GL error). Skybox/reflection cubemaps are rarely POT.
      this.gl.texParameteri(
        this.gl.TEXTURE_CUBE_MAP,
        this.gl.TEXTURE_WRAP_S,
        this.gl.CLAMP_TO_EDGE,
      );
      this.gl.texParameteri(
        this.gl.TEXTURE_CUBE_MAP,
        this.gl.TEXTURE_WRAP_T,
        this.gl.CLAMP_TO_EDGE,
      );
      this._texCubeCache.set(tex, glTex);
    }
    return glTex;
  }

  /** @inheritdoc */
  public override setRenderTarget(
    target: RenderTarget | RenderTargetCube | null,
    activeCubeFace?: number,
  ): void {
    this._activeRenderTarget = target;
    this._activeCubeFace = activeCubeFace ?? 0;
  }

  /** @inheritdoc */
  public get activeRenderTarget(): RenderTarget | RenderTargetCube | null {
    return this._activeRenderTarget;
  }

  /** @inheritdoc */
  public get activeCubeFace(): number {
    return this._activeCubeFace;
  }

  /** @inheritdoc */
  public override get isOffscreenRenderTarget(): boolean {
    return this._activeRenderTarget !== null;
  }

  public resetStateCache(): void {
    this._stateCullFaceEnabled = null;
    this._stateCullFaceMode = -1;
    this._stateBlendEnabled = null;
    this._stateBlendSrc = -1;
    this._stateBlendDst = -1;
    this._stateDepthMask = null;
    this._stateDepthTest = null;
  }

  public bindMainRenderTarget(): boolean {
    let isOffscreen = false;

    // Reconcile the HDR post pipeline on every frame: showcases enable post-processing in
    // `setupScene()`, i.e. after the renderer's initial `setSize()`, so without this the FBO +
    // post pass would never exist and WebGL1 would silently fall back to a forward-to-canvas
    // hybrid in which the tonemapping composite (and thus the presented frame) is lost.
    this._reconcilePostProcess();

    if (this._activeRenderTarget instanceof RenderTargetCube) {
      isOffscreen = true;
      const cubeTarget = this._activeRenderTarget;
      let fbo = this._renderTargetCubeFbos.get(cubeTarget);
      if (!fbo || !cubeTarget.isLoaded) {
        if (fbo) {
          this.gl.deleteFramebuffer(fbo);
          const oldTex = this._texCubeCache.get(cubeTarget);
          if (oldTex) this.gl.deleteTexture(oldTex);
          const oldDepthRb = this._renderTargetCubeDepthBuffers.get(cubeTarget);
          if (oldDepthRb) {
            this.gl.deleteRenderbuffer(oldDepthRb);
            this._renderTargetCubeDepthBuffers.delete(cubeTarget);
          }
        }
        fbo = this.gl.createFramebuffer()!;
        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, fbo);

        const tex = this.gl.createTexture()!;
        this.gl.bindTexture(this.gl.TEXTURE_CUBE_MAP, tex);
        for (let i: number = 0; i < 6; i++) {
          this.gl.texImage2D(
            this.gl.TEXTURE_CUBE_MAP_POSITIVE_X + i,
            0,
            this.gl.RGBA,
            cubeTarget.width,
            cubeTarget.height,
            0,
            this.gl.RGBA,
            this.gl.UNSIGNED_BYTE,
            null,
          );
        }
        this.gl.texParameteri(this.gl.TEXTURE_CUBE_MAP, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR);
        this.gl.texParameteri(this.gl.TEXTURE_CUBE_MAP, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);
        this.gl.texParameteri(
          this.gl.TEXTURE_CUBE_MAP,
          this.gl.TEXTURE_WRAP_S,
          this.gl.CLAMP_TO_EDGE,
        );
        this.gl.texParameteri(
          this.gl.TEXTURE_CUBE_MAP,
          this.gl.TEXTURE_WRAP_T,
          this.gl.CLAMP_TO_EDGE,
        );

        if (cubeTarget.depth) {
          const depthRb = this.gl.createRenderbuffer()!;
          this.gl.bindRenderbuffer(this.gl.RENDERBUFFER, depthRb);
          this.gl.renderbufferStorage(
            this.gl.RENDERBUFFER,
            this.gl.DEPTH_COMPONENT16,
            cubeTarget.width,
            cubeTarget.height,
          );
          this.gl.framebufferRenderbuffer(
            this.gl.FRAMEBUFFER,
            this.gl.DEPTH_ATTACHMENT,
            this.gl.RENDERBUFFER,
            depthRb,
          );
          this._renderTargetCubeDepthBuffers.set(cubeTarget, depthRb);
        }

        this._renderTargetCubeFbos.set(cubeTarget, fbo);
        this._texCubeCache.set(cubeTarget, tex);
        cubeTarget.isLoaded = true;
      } else {
        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, fbo);
      }

      // The FBO is shared by all 6 faces (one texture, one framebuffer) -- re-point its color
      // attachment to the face requested for this call every time, since a cached FBO from a
      // previous face would otherwise still be attached to that stale face.
      const cubeTex = this._texCubeCache.get(cubeTarget)!;
      this.gl.framebufferTexture2D(
        this.gl.FRAMEBUFFER,
        this.gl.COLOR_ATTACHMENT0,
        this.gl.TEXTURE_CUBE_MAP_POSITIVE_X + this._activeCubeFace,
        cubeTex,
        0,
      );

      this.gl.viewport(0, 0, cubeTarget.width, cubeTarget.height);
    } else if (this._activeRenderTarget) {
      isOffscreen = true;
      let fbo = this._renderTargetFbos.get(this._activeRenderTarget);
      if (!fbo || !this._activeRenderTarget.isLoaded) {
        // Release the previous FBO's attachments before replacing them (e.g. on resize) --
        // otherwise the old color texture and depth renderbuffer leak, since overwriting the
        // cache entries below would drop the only references to them.
        if (fbo) {
          this.gl.deleteFramebuffer(fbo);
          const oldTex = this._texCache.get(this._activeRenderTarget);
          if (oldTex) this.gl.deleteTexture(oldTex);
          const oldDepthRb = this._renderTargetDepthBuffers.get(this._activeRenderTarget);
          if (oldDepthRb) {
            this.gl.deleteRenderbuffer(oldDepthRb);
            this._renderTargetDepthBuffers.delete(this._activeRenderTarget);
          }
        }
        fbo = this.gl.createFramebuffer()!;
        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, fbo);

        const tex = this.gl.createTexture()!;
        this.gl.bindTexture(this.gl.TEXTURE_2D, tex);
        this.gl.texImage2D(
          this.gl.TEXTURE_2D,
          0,
          this.gl.RGBA,
          this._activeRenderTarget.width,
          this._activeRenderTarget.height,
          0,
          this.gl.RGBA,
          this.gl.UNSIGNED_BYTE,
          null,
        );
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);

        this.gl.framebufferTexture2D(
          this.gl.FRAMEBUFFER,
          this.gl.COLOR_ATTACHMENT0,
          this.gl.TEXTURE_2D,
          tex,
          0,
        );

        if (this._activeRenderTarget.depth) {
          const depthRb = this.gl.createRenderbuffer()!;
          this.gl.bindRenderbuffer(this.gl.RENDERBUFFER, depthRb);
          this.gl.renderbufferStorage(
            this.gl.RENDERBUFFER,
            this.gl.DEPTH_COMPONENT16,
            this._activeRenderTarget.width,
            this._activeRenderTarget.height,
          );
          this.gl.framebufferRenderbuffer(
            this.gl.FRAMEBUFFER,
            this.gl.DEPTH_ATTACHMENT,
            this.gl.RENDERBUFFER,
            depthRb,
          );
          this._renderTargetDepthBuffers.set(this._activeRenderTarget, depthRb);
        }

        this._renderTargetFbos.set(this._activeRenderTarget, fbo);
        this._texCache.set(this._activeRenderTarget, tex);
        this._activeRenderTarget.isLoaded = true;
      } else {
        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, fbo);
      }
      this.gl.viewport(0, 0, this._activeRenderTarget.width, this._activeRenderTarget.height);
    } else if (this.postProcessing.enabled && this._hdrFbo) {
      this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this._hdrFbo);
      this.gl.viewport(0, 0, this.gl.canvas.width, this.gl.canvas.height);
    } else {
      this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
      this.gl.viewport(0, 0, this.gl.canvas.width, this.gl.canvas.height);
    }

    return isOffscreen;
  }

  public bindPostProcessRenderTarget(): void {
    // Unused in WebGL1 directly as FBO is bound in bindMainRenderTarget
  }

  public copyToOpaqueTexture(): void {
    if (!this._opaqueTexture) {
      const tex = this.gl.createTexture();
      this.gl.bindTexture(this.gl.TEXTURE_2D, tex);
      this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.NEAREST);
      this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.NEAREST);
      this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
      this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
      this._opaqueTexture = tex!;

      const dummyTex = { isLoaded: true } as unknown as Texture;
      this._texCache.set(dummyTex, tex!);
    } else {
      this.gl.bindTexture(this.gl.TEXTURE_2D, this._opaqueTexture);
    }

    this.gl.copyTexImage2D(
      this.gl.TEXTURE_2D,
      0,
      this.gl.RGBA,
      0,
      0,
      this.gl.canvas.width,
      this.gl.canvas.height,
      0,
    );
  }

  /**
   * WebGL1 has no depth-texture-capable copy path (no `blitFramebuffer`, and the
   * `WEBGL_depth_texture` extension is unused in this project) -- intentional no-op.
   * Materials sampling `u_opaqueDepthMap` fall back to the default (far-depth) texture.
   */
  public copyToOpaqueDepthTexture(): void {
    // Intentional no-op, see docstring.
  }

  public flushPostProcess(): void {
    const isOffscreen = this._activeRenderTarget !== null;
    if (!isOffscreen && this.postProcessing.enabled && this._hdrTexture && this._postPassGL) {
      let bloomTex: WebGLTexture | null = null;
      if (this._bloomPassGL) {
        const bloomNode = this.postProcessing.get<import("../post/index.js").BloomElement>(
          PostProcessingEffectType.BLOOM,
        );
        if (bloomNode && bloomNode.enabled) {
          bloomTex = this._bloomPassGL.execute(
            this._hdrTexture,
            this.gl.canvas.width,
            this.gl.canvas.height,
            bloomNode,
          );
        }
      }

      let lightShaftsTex: WebGLTexture | null = null;
      if (this._lightShaftsPassGL && this._frameLights?.dLight) {
        const shaftsNode = this.postProcessing.get<import("../post/index.js").LightShaftsElement>(
          PostProcessingEffectType.LIGHT_SHAFTS,
        );
        if (shaftsNode && shaftsNode.enabled) {
          const dLight = this._frameLights.dLight;
          lightShaftsTex = this._lightShaftsPassGL.execute(
            null,
            this._hdrTexture,
            this.gl.canvas.width,
            this.gl.canvas.height,
            this._frameViewProj.data,
            this._frameCamPos,
            dLight,
            null,
            shaftsNode,
          );
        }
      }

      this._postPassGL.execute(
        this.gl,
        this._hdrTexture,
        this.postProcessing,
        bloomTex,
        null,
        lightShaftsTex,
        null,
        this.frameInfo.realTime,
      );
    }
  }

  public renderBatch(
    batch: import("../../core/Scene.js").RenderBatch,
    vMat: Float32Array | undefined,
    vp: Float32Array,
    camPos: Vector3D,
    lights: LightDataInterface,
    scene: Scene,
  ): void {
    const objects = batch.objects;
    if (objects.length === 0) return;

    // InstancedMesh (e.g. WeatherEmitter's ash/dust particles) needs its own compiled program
    // variant (USE_INSTANCING attributes) and its own draw call per object -- split it out from
    // plain objects the same way WebGL2Renderer.renderBatch does, instead of drawing it as a
    // single non-instanced mesh at its own (usually default/identity) transform, which is what
    // silently happened before this split existed.
    const instancedObjects: Object3D[] = [];
    const standardObjects: Object3D[] = [];
    for (const o of objects) {
      if (o instanceof InstancedMesh) instancedObjects.push(o);
      else standardObjects.push(o);
    }

    if (standardObjects.length > 0) {
      this._renderSubgroup(batch, standardObjects, false, vMat, vp, camPos, lights, scene);
    }

    if (instancedObjects.length > 0) {
      if (!this._instancedArraysExt) {
        if (!this._warnedNoInstancedArrays) {
          console.warn(
            "[WebGL1Renderer] ANGLE_instanced_arrays not supported by this device -- instanced " +
              "objects (e.g. WeatherEmitter particles) will not be drawn.",
          );
          this._warnedNoInstancedArrays = true;
        }
      } else {
        this._renderSubgroup(batch, instancedObjects, true, vMat, vp, camPos, lights, scene);
      }
    }
  }

  private _renderSubgroup(
    batch: import("../../core/Scene.js").RenderBatch,
    objects: Object3D[],
    isInstanced: boolean,
    vMat: Float32Array | undefined,
    vp: Float32Array,
    camPos: Vector3D,
    lights: LightDataInterface,
    scene: Scene,
  ): void {
    const shaderId = batch.shaderId;
    const topology = batch.topology as string;
    const fog = scene.fog;

    // Every object sharing this batch shares its material's shader variant too (same precondition
    // WebGL2Renderer's equivalent already relies on) -- read flags off the first object so the
    // program actually compiles in whichever optional texture features (USE_AO_MAP,
    // USE_REFLECTION_MAP, etc.) this material has assigned.
    const firstObj = objects[0]!;
    const mat = firstObj.material!;
    const manifest = mat.getRenderManifest();
    const texs = manifest.textures;
    const flags = resolveManifestFlags(manifest.flags, this._quality.disableTextures) ?? [];

    const programKey = this._programCacheKey(shaderId, isInstanced, flags);
    const cache = this._getProgram(shaderId, isInstanced, flags);
    this.gl.useProgram(cache.prog);

    const u = cache.uniforms;

    // --- Bind Global Uniforms (Once per shader) ---
    const uVp = u.get("u_vp");
    if (uVp) this.gl.uniformMatrix4fv(uVp, false, vp);
    const uViewPos = u.get("u_viewPos");
    if (uViewPos) this.gl.uniform3f(uViewPos, camPos.x, camPos.y, camPos.z);

    const uAmbientColor = u.get("u_ambientColor");
    if (uAmbientColor)
      this.gl.uniform3f(
        uAmbientColor,
        lights.aCol.r * lights.aIntensity,
        lights.aCol.g * lights.aIntensity,
        lights.aCol.b * lights.aIntensity,
      );

    const uDirLightColor = u.get("u_dirLightColor");
    if (uDirLightColor)
      this.gl.uniform3f(
        uDirLightColor,
        lights.dCol.r * lights.dIntensity,
        lights.dCol.g * lights.dIntensity,
        lights.dCol.b * lights.dIntensity,
      );

    const uDirLightDir = u.get("u_dirLightDir");
    if (uDirLightDir) this.gl.uniform3f(uDirLightDir, lights.dDir.x, lights.dDir.y, lights.dDir.z);

    // --- Bind Lights ---
    // WebGL1 has no clustering (see docs/adr/0007-clustered-lighting-webgl2-webgpu-only.md) and only
    // has 16 uniform slots -- fail-fast if more than 16 are supplied.
    if (lights.pLights.length > 16) {
      throw new Error(
        `[WebGL1Renderer] Point light count exceeds limit of 16: ${lights.pLights.length}`,
      );
    }
    const numPointLights = lights.pLights.length;
    const uNumPointLights = u.get("u_numPointLights");
    if (uNumPointLights) this.gl.uniform1i(uNumPointLights, numPointLights);
    for (let i = 0; i < numPointLights; i++) {
      const pl = lights.pLights[i]!;
      const loc = cache.pointLightLocs[i];
      if (loc?.pos)
        this.gl.uniform3f(
          loc.pos,
          pl.worldMatrix.data[12]!,
          pl.worldMatrix.data[13]!,
          pl.worldMatrix.data[14]!,
        );
      if (loc?.col)
        this.gl.uniform3f(
          loc.col,
          pl.color.r * pl.intensity,
          pl.color.g * pl.intensity,
          pl.color.b * pl.intensity,
        );
      if (loc?.distance) this.gl.uniform1f(loc.distance, pl.distance);
      if (loc?.decay) this.gl.uniform1f(loc.decay, pl.decay);
    }

    {
      // --- Fog Uniforms ---
      if (fog) {
        const modeLoc = u.get("u_fogMode");
        if (modeLoc) this.gl.uniform1i(modeLoc, fog.mode);
        const colLoc = u.get("u_fogColor");
        if (colLoc) this.gl.uniform3f(colLoc, fog.color.r, fog.color.g, fog.color.b);
        const densLoc = u.get("u_fogDensity");
        if (densLoc) this.gl.uniform1f(densLoc, fog.density);
        const nearLoc = u.get("u_fogNear");
        if (nearLoc) this.gl.uniform1f(nearLoc, fog.near);
        const farLoc = u.get("u_fogFar");
        if (farLoc) this.gl.uniform1f(farLoc, fog.far);
        const heightLoc = u.get("u_fogHeight");
        if (heightLoc) this.gl.uniform1f(heightLoc, fog.height);
        const hFalloffLoc = u.get("u_fogHeightFalloff");
        if (hFalloffLoc) this.gl.uniform1f(hFalloffLoc, fog.heightFalloff);
      } else {
        const modeLoc = u.get("u_fogMode");
        if (modeLoc) this.gl.uniform1i(modeLoc, 0); // NONE
      }

      // --- 1. Bind Material States ---
      const state = manifest.state;
      const enableCull = !(state && CullMode.NONE === state.culling);
      if (this._stateCullFaceEnabled !== enableCull) {
        if (enableCull) this.gl.enable(this.gl.CULL_FACE);
        else this.gl.disable(this.gl.CULL_FACE);
        this._stateCullFaceEnabled = enableCull;
      }

      if (enableCull) {
        const cullMode = state && CullMode.FRONT === state.culling ? this.gl.FRONT : this.gl.BACK;
        if (this._stateCullFaceMode !== cullMode) {
          this.gl.cullFace(cullMode);
          this._stateCullFaceMode = cullMode;
        }
      }

      const enableBlend = !!state?.transparent;
      if (this._stateBlendEnabled !== enableBlend) {
        if (enableBlend) this.gl.enable(this.gl.BLEND);
        else this.gl.disable(this.gl.BLEND);
        this._stateBlendEnabled = enableBlend;
      }

      let depthMask = !enableBlend;
      if (state?.depthWrite === false) depthMask = false;

      if (this._stateDepthMask !== depthMask) {
        this.gl.depthMask(depthMask);
        this._stateDepthMask = depthMask;
      }

      if (enableBlend) {
        let src: number = this.gl.SRC_ALPHA;
        let dst: number = this.gl.ONE_MINUS_SRC_ALPHA;
        if (state.blending === BlendingMode.ADDITIVE) {
          src = this.gl.ONE;
          dst = this.gl.ONE;
        } else if (state.blending === BlendingMode.PREMULTIPLIED_ALPHA) {
          src = this.gl.ONE;
        }
        if (this._stateBlendSrc !== src || this._stateBlendDst !== dst) {
          this.gl.blendFunc(src, dst);
          this._stateBlendSrc = src;
          this._stateBlendDst = dst;
        }
      }

      const enableDepthTest = state?.depthTest !== false;
      if (this._stateDepthTest !== enableDepthTest) {
        if (enableDepthTest) this.gl.enable(this.gl.DEPTH_TEST);
        else this.gl.disable(this.gl.DEPTH_TEST);
        this._stateDepthTest = enableDepthTest;
      }

      // --- 2. Bind Generic Material Properties (Uniforms) ---
      for (const name in manifest.properties) {
        const value = manifest.properties[name];
        const loc = u.get(name);
        if (!loc) continue;

        if (typeof value === "number") {
          this.gl.uniform1f(loc, value);
        } else if (ArrayBuffer.isView(value)) {
          const v = value as Float32Array;
          if (v.length === 4) this.gl.uniform4fv(loc, v);
          else if (v.length === 3) this.gl.uniform3fv(loc, v);
          else if (v.length === 2) this.gl.uniform2fv(loc, v);
          else if (v.length === 16) this.gl.uniformMatrix4fv(loc, false, v);
        } else if (Array.isArray(value)) {
          if (value.length === 4) this.gl.uniform4fv(loc, value as number[]);
          else if (value.length === 3) this.gl.uniform3fv(loc, value as number[]);
          else if (value.length === 2) this.gl.uniform2fv(loc, value as number[]);
          else if (value.length === 16) this.gl.uniformMatrix4fv(loc, false, value as number[]);
        }
      }

      // --- 3. Bind Textures ---
      if (shaderId === MaterialType.SKYBOX) {
        this.gl.activeTexture(this.gl.TEXTURE0);
        this.gl.bindTexture(this.gl.TEXTURE_2D, null); // Unbind 2D to prevent conflict
        const skyTex = texs["u_skybox"] as CubeTexture;
        this.gl.bindTexture(
          this.gl.TEXTURE_CUBE_MAP,
          skyTex ? this._getWebGLCubeTexture(skyTex) : this.defaultCubeTexture,
        );
        const uSkybox = u.get("u_skybox");
        if (uSkybox) this.gl.uniform1i(uSkybox, 0);
      } else {
        for (const [uniformName, unit] of cache.samplerUnits) {
          const loc = u.get(uniformName);
          if (!loc || !this._isTextureUnitAvailable(unit, uniformName)) continue;

          this.gl.activeTexture(this.gl.TEXTURE0 + unit);
          // Cube-vs-2D is a property of the sampler's declared GLSL type, not its name -- any
          // samplerCube uniform (u_envMap today, potentially others in future materials) needs
          // the cube-texture fallback path, not just one hardcoded name.
          if (this.gl.SAMPLER_CUBE === cache.samplerTypes.get(uniformName)) {
            this.gl.bindTexture(this.gl.TEXTURE_2D, null);
            const ct = texs[uniformName] as CubeTexture;
            this.gl.bindTexture(
              this.gl.TEXTURE_CUBE_MAP,
              ct ? this._getWebGLCubeTexture(ct) : this.defaultCubeTexture,
            );
          } else {
            this.gl.bindTexture(this.gl.TEXTURE_CUBE_MAP, null);
            const t = texs[uniformName] as Texture;
            let fallback: WebGLTexture = this.defaultTexture;
            if (uniformName === "u_normalMap") {
              fallback = this.defaultNormalMap;
            } else if (uniformName === "u_opaqueMap") {
              fallback = this._opaqueTexture ?? this.defaultTexture;
            }
            this.gl.bindTexture(this.gl.TEXTURE_2D, t ? this._getWebGLTexture(t) : fallback);
          }
          this.gl.uniform1i(loc, unit);
        }
      }

      // --- Render each object ---
      for (const o of objects) {
        if (!o.geometry) continue;

        this._acquireProgram(o, programKey);
        this._acquireTextures(o, texs);

        const mesh = this._getOrCreateMesh(o, o.geometry);
        const drawMode = topology === Topology.LINE_LIST ? this.gl.LINES : this.gl.TRIANGLES;

        if (isInstanced) {
          const instMesh = o as InstancedMesh;
          if (instMesh.instanceCount < 0) {
            throw new Error(`[WebGL1Renderer] Invalid instanceCount: ${instMesh.instanceCount}`);
          }
          if (instMesh.instanceMatrices.byteLength < instMesh.instanceCount * 64) {
            throw new Error(
              `[WebGL1Renderer] InstancedMesh matrix buffer too small: required at least ${instMesh.instanceCount * 64} bytes for ${instMesh.instanceCount} instances, but buffer is ${instMesh.instanceMatrices.byteLength} bytes.`,
            );
          }
          if (
            instMesh.instanceData &&
            instMesh.instanceData.byteLength < instMesh.instanceCount * 16
          ) {
            throw new Error(
              `[WebGL1Renderer] InstancedMesh instanceData buffer too small: required at least ${instMesh.instanceCount * 16} bytes for ${instMesh.instanceCount} instances, but buffer is ${instMesh.instanceData.byteLength} bytes.`,
            );
          }
          const ext = this._instancedArraysExt!;

          const uModel = u.get("u_model");
          if (uModel) this.gl.uniformMatrix4fv(uModel, false, instMesh.worldMatrix.data);

          let matrixBuf = this._instanceMatrixBuffers.get(instMesh);
          if (!matrixBuf) {
            matrixBuf = this.gl.createBuffer()!;
            this._instanceMatrixBuffers.set(instMesh, matrixBuf);
          }
          this.gl.bindBuffer(this.gl.ARRAY_BUFFER, matrixBuf);
          if (instMesh.instanceMatrixNeedsUpdate) {
            this.gl.bufferData(
              this.gl.ARRAY_BUFFER,
              instMesh.instanceMatrices,
              this.gl.DYNAMIC_DRAW,
            );
            instMesh.instanceMatrixNeedsUpdate = false;
          }

          mesh.bind(
            cache.attributes.get("a_position")!,
            cache.attributes.get("a_normal")!,
            cache.attributes.get("a_uv")!,
            cache.attributes.get("a_tangent")!,
            -1,
            -1,
            cache.attributes.get("a_color")!,
          );

          // A mat4 attribute occupies 4 consecutive locations (loc..loc+3), one vec4 column each --
          // universal GL attribute-binding mechanics, not GLSL-version-specific (mirrors
          // WebGL2Renderer's identical `a_instanceMatrix` binding, ANGLE-suffixed here since WebGL1
          // needs the extension for both the divisor and the instanced draw call below).
          const instLoc = cache.attributes.get("a_instanceMatrix");
          if (instLoc !== undefined && instLoc >= 0) {
            this.gl.bindBuffer(this.gl.ARRAY_BUFFER, matrixBuf);
            for (let i = 0; i < 4; i++) {
              const attribLoc = instLoc + i;
              this.gl.enableVertexAttribArray(attribLoc);
              this.gl.vertexAttribPointer(attribLoc, 4, this.gl.FLOAT, false, 64, i * 16);
              ext.vertexAttribDivisorANGLE(attribLoc, 1);
            }
          }

          if (mesh.isIndexed) {
            this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, mesh.ebo ?? null);
            ext.drawElementsInstancedANGLE(
              drawMode,
              mesh.count,
              mesh.indexType,
              0,
              instMesh.instanceCount,
            );
          } else {
            ext.drawArraysInstancedANGLE(drawMode, 0, mesh.count, instMesh.instanceCount);
          }

          if (instLoc !== undefined && instLoc >= 0) {
            for (let i = 0; i < 4; i++) {
              ext.vertexAttribDivisorANGLE(instLoc + i, 0);
              this.gl.disableVertexAttribArray(instLoc + i);
            }
          }
        } else {
          this._scratchModelMatrix.set(o.worldMatrix.data);
          if (state?.isSprite && vMat) {
            const sx = Math.sqrt(
              this._scratchModelMatrix[0]! ** 2 +
                this._scratchModelMatrix[1]! ** 2 +
                this._scratchModelMatrix[2]! ** 2,
            );
            const sy = Math.sqrt(
              this._scratchModelMatrix[4]! ** 2 +
                this._scratchModelMatrix[5]! ** 2 +
                this._scratchModelMatrix[6]! ** 2,
            );
            const sz = Math.sqrt(
              this._scratchModelMatrix[8]! ** 2 +
                this._scratchModelMatrix[9]! ** 2 +
                this._scratchModelMatrix[10]! ** 2,
            );
            this._scratchModelMatrix[0] = vMat[0]! * sx;
            this._scratchModelMatrix[1] = vMat[4]! * sx;
            this._scratchModelMatrix[2] = vMat[8]! * sx;
            this._scratchModelMatrix[4] = vMat[1]! * sy;
            this._scratchModelMatrix[5] = vMat[5]! * sy;
            this._scratchModelMatrix[6] = vMat[9]! * sy;
            this._scratchModelMatrix[8] = vMat[2]! * sz;
            this._scratchModelMatrix[9] = vMat[6]! * sz;
            this._scratchModelMatrix[10] = vMat[10]! * sz;
          }

          const uModel = u.get("u_model");
          if (uModel) this.gl.uniformMatrix4fv(uModel, false, this._scratchModelMatrix);

          mesh.bind(
            cache.attributes.get("a_position")!,
            cache.attributes.get("a_normal")!,
            cache.attributes.get("a_uv")!,
            cache.attributes.get("a_tangent")!,
            -1,
            -1,
            cache.attributes.get("a_color")!,
          );
          mesh.draw(drawMode, batch.wireframeMode);
        }
      }
    }
  }

  /** @inheritdoc */
  public override setSize(width: number, height: number): void {
    super.setSize(width, height);
    this._reconcilePostProcess();
  }

  /**
   * Lazily creates or tears down the HDR post-processing framebuffer and passes to match the
   * current `postProcessing.enabled` state and canvas dimensions -- the WebGL1 counterpart of
   * `WebGL2Renderer._ensurePostProcessFbo()`. Creating these resources only inside `setSize`
   * broke any scene that enabled post-processing after the renderer had initialized.
   */
  private _reconcilePostProcess(): void {
    if (this.postProcessing.enabled) {
      if (!this._hdrFbo) {
        this._hdrFbo = this.gl.createFramebuffer()!;
        this._hdrTexture = this.gl.createTexture()!;
        this._hdrRenderBuffer = this.gl.createRenderbuffer()!;
      }

      const w = this.gl.canvas.width;
      const h = this.gl.canvas.height;

      if (w !== this._hdrW || h !== this._hdrH) {
        this._allocateHdrTarget(w, h);
      }

      this._postPassGL ??= new PostProcessPassGL(this.gl, false);
      this._bloomPassGL ??= new BloomPassGL(this.gl, false);
      this._lightShaftsPassGL ??= new LightShaftsPassGL(this.gl, false);
    } else if (this._hdrFbo) {
      this._postPassGL?.destroy(this.gl);
      this._bloomPassGL?.destroy();
      this._lightShaftsPassGL?.destroy();
      this.gl.deleteFramebuffer(this._hdrFbo);
      this.gl.deleteTexture(this._hdrTexture!);
      this.gl.deleteRenderbuffer(this._hdrRenderBuffer!);
      this._hdrFbo = undefined;
      this._hdrTexture = undefined;
      this._hdrRenderBuffer = undefined;
      this._hdrW = 0;
      this._hdrH = 0;
      this._postPassGL = undefined;
      this._bloomPassGL = undefined;
      this._lightShaftsPassGL = undefined;
    }
  }

  /** Only runs on creation or dimension change; callers must not invoke it per render. */
  private _allocateHdrTarget(w: number, h: number): void {
    const gl = this.gl;
    // Always use an 8-bit color target on WebGL1. Rendering to a HALF_FLOAT_OES texture
    // (via OES_texture_half_float + EXT_color_buffer_half_float) reports FRAMEBUFFER_COMPLETE
    // on some drivers (ANGLE/Metal, SwiftShader) yet silently drops every draw, leaving the
    // post pipeline black. The GL1 path is the legacy/low-quality fallback, so the reduced
    // HDR range of RGBA8 is an acceptable trade for a reliable result.
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._hdrFbo!);
    gl.bindTexture(gl.TEXTURE_2D, this._hdrTexture ?? null);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      this._hdrTexture ?? null,
      0,
    );

    gl.bindRenderbuffer(gl.RENDERBUFFER, this._hdrRenderBuffer ?? null);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_STENCIL, w, h);
    gl.framebufferRenderbuffer(
      gl.FRAMEBUFFER,
      gl.DEPTH_STENCIL_ATTACHMENT,
      gl.RENDERBUFFER,
      this._hdrRenderBuffer ?? null,
    );

    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (0 < w && 0 < h && status !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error(
        `WebGL1Renderer: HDR post-process framebuffer incomplete (status 0x${status.toString(16)}).`,
      );
    }
    this._hdrW = w;
    this._hdrH = h;
  }

  /**
   * Looks up (or lazily creates) the GPU mesh for an object's geometry, and tracks
   * per-object geometry references so `releaseObjectGeometry` can correctly free
   * buffers once nothing references them anymore -- even when geometry is shared
   * across many objects (see apps/showcases/19) or swapped on a live object at runtime.
   */
  private _getOrCreateMesh(obj: Object3D, geo: GeometryDataInterface): Mesh {
    let mesh = this._cache.get(geo);
    if (!mesh) {
      mesh = new Mesh(this.gl, geo);
      this._cache.set(geo, mesh);
    } else if (geo.needsUpdate) {
      mesh.update(geo);
      geo.needsUpdate = false;
    }

    const lastGeo = this._lastKnownGeometry.get(obj);
    if (lastGeo !== geo) {
      if (lastGeo) this._releaseGeometryFor(obj);
      mesh.refCount++;
      this._lastKnownGeometry.set(obj, geo);
    }

    return mesh;
  }

  private _releaseGeometryFor(obj: Object3D): void {
    const geo = this._lastKnownGeometry.get(obj);
    if (!geo) return;
    this._lastKnownGeometry.delete(obj);

    const mesh = this._cache.get(geo);
    if (!mesh) return;
    mesh.refCount--;
    if (mesh.refCount <= 0) {
      mesh.dispose();
      this._cache.delete(geo);
    }
  }

  /**
   * Tracks that `obj` currently depends on the textures in `textures` (typically
   * `material.getRenderManifest().textures`). Called once per object per frame from
   * the render loop. `textures` is diffed key-by-key against `obj`'s last-known
   * snapshot rather than by container reference, since a material's manifest object
   * is created once and mutated in place on every `getRenderManifest()` call.
   */
  private _acquireTextures(
    obj: Object3D,
    textures: Record<string, Texture | CubeTexture | undefined>,
  ): void {
    let lastTextures = this._lastKnownTextures.get(obj);
    if (!lastTextures) {
      lastTextures = {};
      this._lastKnownTextures.set(obj, lastTextures);
    }

    for (const key in textures) {
      const current = textures[key];
      const last = lastTextures[key];
      if (current !== last) {
        if (last) this._releaseTexture(last);
        if (current) this._acquireTexture(current);
        lastTextures[key] = current;
      }
    }
  }

  private _acquireTexture(tex: Texture | CubeTexture): void {
    if (tex instanceof CubeTexture) {
      this._texCubeRefCounts.set(tex, (this._texCubeRefCounts.get(tex) ?? 0) + 1);
    } else {
      this._texRefCounts.set(tex, (this._texRefCounts.get(tex) ?? 0) + 1);
    }
  }

  private _releaseTexture(tex: Texture | CubeTexture): void {
    // Render targets are backed by the same Texture base class (so they can be
    // assigned directly to a material, e.g. for portals/mirrors) but are re-rendered
    // into and reused across frames independently of any one object's material
    // reference -- their lifecycle belongs to whoever owns the render target, not to
    // this per-object refcount. Only untrack our reference to it, never delete the
    // underlying WebGLTexture here.
    if (tex instanceof RenderTarget) return;

    if (tex instanceof CubeTexture) {
      const count = (this._texCubeRefCounts.get(tex) ?? 1) - 1;
      if (count <= 0) {
        const glTex = this._texCubeCache.get(tex);
        if (glTex) this.gl.deleteTexture(glTex);
        this._texCubeCache.delete(tex);
        this._texCubeRefCounts.delete(tex);
      } else {
        this._texCubeRefCounts.set(tex, count);
      }
    } else {
      const count = (this._texRefCounts.get(tex) ?? 1) - 1;
      if (count <= 0) {
        const glTex = this._texCache.get(tex);
        if (glTex) this.gl.deleteTexture(glTex);
        this._texCache.delete(tex);
        this._texRefCounts.delete(tex);
      } else {
        this._texRefCounts.set(tex, count);
      }
    }
  }

  private _releaseObjectTextures(obj: Object3D): void {
    const textures = this._lastKnownTextures.get(obj);
    if (!textures) return;
    this._lastKnownTextures.delete(obj);
    for (const tex of Object.values(textures)) {
      if (tex) this._releaseTexture(tex);
    }
  }

  /** @inheritdoc */
  protected override releaseObjectResources(obj: Object3D): void {
    this._releaseGeometryFor(obj);
    this._releaseObjectProgram(obj);
    this._releaseObjectTextures(obj);
  }

  /** @inheritdoc */
  public override destroy(): void {
    const gl = this.gl;
    if (gl) {
      for (const cache of this._programs.values()) gl.deleteProgram(cache.prog);
      for (const tex of this._texCache.values()) gl.deleteTexture(tex);
      for (const tex of this._texCubeCache.values()) gl.deleteTexture(tex);
      for (const fbo of this._renderTargetFbos.values()) gl.deleteFramebuffer(fbo);
      for (const rb of this._renderTargetDepthBuffers.values()) gl.deleteRenderbuffer(rb);
      for (const mesh of this._cache.values()) mesh.dispose();
      if (this._hdrFbo) gl.deleteFramebuffer(this._hdrFbo);
      if (this._hdrTexture) gl.deleteTexture(this._hdrTexture);
      if (this._hdrRenderBuffer) gl.deleteRenderbuffer(this._hdrRenderBuffer);
      this._postPassGL?.destroy(gl);
      this._bloomPassGL?.destroy();
      this._lightShaftsPassGL?.destroy();
    }

    this._programs.clear();
    this._cache.clear();
    this._texCache.clear();
    this._texCubeCache.clear();
    this._texRefCounts.clear();
    this._texCubeRefCounts.clear();
    this._renderTargetFbos.clear();
    this._renderTargetDepthBuffers.clear();
    this._hdrFbo = undefined;
    this._hdrTexture = undefined;
    this._hdrRenderBuffer = undefined;
    this._postPassGL = undefined;
    this._bloomPassGL = undefined;
    this._lightShaftsPassGL = undefined;

    super.destroy();
  }
}
