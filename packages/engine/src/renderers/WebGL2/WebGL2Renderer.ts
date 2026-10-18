import { WebGL2UniformBuffer } from "./WebGL2UniformBuffer.js";
import type { WebGL2ProgramCacheEntry } from "./managers/WebGLProgramCache.js";
import { WebGLProgramCache } from "./managers/WebGLProgramCache.js";
import { WebGLTextureManager } from "./managers/WebGLTextureManager.js";
import { WebGLBufferManager } from "./managers/WebGLBufferManager.js";
import { WebGL2DepthFrameBuffer } from "./WebGL2DepthFrameBuffer.js";
import { WebGL2FrameBuffer } from "./WebGL2FrameBuffer.js";
import { NORMAL_OUTPUT_FLAG } from "./managers/NormalOutputWrapperGL.js";
import { WebGL2CubeFrameBuffer } from "./WebGL2CubeFrameBuffer.js";
import { AbstractWebGLRenderer } from "../AbstractWebGLRenderer.js";
import { WebGLShadowPass } from "../passes/WebGLShadowPass.js";
import { WebGLMainPass } from "../passes/WebGLMainPass.js";
import { WebGLPostProcessPass } from "../passes/WebGLPostProcessPass.js";
import { WebGLClusterCullPass } from "../passes/WebGLClusterCullPass.js";
import {
  PostProcessPassGL,
  BloomPassGL,
  AOPassGL,
  HistoryBlendPassGL,
  LightShaftsPassGL,
  VolumetricFogPassGL,
} from "../post/passes/index.js";
import type { AbstractLight } from "../../core/lights/index.js";
import { MAX_CLUSTERED_LIGHTS_PER_TYPE } from "../../core/lights/index.js";
import { MAX_AREA_LIGHTS } from "../../core/lights/AreaLight.js";
import { MAX_SKINNED_BONES, isSkinnedMesh } from "../../core/animation/index.js";
import type { CubeTexture, RenderTarget } from "../../core/textures/index.js";
import { Texture, RenderTargetCube } from "../../core/textures/index.js";
import type { RenderManifest } from "../shaders/index.js";
import { resolveManifestFlags } from "../shaders/index.js";
import { Color } from "../../core/colors/index.js";
import type { Object3D, Scene, TextureArray } from "../../core/index.js";
import { DeviceLimit, InstancedMesh, computeClipToBox } from "../../core/index.js";
import { DepthMaterial } from "../../core/materials/index.js";
import type { EngineOptions, LightDataInterface } from "../../interfaces/index.js";
import type { WireframeMode } from "../../enums/index.js";
import {
  BlendingMode,
  CullMode,
  MaterialType,
  RendererType,
  Topology,
  PostProcessingEffectType,
} from "../../enums/index.js";
import type { ClusterGridDims } from "../../math/index.js";
import {
  Vector3D,
  Matrix4,
  computeClusterCounts,
  CLUSTER_TEX_WIDTH,
  CLUSTER_GRID_UNIT,
  CLUSTER_INDEX_UNIT,
  DEFAULT_CLUSTER_TILE_SIZE,
  DEFAULT_CLUSTER_Z_SLICES,
  DEFAULT_MAX_LIGHTS_PER_CLUSTER,
} from "../../math/index.js";

/** Out-of-range clear value (octahedral encodings live in [-1, 1]): "no normal" -- see ADR 0028. */
const NORMAL_TARGET_CLEAR: Float32Array = new Float32Array([-2, -2, 0, 0]);

/**
 * WebGL 2.0 implementation of the renderer.
 */
export class WebGL2Renderer extends AbstractWebGLRenderer {
  /** @inheritdoc */
  public override readonly type: RendererType = RendererType.WEB_GL2;
  declare protected gl: WebGL2RenderingContext;

  /** Compiled-program cache -- see `WebGLProgramCache`'s own doc comment. */
  private _programCache!: WebGLProgramCache;
  /** Uploaded-texture GPU state -- see `WebGLTextureManager`'s own doc comment. */
  private _textures!: WebGLTextureManager;
  /** Per-geometry GPU mesh cache -- see `WebGLBufferManager`'s own doc comment. */
  private _geometry!: WebGLBufferManager;

  private _instanceBuffers: WeakMap<InstancedMesh, WebGLBuffer> = new WeakMap();
  private _instanceDataBuffers: WeakMap<InstancedMesh, WebGLBuffer> = new WeakMap();

  private _scratchFloat4: Float32Array = new Float32Array(4);

  /** Fixed unit for reading the directional shadow map's raw (non-comparison) depth, used by
   * PCSS's blocker-search step. Dedicated texture unit 13 -- reserved like every other
   * shadow unit -- with a dedicated WebGLSampler (`_rawDepthSampler`) that overrides
   * TEXTURE_COMPARE_MODE back to NONE, since that mode is otherwise baked onto the depth
   * texture object itself (see WebGL2DepthFrameBuffer). */
  private static readonly _RAW_DEPTH_UNIT = 13;
  private _rawDepthSampler!: WebGLSampler;

  private _opaqueTexture?: WebGLTexture;
  private _opaqueDepthTexture?: WebGLTexture;
  private _opaqueDepthFbo?: WebGLFramebuffer;
  private _opaqueNormalTexture: WebGLTexture | undefined = undefined;
  private _opaqueNormalFbo: WebGLFramebuffer | undefined = undefined;
  private _opaqueNormalWidth = 0;
  private _opaqueNormalHeight = 0;
  private _opaqueDepthWidth: number = 0;
  private _opaqueDepthHeight: number = 0;
  private static readonly _SPOT_SHADOW_MAP_NAMES: readonly string[] = [
    "u_spotShadowMap[0]",
    "u_spotShadowMap[1]",
    "u_spotShadowMap[2]",
    "u_spotShadowMap[3]",
  ];
  private _opaqueDepthFormat: number = 0;
  /** Whether the last verified blit read from the HDR FBO; `undefined` until a blit was verified. */
  private _opaqueDepthVerifiedHdr: boolean | undefined;
  /** Set when no depth format could be blitted from the default framebuffer. */
  private _opaqueDepthUnsupported: boolean = false;
  protected _hdrFbo: WebGL2FrameBuffer | undefined = undefined;
  /** True while the main pass wants fragment output 1 routed into the normal buffer. */
  private _normalWriteRequested: boolean = false;
  protected _postPassGL: PostProcessPassGL | undefined = undefined;
  protected _bloomPassGL: BloomPassGL | undefined = undefined;
  protected _hbaoPassGL: AOPassGL | undefined = undefined;
  protected _lightShaftsPassGL: LightShaftsPassGL | undefined = undefined;
  protected _volumetricFogPassGL: VolumetricFogPassGL | undefined = undefined;
  protected _taaPassGL: HistoryBlendPassGL | undefined = undefined;
  protected _motionTrailPassGL: HistoryBlendPassGL | undefined = undefined;

  protected _activeRenderTarget: RenderTarget | RenderTargetCube | null = null;
  protected _activeCubeFace: number = 0;
  private _renderTargetFbos: Map<RenderTarget, WebGL2FrameBuffer> = new Map();
  private _renderTargetCubeFbos: Map<RenderTargetCube, WebGL2CubeFrameBuffer> = new Map();

  private _scratchModelMatrix: Float32Array = new Float32Array(16);

  private _globalUBO!: WebGL2UniformBuffer;

  /** Clustered light culling grid state, see docs/adr/0007-clustered-lighting-webgl2-webgpu-only.md.
   * Read (never written) by `WebGLClusterCullPass` via the getters below. */
  private _clusterDims: ClusterGridDims = { x: 1, y: 1, z: 1 };
  public get clusterDims(): ClusterGridDims {
    return this._clusterDims;
  }
  private _clusterMaxLightsPerCluster = 1;
  public get clusterMaxLightsPerCluster(): number {
    return this._clusterMaxLightsPerCluster;
  }
  private _clusterGridTex!: WebGLTexture;
  public get clusterGridTex(): WebGLTexture {
    return this._clusterGridTex;
  }
  private _clusterIndexTex!: WebGLTexture;
  public get clusterIndexTex(): WebGLTexture {
    return this._clusterIndexTex;
  }

  private _stateCullFaceEnabled: boolean | null = null;
  private _stateCullFaceMode: number = -1;
  private _stateBlendEnabled: boolean | null = null;
  private _stateBlendSrc: number = -1;
  private _stateBlendDst: number = -1;
  private _stateDepthMask: boolean | null = null;
  private _stateDepthTest: boolean | null = null;

  private _shadowMaps: Map<AbstractLight, WebGL2DepthFrameBuffer> = new Map();
  private _dummyShadowMap!: WebGL2DepthFrameBuffer;
  /** Scratch: shadow depth textures of the first 4 spot lights for the volumetric fog pass. */
  private readonly _fogSpotShadowTextures: (WebGLTexture | null)[] = [null, null, null, null];

  /**
   * Dedicated black cube fallback for `u_irradianceMap`/`u_prefilterMap` when a scene has no real
   * IBL data. `Standard.frag.glsl`'s PBR chunk detects "no IBL bound" via `length(irradiance) <
   * 0.001` and only then falls back to `u_ambientColor` + a Fresnel-weighted `u_envMap` sample --
   * reusing the generic `defaultCubeTexture` (a visibly-fake placeholder purple, RGB 50/50/100, so
   * missing skyboxes/envMaps are easy to spot) here would make that length check never trip, so the
   * shader would treat the placeholder color as real diffuse+specular lighting data instead.
   */
  private _blackCubeTexture!: WebGLTexture;
  /**
   * Dedicated `u_brdfLUT` fallback: (scale=1, bias=0) in the .rg channels the shader reads, so
   * `specularAmbient` reduces to `prefilteredColor * kS_ambient` with no unintended `+1` bias term.
   * The generic `defaultTexture` (opaque white, RGBA 255/255/255/255) would supply (scale=1,
   * bias=1) instead. Matches `WebGPURenderer._defaultBrdfTexView`'s convention exactly.
   */
  private _defaultBrdfTexture!: WebGLTexture;

  /** Cached once at init instead of re-querying `DeviceCaps` on every texture bind. */
  private _maxTextureUnits: number = 0;
  /** `${uniformName}:${unit}` keys already warned about in `_isTextureUnitAvailable`. */
  private _warnedTextureUnits: Set<string> = new Set();

  /** @inheritdoc */
  public async initialize(
    canvas: HTMLCanvasElement,
    attributes?: Record<string, unknown>,
    config?: EngineOptions,
  ): Promise<void> {
    const gl = canvas.getContext("webgl2", attributes);
    if (!gl) throw new Error("[WebGL2Renderer] WebGL2 context could not be initialized.");
    this.gl = gl as WebGL2RenderingContext;
    this._geometry = new WebGLBufferManager(this.gl);

    if (config?.quality) {
      this._quality = { ...this._quality, ...config.quality };
    }
    this._resolveNormalBufferOption();
    if (config?.postProcessing) {
      this.postProcessing.loadConfig(config.postProcessing);
    }

    this._maxTextureUnits = this.context.deviceCaps.getLimit(
      DeviceLimit.WEBGL2_MAX_TEXTURE_IMAGE_UNITS,
    );

    this._dummyShadowMap = new WebGL2DepthFrameBuffer(this.gl, 1, 1);
    this._dummyShadowMap.bind();
    this.gl.clear(this.gl.DEPTH_BUFFER_BIT);
    this._dummyShadowMap.unbind();

    // Sampler object overriding TEXTURE_COMPARE_MODE to NONE, bound once to a fixed unit so any
    // depth texture bound there afterwards reads as a plain float instead of a 0/1 comparison --
    // sampler objects take precedence over a texture's own parameters for the unit they're bound to.
    this._rawDepthSampler = this.gl.createSampler()!;
    this.gl.samplerParameteri(this._rawDepthSampler, this.gl.TEXTURE_COMPARE_MODE, this.gl.NONE);
    this.gl.samplerParameteri(this._rawDepthSampler, this.gl.TEXTURE_MIN_FILTER, this.gl.NEAREST);
    this.gl.samplerParameteri(this._rawDepthSampler, this.gl.TEXTURE_MAG_FILTER, this.gl.NEAREST);
    this.gl.samplerParameteri(this._rawDepthSampler, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
    this.gl.samplerParameteri(this._rawDepthSampler, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
    this.gl.bindSampler(WebGL2Renderer._RAW_DEPTH_UNIT, this._rawDepthSampler);

    this.gl.pixelStorei(this.gl.UNPACK_FLIP_Y_WEBGL, false);
    this.initDefaultTextures();
    this._textures = new WebGLTextureManager(
      this.gl,
      this._texCache,
      this.defaultTexture,
      this.defaultCubeTexture,
    );
    this._initIblFallbackTextures();
    this.gl.enable(this.gl.DEPTH_TEST);

    // Internal materials the renderer draws by id (shadow/depth), not through a scene object
    this.context.shaderRegistry.ensureProvider(MaterialType.DEPTH, new DepthMaterial());

    // 2112 bytes: GlobalUniforms with std140 layout (u_areaLights[4] 96-byte stride ends at 2080,
    // followed by u_tileSizePx at 2080 and u_clusterDims at 2096) for clustered light culling.
    this._globalUBO = new WebGL2UniformBuffer(this.gl, 2112, 0);
    this._programCache = new WebGLProgramCache(
      this.gl,
      this._globalUBO,
      this.context.shaderRegistry,
    );
    this._allocateClusterTextures({ x: 1, y: 1, z: 1 }, 1);

    // Runs first: WebGLShadowPass's updateGlobalUBO() flushes the whole UBO (including the
    // cluster grid uniforms WebGLClusterCullPass stages below) to the GPU in one call.
    this.addPass(new WebGLClusterCullPass());
    this.addPass(new WebGLShadowPass());
    this.addPass(new WebGLMainPass());
    this.addPass(new WebGLPostProcessPass());
  }

  /**
   * (Re)allocates the WebGL2 clustered-light-culling data textures (RG32UI grid + R32UI index
   * list, per light type) for the given grid size -- see
   * docs/adr/0007-clustered-lighting-webgl2-webgpu-only.md. Laid out on fixed-width 2D textures
   * since WebGL2 has no 1D texture target (`CLUSTER_TEX_WIDTH`, shared with the fragment shader
   * lookup and with `WebGLClusterCullPass`, which writes the actual per-frame data).
   * @param dims Cluster grid dimensions.
   * @param maxLightsPerCluster Maximum number of lights a single cluster cell can reference.
   */
  private _allocateClusterTextures(dims: ClusterGridDims, maxLightsPerCluster: number): void {
    const numClusters = Math.max(1, dims.x * dims.y * dims.z);
    const gridHeight = Math.max(1, Math.ceil(numClusters / CLUSTER_TEX_WIDTH));
    const indexCount = numClusters * Math.max(1, maxLightsPerCluster);
    const indexHeight = Math.max(1, Math.ceil(indexCount / CLUSTER_TEX_WIDTH));

    this._clusterGridTex = this._createIntegerTexture(CLUSTER_TEX_WIDTH, gridHeight, true);
    this._clusterIndexTex = this._createIntegerTexture(CLUSTER_TEX_WIDTH, indexHeight, false);

    this._clusterDims = dims;
    this._clusterMaxLightsPerCluster = Math.max(1, maxLightsPerCluster);
  }

  /**
   * Creates an integer 2D texture for clustered light culling data -- RGBA32UI (point.rg, spot.ba) for
   * the combined grid texture, RG32UI (point.r, spot.g) for the combined flat index list.
   */
  private _createIntegerTexture(width: number, height: number, isGrid: boolean): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      isGrid ? gl.RGBA32UI : gl.RG32UI,
      width,
      height,
      0,
      isGrid ? gl.RGBA_INTEGER : gl.RG_INTEGER,
      gl.UNSIGNED_INT,
      null,
    );
    gl.bindTexture(gl.TEXTURE_2D, null);
    return tex;
  }

  /**
   * Stages the clustered light culling grid metadata into the (not-yet-uploaded) global UBO --
   * see docs/adr/0007-clustered-lighting-webgl2-webgpu-only.md. Actual GPU upload happens via
   * `updateGlobalUBO()`'s trailing `_globalUBO.update()`, called right after this in the same
   * frame (`WebGLClusterCullPass` runs before `WebGLShadowPass` in `_passes`).
   * @param tileSizePx Screen-space tile size in pixels, [width, height].
   */
  public writeClusterGridUniforms(tileSizePx: [number, number]): void {
    this._globalUBO.setVec2(2080, tileSizePx[0], tileSizePx[1]);
    this._globalUBO.setFloat(2096, this._clusterDims.x);
    this._globalUBO.setFloat(2100, this._clusterDims.y);
    this._globalUBO.setFloat(2104, this._clusterDims.z);
    this._globalUBO.setFloat(2108, this._clusterMaxLightsPerCluster);
  }

  /** Builds the black cube / (scale=1, bias=0) fallbacks used when a scene has no real IBL data. */
  private _initIblFallbackTextures(): void {
    this._blackCubeTexture = this.gl.createTexture()!;
    this.gl.bindTexture(this.gl.TEXTURE_CUBE_MAP, this._blackCubeTexture);
    for (let i: number = 0; 6 > i; i++) {
      this.gl.texImage2D(
        this.gl.TEXTURE_CUBE_MAP_POSITIVE_X + i,
        0,
        this.gl.RGBA,
        1,
        1,
        0,
        this.gl.RGBA,
        this.gl.UNSIGNED_BYTE,
        new Uint8Array([0, 0, 0, 255]),
      );
    }

    this._defaultBrdfTexture = this.gl.createTexture()!;
    this.gl.bindTexture(this.gl.TEXTURE_2D, this._defaultBrdfTexture);
    this.gl.texImage2D(
      this.gl.TEXTURE_2D,
      0,
      this.gl.RGBA,
      1,
      1,
      0,
      this.gl.RGBA,
      this.gl.UNSIGNED_BYTE,
      new Uint8Array([255, 0, 0, 255]),
    );
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.NEAREST);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.NEAREST);
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

  /**
   * Whether `unit` is within the device's texture-unit budget. Centralizes the "not enough
   * units" check + warning so every optional-texture bind site (per-object samplers, global IBL
   * maps) degrades the same way instead of duplicating the comparison ad hoc -- easy to forget
   * at a new call site otherwise, since exceeding the budget doesn't throw, it silently defaults
   * the sampler to unit 0 and can collide with an unrelated, differently-typed sampler there.
   */
  private _isTextureUnitAvailable(unit: number, uniformName: string): boolean {
    if (unit < this._maxTextureUnits) return true;
    // Warn once per (uniform, unit) instead of every draw call -- this triggers every frame for
    // every affected object once a shader's live sampler count exceeds the device budget, and an
    // unthrottled console.warn at that frequency floods the console and costs real time.
    const warnKey = `${uniformName}:${unit}`;
    if (!this._warnedTextureUnits.has(warnKey)) {
      this._warnedTextureUnits.add(warnKey);
      console.warn(
        `[WebGL2Renderer] Exceeded MAX_TEXTURE_IMAGE_UNITS (${this._maxTextureUnits}). Cannot bind material texture ${uniformName} to unit ${unit}.`,
      );
    }
    return false;
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

  /** @inheritdoc */
  public override get hasNormalTarget(): boolean {
    return (
      !this._activeRenderTarget &&
      this.postProcessing.enabled &&
      this._hdrFbo?.secondaryTexture !== undefined
    );
  }

  /** The normal buffer texture (ADR 0028), or undefined while it is not being written. */
  public get normalTexture(): WebGLTexture | undefined {
    return this.hasNormalTarget ? this._hdrFbo!.secondaryTexture : undefined;
  }

  private readonly _scratchClipToBox: Matrix4 = new Matrix4();

  /** Decal-only per-object uniforms: clip -> box matrix and whether the normal buffer copy is bound. */
  private _setDecalUniforms(u: Map<string, WebGLUniformLocation | undefined>, o: Object3D): void {
    const uClipToBox = u.get("u_decalClipToBox");
    if (
      uClipToBox &&
      computeClipToBox(o.worldMatrix, this._frameInvViewProj, this._scratchClipToBox)
    ) {
      this.gl.uniformMatrix4fv(uClipToBox, false, this._scratchClipToBox.data);
    }
    const uHasNormals = u.get("u_decalHasNormalBuffer");
    if (uHasNormals) {
      this.gl.uniform1f(uHasNormals, this._opaqueNormalTexture && this.hasNormalTarget ? 1 : 0);
    }
  }

  /** @inheritdoc */
  public override get canDrawDecals(): boolean {
    return null === this._activeRenderTarget;
  }

  /**
   * Copies the normal buffer (COLOR_ATTACHMENT1 of the HDR framebuffer) into a texture decals can
   * sample: reading it while it is still attached to the bound framebuffer would be a feedback loop.
   */
  public override copyToOpaqueNormalTexture(): void {
    const gl = this.gl;
    const hdr = this._hdrFbo;
    if (!this.hasNormalTarget || !hdr?.secondaryTexture) return;

    const w = gl.canvas.width;
    const h = gl.canvas.height;
    if (!this._opaqueNormalTexture) {
      this._opaqueNormalTexture = gl.createTexture()!;
      this._opaqueNormalFbo = gl.createFramebuffer()!;
    }
    if (this._opaqueNormalWidth !== w || this._opaqueNormalHeight !== h) {
      gl.bindTexture(gl.TEXTURE_2D, this._opaqueNormalTexture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG16F, w, h, 0, gl.RG, gl.HALF_FLOAT, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this._opaqueNormalFbo!);
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        this._opaqueNormalTexture,
        0,
      );
      this._opaqueNormalWidth = w;
      this._opaqueNormalHeight = h;
    }

    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, hdr.framebuffer);
    gl.readBuffer(gl.COLOR_ATTACHMENT1);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this._opaqueNormalFbo!);
    gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, hdr.framebuffer);
    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    hdr.bind();
  }

  /** @inheritdoc */
  public override setNormalWriteEnabled(enabled: boolean): void {
    this._normalWriteRequested = enabled;
    this._hdrFbo?.setSecondaryWriteEnabled(enabled);
  }

  /** @inheritdoc */
  public override clearNormalTarget(): void {
    const fbo = this._hdrFbo;
    if (!fbo?.secondaryTexture) return;
    fbo.setSecondaryWriteEnabled(true);
    this.gl.clearBufferfv(this.gl.COLOR, 1, NORMAL_TARGET_CLEAR);
    fbo.setSecondaryWriteEnabled(false);
  }

  public bindMainRenderTarget(): boolean {
    let isOffscreen = false;
    this._ensurePostProcessFbo();
    this._warnIfNormalBufferUnavailable();

    if (this._activeRenderTarget) {
      isOffscreen = true;
      if (this._activeRenderTarget instanceof RenderTargetCube) {
        let fbo = this._renderTargetCubeFbos.get(this._activeRenderTarget);
        if (!fbo || !this._activeRenderTarget.isLoaded) {
          if (fbo) fbo.destroy();
          fbo = new WebGL2CubeFrameBuffer(this.gl, {
            width: this._activeRenderTarget.width,
            height: this._activeRenderTarget.height,
            format: this.gl.RGBA,
            internalFormat: this.gl.RGBA8,
            type: this.gl.UNSIGNED_BYTE,
          });
          this._renderTargetCubeFbos.set(this._activeRenderTarget, fbo);
          this._textures.registerCubeTexture(this._activeRenderTarget, fbo.texture);
          this._activeRenderTarget.isLoaded = true;
        }
        fbo.bindFace(this._activeCubeFace);
      } else {
        let fbo = this._renderTargetFbos.get(this._activeRenderTarget);
        if (!fbo || !this._activeRenderTarget.isLoaded) {
          if (fbo) fbo.destroy();
          fbo = new WebGL2FrameBuffer(this.gl, {
            width: this._activeRenderTarget.width,
            height: this._activeRenderTarget.height,
            format: this.gl.RGBA,
            internalFormat: this.gl.RGBA8,
            type: this.gl.UNSIGNED_BYTE,
          });

          this._renderTargetFbos.set(this._activeRenderTarget, fbo);
          this._textures.registerTexture(this._activeRenderTarget, fbo.texture);
          this._activeRenderTarget.isLoaded = true;
        }
        fbo.bind();
        this.gl.viewport(0, 0, this._activeRenderTarget.width, this._activeRenderTarget.height);
      }
    } else if (this.postProcessing.enabled && this._hdrFbo) {
      this._hdrFbo.bind();
      this.gl.viewport(0, 0, this.gl.canvas.width, this.gl.canvas.height);
    } else {
      this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
      this.gl.viewport(0, 0, this.gl.canvas.width, this.gl.canvas.height);
    }

    return isOffscreen;
  }

  public bindPostProcessRenderTarget(): void {
    // FBO is already bound in bindMainRenderTarget if needed, handled implicitly for now
  }

  public copyToOpaqueTexture(): void {
    const isHdr = this.postProcessing.enabled && this._hdrFbo;
    const internalFormat = isHdr ? this._hdrFbo!.internalFormat : this.gl.RGBA8;

    if (!this._opaqueTexture) {
      const tex = this.gl.createTexture();
      this.gl.bindTexture(this.gl.TEXTURE_2D, tex);
      this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.NEAREST);
      this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.NEAREST);
      this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
      this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
      this._opaqueTexture = tex!;

      const dummyTex = Texture.empty();
      dummyTex.isLoaded = true;
      this._textures.registerTexture(dummyTex, tex!);
    } else {
      this.gl.bindTexture(this.gl.TEXTURE_2D, this._opaqueTexture);
    }

    this.gl.copyTexImage2D(
      this.gl.TEXTURE_2D,
      0,
      internalFormat,
      0,
      0,
      this.gl.canvas.width,
      this.gl.canvas.height,
      0,
    );
  }

  /**
   * Captures the opaque depth buffer into a sampleable texture, for underwater/refraction/
   * absorption depth effects (e.g. `OpenWaterMaterial`, `FluidSurfaceMaterial`).
   * `blitFramebuffer` requires the capture texture's depth format to match the source's exactly:
   * with an HDR FBO that is `DEPTH24_STENCIL8`. The default framebuffer's real depth format is
   * implementation-defined (and its reported bit counts are not a reliable guide), so without
   * post-processing the first capture probes the candidate formats until a blit succeeds.
   */
  public copyToOpaqueDepthTexture(): void {
    const gl = this.gl;
    const hdr = this.postProcessing.enabled ? this._hdrFbo : undefined;
    // Offscreen targets (probes, planar reflections) have their own depth attachment -- no capture.
    if (!hdr && (null !== this._activeRenderTarget || this._opaqueDepthUnsupported)) return;

    const w = gl.canvas.width;
    const h = gl.canvas.height;
    const candidates = hdr
      ? [gl.DEPTH24_STENCIL8]
      : this._opaqueDepthFormat !== 0
        ? [this._opaqueDepthFormat]
        : [gl.DEPTH24_STENCIL8, gl.DEPTH_COMPONENT24, gl.DEPTH_COMPONENT32F, gl.DEPTH_COMPONENT16];

    if (!this._opaqueDepthTexture) {
      this._opaqueDepthTexture = gl.createTexture()!;
      this._opaqueDepthFbo = gl.createFramebuffer()!;
    }

    let captured = false;
    for (const internalFormat of candidates) {
      let allocated = false;
      if (
        this._opaqueDepthWidth !== w ||
        this._opaqueDepthHeight !== h ||
        this._opaqueDepthFormat !== internalFormat
      ) {
        this._allocateOpaqueDepth(internalFormat, w, h);
        allocated = true;
      }

      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, hdr ? hdr.framebuffer : null);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this._opaqueDepthFbo!);
      // Whether a blit works depends only on the source/target depth formats, so once verified it
      // is not probed again: `getError` is a CPU/GPU sync point and cost ~75% of the frame's JS time.
      if (!allocated && this._opaqueDepthVerifiedHdr === !!hdr) {
        gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.DEPTH_BUFFER_BIT, gl.NEAREST);
        captured = true;
        break;
      }
      // Drain stale errors so the blit's own result is unambiguous (bounded: a lost context
      // reports CONTEXT_LOST_WEBGL forever, which would otherwise never leave this loop).
      for (let drained = 0; drained < 8 && gl.NO_ERROR !== gl.getError(); drained++);
      gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.DEPTH_BUFFER_BIT, gl.NEAREST);
      if (gl.NO_ERROR === gl.getError()) {
        this._opaqueDepthVerifiedHdr = !!hdr;
        captured = true;
        break;
      }
    }
    if (!captured) {
      // Sticky on purpose: every candidate format failed, so retrying each frame would only spam
      // GL errors. This renderer has no context-restore path that could invalidate the verdict.
      this._opaqueDepthUnsupported = true;
      this._opaqueDepthFormat = 0;
      this._opaqueDepthVerifiedHdr = undefined;
    }

    if (hdr) hdr.bind();
    else gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /** (Re)allocates the opaque depth capture texture in `internalFormat` and attaches it. */
  private _allocateOpaqueDepth(internalFormat: number, w: number, h: number): void {
    const gl = this.gl;
    const hasStencil =
      internalFormat === gl.DEPTH24_STENCIL8 || internalFormat === gl.DEPTH32F_STENCIL8;
    const format = hasStencil ? gl.DEPTH_STENCIL : gl.DEPTH_COMPONENT;
    let type: number = gl.UNSIGNED_INT_24_8;
    if (!hasStencil) {
      if (internalFormat === gl.DEPTH_COMPONENT16) type = gl.UNSIGNED_SHORT;
      else if (internalFormat === gl.DEPTH_COMPONENT32F) type = gl.FLOAT;
      else type = gl.UNSIGNED_INT;
    }

    gl.bindTexture(gl.TEXTURE_2D, this._opaqueDepthTexture!);
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, format, type, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this._opaqueDepthFbo!);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_STENCIL_ATTACHMENT, gl.TEXTURE_2D, null, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, null, 0);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      hasStencil ? gl.DEPTH_STENCIL_ATTACHMENT : gl.DEPTH_ATTACHMENT,
      gl.TEXTURE_2D,
      this._opaqueDepthTexture!,
      0,
    );

    this._opaqueDepthWidth = w;
    this._opaqueDepthHeight = h;
    this._opaqueDepthFormat = internalFormat;
  }

  /** Shadow depth textures of the first 4 spot lights (null = no shadow), the slots the fog samples. */
  private _collectFogSpotShadowTextures(): readonly (WebGLTexture | null)[] {
    const spots = this._frameLights?.sLights ?? [];
    for (let i = 0; i < 4; i++) {
      const light = spots[i];
      this._fogSpotShadowTextures[i] =
        light !== undefined && light.castShadow && light.shadowCamera !== undefined
          ? (this._shadowMaps.get(light)?.texture ?? null)
          : null;
    }
    return this._fogSpotShadowTextures;
  }

  public flushPostProcess(): void {
    const isOffscreen = this._activeRenderTarget !== null;
    if (!isOffscreen && this.postProcessing.enabled && this._hdrFbo && this._postPassGL) {
      // TAA resolves first, if enabled: everything downstream (Bloom, HBAO, the final uber
      // pass) should react to the temporally-smoothed color, not the raw per-frame jittered one.
      let colorTex: WebGLTexture = this._hdrFbo.texture;
      if (this._taaPassGL) {
        const taaNode = this.postProcessing.get<import("../post/index.js").TaaElement>(
          PostProcessingEffectType.TAA,
        );
        if (taaNode && taaNode.enabled) {
          const resolved = this._taaPassGL.execute(
            colorTex,
            this.gl.canvas.width,
            this.gl.canvas.height,
            taaNode,
          );
          if (resolved) colorTex = resolved;
        }
      }

      // Motion Trail: a deliberate ghost/afterimage look, not anti-aliasing -- reuses the same
      // history-blend pass as TAA (its own separate instance/history buffer), chained after TAA
      // so both can be combined if ever wanted, though typically only one is enabled at a time.
      if (this._motionTrailPassGL) {
        const trailNode = this.postProcessing.get<import("../post/index.js").MotionTrailElement>(
          PostProcessingEffectType.MOTION_TRAIL,
        );
        if (trailNode && trailNode.enabled) {
          const resolved = this._motionTrailPassGL.execute(
            colorTex,
            this.gl.canvas.width,
            this.gl.canvas.height,
            trailNode,
          );
          if (resolved) colorTex = resolved;
        }
      }

      let bloomTex: WebGLTexture | null = null;
      if (this._bloomPassGL) {
        const bloomNode = this.postProcessing.get<import("../post/index.js").BloomElement>(
          PostProcessingEffectType.BLOOM,
        );
        if (bloomNode && bloomNode.enabled) {
          bloomTex = this._bloomPassGL.execute(
            colorTex,
            this.gl.canvas.width,
            this.gl.canvas.height,
            bloomNode,
          );
        }
      }

      let hbaoTex: WebGLTexture | null = null;
      if (this._hbaoPassGL && this._opaqueDepthTexture && this._frameProjMatrix) {
        const hbaoNode = this.postProcessing.get<import("../post/index.js").HbaoElement>(
          PostProcessingEffectType.HBAO,
        );
        if (hbaoNode && hbaoNode.enabled) {
          hbaoTex = this._hbaoPassGL.execute(
            this._opaqueDepthTexture,
            this.gl.canvas.width,
            this.gl.canvas.height,
            this._frameNear,
            this._frameFar,
            this._frameProjMatrix,
            hbaoNode,
          );
        }
      }

      let lightShaftsTex: WebGLTexture | null = null;
      if (this._lightShaftsPassGL && this._frameLights?.dLight) {
        const shaftsNode = this.postProcessing.get<import("../post/index.js").LightShaftsElement>(
          PostProcessingEffectType.LIGHT_SHAFTS,
        );
        if (shaftsNode && shaftsNode.enabled && this._opaqueDepthTexture) {
          const dLight = this._frameLights.dLight;
          const shadowFbo = this._shadowMaps.get(dLight);
          lightShaftsTex = this._lightShaftsPassGL.execute(
            this._opaqueDepthTexture,
            colorTex,
            this.gl.canvas.width,
            this.gl.canvas.height,
            this._frameViewProj.data,
            this._frameCamPos,
            dLight,
            shadowFbo?.texture ?? null,
            shaftsNode,
          );
        }
      }

      let volumetricFogTex: WebGLTexture | null = null;
      if (this._volumetricFogPassGL) {
        const volFogNode = this.postProcessing.get<import("../post/index.js").VolumetricFogElement>(
          PostProcessingEffectType.VOLUMETRIC_FOG,
        );
        if (volFogNode && volFogNode.enabled && this._opaqueDepthTexture) {
          const dLight = this._frameLights?.dLight;
          const shadowFbo = dLight ? this._shadowMaps.get(dLight) : undefined;
          volumetricFogTex = this._volumetricFogPassGL.execute(
            this._opaqueDepthTexture,
            this.gl.canvas.width,
            this.gl.canvas.height,
            this._frameViewProj.data,
            this._frameCamPos,
            this._frameNear,
            this._frameFar,
            dLight,
            shadowFbo?.texture ?? null,
            volFogNode,
            this._fogVolumes,
            this.frameInfo.time,
            this._frameLights?.aCol,
            this._frameLights?.aIntensity,
            this._frameScene?.irradianceMap
              ? this._textures.getWebGLCubeTexture(this._frameScene.irradianceMap, this._quality)
              : this._blackCubeTexture,
            this._frameScene?.environmentIntensity ?? 0,
            this._frameLights?.pLights ?? [],
            this._frameLights?.sLights ?? [],
            this._collectFogSpotShadowTextures(),
            this._dummyShadowMap.texture,
          );
        }
      }

      this._postPassGL.execute(
        this.gl,
        colorTex,
        this.postProcessing,
        bloomTex,
        hbaoTex,
        lightShaftsTex,
        volumetricFogTex,
        this.frameInfo.realTime,
      );
    }
  }

  /**
   * Renders shadow maps for all shadow-casting lights.
   */
  public renderShadowMaps(
    lights: import("../../interfaces/index.js").LightDataInterface,
    sortedGroups: import("../../core/Scene.js").RenderBatch[],
  ): void {
    const emptyLights: LightDataInterface = {
      aCol: new Color(0, 0, 0, 1),
      aIntensity: 0,
      dCol: new Color(0, 0, 0, 1),
      dDir: Vector3D.ZERO,
      dIntensity: 0,
      aLights: [],
      pLights: [],
      sLights: [],
    };

    // SpotLights
    for (const light of lights.sLights) {
      if (!light.castShadow) continue;
      // Creates the shadow camera on first use (castShadow may be switched on after construction)
      // and keeps it on the light, as SpotShadowPassGPU does for WebGPU.
      light.updateShadowCamera();
      const shadowCamera = light.shadowCamera;
      if (!shadowCamera) continue;

      let fbo = this._shadowMaps.get(light);
      if (!fbo) {
        fbo = new WebGL2DepthFrameBuffer(this.gl, light.shadowResolution, light.shadowResolution);
        this._shadowMaps.set(light, fbo);
      } else {
        fbo.resize(light.shadowResolution, light.shadowResolution);
      }

      fbo.bind();
      this.gl.depthMask(true);
      this.gl.clear(this.gl.DEPTH_BUFFER_BIT);

      // Update Global UBO with light's camera
      this.updateGlobalUBO(shadowCamera.viewProjectionMatrix, shadowCamera.position, emptyLights);

      // Keep FRONT culling enabled for the shadow pass to prevent shadow acne!
      this.gl.enable(this.gl.CULL_FACE);
      this.gl.cullFace(this.gl.FRONT);
      this.gl.enable(this.gl.DEPTH_TEST);
      this.gl.disable(this.gl.BLEND);

      const cache = this._programCache.getProgram(MaterialType.DEPTH);
      this.gl.useProgram(cache.prog);

      this._renderShadowScene(cache, sortedGroups);

      this.gl.cullFace(this.gl.BACK);
      fbo.unbind();
    }

    // DirectionalLight (CSM Atlas)
    if (lights.dLight && lights.dLight.castShadow && lights.dLight.numCascades > 0) {
      const light = lights.dLight;
      const res = light.shadowResolution;

      // Arrange cascades in a square grid (e.g. 2x2 for 4 cascades)
      const cols = Math.ceil(Math.sqrt(light.numCascades));
      const rows = Math.ceil(light.numCascades / cols);
      const atlasWidth = cols * res;
      const atlasHeight = rows * res;

      let fbo = this._shadowMaps.get(light);
      if (!fbo) {
        fbo = new WebGL2DepthFrameBuffer(this.gl, atlasWidth, atlasHeight);
        this._shadowMaps.set(light, fbo);
      } else {
        fbo.resize(atlasWidth, atlasHeight);
      }

      fbo.bind(); // This sets viewport to full atlas, we'll overwrite it per cascade
      this.gl.depthMask(true);
      this.gl.clear(this.gl.DEPTH_BUFFER_BIT);

      this.gl.enable(this.gl.CULL_FACE);
      this.gl.cullFace(this.gl.FRONT);
      this.gl.enable(this.gl.DEPTH_TEST);
      this.gl.disable(this.gl.BLEND);

      const cache = this._programCache.getProgram(MaterialType.DEPTH);
      this.gl.useProgram(cache.prog);
      this._bindDummyShadowMaps(cache);

      for (let i = 0; i < light.numCascades; i++) {
        const cascadeCam = light.cascadeCameras[i];
        if (!cascadeCam) continue;

        // Set viewport to the quadrant for this cascade
        const col = i % cols;
        const row = Math.floor(i / cols);
        this.gl.viewport(col * res, row * res, res, res);

        this.updateGlobalUBO(cascadeCam.viewProjectionMatrix, cascadeCam.position, emptyLights);

        this._renderShadowScene(cache, sortedGroups);
      }

      this.gl.cullFace(this.gl.BACK);
      fbo.unbind();
    }
  }

  /**
   * Helper to render the actual geometry for a shadow pass.
   */
  private _renderShadowScene(
    cache: WebGL2ProgramCacheEntry,
    sortedGroups: import("../../core/Scene.js").RenderBatch[],
  ): void {
    for (let i = 0; i < sortedGroups.length; i++) {
      const batch = sortedGroups[i];
      if (batch!.shaderId === MaterialType.SKYBOX || batch!.objects.length === 0) continue;

      const drawMode = batch!.topology === Topology.LINE_LIST ? this.gl.LINES : this.gl.TRIANGLES;
      const objects = batch!.objects;
      const firstObj = objects[0]!;
      if (!firstObj.material) continue;

      const manifest = firstObj.material.getRenderManifest();
      const uExtraLoc = cache.uniforms.get("u_extraParams");
      const extraParams = manifest.properties["u_extraParams"] as Float32Array | number[];

      let hasAlpha = false;
      if (extraParams && extraParams[1]! > 0.0 && manifest.textures["u_diffuseMap"]) {
        hasAlpha = true;
        this.gl.activeTexture(this.gl.TEXTURE0);
        const tex = manifest.textures["u_diffuseMap"] as Texture;
        this.gl.bindTexture(this.gl.TEXTURE_2D, this._textures.getWebGLTexture(tex, this._quality));
        const uDiffuseLoc = cache.uniforms.get("u_diffuseMap");
        if (uDiffuseLoc) this.gl.uniform1i(uDiffuseLoc, 0);

        if (uExtraLoc) {
          this.gl.uniform4fv(uExtraLoc, extraParams as Float32Array);
        }
      }

      if (!hasAlpha && uExtraLoc) {
        this.gl.uniform4fv(uExtraLoc, new Float32Array([0, 0, 0, 0]));
      }

      for (const o of objects) {
        if (!o.castShadow || !o.geometry) continue;

        // NOTE: This pass deliberately does NOT acquireProgram() the DEPTH program per object.
        // The DEPTH program is renderer-infrastructure (fixed cascade/spot variants, already
        // compiled via getProgram above), not a per-object resource. Acquiring it here would
        // overwrite each caster's `_lastKnownProgramKey` with the DEPTH key, forcing the
        // standard pass to release-and-reacquire the object's real material key every frame --
        // and when the object is the last holder of that material program, the shared program
        // is DELETED and RECOMPILED each frame (the "shader churn" stutter). Leaves the DEPTH
        // program resident across the session like any other infrastructure resource.
        this._textures.acquireTextures(o, manifest.textures);

        this._scratchModelMatrix.set(o.worldMatrix.data);
        const uModel = cache.uniforms.get("u_model");
        if (uModel) this.gl.uniformMatrix4fv(uModel, false, this._scratchModelMatrix);

        const mesh = this._geometry.getOrCreateMesh(o, o.geometry);

        if (mesh.vaoCapable) {
          mesh.bindVAO();
        } else {
          mesh.bind(
            cache.attributes.get("a_position")!,
            cache.attributes.get("a_normal")!,
            cache.attributes.get("a_uv")!,
            cache.attributes.get("a_tangent")!,
            -1,
            -1,
            cache.attributes.get("a_color")!,
          );
        }
        mesh.draw(drawMode, batch!.wireframeMode);
      }
    }
  }

  /**
   * Binds dummy depth textures to shadow samplers to satisfy WebGL2 sampler2DShadow validation rules.
   */
  private _bindDummyShadowMaps(cache: WebGL2ProgramCacheEntry): void {
    const dummyUnit = 12;
    const maxUnits = this.context.deviceCaps.getLimit(DeviceLimit.WEBGL2_MAX_TEXTURE_IMAGE_UNITS);
    if (dummyUnit >= maxUnits) {
      console.warn(`[WebGL2Renderer] dummyUnit ${dummyUnit} >= maxUnits ${maxUnits}`);
      return;
    }

    this.gl.activeTexture(this.gl.TEXTURE0 + dummyUnit);
    this.gl.bindTexture(this.gl.TEXTURE_2D, this._dummyShadowMap.texture);

    const dirMapLoc = this._cachedUniformLocation(cache, "u_dirShadowMap");
    if (dirMapLoc) this.gl.uniform1i(dirMapLoc, dummyUnit);

    const dirMapRawLoc = this._cachedUniformLocation(cache, "u_dirShadowMapRaw");
    if (dirMapRawLoc) {
      this.gl.activeTexture(this.gl.TEXTURE0 + WebGL2Renderer._RAW_DEPTH_UNIT);
      this.gl.bindTexture(this.gl.TEXTURE_2D, this._dummyShadowMap.texture);
      this.gl.uniform1i(dirMapRawLoc, WebGL2Renderer._RAW_DEPTH_UNIT);
    }

    for (let i = 0; i < 4; i++) {
      const loc = this._cachedUniformLocation(cache, WebGL2Renderer._SPOT_SHADOW_MAP_NAMES[i]!);
      if (loc) this.gl.uniform1i(loc, dummyUnit);
    }
  }

  /**
   * Uniform location lookup that also caches misses: a program without the uniform would
   * otherwise hit the driver with `getUniformLocation` on every draw.
   */
  private _cachedUniformLocation(
    cache: WebGL2ProgramCacheEntry,
    name: string,
  ): WebGLUniformLocation | undefined {
    if (!cache.uniforms.has(name)) {
      cache.uniforms.set(name, this.gl.getUniformLocation(cache.prog, name) ?? undefined);
    }
    return cache.uniforms.get(name);
  }

  public renderBatch(
    batch: import("../../core/Scene.js").RenderBatch,
    vMat: Float32Array | undefined,
    _vp: Float32Array,
    _camPos: Vector3D,
    lights: import("../../interfaces/index.js").LightDataInterface,
    scene: Scene,
  ): void {
    const objects = batch!.objects;
    if (objects.length === 0) return;

    const instancedObjects: Object3D[] = [];
    const standardObjects: Object3D[] = [];

    for (let i = 0; i < objects.length; i++) {
      const o = objects[i];
      if (o instanceof InstancedMesh) {
        instancedObjects.push(o!);
      } else {
        standardObjects.push(o!);
      }
    }

    const firstObj = objects[0]!;
    const mat = firstObj.material!;
    const manifest = mat.getRenderManifest();

    const topo = batch!.topology;

    if (standardObjects.length > 0) {
      this._renderSubgroup(
        batch!.shaderId,
        standardObjects,
        false,
        manifest,
        vMat,
        topo,
        lights,
        scene,
        batch!.wireframeMode,
      );
    }

    if (instancedObjects.length > 0) {
      this._renderSubgroup(
        batch!.shaderId,
        instancedObjects,
        true,
        manifest,
        vMat,
        topo,
        lights,
        scene,
        batch!.wireframeMode,
      );
    }
  }

  private _renderSubgroup(
    shaderId: string,
    objects: Object3D[],
    isInstanced: boolean,
    manifest: RenderManifest,
    vMat?: Float32Array,
    topology: Topology = Topology.DEFAULT,
    lights?: LightDataInterface,
    scene?: Scene,
    wireframeMode?: WireframeMode,
  ): void {
    // --- 3. Build & Bind Shader ---
    const isInst =
      "instanceCount" in objects[0]! && (objects[0] as InstancedMesh).instanceCount > 0;
    const shaderFlags = manifest.flags
      ? [...(resolveManifestFlags(manifest.flags, this._quality.disableTextures) ?? [])]
      : [];

    if (
      objects[0] &&
      ((isSkinnedMesh(objects[0]) && objects[0].skeleton) || objects[0].geometry?.joints)
    ) {
      if (!shaderFlags.includes("USE_SKINNING")) {
        shaderFlags.push("USE_SKINNING");
      }
    }

    if (scene?.irradianceMap || scene?.prefilterMap) {
      if (!shaderFlags.includes("USE_IBL")) {
        shaderFlags.push("USE_IBL");
      }
    }

    // Check if texture array is used
    if (manifest.textures) {
      for (const tex of Object.values(manifest.textures)) {
        if (tex && "isTextureArray" in tex && (tex as TextureArray).isTextureArray) {
          if (!shaderFlags.includes("USE_TEXTURE_ARRAY")) {
            shaderFlags.push("USE_TEXTURE_ARRAY");
          }
          break;
        }
      }
    }

    if (this._quality.normalBuffer) shaderFlags.push(NORMAL_OUTPUT_FLAG);

    // Per-instance RGBA color (e.g. particle tint) is a mesh opt-in so the generic `instanceData`
    // semantics (texture-array index) stay untouched for other meshes: only an instanced mesh
    // explicitly requesting it gets the `USE_INSTANCE_COLOR` variant compiled in.
    if (isInst && objects[0] instanceof InstancedMesh && objects[0].useInstanceDataAsColor) {
      shaderFlags.push("USE_INSTANCE_COLOR");
    }

    const cache = this._programCache.getProgram(manifest.shaderId, isInst, shaderFlags);
    const programKey = this._programCache.programCacheKey(manifest.shaderId, isInst, shaderFlags);
    this.gl.useProgram(cache.prog);
    // A program the normal wrapper could not rewrite has no output 1; routing the draw buffer to
    // it would write undefined values into the normal buffer.
    if (this._normalWriteRequested) {
      this._hdrFbo?.setSecondaryWriteEnabled(cache.writesNormalOutput);
    }

    this._bindDummyShadowMaps(cache);

    // Clustered light culling textures -- always bound at these fixed units by
    // WebGLClusterCullPass (once per frame, before this pass runs); each program just needs to
    // know which unit its sampler uniform reads from, see
    // docs/adr/0007-clustered-lighting-webgl2-webgpu-only.md.
    const clusterGridLoc = cache.uniforms.get("u_clusterGrid");
    if (clusterGridLoc) this.gl.uniform1i(clusterGridLoc, CLUSTER_GRID_UNIT);
    const clusterIndexLoc = cache.uniforms.get("u_clusterIndices");
    if (clusterIndexLoc) this.gl.uniform1i(clusterIndexLoc, CLUSTER_INDEX_UNIT);

    // Bind Shadow Maps
    if (lights && lights.sLights.length > 0) {
      for (let i = 0; i < 4; i++) {
        if (i >= lights.sLights.length) break;
        const light = lights.sLights[i]!;
        const mapLoc = cache.uniforms.get(`u_spotShadowMap[${i}]`);
        const matLoc = cache.uniforms.get(`u_spotShadowMatrix[${i}]`);
        const infoLoc = cache.uniforms.get(`u_spotShadowInfo[${i}]`);

        if (light.castShadow && light.shadowCamera) {
          const fbo = this._shadowMaps.get(light);
          if (fbo && fbo.texture) {
            const texUnit = 8 + i; // TEXTURE8 to TEXTURE11
            const maxUnits = this.context.deviceCaps.getLimit(
              DeviceLimit.WEBGL2_MAX_TEXTURE_IMAGE_UNITS,
            );
            if (texUnit >= maxUnits) {
              console.warn(
                `[WebGL2Renderer] Exceeded MAX_TEXTURE_IMAGE_UNITS (${maxUnits}). Cannot bind spot shadow map to texture unit ${texUnit}.`,
              );
            } else {
              this.gl.activeTexture(this.gl.TEXTURE0 + texUnit);
              this.gl.bindTexture(this.gl.TEXTURE_2D, fbo.texture);
              if (mapLoc) this.gl.uniform1i(mapLoc, texUnit);
              if (matLoc)
                this.gl.uniformMatrix4fv(matLoc, false, light.shadowCamera.viewProjectionMatrix);
              if (infoLoc) {
                this._scratchFloat4[0] = light.shadowBias;
                this._scratchFloat4[1] = light.shadowNormalBias;
                this._scratchFloat4[2] = 1.0;
                this._scratchFloat4[3] = 0.0;
                this.gl.uniform4fv(infoLoc, this._scratchFloat4);
              }
            }
          }
        } else {
          if (mapLoc) this.gl.uniform1i(mapLoc, 12);
          if (infoLoc) {
            this._scratchFloat4[0] = 0.0;
            this._scratchFloat4[1] = 0.0;
            this._scratchFloat4[2] = 0.0;
            this._scratchFloat4[3] = 0.0;
            this.gl.uniform4fv(infoLoc, this._scratchFloat4);
          }
        }
      }
    }

    // DirectionalLight Shadows
    //
    // Deliberately skipped while rendering into an offscreen target (a DynamicReflectionProbe
    // face or a PlanarReflectionNode): cascade selection below picks a split by this DRAW's
    // `u_viewPos` (see `depth` in light_calc_pbr.frag.glsl/light_calc.frag.glsl), which is the
    // *current* camera position -- correct for the main camera, but the cascades themselves are
    // fit once per frame to the MAIN camera only (`Scene.updateLights()`). A probe sits far
    // closer to nearby geometry than the main camera, so this reused, main-camera-relative depth
    // picks a much coarser cascade than the geometry actually needs, and that cascade's fixed
    // texel-space PCSS search radius then covers a disproportionately large world-space area --
    // producing an oversized, near-black shadow blob for small dynamic casters (e.g. an orbiting
    // moon) inside the reflection. A reflection probe/planar reflection was never meant to carry
    // precise directional shadowing anyway, so it's simplest and safest to just turn it off here
    // rather than thread a second, probe-agnostic depth reference through the cascade uniforms.
    if (
      !this.isOffscreenRenderTarget &&
      lights &&
      lights.dLight &&
      lights.dLight.castShadow &&
      lights.dLight.numCascades > 0
    ) {
      const light = lights.dLight;
      const mapLoc = cache.uniforms.get("u_dirShadowMap");
      const mapRawLoc = cache.uniforms.get("u_dirShadowMapRaw");
      const splitsLoc = cache.uniforms.get("u_cascadeSplits");
      const infoLoc = cache.uniforms.get("u_dirShadowInfo");

      const fbo = this._shadowMaps.get(light);
      if (fbo && fbo.texture) {
        const texUnit = 12; // TEXTURE12
        const maxUnits = this.context.deviceCaps.getLimit(
          DeviceLimit.WEBGL2_MAX_TEXTURE_IMAGE_UNITS,
        );
        if (texUnit >= maxUnits) {
          console.warn(
            `[WebGL2Renderer] Exceeded MAX_TEXTURE_IMAGE_UNITS (${maxUnits}). Cannot bind directional shadow map to texture unit ${texUnit}.`,
          );
        } else {
          this.gl.activeTexture(this.gl.TEXTURE0 + texUnit);
          this.gl.bindTexture(this.gl.TEXTURE_2D, fbo.texture);
          if (mapLoc) this.gl.uniform1i(mapLoc, texUnit);

          // Same depth texture, second unit, non-comparison sampler -- see PCSS blocker search.
          this.gl.activeTexture(this.gl.TEXTURE0 + WebGL2Renderer._RAW_DEPTH_UNIT);
          this.gl.bindTexture(this.gl.TEXTURE_2D, fbo.texture);
          if (mapRawLoc) this.gl.uniform1i(mapRawLoc, WebGL2Renderer._RAW_DEPTH_UNIT);

          for (let i = 0; i < light.numCascades; i++) {
            const matLoc = cache.uniforms.get(`u_cascadeMatrices[${i}]`);
            if (matLoc && light.cascadeCameras[i]) {
              this.gl.uniformMatrix4fv(
                matLoc,
                false,
                light.cascadeCameras[i]!.viewProjectionMatrix,
              );
            }
          }

          if (splitsLoc) {
            this._scratchFloat4[0] = light.cascadeSplits[0] ?? 0;
            this._scratchFloat4[1] = light.cascadeSplits[1] ?? 0;
            this._scratchFloat4[2] = light.cascadeSplits[2] ?? 0;
            this._scratchFloat4[3] = light.cascadeSplits[3] ?? 0;
            this.gl.uniform4fv(splitsLoc, this._scratchFloat4);
          }

          if (infoLoc) {
            this._scratchFloat4[0] = light.shadowBias;
            this._scratchFloat4[1] = light.shadowNormalBias;
            this._scratchFloat4[2] = 1.0;
            this._scratchFloat4[3] = light.numCascades;
            this.gl.uniform4fv(infoLoc, this._scratchFloat4);
          }
        }
      }
    } else {
      const mapLoc = cache.uniforms.get("u_dirShadowMap");
      if (mapLoc) this.gl.uniform1i(mapLoc, 12);
      const mapRawLoc = cache.uniforms.get("u_dirShadowMapRaw");
      if (mapRawLoc) this.gl.uniform1i(mapRawLoc, WebGL2Renderer._RAW_DEPTH_UNIT);
      const infoLoc = cache.uniforms.get("u_dirShadowInfo");
      if (infoLoc) {
        this._scratchFloat4[0] = 0.0;
        this._scratchFloat4[1] = 0.0;
        this._scratchFloat4[2] = 0.0;
        this._scratchFloat4[3] = 0.0;
        this.gl.uniform4fv(infoLoc, this._scratchFloat4);
      }
    }

    const u = cache.uniforms;

    // --- Fog Uniforms ---
    const fog = scene?.fog;
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

    // --- Global IBL Uniforms ---
    if (scene) {
      const intLoc = u.get("u_envIntensity");
      if (intLoc) this.gl.uniform1f(intLoc, scene.environmentIntensity);

      // Irradiance Map -- always claim the unit with at least a dummy cube texture when the
      // uniform is active, even without real IBL data: leaving an active sampler unassigned
      // defaults it to unit 0, colliding with whatever 2D sampler (e.g. u_diffuseMap)
      // legitimately owns that unit ("two textures of different types use the same sampler
      // location" GL_INVALID_OPERATION).
      const irrUnit = cache.samplerUnits.get("u_irradianceMap");
      const irrLoc = u.get("u_irradianceMap");
      if (
        irrLoc &&
        undefined !== irrUnit &&
        this._isTextureUnitAvailable(irrUnit, "u_irradianceMap")
      ) {
        this.gl.activeTexture(this.gl.TEXTURE0 + irrUnit);
        this.gl.bindTexture(this.gl.TEXTURE_2D, null);
        this.gl.bindTexture(
          this.gl.TEXTURE_CUBE_MAP,
          scene.irradianceMap
            ? this._textures.getWebGLCubeTexture(scene.irradianceMap, this._quality)
            : this._blackCubeTexture,
        );
        this.gl.uniform1i(irrLoc, irrUnit);
      }

      // Prefilter Map
      const prefUnit = cache.samplerUnits.get("u_prefilterMap");
      const prefLoc = u.get("u_prefilterMap");
      if (
        prefLoc &&
        undefined !== prefUnit &&
        this._isTextureUnitAvailable(prefUnit, "u_prefilterMap")
      ) {
        this.gl.activeTexture(this.gl.TEXTURE0 + prefUnit);
        this.gl.bindTexture(this.gl.TEXTURE_2D, null);
        this.gl.bindTexture(
          this.gl.TEXTURE_CUBE_MAP,
          scene.prefilterMap
            ? this._textures.getWebGLCubeTexture(scene.prefilterMap, this._quality)
            : this._blackCubeTexture,
        );
        this.gl.uniform1i(prefLoc, prefUnit);
      }

      // BRDF LUT
      const brdfUnit = cache.samplerUnits.get("u_brdfLUT");
      const brdfLoc = u.get("u_brdfLUT");
      if (
        brdfLoc &&
        undefined !== brdfUnit &&
        this._isTextureUnitAvailable(brdfUnit, "u_brdfLUT")
      ) {
        this.gl.activeTexture(this.gl.TEXTURE0 + brdfUnit);
        this.gl.bindTexture(this.gl.TEXTURE_CUBE_MAP, null);
        this.gl.bindTexture(
          this.gl.TEXTURE_2D,
          scene.brdfLUT
            ? this._textures.getWebGLTexture(scene.brdfLUT, this._quality)
            : this._defaultBrdfTexture,
        );
        this.gl.uniform1i(brdfLoc, brdfUnit);
      }
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
      }
    }

    // --- 3. Bind Textures ---
    const texs = manifest.textures;
    if (shaderId === MaterialType.SKYBOX) {
      this.gl.activeTexture(this.gl.TEXTURE0);
      this.gl.bindTexture(this.gl.TEXTURE_2D, null);
      const skyTex = texs["u_skybox"] as CubeTexture;
      this.gl.bindTexture(
        this.gl.TEXTURE_CUBE_MAP,
        skyTex
          ? this._textures.getWebGLCubeTexture(skyTex, this._quality)
          : this.defaultCubeTexture,
      );
      const uSkybox = u.get("u_skybox");
      if (uSkybox) this.gl.uniform1i(uSkybox, 0);
    } else {
      for (const [uniformName, unit] of cache.samplerUnits) {
        // IBL maps are scene-global, not per-object -- already bound once per draw call by the
        // dedicated "Global IBL Uniforms" block above. Letting this per-object loop also process
        // them would rebind them, clobbering the correct binding and re-triggering the same
        // sampler-type collision this loop is meant to avoid.
        if (
          "u_irradianceMap" === uniformName ||
          "u_prefilterMap" === uniformName ||
          "u_brdfLUT" === uniformName
        ) {
          continue;
        }
        const loc = u.get(uniformName);
        if (!loc || !this._isTextureUnitAvailable(unit, uniformName)) continue;

        this.gl.activeTexture(this.gl.TEXTURE0 + unit);
        // Cube-vs-2D is a property of the sampler's declared GLSL type, not its name -- any
        // samplerCube uniform (u_envMap today, potentially others in future materials) needs the
        // cube-texture fallback path, not just one hardcoded name.
        if (this.gl.SAMPLER_CUBE === cache.samplerTypes.get(uniformName)) {
          this.gl.bindTexture(this.gl.TEXTURE_2D, null);
          const ct = texs[uniformName] as CubeTexture;
          this.gl.bindTexture(
            this.gl.TEXTURE_CUBE_MAP,
            ct ? this._textures.getWebGLCubeTexture(ct, this._quality) : this.defaultCubeTexture,
          );
        } else {
          this.gl.bindTexture(this.gl.TEXTURE_CUBE_MAP, null);
          const t = texs[uniformName] as Texture;
          if (uniformName === "u_normalMap" && !t) {
            this.gl.bindTexture(this.gl.TEXTURE_2D, this.defaultNormalMap);
          } else if (uniformName === "u_specularMap" && !t) {
            this.gl.bindTexture(this.gl.TEXTURE_2D, this.defaultSpecularMap);
          } else if (uniformName === "u_opaqueMap" && !t) {
            this.gl.bindTexture(this.gl.TEXTURE_2D, this._opaqueTexture ?? this.defaultTexture);
          } else if (uniformName === "u_normalBufferMap" && !t) {
            this.gl.bindTexture(
              this.gl.TEXTURE_2D,
              this._opaqueNormalTexture ?? this.defaultTexture,
            );
          } else if (uniformName === "u_opaqueDepthMap" && !t) {
            this.gl.bindTexture(
              this.gl.TEXTURE_2D,
              this._opaqueDepthTexture ?? this.defaultTexture,
            );
          } else {
            const glTex = t
              ? this._textures.getWebGLTexture(t, this._quality)
              : this.defaultTexture;
            if (t && "isTextureArray" in t && (t as TextureArray).isTextureArray) {
              this.gl.bindTexture(this.gl.TEXTURE_2D_ARRAY, glTex);
            } else {
              this.gl.bindTexture(this.gl.TEXTURE_2D, glTex);
            }
          }
        }
        this.gl.uniform1i(loc, unit);
      }
    }

    // --- 4. Render each object ---
    for (const o of objects) {
      if (!o.geometry) continue;

      this._programCache.acquireProgram(o, programKey);
      this._textures.acquireTextures(o, manifest.textures);

      if (isInstanced) {
        const instMesh = o as InstancedMesh;
        if (instMesh.instanceCount < 0) {
          throw new Error(`[WebGL2Renderer] Invalid instanceCount: ${instMesh.instanceCount}`);
        }
        if (instMesh.instanceMatrices.byteLength < instMesh.instanceCount * 64) {
          throw new Error(
            `[WebGL2Renderer] InstancedMesh matrix buffer too small: required at least ${instMesh.instanceCount * 64} bytes for ${instMesh.instanceCount} instances, but buffer is ${instMesh.instanceMatrices.byteLength} bytes.`,
          );
        }
        if (
          instMesh.instanceData &&
          instMesh.instanceData.byteLength < instMesh.instanceCount * 16
        ) {
          throw new Error(
            `[WebGL2Renderer] InstancedMesh instanceData buffer too small: required at least ${instMesh.instanceCount * 16} bytes for ${instMesh.instanceCount} instances, but buffer is ${instMesh.instanceData.byteLength} bytes.`,
          );
        }

        // Instanced draws configure their base attributes + instance-matrices manually and reset
        // them again afterwards, so they run on the DEFAULT VAO -- never on a mesh's cached VAO,
        // whose pointers must stay pristine for the non-instanced path.
        this.gl.bindVertexArray(null);

        this._scratchModelMatrix.set(instMesh.worldMatrix.data);
        const uModel = u.get("u_model");
        if (uModel) this.gl.uniformMatrix4fv(uModel, false, this._scratchModelMatrix);

        let matrixBuf = this._instanceBuffers.get(instMesh);
        if (!matrixBuf) {
          matrixBuf = this.gl.createBuffer()!;
          this._instanceBuffers.set(instMesh, matrixBuf);
        }
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, matrixBuf);
        if (instMesh.instanceMatrixNeedsUpdate) {
          this.gl.bufferData(this.gl.ARRAY_BUFFER, instMesh.instanceMatrices, this.gl.DYNAMIC_DRAW);
          instMesh.instanceMatrixNeedsUpdate = false;
        }

        const mesh = this._geometry.getOrCreateMesh(instMesh, instMesh.geometry!);

        mesh.bind(
          cache.attributes.get("a_position")!,
          cache.attributes.get("a_normal")!,
          cache.attributes.get("a_uv")!,
          cache.attributes.get("a_tangent")!,
          cache.attributes.get("a_joints") ?? -1,
          cache.attributes.get("a_weights") ?? -1,
        );

        const loc = cache.attributes.get("a_instanceMatrix");
        if (loc !== undefined && loc >= 0) {
          this.gl.bindBuffer(this.gl.ARRAY_BUFFER, matrixBuf);
          for (let i = 0; i < 4; i++) {
            const attribLoc = loc + i;
            this.gl.enableVertexAttribArray(attribLoc);
            this.gl.vertexAttribPointer(attribLoc, 4, this.gl.FLOAT, false, 64, i * 16);
            this.gl.vertexAttribDivisor(attribLoc, 1);
          }
        }

        const dataLoc = cache.attributes.get("a_instanceData");
        if (dataLoc !== undefined && dataLoc >= 0 && instMesh.instanceData) {
          let dataBuf = this._instanceDataBuffers.get(instMesh);
          if (!dataBuf) {
            dataBuf = this.gl.createBuffer()!;
            this._instanceDataBuffers.set(instMesh, dataBuf);
          }
          this.gl.bindBuffer(this.gl.ARRAY_BUFFER, dataBuf);
          if (instMesh.instanceDataNeedsUpdate) {
            this.gl.bufferData(this.gl.ARRAY_BUFFER, instMesh.instanceData, this.gl.DYNAMIC_DRAW);
            instMesh.instanceDataNeedsUpdate = false;
          }
          this.gl.enableVertexAttribArray(dataLoc);
          this.gl.vertexAttribPointer(
            dataLoc,
            instMesh.instanceDataSize,
            this.gl.FLOAT,
            false,
            0,
            0,
          );
          this.gl.vertexAttribDivisor(dataLoc, 1);
        }

        const drawMode = topology === Topology.LINE_LIST ? this.gl.LINES : this.gl.TRIANGLES;
        if (mesh.isIndexed) {
          this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, mesh.ebo ?? null);
          this.gl.drawElementsInstanced(
            drawMode,
            mesh.count,
            mesh.indexType,
            0,
            instMesh.instanceCount,
          );
        } else {
          this.gl.drawArraysInstanced(drawMode, 0, mesh.count, instMesh.instanceCount);
        }

        if (loc !== undefined && loc >= 0) {
          for (let i = 0; i < 4; i++) {
            this.gl.vertexAttribDivisor(loc + i, 0);
            this.gl.disableVertexAttribArray(loc + i);
          }
        }
        if (dataLoc !== undefined && dataLoc >= 0) {
          this.gl.vertexAttribDivisor(dataLoc, 0);
          this.gl.disableVertexAttribArray(dataLoc);
        }
      } else {
        // Model Matrix & Billboarding
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

        if (state?.isDecal) this._setDecalUniforms(u, o);

        if (isSkinnedMesh(o) && o.skeleton) {
          const skel = o.skeleton;
          const boneLoc =
            cache.uniforms.get("u_boneMatrices[0]") ??
            this.gl.getUniformLocation(cache.prog, "u_boneMatrices");
          if (boneLoc) {
            // Clamp to the shader's fixed-size array: uploading more matrices than it declares
            // would either error or overwrite whatever uniform happens to follow it in the program.
            const maxFloats = MAX_SKINNED_BONES * 16;
            const boneData =
              skel.boneMatrices.length > maxFloats
                ? skel.boneMatrices.subarray(0, maxFloats)
                : skel.boneMatrices;
            this.gl.uniformMatrix4fv(boneLoc, false, boneData);
          }
        }

        // Bind and Draw Geometry
        const mesh = this._geometry.getOrCreateMesh(o, o.geometry);

        if (mesh.vaoCapable) {
          mesh.bindVAO();
        } else {
          mesh.bind(
            cache.attributes.get("a_position")!,
            cache.attributes.get("a_normal")!,
            cache.attributes.get("a_uv")!,
            cache.attributes.get("a_tangent")!,
            cache.attributes.get("a_joints") ?? -1,
            cache.attributes.get("a_weights") ?? -1,
            cache.attributes.get("a_color") ?? -1,
          );
        }

        const drawMode = topology === Topology.LINE_LIST ? this.gl.LINES : this.gl.TRIANGLES;
        mesh.draw(drawMode, wireframeMode);
      }
    }
  }

  public updateGlobalUBO(
    vp: Float32Array,
    camPos: Vector3D,
    lights: LightDataInterface,
    near: number = 0.1,
    far: number = 1000,
  ): void {
    if (lights.pLights.length > MAX_CLUSTERED_LIGHTS_PER_TYPE) {
      throw new Error(
        `[WebGL2Renderer] Point light count exceeds limit of ${MAX_CLUSTERED_LIGHTS_PER_TYPE}: ${lights.pLights.length}`,
      );
    }
    if (lights.sLights.length > MAX_CLUSTERED_LIGHTS_PER_TYPE) {
      throw new Error(
        `[WebGL2Renderer] Spot light count exceeds limit of ${MAX_CLUSTERED_LIGHTS_PER_TYPE}: ${lights.sLights.length}`,
      );
    }
    if (lights.aLights.length > 42) {
      throw new Error(
        `[WebGL2Renderer] Area light count exceeds limit of 42: ${lights.aLights.length}`,
      );
    }
    const ubo = this._globalUBO;
    ubo.setMatrix(0, vp);
    ubo.setVec3(64, camPos.x, camPos.y, camPos.z);

    // Scale colors by intensity without Vector3D allocations
    ubo.setVec3(
      80,
      lights.aCol.r * lights.aIntensity,
      lights.aCol.g * lights.aIntensity,
      lights.aCol.b * lights.aIntensity,
    );
    ubo.setVec3(
      96,
      lights.dCol.r * lights.dIntensity,
      lights.dCol.g * lights.dIntensity,
      lights.dCol.b * lights.dIntensity,
    );
    ubo.setVec3(112, lights.dDir.x, lights.dDir.y, lights.dDir.z);
    // WebGL2's raw UBO light array still has 16 slots (see docs/adr/0007-clustered-lighting-webgl2-webgpu-only.md);
    // clamp explicitly now that the scene-wide cap is 64.
    ubo.setInt(128, Math.min(lights.pLights.length, 16));
    ubo.setInt(132, Math.min(lights.sLights.length, 16));
    ubo.setInt(136, lights.aLights.length);
    const gamma = this.postProcessing.enabled ? 1.0 : (this._quality.gamma ?? 2.2);
    const exposure = this.postProcessing.enabled ? 1.0 : (this._quality.exposure ?? 1.0);
    ubo.setFloat(140, gamma);
    ubo.setFloat(144, exposure);

    for (let i = 0; i < 16; i++) {
      const offset = 160 + i * 32;
      if (i < lights.pLights.length) {
        const pl = lights.pLights[i]!;
        const matData = pl.worldMatrix.data;
        ubo.setVec3(offset, matData[12]!, matData[13]!, matData[14]!);
        ubo.setVec3(
          offset + 16,
          pl.color.r * pl.intensity,
          pl.color.g * pl.intensity,
          pl.color.b * pl.intensity,
        );
        ubo.setFloat(offset + 12, pl.distance);
        ubo.setFloat(offset + 28, pl.decay);
      }
    }

    for (let i = 0; i < 16; i++) {
      const offset = 672 + i * 64;
      if (i < lights.sLights.length) {
        const sl = lights.sLights[i]!;
        const slMat = sl.worldMatrix.data;
        const dir = sl.direction;
        const dirLen = Math.sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z) || 1.0;
        ubo.setVec3(offset, slMat[12]!, slMat[13]!, slMat[14]!);
        ubo.setVec3(offset + 16, dir.x / dirLen, dir.y / dirLen, dir.z / dirLen);
        ubo.setVec3(
          offset + 32,
          sl.color.r * sl.intensity,
          sl.color.g * sl.intensity,
          sl.color.b * sl.intensity,
        );
        ubo.setFloat(offset + 48, Math.cos(sl.angle));
        ubo.setFloat(offset + 52, Math.cos(sl.angle * (1.0 - sl.penumbra)));
        ubo.setFloat(offset + 56, sl.distance);
        ubo.setFloat(offset + 60, sl.decay);
      }
    }

    for (let i = 0; i < MAX_AREA_LIGHTS; i++) {
      const offset = 1696 + i * 96;
      if (i < lights.aLights.length) {
        const al = lights.aLights[i]!;
        const mat = al.worldMatrix.data;
        ubo.setVec3(offset, mat[12]!, mat[13]!, mat[14]!);
        ubo.setVec3(
          offset + 16,
          al.color.r * al.intensity,
          al.color.g * al.intensity,
          al.color.b * al.intensity,
        );
        ubo.setVec3(offset + 32, mat[0]!, mat[1]!, mat[2]!);
        ubo.setVec3(offset + 48, mat[4]!, mat[5]!, mat[6]!);
        ubo.setVec3(offset + 64, mat[8]!, mat[9]!, mat[10]!);
        ubo.setFloat(offset + 80, al.width / 2.0);
        ubo.setFloat(offset + 84, al.height / 2.0);
        ubo.setFloat(offset + 88, al.distance);
        ubo.setFloat(offset + 92, al.decay);
      }
    }

    ubo.setVec2(152, near, far);
    ubo.update();
  }

  /**
   * Auto-enable (ADR 0028): the HDR FBO was created without the secondary attachment, so drop it
   * here and let `_ensurePostProcessFbo` rebuild it. Programs recompile through the new
   * `USE_NORMAL_OUT` flag. One-time hitch.
   */
  public override requestNormalBuffer(): boolean {
    const switched = super.requestNormalBuffer();
    if (switched && this._hdrFbo && !this._hdrFbo.secondaryTexture) {
      this._hdrFbo.destroy();
      this._hdrFbo = undefined;
    }
    return switched;
  }

  private _warnedNormalBufferUnavailable = false;

  private _warnIfNormalBufferUnavailable(): void {
    if (this._warnedNormalBufferUnavailable || this._quality.normalBuffer !== true) return;
    if (this._activeRenderTarget || this._hdrFbo?.secondaryTexture) return;

    this._warnedNormalBufferUnavailable = true;
    console.warn(
      "[WebGL2Renderer] quality.normalBuffer needs postProcessing.enabled and EXT_color_buffer_float; " +
        "no normal buffer is written (consumers fall back to depth-derived normals).",
    );
  }

  /**
   * Lazily creates or tears down the HDR post-processing framebuffer and passes to match
   * the current `postProcessing.enabled` state and canvas dimensions.
   */
  private _ensurePostProcessFbo(): void {
    if (
      this.postProcessing.enabled &&
      !this._hdrFbo &&
      this.gl.canvas.width > 0 &&
      this.gl.canvas.height > 0
    ) {
      // RGBA16F rendering requires EXT_color_buffer_float; without it, WebGL2FrameBuffer's
      // checkFramebufferStatus() throws. Fall back to an UNSIGNED_BYTE target (WebGL1Renderer
      // always uses RGBA8 because half-float targets silently drop draws on some drivers).
      const supportsFloatColorBuffer = this.gl.getExtension("EXT_color_buffer_float") !== null;
      // The normal buffer (ADR 0028) needs the same float-renderable extension as the HDR color.
      const wantsNormalBuffer = this._quality.normalBuffer === true && supportsFloatColorBuffer;
      this._hdrFbo = new WebGL2FrameBuffer(this.gl, {
        width: this.gl.canvas.width,
        height: this.gl.canvas.height,
        internalFormat: supportsFloatColorBuffer ? this.gl.RGBA16F : this.gl.RGBA8,
        format: this.gl.RGBA,
        type: supportsFloatColorBuffer ? this.gl.HALF_FLOAT : this.gl.UNSIGNED_BYTE,
        secondary: wantsNormalBuffer
          ? { internalFormat: this.gl.RG16F, format: this.gl.RG, type: this.gl.HALF_FLOAT }
          : undefined,
      });
      this._postPassGL ??= new PostProcessPassGL(this.gl, true, this.context.shaderRegistry);
      this._bloomPassGL ??= new BloomPassGL(this.gl, true);
      this._hbaoPassGL ??= new AOPassGL(this.gl);
      this._lightShaftsPassGL ??= new LightShaftsPassGL(this.gl, true);
      this._volumetricFogPassGL ??= new VolumetricFogPassGL(this.gl, true);
      this._taaPassGL ??= new HistoryBlendPassGL(this.gl);
      this._motionTrailPassGL ??= new HistoryBlendPassGL(this.gl);
    } else if (!this.postProcessing.enabled && this._hdrFbo) {
      this._postPassGL?.destroy?.(this.gl);
      this._bloomPassGL?.destroy();
      this._hbaoPassGL?.destroy();
      this._lightShaftsPassGL?.destroy();
      this._volumetricFogPassGL?.destroy();
      this._taaPassGL?.destroy();
      this._motionTrailPassGL?.destroy();
      this._hdrFbo.destroy();
      this._hdrFbo = undefined;
      this._postPassGL = undefined;
      this._bloomPassGL = undefined;
      this._hbaoPassGL = undefined;
      this._lightShaftsPassGL = undefined;
      this._volumetricFogPassGL = undefined;
      this._taaPassGL = undefined;
      this._motionTrailPassGL = undefined;
    }
  }

  /** @inheritdoc */
  public override setSize(width: number, height: number): void {
    super.setSize(width, height);

    if (this.postProcessing.enabled) {
      if (this._hdrFbo) {
        this._hdrFbo.resize(this.gl.canvas.width, this.gl.canvas.height);
      } else {
        this._ensurePostProcessFbo();
      }
    } else if (this._hdrFbo) {
      this._ensurePostProcessFbo();
    }

    // Clustered light culling grid depends on canvas resolution -- see
    // docs/adr/0007-clustered-lighting-webgl2-webgpu-only.md. `enabled: false` collapses the
    // grid to a single cluster covering the whole frustum (equivalent to the pre-clustering
    // "iterate every light" behavior) without needing a separate shader code path.
    const clusterConfig = this._quality.clusteredLighting;
    const dims: ClusterGridDims =
      clusterConfig?.enabled === false
        ? { x: 1, y: 1, z: 1 }
        : computeClusterCounts(
            this.gl.canvas.width,
            this.gl.canvas.height,
            clusterConfig?.tileSize ?? DEFAULT_CLUSTER_TILE_SIZE,
            clusterConfig?.zSlices ?? DEFAULT_CLUSTER_Z_SLICES,
          );
    // WebGL2's raw light array is capped at 16 (see the ADR above), so no cluster can ever need
    // more than 16 slots regardless of a higher configured value (meant for WebGPU's 64-light cap).
    const maxLightsPerCluster = Math.min(
      clusterConfig?.enabled === false
        ? 16
        : (clusterConfig?.maxLightsPerCluster ?? DEFAULT_MAX_LIGHTS_PER_CLUSTER),
      16,
    );
    if (
      dims.x !== this._clusterDims.x ||
      dims.y !== this._clusterDims.y ||
      dims.z !== this._clusterDims.z ||
      maxLightsPerCluster !== this._clusterMaxLightsPerCluster
    ) {
      this._allocateClusterTextures(dims, maxLightsPerCluster);
    }
  }

  /** @inheritdoc */
  protected override releaseObjectResources(obj: Object3D): void {
    this._geometry.releaseGeometryFor(obj);
    this._programCache.releaseObjectProgram(obj);
    this._textures.releaseObjectTextures(obj);
  }

  /** @inheritdoc */
  public override destroy(): void {
    const gl = this.gl;
    if (gl) {
      this._programCache?.dispose();
      this._textures?.dispose();
      this._geometry?.dispose();
      for (const tex of this._texCache.values()) gl.deleteTexture(tex);
      for (const fbo of this._renderTargetFbos.values()) fbo.destroy();
      for (const fbo of this._renderTargetCubeFbos.values()) fbo.destroy();
      for (const shadowFbo of this._shadowMaps.values()) shadowFbo.destroy();
      this._dummyShadowMap?.destroy();
      if (this._rawDepthSampler) gl.deleteSampler(this._rawDepthSampler);
      this._hdrFbo?.destroy();
      if (this._opaqueNormalTexture) this.gl.deleteTexture(this._opaqueNormalTexture);
      if (this._opaqueNormalFbo) this.gl.deleteFramebuffer(this._opaqueNormalFbo);
      this._opaqueNormalTexture = undefined;
      this._opaqueNormalFbo = undefined;
      this._postPassGL?.destroy(gl);
      this._bloomPassGL?.destroy();
      this._hbaoPassGL?.destroy();
      this._lightShaftsPassGL?.destroy();
      this._volumetricFogPassGL?.destroy();
      this._taaPassGL?.destroy();
      this._motionTrailPassGL?.destroy();
      this._globalUBO?.destroy();
    }

    this._texCache.clear();
    this._renderTargetFbos.clear();
    this._renderTargetCubeFbos.clear();
    this._shadowMaps.clear();
    this._hdrFbo = undefined;
    this._postPassGL = undefined;
    this._bloomPassGL = undefined;
    this._lightShaftsPassGL = undefined;
    this._volumetricFogPassGL = undefined;

    super.destroy();
  }
}
