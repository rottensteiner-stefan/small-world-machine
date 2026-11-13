import { WebGL2UniformBuffer } from "./WebGL2UniformBuffer.js";
import { WebGL2GlobalUniformLayout } from "../GlobalUniformLayout.js";
import type { WebGLProgramCacheEntry } from "../gl/managers/WebGLProgramCache.js";
import { WebGLProgramCache } from "../gl/managers/WebGLProgramCache.js";
import { WebGLTextureManager } from "../gl/managers/WebGLTextureManager.js";
import { WebGLBufferManager } from "../gl/managers/WebGLBufferManager.js";
import { NORMAL_OUTPUT_FLAG } from "../gl/managers/NormalOutputWrapperGL.js";
import {
  AbstractWebGLRenderer,
  type InstanceFieldDrawContext,
  type InstanceFieldDrawPass,
} from "../AbstractWebGLRenderer.js";
import type { InstanceFieldGL } from "../gl/managers/InstanceFieldGL.js";
import { INSTANCE_RECORD_BYTES, type CpuIndirectDrawSource } from "../../core/InstanceField.js";
import { WebGLShadowPass } from "../passes/WebGLShadowPass.js";
import { WebGLMainPass } from "../passes/WebGLMainPass.js";
import { WebGLPostProcessPass } from "../passes/WebGLPostProcessPass.js";
import { WebGLClusterCullPass } from "../passes/WebGLClusterCullPass.js";
import type {
  CubeTexture,
  Texture,
  RenderTarget,
  RenderTargetCube,
} from "../../core/textures/index.js";
import type { RenderManifest } from "../shaders/index.js";
import { VERTEX_COLOR_FLAG, resolveManifestFlags } from "../shaders/index.js";
import { MAX_SKINNED_BONES, isSkinnedMesh } from "../../core/animation/index.js";
import type { Color } from "../../core/colors/index.js";
import type { Object3D, RenderBatch, Scene, TextureArray } from "../../core/index.js";
import { DeviceLimit, InstancedMesh, computeClipToBox } from "../../core/index.js";
import { DepthMaterial } from "../../core/materials/index.js";
import { EvsmMomentMaterial } from "../../core/materials/EvsmMomentMaterial.js";
import type { EngineOptions, LightDataInterface, QualityConfig } from "../../interfaces/index.js";
import {
  MaterialType,
  RendererType,
  ShaderFlag,
  ShadowMode,
  Topology,
  WireframeMode,
} from "../../enums/index.js";
import type { GLLineRibbon, Mesh } from "../Mesh.js";
import { AUTO_INSTANCING_MIN_RUN, partitionInstanceRuns } from "../AutoInstancing.js";
import { usesLineQuadShadow } from "../LineShadowRibbon.js";
import type { ClusterGridDims, Vector3D } from "../../math/index.js";
import { Matrix4, CLUSTER_GRID_UNIT, CLUSTER_INDEX_UNIT } from "../../math/index.js";
import { WebGL2ClusterManager } from "./managers/WebGL2ClusterManager.js";
import {
  writeWebGL2ClusterGridUniforms,
  writeWebGL2GlobalUBO,
} from "./managers/WebGL2GlobalUniformWriter.js";
import { WebGL2InstanceManager } from "./managers/WebGL2InstanceManager.js";
import { WebGL2OpaqueCapture } from "./managers/WebGL2OpaqueCapture.js";
import { WebGL2RenderTargetManager } from "./managers/WebGL2RenderTargetManager.js";
import { WebGL2ShadowManager, type WebGL2ShadowHost } from "./managers/WebGL2ShadowManager.js";

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

  private readonly _instances: WebGL2InstanceManager = new WebGL2InstanceManager();
  private readonly _opaqueCapture: WebGL2OpaqueCapture = new WebGL2OpaqueCapture();
  private readonly _renderTargets: WebGL2RenderTargetManager = new WebGL2RenderTargetManager();
  private readonly _clusters: WebGL2ClusterManager = new WebGL2ClusterManager();
  private readonly _shadows: WebGL2ShadowManager = new WebGL2ShadowManager();
  private _shadowHost: WebGL2ShadowHost | undefined = undefined;

  private _globalUBO!: WebGL2UniformBuffer;

  /** Clustered light culling grid state, see docs/adr/0007-clustered-lighting-webgl2-webgpu-only.md.
   * Read (never written) by `WebGLClusterCullPass` via the getters below. */
  public get clusterDims(): ClusterGridDims {
    return this._clusters.dims;
  }
  public get clusterMaxLightsPerCluster(): number {
    return this._clusters.maxLightsPerCluster;
  }
  public get clusterIndexCapacity(): number {
    return this._clusters.indexCapacity;
  }
  public get clusterGridTex(): WebGLTexture {
    return this._clusters.gridTex;
  }
  public get clusterIndexTex(): WebGLTexture {
    return this._clusters.indexTex;
  }

  /** Derived field-lane shader flags per committed `manifest.flags` array reference (ADR 0059). */
  private readonly _fieldFlagsCache = new WeakMap<string[], { flags: string[]; tag: number }>();
  private readonly _zeroVec4: Float32Array = new Float32Array(4);
  /** Scratch `u_extraParams` of a line-quad shadow batch: [1, 0, texel NDC, half width]. */
  private readonly _lineShadowParams: Float32Array = new Float32Array([1, 0, 0, 0]);

  /**
   * Dedicated black cube fallback for `u_irradianceMap`/`u_prefilterMap` when a scene has no real
   * IBL data.
   */
  private _blackCubeTexture!: WebGLTexture;
  /**
   * Dedicated `u_brdfLUT` fallback: (scale=1, bias=0) in .rg channels.
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
    this._shadows.createResources(this.gl);

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

    this._globalUBO = new WebGL2UniformBuffer(this.gl, WebGL2GlobalUniformLayout.totalBytes, 0);
    this._programCache = new WebGLProgramCache(this.gl, this.context.shaderRegistry, {
      globalUBO: this._globalUBO,
      dialect: "glsl300",
    });
    this._clusters.allocate(this.gl, { x: 1, y: 1, z: 1 }, 1);
  }

  /** @inheritdoc */
  protected override onContextRestored(): void {
    // Re-arm registered field lanes FIRST (live-context VBO re-upload) so the first draw through
    // the pass hook after restore uses live handles, never one cycle stale.
    this._onFieldContextRestored();
    const clusterDims = this._clusters.dims;
    const clusterMaxLights = this._clusters.maxLightsPerCluster;
    this._texCache.clear();
    this._renderTargets.resetOnContextRestored();
    this._shadows.resetOnContextRestored();
    this._instances.resetOnContextRestored();
    this._opaqueCapture.resetOnContextRestored();
    this._clusters.resetOnContextRestored();

    this._createGpuResources();
    this._clusters.allocate(this.gl, clusterDims, clusterMaxLights);
    if (this.postProcessing.enabled) {
      this._renderTargets.ensurePostProcessFbo(
        this.gl,
        true,
        this._quality.normalBuffer === true,
        this.context.shaderRegistry,
      );
    }
  }

  /** Stages the clustered light culling grid metadata into the global UBO. */
  public writeClusterGridUniforms(tileSizePx: [number, number]): void {
    writeWebGL2ClusterGridUniforms(
      this._globalUBO,
      this._clusters.dims,
      this._clusters.maxLightsPerCluster,
      tileSizePx,
    );
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
    this._renderTargets.setRenderTarget(target, activeCubeFace);
  }

  /** @inheritdoc */
  public get activeRenderTarget(): RenderTarget | RenderTargetCube | null {
    return this._renderTargets.activeRenderTarget;
  }

  /** @inheritdoc */
  public get activeCubeFace(): number {
    return this._renderTargets.activeCubeFace;
  }

  /** @inheritdoc */
  public override get isOffscreenRenderTarget(): boolean {
    return this._renderTargets.isOffscreenRenderTarget;
  }

  /** @inheritdoc */
  protected override _onPostRender(): void {
    this._renderTargets.onPostRender();
  }

  /** @inheritdoc */
  public override get hasNormalTarget(): boolean {
    return this._renderTargets.hasNormalTarget(this.postProcessing.enabled);
  }

  /** The normal buffer texture (ADR 0028), or undefined while it is not being written. */
  public get normalTexture(): WebGLTexture | undefined {
    return this._renderTargets.normalTexture(this.postProcessing.enabled);
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
      this.gl.uniform1f(
        uHasNormals,
        this._opaqueCapture.opaqueNormalTexture && this.hasNormalTarget ? 1 : 0,
      );
    }
  }

  /** @inheritdoc */
  public override get canDrawDecals(): boolean {
    return this._renderTargets.canDrawDecals;
  }

  /** @inheritdoc */
  public override copyToOpaqueNormalTexture(): void {
    this._opaqueCapture.copyToOpaqueNormalTexture(
      this.gl,
      this._renderTargets.hdrFbo,
      this.hasNormalTarget,
    );
  }

  /** @inheritdoc */
  public override setNormalWriteEnabled(enabled: boolean): void {
    this._renderTargets.setNormalWriteEnabled(enabled);
  }

  /** @inheritdoc */
  public override clearNormalTarget(): void {
    this._renderTargets.clearNormalTarget(this.gl);
  }

  public bindMainRenderTarget(): boolean {
    return this._renderTargets.bindMainRenderTarget(
      this.gl,
      this.postProcessing.enabled,
      this._quality.normalBuffer === true,
      this._textures,
      this.context.shaderRegistry,
    );
  }

  public bindPostProcessRenderTarget(): void {
    // FBO is already bound in bindMainRenderTarget if needed, handled implicitly for now
  }

  public copyToOpaqueTexture(): void {
    this._opaqueCapture.copyToOpaqueTexture(
      this.gl,
      this._renderTargets.hdrFbo,
      this.postProcessing.enabled,
      this._textures,
    );
  }

  public copyToOpaqueDepthTexture(): void {
    this._opaqueCapture.copyToOpaqueDepthTexture(
      this.gl,
      this._renderTargets.hdrFbo,
      this._renderTargets.isOffscreenRenderTarget,
    );
  }

  public flushPostProcess(): void {
    this._renderTargets.flushPostProcess(this.gl, {
      postProcessing: this.postProcessing,
      viewProj: this._frameViewProj,
      camPos: this._frameCamPos,
      near: this._frameNear,
      far: this._frameFar,
      projMatrixData: this._frameProjMatrix!,
      lights: this._frameLights,
      fogVolumes: this._fogVolumes,
      frameInfo: this.frameInfo,
      scene: this._frameScene,
      quality: this._quality,
      textures: this._textures,
      opaqueDepthTexture: this._opaqueCapture.opaqueDepthTextureForPost,
      dirShadowTexture: this._shadows.getDirectionalShadowTexture(this._frameLights?.dLight),
      spotShadowTextures: this._shadows.collectFogSpotShadowTextures(this._frameLights),
      fallbackShadowTexture: this._shadows.fallbackShadowTexture,
      fallbackSpotShadowArray: this._shadows.fallbackSpotShadowArray,
      blackCubeTexture: this._blackCubeTexture,
    });
  }

  private _getShadowHost(): WebGL2ShadowHost {
    if (this._shadowHost) return this._shadowHost;
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    this._shadowHost = {
      get gl(): WebGL2RenderingContext {
        return self.gl;
      },
      get quality(): QualityConfig {
        return self._quality;
      },
      get targetClearColor(): Color {
        return self.targetClearColor;
      },
      get frameViewProj(): Matrix4 {
        return self._frameViewProj;
      },
      get frameCamPos(): Vector3D {
        return self._frameCamPos;
      },
      get frameSceneRoot(): Object3D | undefined {
        return self._frameScene?.root;
      },
      get globalUBO(): WebGL2UniformBuffer {
        return self._globalUBO;
      },
      updateGlobalUBO(vp, camPos, lights): void {
        self.updateGlobalUBO(vp, camPos, lights);
      },
      renderShadowScene(shaderId, lineShaderId, texelNdc, sortedGroups): void {
        self._renderShadowScene(shaderId, lineShaderId, texelNdc, sortedGroups);
      },
      drawFieldShadowView(shaderId, vp, pass, slotOverride): void {
        self._drawFieldShadowView(shaderId, vp, pass, slotOverride);
      },
    };
    return this._shadowHost;
  }

  /** Renders shadow maps for all shadow-casting lights. */
  public renderShadowMaps(lights: LightDataInterface, sortedGroups: RenderBatch[]): void {
    this._shadows.renderShadowMaps(this._getShadowHost(), lights, sortedGroups);
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
      const texVersion = this._textures.textureSetVersion(manifest.textures);
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
        const runObjects = this._instances.scratchRunObjects;
        const runs = this._instances.scratchRuns;
        const runRest = this._instances.scratchRunRest;
        partitionInstanceRuns(objects, runObjects, runs, runRest, true);
        if (runs.length > 0) {
          perObject = runRest;
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
              this._textures.acquireTextures(runObjects[j]!, manifest.textures, texVersion);
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
        this._textures.acquireTextures(o, manifest.textures, texVersion);

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

  /**
   * @inheritdoc — glsl300 field draw loop (ADR 0059 CPU-cell lane, option (i)): ONE static
   * cell-sorted 16-byte record VBO per field, `vertexAttribPointer` BYTE OFFSET per command, no
   * per-frame instance uploads. `opaque` uses the material's own program (+`USE_INSTANCE_FIELD`),
   * `shadow`/`evsm` the depth/moment programs. Every command draws one contiguous VBO range on
   * the DEFAULT VAO; the per-instance divisors are reset right after each draw so no stale
   * instanced pointer leaks into the non-instanced paths.
   */
  protected override _drawCpuIndirectSource(
    field: InstanceFieldGL,
    source: CpuIndirectDrawSource,
    pass: InstanceFieldDrawPass,
    ctx: InstanceFieldDrawContext,
  ): void {
    if (source.commands.length === 0) return;
    const gl = this.gl;
    const instanceVbo = field.instanceVbo;
    if (!instanceVbo) return;
    // Never a mesh's cached VAO: the record pointers must be rebound per command range.
    gl.bindVertexArray(null);

    let currentProgram: WebGLProgramCacheEntry | undefined;
    for (const cmd of source.commands) {
      const mesh = field.getGeometry(cmd.geometrySlot);
      if (!mesh) continue;
      const material = field.getMaterial(cmd.materialSlot);
      if (!material) continue;
      const manifest = material.material.getRenderManifest();

      let cache: WebGLProgramCacheEntry;
      if (pass === "opaque") {
        // `isInstanced = false`: never `USE_INSTANCING`, the field records bind their own
        // attributes (fixed 12/13) and `useProgram` below is the program switch guard only.
        const flags = this._buildFieldShaderFlags(manifest, ctx.scene);
        cache = this._programCache.getProgram(manifest.shaderId, false, flags);
        if (cache !== currentProgram) {
          gl.useProgram(cache.prog);
          this._bindFieldWindUniforms(field, cache);
          this._bindDummyShadowMaps(cache);
          currentProgram = cache;
          if (this._renderTargets.normalWriteRequested) {
            this._renderTargets.hdrFbo?.setSecondaryWriteEnabled(cache.writesNormalOutput);
          }
          // The clustered-light cull textures were bound by WebGLClusterCullPass (fixed units);
          // each program that converges them needs to know its units.
          const clusterGridLoc = cache.uniforms.get("u_clusterGrid");
          if (clusterGridLoc) gl.uniform1i(clusterGridLoc, CLUSTER_GRID_UNIT);
          const clusterIndexLoc = cache.uniforms.get("u_clusterIndices");
          if (clusterIndexLoc) gl.uniform1i(clusterIndexLoc, CLUSTER_INDEX_UNIT);
          this._bindSpotShadowMaps(cache, ctx.lights);
          this._bindDirectionalShadowMaps(cache, ctx.lights);
          this._bindFogUniforms(
            cache.uniforms,
            this.postProcessing.volumetricFogOwnsFog ? undefined : ctx.scene?.fog,
          );
          this._bindGlobalIblUniforms(cache, ctx.scene);
        }
        this._bindMaterialState(manifest.state);
        this._bindGenericMaterialProperties(cache.uniforms, manifest.properties, false);
        this._bindSubgroupTextures(cache, manifest.shaderId, manifest);
      } else {
        cache = this._programCache.getProgram(ctx.shaderId ?? MaterialType.DEPTH, false, [
          ShaderFlag.INSTANCE_FIELD,
        ]);
        if (cache !== currentProgram) {
          gl.useProgram(cache.prog);
          this._bindFieldWindUniforms(field, cache);
          this._bindDummyShadowMaps(cache);
          currentProgram = cache;
        }
        // Alpha-test foliage: the caster material's cutout map + threshold (DEPTH/EVSM programs).
        this._bindShadowBatchUniforms(cache, manifest);
      }

      this._drawFieldCommand(gl, mesh, cache, cmd, instanceVbo);
    }
  }

  /**
   * Uploads this field's per-field wind state onto `cache`'s program (ADR 0059 step 1b; GL2 side
   * of the WGSL `InstanceFieldSystem.setWind` lane). Scalar `uniform4f` per `SwmWind` struct
   * member (no `subarray`/`uniform4fv` boxing) + the master-switch height. `u_windHeight` is
   * ALWAYS written (`0` when the field's wind is disabled) so a program shared across fields can
   * never keep a stale cross-field wind live: the first command of every field re-initializes both
   * uniforms on its program switch. The depth/EVSM field programs consume the same `base_vertex_*`
   * chunks, so the upload is gated on neither pass nor program kind.
   */
  private _bindFieldWindUniforms(field: InstanceFieldGL, cache: WebGLProgramCacheEntry): void {
    const gl = this.gl;
    const wind = field.windUniforms;
    if (wind) {
      const p0 = this._cachedUniformLocation(cache, "u_wind.p0");
      if (p0) gl.uniform4f(p0, wind[0]!, wind[1]!, wind[2]!, wind[3]!);
      const p1 = this._cachedUniformLocation(cache, "u_wind.p1");
      if (p1) gl.uniform4f(p1, wind[4]!, wind[5]!, wind[6]!, wind[7]!);
      const p2 = this._cachedUniformLocation(cache, "u_wind.p2");
      if (p2) gl.uniform4f(p2, wind[8]!, wind[9]!, wind[10]!, wind[11]!);
      const p3 = this._cachedUniformLocation(cache, "u_wind.p3");
      if (p3) gl.uniform4f(p3, wind[12]!, wind[13]!, wind[14]!, wind[15]!);
    }
    const height = this._cachedUniformLocation(cache, "u_windHeight");
    if (height) gl.uniform1f(height, field.windHeight);
  }

  /** Binds one field command's geometry + record range and performs the instanced draw. */
  private _drawFieldCommand(
    gl: WebGL2RenderingContext,
    mesh: Mesh,
    cache: WebGLProgramCacheEntry,
    cmd: CpuIndirectDrawSource["commands"][number],
    instanceVbo: WebGLBuffer,
  ): void {
    mesh.bind(
      cache.attributes.get("a_position")!,
      cache.attributes.get("a_normal") ?? -1,
      cache.attributes.get("a_uv") ?? -1,
      cache.attributes.get("a_tangent") ?? -1,
      cache.attributes.get("a_joints") ?? -1,
      cache.attributes.get("a_weights") ?? -1,
      cache.attributes.get("a_color") ?? -1,
    );

    const posLoc = cache.attributes.get("a_instancePos");
    const poseLoc = cache.attributes.get("a_instancePose");
    if ((posLoc === undefined || posLoc < 0) && (poseLoc === undefined || poseLoc < 0)) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, instanceVbo);
    if (posLoc !== undefined && posLoc >= 0) {
      gl.enableVertexAttribArray(posLoc);
      gl.vertexAttribPointer(
        posLoc,
        3,
        gl.FLOAT,
        false,
        INSTANCE_RECORD_BYTES,
        cmd.instanceAttrByteOffset,
      );
      gl.vertexAttribDivisor(posLoc, 1);
    }
    if (poseLoc !== undefined && poseLoc >= 0) {
      gl.enableVertexAttribArray(poseLoc);
      // u32 bits are NOT an IEEE float: `vertexAttribIPointer` on the same record buffer.
      gl.vertexAttribIPointer(
        poseLoc,
        1,
        gl.UNSIGNED_INT,
        INSTANCE_RECORD_BYTES,
        cmd.instanceAttrByteOffset + 12,
      );
      gl.vertexAttribDivisor(poseLoc, 1);
    }

    mesh.drawInstanced(gl.TRIANGLES, cmd.instanceCount);

    if (posLoc !== undefined && posLoc >= 0) {
      gl.vertexAttribDivisor(posLoc, 0);
      gl.disableVertexAttribArray(posLoc);
    }
    if (poseLoc !== undefined && poseLoc >= 0) {
      gl.vertexAttribDivisor(poseLoc, 0);
      gl.disableVertexAttribArray(poseLoc);
    }
  }

  /**
   * Shader-variant flags of ONE field material's program: the material's manifest flags (resolved
   * against the tier quality like `_buildSubgroupShaderFlags`), IBL, normal output and EVSM, plus
   * `INSTANCE_FIELD`. `TEXTURE_ARRAY` is stripped: the field vertex stage declares no
   * `v_texIndex` output (the pose consumes the whole model transform, see base_vertex_header).
   *
   * Cached per committed `manifest.flags` array reference (immutable-while-published contract)
   * with a quality/IBL tag check; hit returns the SAME cached array (WebGLProgramCache only reads
   * it and copies on miss), keeping the per-command field draw allocation-free. WeakMap keying
   * drops the entry with the committed array, so dynamically toggled materials never leak.
   */
  private _buildFieldShaderFlags(manifest: RenderManifest, scene?: Scene): string[] {
    const committed = manifest.flags;
    const ibl = (scene?.irradianceMap ?? scene?.prefilterMap) !== undefined;
    const q = this._quality;
    const tag =
      (q.disableTextures ? 1 : 0) |
      (q.cheapIridescence ? 2 : 0) |
      (q.normalBuffer ? 4 : 0) |
      (q.shadowMode === ShadowMode.EVSM ? 8 : 0) |
      (ibl ? 16 : 0);
    const cached = committed ? this._fieldFlagsCache.get(committed) : undefined;
    if (cached && cached.tag === tag) return cached.flags;
    const flags = committed
      ? [...(resolveManifestFlags(committed, q.disableTextures, q.cheapIridescence) ?? [])]
      : [];
    if (ibl) {
      if (!flags.includes(ShaderFlag.IBL)) flags.push(ShaderFlag.IBL);
    }
    if (q.normalBuffer) flags.push(NORMAL_OUTPUT_FLAG);
    if (q.shadowMode === ShadowMode.EVSM) flags.push(ShaderFlag.EVSM);
    const ta = flags.indexOf(ShaderFlag.TEXTURE_ARRAY);
    if (ta >= 0) flags.splice(ta, 1);
    flags.push(ShaderFlag.INSTANCE_FIELD);
    if (committed) this._fieldFlagsCache.set(committed, { flags, tag });
    return flags;
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

  private _shadowMaxUnits(): number {
    return (
      this.context?.deviceCaps.getLimit(DeviceLimit.WEBGL2_MAX_TEXTURE_IMAGE_UNITS) ??
      this._maxTextureUnits
    );
  }

  /**
   * Binds dummy depth textures to shadow samplers to satisfy WebGL2 sampler2DShadow validation rules.
   */
  private _bindDummyShadowMaps(cache: WebGLProgramCacheEntry): void {
    this._shadows.bindDummyShadowMaps(
      this.gl,
      cache,
      this._shadowMaxUnits(),
      this._quality.shadowMode,
    );
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
    const instancedObjects = this._instances.scratchInstancedObjects;
    const standardObjects = this._instances.scratchStandardObjects;
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
      // ADR 0046 A2: consecutive same-geometry objects form the longest runs on which
      // `partitionInstanceRuns` merges -- reorder the eligible subgroup stably by geometry first.
      this._instances.groupByGeometry(standardObjects);
      const runObjects = this._instances.scratchRunObjects;
      const runs = this._instances.scratchRuns;
      const runRest = this._instances.scratchRunRest;
      partitionInstanceRuns(standardObjects, runObjects, runs, runRest);
      if (runs.length > 0) {
        perObject = runRest;
        this._renderSubgroup(
          batch!.shaderId,
          runObjects,
          true,
          manifest,
          vMat,
          topo,
          lights,
          scene,
          batch!.wireframeMode,
          runs,
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
    if (this._renderTargets.normalWriteRequested) {
      this._renderTargets.hdrFbo?.setSecondaryWriteEnabled(cache.writesNormalOutput);
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

    // A05 one-owner rule: with the volumetric fog element active the post composite applies its
    // own transmittance + in-scatter over the whole frame, so the scene's analytic fog must be
    // suppressed here (fogMode = NONE) -- otherwise the same pixels get analytic attenuation AND
    // froxel transmittance (compounded) plus doubled in-scatter. WebGL1 does NOT gate (its post
    // shader has no volumetric term; scene fog stays its single owner).
    this._bindFogUniforms(
      cache.uniforms,
      this.postProcessing.volumetricFogOwnsFog ? undefined : scene?.fog,
    );

    this._bindGlobalIblUniforms(cache, scene);

    // --- 1. Bind Material States ---
    const state = manifest.state;
    this._bindMaterialState(state);
    this._bindGenericMaterialProperties(cache.uniforms, manifest.properties, false);

    this._bindSubgroupTextures(cache, shaderId, manifest);

    // --- 4. Render each object ---
    const texs = manifest.textures;
    const texVersion = this._textures.textureSetVersion(texs);

    if (runs) {
      for (let r = 0; r < runs.length; r += 2) {
        const start = runs[r]!;
        const end = runs[r + 1]!;
        for (let i = start; i < end; i++) {
          this._programCache.acquireProgram(objects[i]!, programKey);
          this._textures.acquireTextures(objects[i]!, texs, texVersion);
        }
        this._renderInstanceRun(objects, start, end, cache, topology, wireframeMode);
      }
      return;
    }

    for (let i = 0; i < objects.length; i++) {
      const o = objects[i]!;
      if (!o.geometry) continue;
      if (isInstanced && (o as InstancedMesh).instanceCount === 0) continue;

      this._programCache.acquireProgram(o, programKey);
      this._textures.acquireTextures(o, texs, texVersion);

      if (isInstanced) {
        this._renderInstancedObject(o as InstancedMesh, cache, topology, wireframeMode);
      } else {
        this._renderStandardObject(o, cache, state, vMat, topology, wireframeMode);
      }
    }
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
      ? [
          ...(resolveManifestFlags(
            manifest.flags,
            this._quality.disableTextures,
            this._quality.cheapIridescence,
          ) ?? []),
        ]
      : [];

    if (
      firstObject &&
      ((isSkinnedMesh(firstObject) && firstObject.skeleton) || firstObject.geometry?.joints)
    ) {
      if (!shaderFlags.includes(ShaderFlag.SKINNING)) {
        shaderFlags.push(ShaderFlag.SKINNING);
      }
    }

    if (scene?.irradianceMap || scene?.prefilterMap) {
      if (!shaderFlags.includes(ShaderFlag.IBL)) {
        shaderFlags.push(ShaderFlag.IBL);
      }
    }

    // Check if texture array is used
    if (manifest.textures) {
      for (const tex of Object.values(manifest.textures)) {
        if (tex && "isTextureArray" in tex && (tex as TextureArray).isTextureArray) {
          if (!shaderFlags.includes(ShaderFlag.TEXTURE_ARRAY)) {
            shaderFlags.push(ShaderFlag.TEXTURE_ARRAY);
          }
          break;
        }
      }
    }

    if (this._quality.normalBuffer) shaderFlags.push(NORMAL_OUTPUT_FLAG);

    // EVSM (ADR 0043): only this variant declares the moment-atlas sampler, so the default
    // PCSS/PCF programs keep one texture unit free. A mode switch selects the other cached variant.
    if (this._quality.shadowMode === ShadowMode.EVSM) shaderFlags.push(ShaderFlag.EVSM);

    // Per-instance RGBA color (e.g. particle tint) is a mesh opt-in so the generic `instanceData`
    // semantics (texture-array index) stay untouched for other meshes: only an instanced mesh
    // explicitly requesting it gets the `USE_INSTANCE_COLOR` variant compiled in.
    if (isInst && firstObject instanceof InstancedMesh && firstObject.useInstanceDataAsColor) {
      shaderFlags.push(ShaderFlag.INSTANCE_COLOR);
    }

    return shaderFlags;
  }

  /** Delegates spot + point shadow sampler/uniform binding to `WebGL2ShadowManager`. */
  private _bindSpotShadowMaps(cache: WebGLProgramCacheEntry, lights?: LightDataInterface): void {
    this._shadows.bindSpotShadowMaps(this.gl, cache, lights);
  }

  /** Delegates directional CSM + EVSM shadow sampler/uniform binding to `WebGL2ShadowManager`. */
  private _bindDirectionalShadowMaps(
    cache: WebGLProgramCacheEntry,
    lights?: LightDataInterface,
  ): void {
    this._shadows.bindDirectionalShadowMaps(
      this.gl,
      cache,
      lights,
      this.isOffscreenRenderTarget,
      this._quality,
      this._shadowMaxUnits(),
    );
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
            this.gl.bindTexture(
              this.gl.TEXTURE_2D,
              this._opaqueCapture.opaqueTexture ?? this.defaultTexture,
            );
          } else if (uniformName === "u_normalBufferMap" && !t) {
            this.gl.bindTexture(
              this.gl.TEXTURE_2D,
              this._opaqueCapture.opaqueNormalTexture ?? this.defaultTexture,
            );
          } else if (uniformName === "u_opaqueDepthMap" && !t) {
            this.gl.bindTexture(
              this.gl.TEXTURE_2D,
              this._opaqueCapture.opaqueDepthTexture ?? this.defaultTexture,
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

  /** Delegates per-`InstancedMesh` drawing to `WebGL2InstanceManager`. */
  private _renderInstancedObject(
    instMesh: InstancedMesh,
    cache: WebGLProgramCacheEntry,
    topology: Topology,
    wireframeMode?: WireframeMode,
    ribbon?: GLLineRibbon,
  ): void {
    this._instances.renderInstancedObject(
      this.gl,
      this._geometry,
      instMesh,
      cache,
      topology,
      wireframeMode,
      ribbon,
    );
  }

  /** Delegates ADR 0046 auto-instancing runs to `WebGL2InstanceManager`. */
  private _renderInstanceRun(
    objects: readonly Object3D[],
    start: number,
    end: number,
    cache: WebGLProgramCacheEntry,
    topology: Topology,
    wireframeMode?: WireframeMode,
  ): void {
    this._instances.renderInstanceRun(
      this.gl,
      this._geometry,
      objects,
      start,
      end,
      cache,
      topology,
      wireframeMode,
    );
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
    const exposure = this.postProcessing.enabled ? 1.0 : (this._quality.exposure ?? 1.0);
    writeWebGL2GlobalUBO(
      this._globalUBO,
      vp,
      camPos,
      lights,
      this.outputGamma,
      exposure,
      this.forwardToneMapping,
      this.forwardToneMappingWhitePoint,
      near,
      far,
    );
  }

  /**
   * Auto-enable (ADR 0028): the HDR FBO was created without the secondary attachment, so drop it
   * here and let `ensurePostProcessFbo` rebuild it. Programs recompile through the new
   * `USE_NORMAL_OUT` flag. One-time hitch.
   */
  public override requestNormalBuffer(): boolean {
    const switched = super.requestNormalBuffer();
    if (switched) this._renderTargets.dropHdrFboIfMissingNormal();
    return switched;
  }

  /**
   * S3 DP-4A teleport fan-out on WebGL2: resets the chained GL post-FX temporal history (the TAA /
   * motion-trail history-blend pass ghosts identically to WebGPU after a camera cut -- E1 ruled
   * "both tiers" in). Called synchronously by `SmallWorldMachine.notifyCameraTeleport()`; a
   * never-created `GLPostEffects` (post-processing off) has no history and is skipped -- the API is
   * idempotent.
   */
  public override notifyCameraTeleport(_scene: Scene): void {
    this._renderTargets.notifyCameraTeleport();
  }

  /** @inheritdoc */
  public override setSize(width: number, height: number): void {
    super.setSize(width, height);
    this._renderTargets.resize(
      this.gl,
      this.postProcessing.enabled,
      this._quality.normalBuffer === true,
      this.context.shaderRegistry,
    );
    this._clusters.resizeForCanvas(
      this.gl,
      this.gl.canvas.width,
      this.gl.canvas.height,
      this._quality.clusteredLighting,
    );
  }

  /** @inheritdoc */
  protected override releaseObjectResources(obj: Object3D): void {
    this._geometry.releaseGeometryFor(obj);
    this._programCache.releaseObjectProgram(obj);
    this._textures.releaseObjectTextures(obj);
    if (obj instanceof InstancedMesh) this._instances.releaseInstanceBuffers(this.gl, obj);
  }

  /** @inheritdoc */
  public releaseRenderTarget(target: RenderTarget | RenderTargetCube): void {
    this._renderTargets.releaseRenderTarget(target, this._textures);
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
      this._shadows?.destroy(gl);
      this._instances?.destroy(gl);
      this._renderTargets?.destroy();
      this._opaqueCapture?.destroy(gl);
      this._clusters?.destroy(gl);
      this._globalUBO?.destroy();
      for (const tex of [this._blackCubeTexture, this._defaultBrdfTexture]) {
        if (tex) gl.deleteTexture(tex);
      }
    } else {
      this._renderTargets?.destroy();
    }

    this._texCache.clear();
    super.destroy();
  }
}
