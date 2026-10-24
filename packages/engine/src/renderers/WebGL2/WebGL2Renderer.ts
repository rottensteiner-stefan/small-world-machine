import { WebGL2UniformBuffer } from "./WebGL2UniformBuffer.js";
import {
  WebGL2GlobalUniformLayout,
  WebGL2PointLightLayout,
  WebGL2SpotLightLayout,
  WebGL2AreaLightLayout,
} from "../GlobalUniformLayout.js";
import type { WebGLProgramCacheEntry } from "../gl/managers/WebGLProgramCache.js";
import { WebGLProgramCache } from "../gl/managers/WebGLProgramCache.js";
import { WebGLTextureManager } from "../gl/managers/WebGLTextureManager.js";
import { WebGLBufferManager } from "../gl/managers/WebGLBufferManager.js";
import { WebGL2DepthFrameBuffer } from "./WebGL2DepthFrameBuffer.js";
import { WebGL2FrameBuffer } from "./WebGL2FrameBuffer.js";
import { NORMAL_OUTPUT_FLAG } from "../gl/managers/NormalOutputWrapperGL.js";
import { WebGL2CubeFrameBuffer } from "./WebGL2CubeFrameBuffer.js";
import { AbstractWebGLRenderer } from "../AbstractWebGLRenderer.js";
import { WebGLShadowPass } from "../passes/WebGLShadowPass.js";
import { WebGLMainPass } from "../passes/WebGLMainPass.js";
import { WebGLPostProcessPass } from "../passes/WebGLPostProcessPass.js";
import { WebGLClusterCullPass } from "../passes/WebGLClusterCullPass.js";
import { GLPostEffects, createGLPostEffectContext } from "../post/passes/index.js";
import type { GLPostEffectPassContext } from "../post/passes/index.js";
import type { AbstractLight, DirectionalLight } from "../../core/lights/index.js";
import { MAX_CLUSTERED_LIGHTS_PER_TYPE } from "../../core/lights/index.js";
import { MAX_SKINNED_BONES, isSkinnedMesh } from "../../core/animation/index.js";
import type { CubeTexture, RenderTarget } from "../../core/textures/index.js";
import { Texture, RenderTargetCube } from "../../core/textures/index.js";
import type { RenderManifest } from "../shaders/index.js";
import { VERTEX_COLOR_FLAG, resolveManifestFlags } from "../shaders/index.js";
import { Color } from "../../core/colors/index.js";
import type { Object3D, RenderBatch, Scene, TextureArray } from "../../core/index.js";
import { DeviceLimit, InstancedMesh, computeClipToBox } from "../../core/index.js";
import { DepthMaterial } from "../../core/materials/index.js";
import { EvsmMomentMaterial } from "../../core/materials/EvsmMomentMaterial.js";
import type { EngineOptions, LightDataInterface } from "../../interfaces/index.js";
import {
  MaterialType,
  RendererType,
  ShadowMode,
  Topology,
  WireframeMode,
} from "../../enums/index.js";
import type { GLLineRibbon, Mesh } from "../Mesh.js";
import { AUTO_INSTANCING_MIN_RUN, partitionInstanceRuns } from "../AutoInstancing.js";
import { usesLineQuadShadow } from "../LineShadowRibbon.js";
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
import { requireGlObject } from "../gl/requireGlObject.js";

/** Out-of-range clear value (octahedral encodings live in [-1, 1]): "no normal" -- see ADR 0028. */
const NORMAL_TARGET_CLEAR: Float32Array = new Float32Array([-2, -2, 0, 0]);
/** `u_model` of an auto-instancing run (ADR 0046): the instance matrices carry the transforms. */
const IDENTITY_MATRIX: Float32Array = new Float32Array([
  1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
]);

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
  /** Auto-instancing (ADR 0046): one streamed matrix buffer for every run, plus its CPU staging. */
  private _runMatrixBuffer: WebGLBuffer | undefined;
  private _runStaging: Float32Array = new Float32Array(1024 * 16);
  // Reused outputs of `partitionInstanceRuns()` (no per-frame allocation).
  private readonly _scratchRunObjects: Object3D[] = [];
  private readonly _scratchRuns: number[] = [];
  private readonly _scratchRunRest: Object3D[] = [];

  private _scratchFloat4: Float32Array = new Float32Array(4);

  /** Fixed unit for reading the directional shadow map's raw (non-comparison) depth, used by
   * PCSS's blocker-search step. Dedicated texture unit 13 -- reserved like every other
   * shadow unit -- with a dedicated WebGLSampler (`_rawDepthSampler`) that overrides
   * TEXTURE_COMPARE_MODE back to NONE, since that mode is otherwise baked onto the depth
   * texture object itself (see WebGL2DepthFrameBuffer). */
  private static readonly _RAW_DEPTH_UNIT = 13;
  private _rawDepthSampler!: WebGLSampler;

  /** Defensive fallback unit for the EVSM moment atlas sampler (ADR 0043). NOTE: unit 14 is
   * CLUSTER_GRID_UNIT (the RG32UI cluster-grid texture), so `_bindEvsmShadowUniforms` no longer
   * binds the RGBA32F atlas there -- it uses the per-program sampler unit the program cache
   * reserved exclusively for `u_dirEVSMMap` (see that method) and only falls back to this fixed
   * unit for the (theoretical) case of an active sampler without an allocated unit. */
  private static readonly _EVSM_MAP_UNIT = 14;
  /** EVSM tuning lanes, byte-identical to the WebGPU side (GlobalUniformWriter lanes 217-219). */
  private static readonly _EVSM_VARIANCE_FLOOR = 0.002;
  private static readonly _EVSM_LIGHT_BLEED = 0.12;
  /** Receiver depth bias before the exponential warp (three.js VSM `shadowCoord.z += shadowBias`);
   * in [0,1] light-depth units. See the WebGPU EVSM_RECEIVE_BIAS constant for the rationale. */
  private static readonly _EVSM_RECEIVE_BIAS = 0.0002;
  /** Moment-atlas clear vector meaning "no occluder" = an occluder at the far plane, which every
   * in-front receiver evaluates as lit (far-plane EVSM rationale: see the moment writer header). */
  private _evsmFarClear: [number, number, number, number] = [0, 0, 0, 0];
  /** RGBA32F moment atlas (color) + its FBO. The FBO reuses the CSM depth atlas as its depth
   * attachment, so `_evsmAtlasTexture` and `_evsmAtlasFbo` stand alone as a color-only set. */
  private _evsmAtlasFbo: WebGLFramebuffer | null = null;
  private _evsmAtlasTexture: WebGLTexture | null = null;
  /** 1x1 RGBA32F dummy, bound to u_dirEVSMMap whenever no real moment atlas is active (EVSM off
   * or unsupported) so the sampler always references a real texture object on every program. */
  private _evsmDummyTexture: WebGLTexture | null = null;
  /** True when EXT_color_buffer_float (required to render into RGBA32F) was granted. */
  private _evsmSupported = false;
  private _evsmSupportChecked = false;

  private _opaqueTexture?: WebGLTexture | undefined;
  private _opaqueDepthTexture?: WebGLTexture | undefined;
  private _opaqueDepthFbo?: WebGLFramebuffer | undefined;
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
  /** Owns every GL post pass (registry + terminal uber pass) behind the ADR 0037 contract. */
  private _postEffects: GLPostEffects | undefined = undefined;
  /** Reusable per-frame post context (zero allocation -- see GLPostEffectPassContext). */
  private _postCtx: GLPostEffectPassContext | undefined = undefined;

  protected _activeRenderTarget: RenderTarget | RenderTargetCube | null = null;
  protected _activeCubeFace: number = 0;
  private _renderTargetFbos: Map<RenderTarget, WebGL2FrameBuffer> = new Map();
  private _renderTargetCubeFbos: Map<RenderTargetCube, WebGL2CubeFrameBuffer> = new Map();
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

  private _shadowMaps: Map<AbstractLight, WebGL2DepthFrameBuffer> = new Map();
  /** Lights that rendered a shadow map in the current `renderShadowMaps()` call. */
  private readonly _shadowMapsUsed: Set<AbstractLight> = new Set();
  /** Reused "no lights" payload for the depth-only shadow programs. */
  private readonly _emptyLights: LightDataInterface = {
    aCol: new Color(0, 0, 0, 1),
    aIntensity: 0,
    dCol: new Color(0, 0, 0, 1),
    dDir: Vector3D.ZERO,
    dIntensity: 0,
    aLights: [],
    pLights: [],
    sLights: [],
  };
  private readonly _zeroVec4: Float32Array = new Float32Array(4);
  /** Scratch `u_extraParams` of a line-quad shadow batch: [1, 0, texel NDC, half width]. */
  private readonly _lineShadowParams: Float32Array = new Float32Array([1, 0, 0, 0]);
  private readonly _scratchInstancedObjects: Object3D[] = [];
  private readonly _scratchStandardObjects: Object3D[] = [];
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
    this.installContextLossHandling(canvas);

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

    this._createGpuResources();

    // Runs first: WebGLShadowPass's updateGlobalUBO() flushes the whole UBO (including the
    // cluster grid uniforms WebGLClusterCullPass stages below) to the GPU in one call.
    this.addPass(new WebGLClusterCullPass());
    this.addPass(new WebGLShadowPass());
    this.addPass(new WebGLMainPass());
    this.addPass(new WebGLPostProcessPass());
  }

  /**
   * Creates every GL object the renderer owns beyond what the scene and the post stack allocate
   * lazily. Shared by `initialize()` and the context-restore path, so a restored context ends up in
   * exactly the state a fresh one does.
   */
  private _createGpuResources(): void {
    this._geometry = new WebGLBufferManager(this.gl);
    this._dummyShadowMap = new WebGL2DepthFrameBuffer(this.gl, 1, 1);
    this._dummyShadowMap.bind();
    this.gl.clear(this.gl.DEPTH_BUFFER_BIT);
    this._dummyShadowMap.unbind();

    // Sampler object overriding TEXTURE_COMPARE_MODE to NONE, bound once to a fixed unit so any
    // depth texture bound there afterwards reads as a plain float instead of a 0/1 comparison --
    // sampler objects take precedence over a texture's own parameters for the unit they're bound to.
    this._rawDepthSampler = requireGlObject(this.gl.createSampler(), "sampler");
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
    this.context.shaderRegistry.ensureProvider(MaterialType.EVSM, new EvsmMomentMaterial());
    this.context.shaderRegistry.ensureProvider(
      DepthMaterial.LINE_QUADS_SHADER_ID,
      new DepthMaterial({ lineQuads: true }),
    );
    this.context.shaderRegistry.ensureProvider(
      EvsmMomentMaterial.LINE_QUADS_SHADER_ID,
      new EvsmMomentMaterial({ lineQuads: true }),
    );

    // GlobalUniforms with std140 layout -- size and every field offset come from the single
    // GlobalUniformLayout table (u_areaLights[4] 96-byte stride ends at 2080, followed by
    // u_tileSizePx at 2080 and u_clusterDims at 2096) for clustered light culling.
    this._globalUBO = new WebGL2UniformBuffer(this.gl, WebGL2GlobalUniformLayout.totalBytes, 0);
    this._programCache = new WebGLProgramCache(this.gl, this.context.shaderRegistry, {
      globalUBO: this._globalUBO,
      dialect: "glsl300",
    });
    this._allocateClusterTextures({ x: 1, y: 1, z: 1 }, 1);
  }

  /** @inheritdoc */
  protected override onContextRestored(): void {
    // Every handle created on the old context is dead: forget them (nothing to delete) and rebuild.
    const clusterDims = this._clusterDims;
    const clusterMaxLights = this._clusterMaxLightsPerCluster;
    this._texCache.clear();
    this._renderTargetFbos.clear();
    this._renderTargetCubeFbos.clear();
    this._shadowMaps.clear();
    this._shadowMapsUsed.clear();
    this._instanceBuffers = new WeakMap();
    this._instanceDataBuffers = new WeakMap();
    this._runMatrixBuffer = undefined;
    this._hdrFbo = undefined;
    this._postEffects = undefined;
    this._postCtx = undefined;
    // EVSM (ADR 0043) handles are dead with the old context; rebuild lazily (see
    // _checkEvsmSupport/_ensureEvsmAtlas) and re-check EXT_color_buffer_float.
    this._evsmAtlasFbo = null;
    this._evsmAtlasTexture = null;
    this._evsmDummyTexture = null;
    this._evsmSupported = false;
    this._evsmSupportChecked = false;
    this._opaqueTexture = undefined;
    this._opaqueDepthTexture = undefined;
    this._opaqueDepthFbo = undefined;
    this._opaqueDepthWidth = 0;
    this._opaqueDepthHeight = 0;
    this._opaqueDepthVerifiedHdr = undefined;
    this._opaqueDepthUnsupported = false;
    this._opaqueNormalTexture = undefined;
    this._opaqueNormalFbo = undefined;
    this._opaqueNormalWidth = 0;
    this._opaqueNormalHeight = 0;
    // The old pair is dead too; `_allocateClusterTextures` would "delete" it harmlessly.
    this._createGpuResources();
    this._allocateClusterTextures(clusterDims, clusterMaxLights);
    if (this.postProcessing.enabled) this._ensurePostProcessFbo();
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

    // setSize() re-allocates whenever the grid dims change: free the previous pair first.
    if (this._clusterGridTex) this.gl.deleteTexture(this._clusterGridTex);
    if (this._clusterIndexTex) this.gl.deleteTexture(this._clusterIndexTex);
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
    const f = WebGL2GlobalUniformLayout.fields;
    this._globalUBO.setVec2(f.tileSizePx.offset, tileSizePx[0], tileSizePx[1]);
    this._globalUBO.setFloat(f.clusterDims.offset, this._clusterDims.x);
    this._globalUBO.setFloat(f.clusterDims.offset + 4, this._clusterDims.y);
    this._globalUBO.setFloat(f.clusterDims.offset + 8, this._clusterDims.z);
    this._globalUBO.setFloat(f.clusterDims.offset + 12, this._clusterMaxLightsPerCluster);
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
    if (!isOffscreen && this.postProcessing.enabled && this._hdrFbo && this._postEffects) {
      this._postEffects.execute(this._buildPostEffectContext());
    }
  }

  /**
   * Repopulates the reusable per-frame post context from the current frame state (zero allocation
   * -- the scratch context object itself is allocated once; every dispatch only re-points
   * references, see GLPostEffectPassContext).
   */
  private _buildPostEffectContext(): GLPostEffectPassContext {
    let ctx = this._postCtx;
    if (!ctx) {
      ctx = createGLPostEffectContext();
      this._postCtx = ctx;
    }
    ctx.gl = this.gl;
    ctx.group = this.postProcessing;
    ctx.width = this.gl.canvas.width;
    ctx.height = this.gl.canvas.height;
    ctx.colorTexture = this._hdrFbo!.texture;
    // A failed capture leaves the texture allocated but empty: passes must see "no depth", not zeros.
    ctx.depthTexture = this._opaqueDepthUnsupported ? undefined : this._opaqueDepthTexture;
    ctx.viewProjMatrix = this._frameViewProj.data;
    ctx.camPos = this._frameCamPos;
    ctx.near = this._frameNear;
    ctx.far = this._frameFar;
    ctx.projMatrixData = this._frameProjMatrix;
    ctx.lights = this._frameLights;
    ctx.fogVolumes = this._fogVolumes;
    ctx.time = this.frameInfo.time;
    ctx.realTime = this.frameInfo.realTime;
    const dLight = this._frameLights?.dLight;
    ctx.dirShadowTexture = dLight ? (this._shadowMaps.get(dLight)?.texture ?? null) : null;
    ctx.spotShadowTextures = this._collectFogSpotShadowTextures();
    ctx.fallbackShadowTexture = this._dummyShadowMap.texture;
    ctx.irradianceMap = this._frameScene?.irradianceMap
      ? this._textures.getWebGLCubeTexture(this._frameScene.irradianceMap, this._quality)
      : this._blackCubeTexture;
    ctx.envIntensity = this._frameScene?.environmentIntensity ?? 0;
    ctx.pointLights = this._frameLights?.pLights ?? [];
    ctx.spotLights = this._frameLights?.sLights ?? [];
    ctx.bloomTexture = null;
    ctx.hbaoTexture = null;
    ctx.lightShaftsTexture = null;
    ctx.volumetricFogTexture = null;
    return ctx;
  }

  /**
   * Renders shadow maps for all shadow-casting lights.
   */
  public renderShadowMaps(lights: LightDataInterface, sortedGroups: RenderBatch[]): void {
    const emptyLights = this._emptyLights;
    this._shadowMapsUsed.clear();

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
      this._shadowMapsUsed.add(light);

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

      this._renderShadowScene(
        MaterialType.DEPTH,
        DepthMaterial.LINE_QUADS_SHADER_ID,
        2 / light.shadowResolution,
        sortedGroups,
      );

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
      this._shadowMapsUsed.add(light);

      fbo.bind(); // This sets viewport to full atlas, we'll overwrite it per cascade
      this.gl.depthMask(true);
      this.gl.clear(this.gl.DEPTH_BUFFER_BIT);

      this.gl.enable(this.gl.CULL_FACE);
      this.gl.cullFace(this.gl.FRONT);
      this.gl.enable(this.gl.DEPTH_TEST);
      this.gl.disable(this.gl.BLEND);

      for (let i = 0; i < light.numCascades; i++) {
        const cascadeCam = light.cascadeCameras[i];
        if (!cascadeCam) continue;

        // Set viewport to the quadrant for this cascade
        const col = i % cols;
        const row = Math.floor(i / cols);
        this.gl.viewport(col * res, row * res, res, res);

        this.updateGlobalUBO(cascadeCam.viewProjectionMatrix, cascadeCam.position, emptyLights);

        this._renderShadowScene(
          MaterialType.DEPTH,
          DepthMaterial.LINE_QUADS_SHADER_ID,
          2 / res,
          sortedGroups,
        );
      }

      // EVSM (ADR 0043): render the warped variance moments into a separate RGBA32F atlas right
      // after the depth pass, while the CSM depth atlas is still attached. The moment FBO reuses
      // that depth texture as its depth attachment with depthWrite off + LEQUAL, so the moments
      // come from exactly the front-most surface the depth pass just stored. Opt-in only
      // (quality.shadowMode === ShadowMode.EVSM); gated on EXT_color_buffer_float with an honest fallback
      // (mode flag stays 0 -> the fixed-PCF/pcss default path, see _checkEvsmSupport).
      if (this._quality.shadowMode === ShadowMode.EVSM) {
        this._renderEvsmMoments(
          light,
          fbo,
          cols,
          res,
          atlasWidth,
          atlasHeight,
          emptyLights,
          sortedGroups,
        );
      }

      this.gl.cullFace(this.gl.BACK);
      fbo.unbind();
    }

    // Lights that were removed or stopped casting shadows no longer keep their (up to 2048^2)
    // depth map alive.
    for (const [light, shadowFbo] of this._shadowMaps) {
      if (this._shadowMapsUsed.has(light)) continue;
      shadowFbo.destroy();
      this._shadowMaps.delete(light);
    }
  }

  /**
   * EVSM (ADR 0043) WebGL2 support gate, called lazily (idempotent). RGBA32F color render targets
   * require `EXT_color_buffer_float`; when the driver refuses it the engine degrades HONESTLY to
   * the default shadow mapping instead of rendering into an unsupported framebuffer -- exactly
   * one warning, and the mode flag stays 0 so no shader ever samples the (absent) moment atlas.
   * Also (re)creates the 1x1 RGBA32F dummy every program's active `u_dirEVSMMap` sampler needs as
   * a real bound texture, and precomputes the far-plane moment clear vector below.
   */
  private _checkEvsmSupport(): void {
    if (this._evsmSupportChecked) return;
    this._evsmSupportChecked = true;
    this._evsmSupported = Boolean(this.gl.getExtension("EXT_color_buffer_float"));

    // A moment texel no caster covers must evaluate as LIT, so it holds the moments of an
    // occluder AT the far plane (d = 1): (e^{40}, e^{80}, -e^{-40}, e^{-80}) -- every in-front
    // receiver's warp `exp(c * d)`, d < 1, is <= e^{40} and therefore fails the Chebyshev
    // bound's "in front of the mean" test. A clear of 0 would read as "occluded by nothing" and
    // paint shadow holes wherever a cascade cell had no geometry.
    const farE = Math.exp(40);
    this._evsmFarClear = [farE, farE * farE, -1 / farE, 1 / (farE * farE)];

    if (!this._evsmSupported) {
      console.warn(
        "[WebGL2Renderer] EXT_color_buffer_float is unavailable: EVSM (quality.shadowMode = " +
          "'evsm') falls back to the default shadow mapping instead of a broken moment atlas.",
      );
      return;
    }
    if (this._evsmDummyTexture) return;
    const tex = this.gl.createTexture();
    if (!tex) return;
    this.gl.bindTexture(this.gl.TEXTURE_2D, tex);
    this.gl.texImage2D(
      this.gl.TEXTURE_2D,
      0,
      this.gl.RGBA32F,
      1,
      1,
      0,
      this.gl.RGBA,
      this.gl.FLOAT,
      null,
    );
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
    this._evsmDummyTexture = tex;
  }

  /**
   * Creates the RGBA32F moment atlas (color-only FBO). Its depth attachment is the CSM depth-atlas
   * texture, attached per frame in `_renderEvsmMoments` so a freshly created atlas never holds a
   * stale depth reference. Returns false on failure so the caller can fall back to the default
   * shadow mapping for this frame instead of rendering into a broken framebuffer.
   */
  private _ensureEvsmAtlas(atlasWidth: number, atlasHeight: number): boolean {
    if (this._evsmAtlasTexture && this._evsmAtlasFbo) return true;
    if (this._evsmAtlasTexture) {
      this.gl.deleteTexture(this._evsmAtlasTexture);
      this._evsmAtlasTexture = null;
    }
    if (this._evsmAtlasFbo) {
      this.gl.deleteFramebuffer(this._evsmAtlasFbo);
      this._evsmAtlasFbo = null;
    }
    const tex = this.gl.createTexture();
    const fbo = this.gl.createFramebuffer();
    if (!tex || !fbo) return false;
    this.gl.bindTexture(this.gl.TEXTURE_2D, tex);
    this.gl.texImage2D(
      this.gl.TEXTURE_2D,
      0,
      this.gl.RGBA32F,
      atlasWidth,
      atlasHeight,
      0,
      this.gl.RGBA,
      this.gl.FLOAT,
      null,
    );
    // NEAREST: the EVSM evaluation performs its own deterministic 3x3 box filter over exact
    // texel taps (evalEVSMDir), so hardware LINEAR on the RGBA32F atlas would double-filter and,
    // more importantly, depend on the optional float-linear sampling path (OES_texture_float_linear)
    // which SwiftShader/ANGLE reports present but samples as zeros here, blacking out the whole
    // EVSM path. NEAREST keeps the shader's box filter exact, byte-deterministic and driver-robust.
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.NEAREST);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.NEAREST);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, fbo);
    this.gl.framebufferTexture2D(
      this.gl.FRAMEBUFFER,
      this.gl.COLOR_ATTACHMENT0,
      this.gl.TEXTURE_2D,
      tex,
      0,
    );
    const status = this.gl.checkFramebufferStatus(this.gl.FRAMEBUFFER);
    if (status !== this.gl.FRAMEBUFFER_COMPLETE) {
      console.warn(
        `[WebGL2Renderer] EVSM moment framebuffer incomplete (0x${status.toString(16)}); ` +
          "falling back to the default shadow mapping.",
      );
      return false;
    }
    this._evsmAtlasTexture = tex;
    this._evsmAtlasFbo = fbo;
    return true;
  }

  /**
   * Binds the EVSM uniforms + moment-atlas sampler for the current program (ADR 0043). Always a
   * valid binding: EVSM only becomes active when opted in (quality.shadowMode === ShadowMode.EVSM) AND
   * supported (EXT_color_buffer_float) AND a real atlas exists, otherwise the mode flag is 0 and
   * the sampler references the 1x1 dummy so every lit shader (incl. the GLSL300 water chunks)
   * takes its byte-identical default path. Called from BOTH branches of _bindDirectionalShadowMaps
   * and (mode 0) from _bindDummyShadowMaps.
   */
  private _bindEvsmShadowUniforms(cache: WebGLProgramCacheEntry, atlasReady: boolean): void {
    // In the default (PCSS/PCF) mode the EVSM helpers are dead code (`u_evsmParams.x === 0`), so a
    // dummy bind is not just unnecessary but harmful: it leaves TEXTURE_2D "active" on unit 14 and
    // clobbers the unit the material/light path expects, which degrades WebGL2 to a black canvas on
    // every lit program (regression caught by the Stage-C gate). Only opt-in EVSM binds the moment
    // lane + atlas here. See docs/adr/0043 for the byte-identical default guarantee.
    if (this._quality.shadowMode !== ShadowMode.EVSM) return;
    const paramsLoc = this._cachedUniformLocation(cache, "u_evsmParams");
    const mapLoc = this._cachedUniformLocation(cache, "u_dirEVSMMap");
    if (!paramsLoc && !mapLoc) return;
    this._checkEvsmSupport();
    const active =
      atlasReady && this._quality.shadowMode === ShadowMode.EVSM && this._evsmSupported;
    if (paramsLoc) {
      this._scratchFloat4[0] = active ? 1.0 : 0.0;
      this._scratchFloat4[1] = WebGL2Renderer._EVSM_VARIANCE_FLOOR;
      this._scratchFloat4[2] = WebGL2Renderer._EVSM_LIGHT_BLEED;
      this._scratchFloat4[3] = WebGL2Renderer._EVSM_RECEIVE_BIAS;
      this.gl.uniform4fv(paramsLoc, this._scratchFloat4);
    }
    if (mapLoc) {
      // Bind the moment atlas/dummy on the sampler unit the program cache reserved EXCLUSIVELY
      // for u_dirEVSMMap within this program (guaranteed distinct from every material texture and
      // from the spot/dir/raw shadow and cluster units) -- NOT on the fixed _EVSM_MAP_UNIT 14, which
      // is CLUSTER_GRID_UNIT: the RG32UI cluster-grid texture WebGLClusterCullPass binds each frame.
      // Putting the RGBA32F atlas there evicted the grid, and every u_clusterGrid fetch then hit a
      // float texture through an integer sampler (GL_INVALID_OPERATION each draw, plus broken
      // clustered lighting). _bindSubgroupTextures skips u_dirEVSMMap (see there), so nothing
      // re-points or unbinds this unit between here and the draw. Inert for the default pcss/pcf
      // path (early return above). A program that somehow had the sampler uniform active without
      // an allocated unit falls back to the fixed unit.
      const unit = cache.samplerUnits.get("u_dirEVSMMap") ?? WebGL2Renderer._EVSM_MAP_UNIT;
      if (this._ensureShadowMapUnit(unit, "EVSM moment map")) {
        const useAtlas = active && this._evsmAtlasTexture;
        this.gl.activeTexture(this.gl.TEXTURE0 + unit);
        this.gl.bindTexture(
          this.gl.TEXTURE_2D,
          useAtlas ? this._evsmAtlasTexture : this._evsmDummyTexture,
        );
        this.gl.uniform1i(mapLoc, unit);
        // State hygiene: the material/light path binds textures with an explicit activeTexture
        // per unit, so leaving unit 14 "active" here is meaningless at best and, on paths that
        // assume the default unit (TEXTURE0), redirects their next bind into this sampler slot.
        // Restore the default unit so a subsequent bare bind stays where the caller expects.
        this.gl.activeTexture(this.gl.TEXTURE0);
      }
    }
  }

  /**
   * Renders the EVSM moment atlas (ADR 0043) per cascade, immediately after the depth pass while
   * the CSM depth atlas is still an attached depth source. Runs only for
   * quality.shadowMode === ShadowMode.EVSM with EXT_color_buffer_float present. Geometry/culling/VP reuse
   * the exact depth-pass conventions (same FRONT cull, per-cascade viewport + global UBO), so the
   * moments describe the same front-most surface the depth pass just recorded.
   */
  private _renderEvsmMoments(
    light: DirectionalLight,
    depthFbo: WebGL2DepthFrameBuffer,
    cols: number,
    res: number,
    atlasWidth: number,
    atlasHeight: number,
    emptyLights: LightDataInterface,
    sortedGroups: RenderBatch[],
  ): void {
    this._checkEvsmSupport();
    if (!this._evsmSupported) return;
    if (!this._ensureEvsmAtlas(atlasWidth, atlasHeight)) return;
    if (!this._evsmAtlasFbo || !this._evsmAtlasTexture) return;

    // Reuse the depth atlas (already holding this frame's cascades) as the depth test source.
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this._evsmAtlasFbo);
    this.gl.framebufferTexture2D(
      this.gl.FRAMEBUFFER,
      this.gl.DEPTH_ATTACHMENT,
      this.gl.TEXTURE_2D,
      depthFbo.texture,
      0,
    );

    // Render front faces (cullFace(BACK), matching WebGPU CascadedShadowPassGPU / EvsmMomentMaterial)
    // so the moment atlas stores the closest caster surface rather than the back face. Back-face
    // moments (cullFace(FRONT)) have zero depth separation (d -> 0) where a caster's base meets the
    // floor, which forces Chebyshev's variance / (variance + d^2) -> 1.0 (Peter-Panning at the base).
    this.gl.depthMask(true);
    this.gl.depthFunc(this.gl.LESS);
    this.gl.enable(this.gl.DEPTH_TEST);
    this.gl.disable(this.gl.BLEND);
    this.gl.enable(this.gl.CULL_FACE);
    this.gl.cullFace(this.gl.BACK);

    for (let i = 0; i < light.numCascades; i++) {
      const cascadeCam = light.cascadeCameras[i];
      if (!cascadeCam) continue;
      const col = i % cols;
      const row = Math.floor(i / cols);
      this.gl.viewport(col * res, row * res, res, res);

      // Scissor-clear this cascade's cell to the far-plane moment vector + depth 1.0, so texels with
      // no caster evaluate as LIT instead of as shadow holes (gl.clear ignores the viewport).
      this.gl.enable(this.gl.SCISSOR_TEST);
      this.gl.scissor(col * res, row * res, res, res);
      this.gl.clearColor(
        this._evsmFarClear[0],
        this._evsmFarClear[1],
        this._evsmFarClear[2],
        this._evsmFarClear[3],
      );
      this.gl.clear(this.gl.COLOR_BUFFER_BIT | this.gl.DEPTH_BUFFER_BIT);
      this.gl.disable(this.gl.SCISSOR_TEST);

      this.updateGlobalUBO(cascadeCam.viewProjectionMatrix, cascadeCam.position, emptyLights);

      this._renderShadowScene(
        MaterialType.EVSM,
        EvsmMomentMaterial.LINE_QUADS_SHADER_ID,
        2 / res,
        sortedGroups,
      );
    }

    // Restore the scene's row clear color: the far-plane scissor clears above `gl.clearColor`d an
    // astronomically bright vector (e^40, e^80, ...) that would otherwise leak into the main
    // pass's `clear(COLOR_BUFFER_BIT | DEPTH_BUFFER_BIT)` and paint the whole canvas as
    // clamp(e^40)->255, clamp(e^80)->255, clamp(-e^-40)->0 -- the flat yellow Stage-C regression.
    {
      const cc = this.clearColor;
      this.gl.clearColor(cc.r, cc.g, cc.b, cc.a);
    }

    // Restore the depth state the rest of the frame expects.
    this.gl.depthMask(true);
    this.gl.depthFunc(this.gl.LESS);
    this.gl.cullFace(this.gl.BACK);
  }

  /**
   * Helper to render the actual geometry for a shadow pass with the `shaderId` depth-only program
   * (DEPTH or EVSM). `InstancedMesh` casters switch to that program's instanced variant, so every
   * instance casts, not just the mesh's own transform. Line casters with a `shadowWidth` use
   * `lineShaderId` instead and draw their edge ribbon as world-width quads (ADR 0045);
   * `texelNdc` is one shadow-map texel in NDC, the quads' minimum width.
   */
  private _renderShadowScene(
    shaderId: string,
    lineShaderId: string,
    texelNdc: number,
    sortedGroups: RenderBatch[],
  ): void {
    const stdCache = this._programCache.getProgram(shaderId);
    let instCache: WebGLProgramCacheEntry | undefined;
    let lineCache: WebGLProgramCacheEntry | undefined;
    let lineInstCache: WebGLProgramCacheEntry | undefined;
    let current: WebGLProgramCacheEntry | undefined;

    for (let i = 0; i < sortedGroups.length; i++) {
      const batch = sortedGroups[i];
      if (batch!.shaderId === MaterialType.SKYBOX || batch!.objects.length === 0) continue;

      const drawMode = batch!.topology === Topology.LINE_LIST ? this.gl.LINES : this.gl.TRIANGLES;
      const objects = batch!.objects;
      const firstObj = objects[0]!;
      if (!firstObj.material) continue;

      const manifest = firstObj.material.getRenderManifest();
      const lineQuads = usesLineQuadShadow(batch!);
      // The edge ribbon is two-sided triangles: never culled.
      if (lineQuads) this.gl.disable(this.gl.CULL_FACE);
      // Program the batch uniforms (alpha test / line width) were last set on; a switch re-sets them.
      let batchBound: WebGLProgramCacheEntry | undefined;

      // Automatic instancing (ADR 0046): same-geometry caster runs go through the instanced
      // depth/EVSM program in one draw each; the rest stays on the per-object loop below.
      let perObject: readonly Object3D[] = objects;
      if (
        !lineQuads &&
        this._quality.autoInstancing !== false &&
        objects.length >= AUTO_INSTANCING_MIN_RUN
      ) {
        const runObjects = this._scratchRunObjects;
        const runs = this._scratchRuns;
        partitionInstanceRuns(objects, runObjects, runs, this._scratchRunRest, true);
        if (runs.length > 0) {
          perObject = this._scratchRunRest;
          const cache = (instCache ??= this._programCache.getProgram(shaderId, true));
          if (cache !== current) {
            this.gl.useProgram(cache.prog);
            this._bindDummyShadowMaps(cache);
            current = cache;
          }
          if (cache !== batchBound) {
            this._bindShadowBatchUniforms(cache, manifest);
            batchBound = cache;
          }
          for (let r = 0; r < runs.length; r += 2) {
            const start = runs[r]!;
            const end = runs[r + 1]!;
            for (let j = start; j < end; j++) {
              this._textures.acquireTextures(runObjects[j]!, manifest.textures);
            }
            this._renderInstanceRun(
              runObjects,
              start,
              end,
              cache,
              batch!.topology,
              batch!.wireframeMode,
            );
          }
        }
      }

      for (const o of perObject) {
        if (!o.castShadow || !o.geometry) continue;
        const isInstanced = o instanceof InstancedMesh;
        if (isInstanced && o.instanceCount === 0) continue;

        let cache: WebGLProgramCacheEntry;
        if (lineQuads) {
          cache = isInstanced
            ? (lineInstCache ??= this._programCache.getProgram(lineShaderId, true))
            : (lineCache ??= this._programCache.getProgram(lineShaderId));
        } else {
          cache = isInstanced
            ? (instCache ??= this._programCache.getProgram(shaderId, true))
            : stdCache;
        }
        if (cache !== current) {
          this.gl.useProgram(cache.prog);
          this._bindDummyShadowMaps(cache);
          current = cache;
        }
        if (cache !== batchBound) {
          if (lineQuads) {
            const params = this._lineShadowParams;
            params[2] = texelNdc;
            params[3] = batch!.shadowWidth! * 0.5;
            const loc = cache.uniforms.get("u_extraParams");
            if (loc) this.gl.uniform4fv(loc, params);
          } else {
            this._bindShadowBatchUniforms(cache, manifest);
          }
          batchBound = cache;
        }

        // NOTE: This pass deliberately does NOT acquireProgram() the DEPTH program per object.
        // The DEPTH program is renderer-infrastructure (fixed cascade/spot variants, already
        // compiled via getProgram above), not a per-object resource. Acquiring it here would
        // overwrite each caster's `_lastKnownProgramKey` with the DEPTH key, forcing the
        // standard pass to release-and-reacquire the object's real material key every frame --
        // and when the object is the last holder of that material program, the shared program
        // is DELETED and RECOMPILED each frame (the "shader churn" stutter). Leaves the DEPTH
        // program resident across the session like any other infrastructure resource.
        this._textures.acquireTextures(o, manifest.textures);

        let ribbon: GLLineRibbon | undefined;
        if (lineQuads) {
          ribbon = this._geometry
            .getOrCreateMesh(o, o.geometry)
            .getLineRibbon(o.geometry, batch!.wireframeMode ?? WireframeMode.DEFAULT);
          if (!ribbon) continue;
        }

        if (isInstanced) {
          this._renderInstancedObject(o, cache, batch!.topology, batch!.wireframeMode, ribbon);
          continue;
        }

        this._uploadModelMatrix(o.worldMatrix.data, undefined, undefined, cache.uniforms);

        const mesh = this._geometry.getOrCreateMesh(o, o.geometry);

        if (ribbon) {
          // Default VAO: the mesh's cached VAO must keep its own attribute pointers.
          this.gl.bindVertexArray(null);
          mesh.bindLineRibbon(ribbon);
          this.gl.drawArrays(this.gl.TRIANGLES, 0, ribbon.vertexCount);
          continue;
        }

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

      if (lineQuads) this.gl.enable(this.gl.CULL_FACE);
    }
  }

  /** Alpha-test uniforms of one shadow batch on `cache` (the caster material's cutout map). */
  private _bindShadowBatchUniforms(cache: WebGLProgramCacheEntry, manifest: RenderManifest): void {
    const uExtraLoc = cache.uniforms.get("u_extraParams");
    const extraParams = manifest.properties["u_extraParams"] as Float32Array | number[];

    if (extraParams && extraParams[1]! > 0.0 && manifest.textures["u_diffuseMap"]) {
      this.gl.activeTexture(this.gl.TEXTURE0);
      const tex = manifest.textures["u_diffuseMap"] as Texture;
      this.gl.bindTexture(this.gl.TEXTURE_2D, this._textures.getWebGLTexture(tex, this._quality));
      const uDiffuseLoc = cache.uniforms.get("u_diffuseMap");
      if (uDiffuseLoc) this.gl.uniform1i(uDiffuseLoc, 0);
      if (uExtraLoc) this.gl.uniform4fv(uExtraLoc, extraParams as Float32Array);
      return;
    }

    if (uExtraLoc) this.gl.uniform4fv(uExtraLoc, this._zeroVec4);
  }

  /**
   * Binds dummy depth textures to shadow samplers to satisfy WebGL2 sampler2DShadow validation rules.
   */
  private _bindDummyShadowMaps(cache: WebGLProgramCacheEntry): void {
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

    // EVSM (ADR 0043): every program with an active u_dirEVSMMap sampler needs a valid binding
    // even when no real moment atlas exists yet. _bindDirectionalShadowMaps later overrides this
    // with the real atlas when EVSM is active (mode 0 here keeps the shader on its default path).
    this._bindEvsmShadowUniforms(cache, false);
  }

  /**
   * Uniform location lookup that also caches misses: a program without the uniform would
   * otherwise hit the driver with `getUniformLocation` on every draw.
   */
  private _cachedUniformLocation(
    cache: WebGLProgramCacheEntry,
    name: string,
  ): WebGLUniformLocation | undefined {
    if (!cache.uniforms.has(name)) {
      cache.uniforms.set(name, this.gl.getUniformLocation(cache.prog, name) ?? undefined);
    }
    return cache.uniforms.get(name);
  }

  public renderBatch(
    batch: RenderBatch,
    vMat: Float32Array | undefined,
    _vp: Float32Array,
    _camPos: Vector3D,
    lights: LightDataInterface,
    scene: Scene,
  ): void {
    const objects = batch!.objects;
    if (objects.length === 0) return;

    // Reused partition buffers (cleared here): `_renderSubgroup` only iterates them synchronously.
    const instancedObjects = this._scratchInstancedObjects;
    const standardObjects = this._scratchStandardObjects;
    instancedObjects.length = 0;
    standardObjects.length = 0;

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

    // Automatic instancing (ADR 0046): same-geometry runs become one instanced draw each; only
    // the rest is drawn per object. Vertex colors stay per object (the instanced path binds none).
    let perObject: Object3D[] = standardObjects;
    if (
      this._quality.autoInstancing !== false &&
      standardObjects.length >= AUTO_INSTANCING_MIN_RUN &&
      manifest.state?.isSprite !== true &&
      manifest.state?.isDecal !== true &&
      manifest.flags?.includes(VERTEX_COLOR_FLAG) !== true
    ) {
      partitionInstanceRuns(
        standardObjects,
        this._scratchRunObjects,
        this._scratchRuns,
        this._scratchRunRest,
      );
      if (this._scratchRuns.length > 0) {
        perObject = this._scratchRunRest;
        this._renderSubgroup(
          batch!.shaderId,
          this._scratchRunObjects,
          true,
          manifest,
          vMat,
          topo,
          lights,
          scene,
          batch!.wireframeMode,
          this._scratchRuns,
        );
      }
    }

    if (perObject.length > 0) {
      this._renderSubgroup(
        batch!.shaderId,
        perObject,
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
    /** Auto-instancing runs over `objects` as `[start, end)` pairs (ADR 0046). */
    runs?: readonly number[],
  ): void {
    // --- 3. Build & Bind Shader ---
    const isInst =
      runs !== undefined ||
      ("instanceCount" in objects[0]! && (objects[0] as InstancedMesh).instanceCount > 0);
    const shaderFlags = this._buildSubgroupShaderFlags(objects[0], manifest, scene, isInst);

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
    this._bindSpotShadowMaps(cache, lights);
    this._bindDirectionalShadowMaps(cache, lights);

    this._bindFogUniforms(cache.uniforms, scene?.fog);

    this._bindGlobalIblUniforms(cache, scene);

    // --- 1. Bind Material States ---
    const state = manifest.state;
    this._bindMaterialState(state);
    this._bindGenericMaterialProperties(cache.uniforms, manifest.properties, false);

    this._bindSubgroupTextures(cache, shaderId, manifest);

    // --- 4. Render each object ---
    const texs = manifest.textures;

    if (runs) {
      for (let r = 0; r < runs.length; r += 2) {
        const start = runs[r]!;
        const end = runs[r + 1]!;
        for (let i = start; i < end; i++) {
          this._programCache.acquireProgram(objects[i]!, programKey);
          this._textures.acquireTextures(objects[i]!, texs);
        }
        this._renderInstanceRun(objects, start, end, cache, topology, wireframeMode);
      }
      return;
    }

    for (let i = 0; i < objects.length; i++) {
      const o = objects[i]!;
      if (!o.geometry) continue;

      this._programCache.acquireProgram(o, programKey);
      this._textures.acquireTextures(o, texs);

      if (isInstanced) {
        this._renderInstancedObject(o as InstancedMesh, cache, topology, wireframeMode);
      } else {
        this._renderStandardObject(o, cache, state, vMat, topology, wireframeMode);
      }
    }
  }

  /**
   * True when `unit` may be used for a shadow-map sampler (still below the driver's texture-unit
   * limit). Logs exactly the per-light warning the original inline checks did and lets the caller
   * skip the offending bind. Single warning site for the spot + directional paths.
   */
  private _ensureShadowMapUnit(unit: number, label: string): boolean {
    const maxUnits = this.context.deviceCaps.getLimit(DeviceLimit.WEBGL2_MAX_TEXTURE_IMAGE_UNITS);
    if (unit < maxUnits) return true;
    console.warn(
      `[WebGL2Renderer] Exceeded MAX_TEXTURE_IMAGE_UNITS (${maxUnits}). Cannot bind ${label} to texture unit ${unit}.`,
    );
    return false;
  }

  /**
   * Builds the `USE_*` shader-variant flags for a subgroup. Grouped per subgroup (not per object):
   * every object sharing a batch shares its material's shader variant, so optional-feature
   * detection reads the first object's skin/IBL/texture-array state exactly once. `USE_INSTANCE_COLOR`
   * is a per-mesh opt-in and stays disjoint from the generic `instanceData` (texture-array index)
   * semantics. Same single array allocation as the previous inline build.
   */
  private _buildSubgroupShaderFlags(
    firstObject: Object3D | undefined,
    manifest: RenderManifest,
    scene: Scene | undefined,
    isInst: boolean,
  ): string[] {
    const shaderFlags = manifest.flags
      ? [...(resolveManifestFlags(manifest.flags, this._quality.disableTextures) ?? [])]
      : [];

    if (
      firstObject &&
      ((isSkinnedMesh(firstObject) && firstObject.skeleton) || firstObject.geometry?.joints)
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
    if (isInst && firstObject instanceof InstancedMesh && firstObject.useInstanceDataAsColor) {
      shaderFlags.push("USE_INSTANCE_COLOR");
    }

    return shaderFlags;
  }

  /** Binds shadow maps for the up-to-4 spot lights declared by the subgroup's material/program. */
  private _bindSpotShadowMaps(cache: WebGLProgramCacheEntry, lights?: LightDataInterface): void {
    if (!lights || lights.sLights.length === 0) return;

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
          if (!this._ensureShadowMapUnit(texUnit, "spot shadow map")) continue;
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

  /**
   * Binds the directional shadow map + cascade matrices, or (when no cascade depth exists --
   * including offscreen probe targets and absent lights) unbinds the samplers to their dummy
   * units. The unbind arm always runs: leaving a live sampler pointing at a stale unit would
   * sample garbage next draw.
   */
  private _bindDirectionalShadowMaps(
    cache: WebGLProgramCacheEntry,
    lights?: LightDataInterface,
  ): void {
    // Deliberately skipped while rendering into an offscreen target (a DynamicReflectionProbe
    // face or a PlanarReflectionNode): cascade selection picks a split by this DRAW's
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
      // EVSM (ADR 0043): mode flag + moment-atlas sampler. Active only when every gate is green
      // (mode opt-in, EXT_color_buffer_float, real atlas from this frame's moment pass) -- runs
      // before the fbo checks so a missing FBO still yields a valid dummy + mode-0 binding.
      this._bindEvsmShadowUniforms(cache, !!fbo);
      if (fbo && fbo.texture) {
        const texUnit = 12; // TEXTURE12
        if (!this._ensureShadowMapUnit(texUnit, "directional shadow map")) return;
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
            this.gl.uniformMatrix4fv(matLoc, false, light.cascadeCameras[i]!.viewProjectionMatrix);
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

        // PCSS knobs (evalPCSSDir), same defaults as the WebGPU GlobalUniformWriter.
        const softLoc = cache.uniforms.get("u_shadowSoftness");
        if (softLoc) {
          this._scratchFloat4[0] = this._quality.shadowSoftness ?? 1.0;
          this._scratchFloat4[1] = this._quality.shadowMaxPcfRadius ?? 4.0;
          this._scratchFloat4[2] = 0.0;
          this._scratchFloat4[3] = 0.0;
          this.gl.uniform4fv(softLoc, this._scratchFloat4);
        }
      }
    } else {
      // No shadow-casting directional light: EVSM mode stays 0 with the dummy sampler bound.
      this._bindEvsmShadowUniforms(cache, false);
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
  }

  /**
   * Binds the scene-global IBL resources (environment intensity, irradiance + prefilter cube
   * maps, BRDF LUT) on their reserved sampler units. Each sampler is claimed with at least a
   * fallback texture even without real IBL data: leaving an active sampler unassigned defaults
   * it to unit 0, colliding with whatever 2D sampler legitimately owns that unit.
   */
  private _bindGlobalIblUniforms(cache: WebGLProgramCacheEntry, scene?: Scene): void {
    if (!scene) return;
    const u = cache.uniforms;

    const intLoc = u.get("u_envIntensity");
    if (intLoc) this.gl.uniform1f(intLoc, scene.environmentIntensity);

    // Irradiance Map
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
    if (brdfLoc && undefined !== brdfUnit && this._isTextureUnitAvailable(brdfUnit, "u_brdfLUT")) {
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

  /**
   * Binds this subgroup's material textures onto their reserved sampler units (reusing the cube
   * fallback for samplerCube uniforms and the per-uniform fallback textures for unassigned maps).
   * IBL maps are scene-global (bound once by `_bindGlobalIblUniforms`) and are intentionally
   * skipped here: rebinding them would clobber the correct binding and re-trigger the sampler-type
   * collision this loop is meant to avoid.
   */
  private _bindSubgroupTextures(
    cache: WebGLProgramCacheEntry,
    shaderId: string,
    manifest: RenderManifest,
  ): void {
    const u = cache.uniforms;
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
        if (
          "u_irradianceMap" === uniformName ||
          "u_prefilterMap" === uniformName ||
          "u_brdfLUT" === uniformName ||
          // EVSM (ADR 0043): u_dirEVSMMap is a renderer-owned sampler managed by
          // _bindEvsmShadowUniforms on its own reserved unit, NOT a material texture. Routing it
          // through this loop rebinds the 1x1 WHITE defaultTexture on u_dirEVSMMap's allocated
          // low unit and re-points the uniform there, so the EVSM fragment path samples white
          // moments (m1=m2=1.0) instead of the moment atlas -> chebyshevUpperBoundEVSM returns ~0
          // -> dirShadow ~ 0 -> the whole EVSM frame goes black with only faint ambient surviving.
          // Skipping it here keeps the atlas binding set by _bindDirectionalShadowMaps intact at
          // draw time. Inert for the default PCSS/PCF path (u_dirEVSMMap is never sampled there).
          "u_dirEVSMMap" === uniformName
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
  }

  /**
   * Instanced draw for one `InstancedMesh`: upper-bound validation, then manual attribute setup
   * for the instance matrix/data on the DEFAULT VAO (never the mesh's cached VAO, whose pointers
   * must stay pristine for the non-instanced path), the instanced draw, and the attribute reset.
   * `wireframeMode` picks the edge buffer for structural line meshes, like the non-instanced path.
   * With a `ribbon` (line-quad shadow draw, ADR 0045) the edge ribbon replaces the mesh buffers.
   */
  private _renderInstancedObject(
    instMesh: InstancedMesh,
    cache: WebGLProgramCacheEntry,
    topology: Topology,
    wireframeMode?: WireframeMode,
    ribbon?: GLLineRibbon,
  ): void {
    if (instMesh.instanceCount < 0) {
      throw new Error(`[WebGL2Renderer] Invalid instanceCount: ${instMesh.instanceCount}`);
    }
    if (instMesh.instanceMatrices.byteLength < instMesh.instanceCount * 64) {
      throw new Error(
        `[WebGL2Renderer] InstancedMesh matrix buffer too small: required at least ${instMesh.instanceCount * 64} bytes for ${instMesh.instanceCount} instances, but buffer is ${instMesh.instanceMatrices.byteLength} bytes.`,
      );
    }
    if (instMesh.instanceData && instMesh.instanceData.byteLength < instMesh.instanceCount * 16) {
      throw new Error(
        `[WebGL2Renderer] InstancedMesh instanceData buffer too small: required at least ${instMesh.instanceCount * 16} bytes for ${instMesh.instanceCount} instances, but buffer is ${instMesh.instanceData.byteLength} bytes.`,
      );
    }

    this.gl.bindVertexArray(null);

    this._uploadModelMatrix(instMesh.worldMatrix.data, undefined, undefined, cache.uniforms);

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

    let dataBuf: WebGLBuffer | undefined;
    if (instMesh.instanceData && cache.attributes.has("a_instanceData")) {
      dataBuf = this._instanceDataBuffers.get(instMesh);
      if (!dataBuf) {
        dataBuf = this.gl.createBuffer()!;
        this._instanceDataBuffers.set(instMesh, dataBuf);
      }
      if (instMesh.instanceDataNeedsUpdate) {
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, dataBuf);
        this.gl.bufferData(this.gl.ARRAY_BUFFER, instMesh.instanceData, this.gl.DYNAMIC_DRAW);
        instMesh.instanceDataNeedsUpdate = false;
      }
    }

    const mesh = this._geometry.getOrCreateMesh(instMesh, instMesh.geometry!);
    this._drawInstanced(
      mesh,
      cache,
      matrixBuf,
      instMesh.instanceCount,
      topology,
      wireframeMode,
      ribbon,
      dataBuf,
      instMesh.instanceDataSize,
    );
  }

  /**
   * Automatic instancing (ADR 0046): draws `objects[start..end)` (same geometry, see
   * `partitionInstanceRuns`) as one instanced draw with an identity `u_model`; each object's world
   * matrix is uploaded as its instance matrix.
   */
  private _renderInstanceRun(
    objects: readonly Object3D[],
    start: number,
    end: number,
    cache: WebGLProgramCacheEntry,
    topology: Topology,
    wireframeMode?: WireframeMode,
  ): void {
    const count = end - start;
    if (this._runStaging.length < count * 16) this._runStaging = new Float32Array(count * 32);
    const staging = this._runStaging;
    let mesh: Mesh | undefined;
    for (let i = 0; i < count; i++) {
      const o = objects[start + i]!;
      staging.set(o.worldMatrix.data, i * 16);
      // Per object, so each one's geometry refcount stays tracked like on the per-object path.
      mesh = this._geometry.getOrCreateMesh(o, o.geometry!);
    }

    this.gl.bindVertexArray(null);
    this._uploadModelMatrix(IDENTITY_MATRIX, undefined, undefined, cache.uniforms);
    this._runMatrixBuffer ??= this.gl.createBuffer()!;
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this._runMatrixBuffer);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, staging.subarray(0, count * 16), this.gl.STREAM_DRAW);

    this._drawInstanced(mesh!, cache, this._runMatrixBuffer, count, topology, wireframeMode);
  }

  /**
   * Shared tail of every instanced draw on the DEFAULT VAO (never a mesh's cached VAO, whose
   * pointers must stay pristine for the non-instanced path): binds the mesh (or a line-quad
   * `ribbon`, ADR 0045), the per-instance matrix (and optional data) attributes, draws, and resets
   * the attribute divisors. `wireframeMode` picks the structural edge buffer like `Mesh.draw()`.
   */
  private _drawInstanced(
    mesh: Mesh,
    cache: WebGLProgramCacheEntry,
    matrixBuf: WebGLBuffer,
    count: number,
    topology: Topology,
    wireframeMode?: WireframeMode,
    ribbon?: GLLineRibbon,
    dataBuf?: WebGLBuffer,
    dataSize: number = 4,
  ): void {
    if (ribbon) {
      mesh.bindLineRibbon(ribbon);
    } else {
      mesh.bind(
        cache.attributes.get("a_position")!,
        cache.attributes.get("a_normal")!,
        cache.attributes.get("a_uv")!,
        cache.attributes.get("a_tangent")!,
        cache.attributes.get("a_joints") ?? -1,
        cache.attributes.get("a_weights") ?? -1,
      );
    }

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
    const hasData = dataBuf !== undefined && dataLoc !== undefined && dataLoc >= 0;
    if (hasData) {
      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, dataBuf);
      this.gl.enableVertexAttribArray(dataLoc);
      this.gl.vertexAttribPointer(dataLoc, dataSize, this.gl.FLOAT, false, 0, 0);
      this.gl.vertexAttribDivisor(dataLoc, 1);
    }

    const drawMode = topology === Topology.LINE_LIST ? this.gl.LINES : this.gl.TRIANGLES;
    if (ribbon) {
      this.gl.drawArraysInstanced(this.gl.TRIANGLES, 0, ribbon.vertexCount, count);
    } else {
      mesh.drawInstanced(drawMode, count, wireframeMode);
    }

    if (loc !== undefined && loc >= 0) {
      for (let i = 0; i < 4; i++) {
        this.gl.vertexAttribDivisor(loc + i, 0);
        this.gl.disableVertexAttribArray(loc + i);
      }
    }
    if (hasData) {
      this.gl.vertexAttribDivisor(dataLoc, 0);
      this.gl.disableVertexAttribArray(dataLoc);
    }
  }

  /**
   * Non-instanced draw for one object in the subgroup: model-matrix + decal/skin uniform upload,
   * then geometry bind (cached VAO when the driver supports it, otherwise the per-program
   * attribute pointers) and the draw call.
   */
  private _renderStandardObject(
    o: Object3D,
    cache: WebGLProgramCacheEntry,
    state: RenderManifest["state"],
    vMat: Float32Array | undefined,
    topology: Topology,
    wireframeMode: WireframeMode | undefined,
  ): void {
    const u = cache.uniforms;

    // Model Matrix & Billboarding
    this._uploadModelMatrix(o.worldMatrix.data, state, vMat, u);

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
    const mesh = this._geometry.getOrCreateMesh(o, o.geometry!);

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
    const f = WebGL2GlobalUniformLayout.fields;
    ubo.setMatrix(f.vp.offset, vp);
    ubo.setVec3(f.viewPos.offset, camPos.x, camPos.y, camPos.z);

    // Scale colors by intensity without Vector3D allocations
    ubo.setVec3(
      f.ambientColor.offset,
      lights.aCol.r * lights.aIntensity,
      lights.aCol.g * lights.aIntensity,
      lights.aCol.b * lights.aIntensity,
    );
    ubo.setVec3(
      f.dirLightColor.offset,
      lights.dCol.r * lights.dIntensity,
      lights.dCol.g * lights.dIntensity,
      lights.dCol.b * lights.dIntensity,
    );
    ubo.setVec3(f.dirLightDir.offset, lights.dDir.x, lights.dDir.y, lights.dDir.z);
    // WebGL2's raw UBO light array still has 16 slots (see docs/adr/0007-clustered-lighting-webgl2-webgpu-only.md);
    // clamp explicitly now that the scene-wide cap is 64.
    ubo.setInt(f.numPointLights.offset, Math.min(lights.pLights.length, 16));
    ubo.setInt(f.numSpotLights.offset, Math.min(lights.sLights.length, 16));
    ubo.setInt(f.numAreaLights.offset, lights.aLights.length);
    const gamma = this.postProcessing.enabled ? 1.0 : (this._quality.gamma ?? 2.2);
    const exposure = this.postProcessing.enabled ? 1.0 : (this._quality.exposure ?? 1.0);
    ubo.setFloat(f.gamma.offset, gamma);
    ubo.setFloat(f.exposure.offset, exposure);

    for (let i = 0; i < f.pointLights.count; i++) {
      const offset = f.pointLights.offset + i * f.pointLights.stride;
      if (i < lights.pLights.length) {
        const pl = lights.pLights[i]!;
        const matData = pl.worldMatrix.data;
        ubo.setVec3(offset + WebGL2PointLightLayout.pos, matData[12]!, matData[13]!, matData[14]!);
        ubo.setVec3(
          offset + WebGL2PointLightLayout.color,
          pl.color.r * pl.intensity,
          pl.color.g * pl.intensity,
          pl.color.b * pl.intensity,
        );
        ubo.setFloat(offset + WebGL2PointLightLayout.distance, pl.distance);
        ubo.setFloat(offset + WebGL2PointLightLayout.decay, pl.decay);
      }
    }

    for (let i = 0; i < f.spotLights.count; i++) {
      const offset = f.spotLights.offset + i * f.spotLights.stride;
      if (i < lights.sLights.length) {
        const sl = lights.sLights[i]!;
        const slMat = sl.worldMatrix.data;
        const dir = sl.direction;
        const dirLen = Math.sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z) || 1.0;
        ubo.setVec3(offset + WebGL2SpotLightLayout.pos, slMat[12]!, slMat[13]!, slMat[14]!);
        ubo.setVec3(
          offset + WebGL2SpotLightLayout.dir,
          dir.x / dirLen,
          dir.y / dirLen,
          dir.z / dirLen,
        );
        ubo.setVec3(
          offset + WebGL2SpotLightLayout.color,
          sl.color.r * sl.intensity,
          sl.color.g * sl.intensity,
          sl.color.b * sl.intensity,
        );
        ubo.setFloat(offset + WebGL2SpotLightLayout.angleCos, Math.cos(sl.angle));
        ubo.setFloat(
          offset + WebGL2SpotLightLayout.angleCosPenumbra,
          Math.cos(sl.angle * (1.0 - sl.penumbra)),
        );
        ubo.setFloat(offset + WebGL2SpotLightLayout.distance, sl.distance);
        ubo.setFloat(offset + WebGL2SpotLightLayout.decay, sl.decay);
      }
    }

    for (let i = 0; i < f.areaLights.count; i++) {
      const offset = f.areaLights.offset + i * f.areaLights.stride;
      if (i < lights.aLights.length) {
        const al = lights.aLights[i]!;
        const mat = al.worldMatrix.data;
        ubo.setVec3(offset + WebGL2AreaLightLayout.pos, mat[12]!, mat[13]!, mat[14]!);
        ubo.setVec3(
          offset + WebGL2AreaLightLayout.color,
          al.color.r * al.intensity,
          al.color.g * al.intensity,
          al.color.b * al.intensity,
        );
        ubo.setVec3(offset + WebGL2AreaLightLayout.u, mat[0]!, mat[1]!, mat[2]!);
        ubo.setVec3(offset + WebGL2AreaLightLayout.v, mat[4]!, mat[5]!, mat[6]!);
        ubo.setVec3(offset + WebGL2AreaLightLayout.w, mat[8]!, mat[9]!, mat[10]!);
        ubo.setFloat(offset + WebGL2AreaLightLayout.widthHalf, al.width / 2.0);
        ubo.setFloat(offset + WebGL2AreaLightLayout.heightHalf, al.height / 2.0);
        ubo.setFloat(offset + WebGL2AreaLightLayout.distance, al.distance);
        ubo.setFloat(offset + WebGL2AreaLightLayout.decay, al.decay);
      }
    }

    ubo.setVec2(f.cameraNearFar.offset, near, far);
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
      this._postEffects ??= new GLPostEffects(this.gl, true, this.context.shaderRegistry);
    } else if (!this.postProcessing.enabled && this._hdrFbo) {
      this._postEffects?.destroy();
      this._postEffects = undefined;
      this._postCtx = undefined;
      this._hdrFbo.destroy();
      this._hdrFbo = undefined;
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
  public releaseRenderTarget(target: RenderTarget | RenderTargetCube): void {
    if (target instanceof RenderTargetCube) {
      this._renderTargetCubeFbos.get(target)?.destroy();
      this._renderTargetCubeFbos.delete(target);
      this._textures.unregisterCubeTexture(target);
    } else {
      this._renderTargetFbos.get(target)?.destroy();
      this._renderTargetFbos.delete(target);
      this._textures.unregisterTexture(target);
    }
    // The FBO (and its colour texture) is gone: a later render into the target re-allocates it.
    target.isLoaded = false;
  }

  /** @inheritdoc */
  public override destroy(): void {
    this.uninstallContextLossHandling();
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
      if (this._runMatrixBuffer) gl.deleteBuffer(this._runMatrixBuffer);
      if (this._rawDepthSampler) gl.deleteSampler(this._rawDepthSampler);
      this._hdrFbo?.destroy();
      if (this._opaqueNormalTexture) this.gl.deleteTexture(this._opaqueNormalTexture);
      if (this._opaqueNormalFbo) this.gl.deleteFramebuffer(this._opaqueNormalFbo);
      this._opaqueNormalTexture = undefined;
      this._opaqueNormalFbo = undefined;
      if (this._evsmAtlasTexture) gl.deleteTexture(this._evsmAtlasTexture);
      if (this._evsmAtlasFbo) gl.deleteFramebuffer(this._evsmAtlasFbo);
      if (this._evsmDummyTexture) gl.deleteTexture(this._evsmDummyTexture);
      this._evsmAtlasTexture = null;
      this._evsmAtlasFbo = null;
      this._evsmDummyTexture = null;
      this._postEffects?.destroy();
      this._globalUBO?.destroy();
      // Renderer-owned textures / FBOs that used to leak on destroy().
      for (const tex of [
        this._clusterGridTex,
        this._clusterIndexTex,
        this._opaqueTexture,
        this._opaqueDepthTexture,
        this._blackCubeTexture,
        this._defaultBrdfTexture,
      ]) {
        if (tex) gl.deleteTexture(tex);
      }
      if (this._opaqueDepthFbo) gl.deleteFramebuffer(this._opaqueDepthFbo);
      this._opaqueTexture = undefined;
      this._opaqueDepthTexture = undefined;
      this._opaqueDepthFbo = undefined;
    }

    this._texCache.clear();
    this._renderTargetFbos.clear();
    this._renderTargetCubeFbos.clear();
    this._shadowMaps.clear();
    this._hdrFbo = undefined;
    this._postEffects = undefined;
    this._postCtx = undefined;

    super.destroy();
  }
}
