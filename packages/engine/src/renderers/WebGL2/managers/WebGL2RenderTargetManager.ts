import { RenderTarget, RenderTargetCube } from "../../../core/textures/index.js";
import type { Scene, FogVolume } from "../../../core/index.js";
import type { FrameInfo, LightDataInterface, QualityConfig } from "../../../interfaces/index.js";
import type { Matrix4, Vector3D } from "../../../math/index.js";
import type { WebGLTextureManager } from "../../gl/managers/WebGLTextureManager.js";
import type { PostProcessingGroup } from "../../post/PostProcessingGroup.js";
import type { GLPostEffectPassContext } from "../../post/passes/index.js";
import { GLPostEffects, createGLPostEffectContext } from "../../post/passes/index.js";
import type { ShaderRegistry } from "../../shaders/index.js";
import { WebGL2CubeFrameBuffer } from "../WebGL2CubeFrameBuffer.js";
import { WebGL2FrameBuffer } from "../WebGL2FrameBuffer.js";

/** Out-of-range clear value (octahedral encodings live in [-1, 1]): "no normal" -- see ADR 0028. */
const NORMAL_TARGET_CLEAR: Float32Array = new Float32Array([-2, -2, 0, 0]);

/** Frame state needed to populate `GLPostEffectPassContext` without allocating per frame. */
export interface WebGL2PostFrameParams {
  postProcessing: PostProcessingGroup;
  viewProj: Matrix4;
  camPos: Vector3D;
  near: number;
  far: number;
  projMatrixData: Float32Array;
  lights: LightDataInterface | undefined;
  fogVolumes: FogVolume[];
  frameInfo: FrameInfo;
  scene: Scene | undefined;
  quality: QualityConfig;
  textures: WebGLTextureManager;
  opaqueDepthTexture: WebGLTexture | undefined;
  dirShadowTexture: WebGLTexture | null;
  spotShadowTextures: readonly (WebGLTexture | null)[];
  fallbackShadowTexture: WebGLTexture;
  fallbackSpotShadowArray: WebGLTexture;
  blackCubeTexture: WebGLTexture;
}

/**
 * Owns WebGL2 offscreen render targets (`RenderTarget` / `RenderTargetCube` FBO caches), the
 * HDR post-processing framebuffer, normal-buffer attachment routing (ADR 0028), and the chained
 * `GLPostEffects` pipeline.
 */
export class WebGL2RenderTargetManager {
  private _hdrFbo: WebGL2FrameBuffer | undefined = undefined;
  private _normalWriteRequested = false;
  private _warnedNormalBufferUnavailable = false;
  private _postEffects: GLPostEffects | undefined = undefined;
  private _postCtx: GLPostEffectPassContext | undefined = undefined;

  private _activeRenderTarget: RenderTarget | RenderTargetCube | null = null;
  private _activeCubeFace = 0;
  private _renderTargetFbos: Map<RenderTarget, WebGL2FrameBuffer> = new Map();
  private _renderTargetCubeFbos: Map<RenderTargetCube, WebGL2CubeFrameBuffer> = new Map();

  public get hdrFbo(): WebGL2FrameBuffer | undefined {
    return this._hdrFbo;
  }

  public get normalWriteRequested(): boolean {
    return this._normalWriteRequested;
  }

  public get activeRenderTarget(): RenderTarget | RenderTargetCube | null {
    return this._activeRenderTarget;
  }

  public get activeCubeFace(): number {
    return this._activeCubeFace;
  }

  public get isOffscreenRenderTarget(): boolean {
    return this._activeRenderTarget !== null;
  }

  public get canDrawDecals(): boolean {
    return this._activeRenderTarget === null;
  }

  public setRenderTarget(
    target: RenderTarget | RenderTargetCube | null,
    activeCubeFace?: number,
  ): void {
    this._activeRenderTarget = target;
    this._activeCubeFace = activeCubeFace ?? 0;
  }

  public onPostRender(): void {
    if (
      this._activeRenderTarget instanceof RenderTarget &&
      this._activeRenderTarget.generateMipmaps
    ) {
      this._renderTargetFbos.get(this._activeRenderTarget)?.generateMipmap();
    }
  }

  public hasNormalTarget(postProcessingEnabled: boolean): boolean {
    return (
      !this._activeRenderTarget &&
      postProcessingEnabled &&
      this._hdrFbo?.secondaryTexture !== undefined
    );
  }

  public normalTexture(postProcessingEnabled: boolean): WebGLTexture | undefined {
    return this.hasNormalTarget(postProcessingEnabled) ? this._hdrFbo!.secondaryTexture : undefined;
  }

  public setNormalWriteEnabled(enabled: boolean): void {
    this._normalWriteRequested = enabled;
    this._hdrFbo?.setSecondaryWriteEnabled(enabled);
  }

  public clearNormalTarget(gl: WebGL2RenderingContext): void {
    const fbo = this._hdrFbo;
    if (!fbo?.secondaryTexture) return;
    fbo.setSecondaryWriteEnabled(true);
    gl.clearBufferfv(gl.COLOR, 1, NORMAL_TARGET_CLEAR);
    fbo.setSecondaryWriteEnabled(false);
  }

  /** Drops an existing HDR FBO lacking the secondary attachment so the next frame rebuilds it. */
  public dropHdrFboIfMissingNormal(): void {
    if (this._hdrFbo && !this._hdrFbo.secondaryTexture) {
      this._hdrFbo.destroy();
      this._hdrFbo = undefined;
    }
  }

  public bindMainRenderTarget(
    gl: WebGL2RenderingContext,
    postProcessingEnabled: boolean,
    normalBufferEnabled: boolean,
    textures: WebGLTextureManager,
    shaderRegistry: ShaderRegistry,
  ): boolean {
    let isOffscreen = false;
    this.ensurePostProcessFbo(gl, postProcessingEnabled, normalBufferEnabled, shaderRegistry);
    this._warnIfNormalBufferUnavailable(normalBufferEnabled);

    if (this._activeRenderTarget) {
      isOffscreen = true;
      if (this._activeRenderTarget instanceof RenderTargetCube) {
        let fbo = this._renderTargetCubeFbos.get(this._activeRenderTarget);
        if (!fbo || !this._activeRenderTarget.isLoaded) {
          if (fbo) fbo.destroy();
          fbo = new WebGL2CubeFrameBuffer(gl, {
            width: this._activeRenderTarget.width,
            height: this._activeRenderTarget.height,
            format: gl.RGBA,
            internalFormat: gl.RGBA8,
            type: gl.UNSIGNED_BYTE,
          });
          this._renderTargetCubeFbos.set(this._activeRenderTarget, fbo);
          textures.registerCubeTexture(this._activeRenderTarget, fbo.texture);
          this._activeRenderTarget.isLoaded = true;
        }
        fbo.bindFace(this._activeCubeFace);
      } else {
        let fbo = this._renderTargetFbos.get(this._activeRenderTarget);
        if (!fbo || !this._activeRenderTarget.isLoaded) {
          if (fbo) fbo.destroy();
          fbo = new WebGL2FrameBuffer(gl, {
            width: this._activeRenderTarget.width,
            height: this._activeRenderTarget.height,
            format: gl.RGBA,
            internalFormat: gl.RGBA8,
            type: gl.UNSIGNED_BYTE,
            generateMipmaps: this._activeRenderTarget.generateMipmaps,
          });

          this._renderTargetFbos.set(this._activeRenderTarget, fbo);
          textures.registerTexture(this._activeRenderTarget, fbo.texture);
          this._activeRenderTarget.isLoaded = true;
        }
        fbo.bind();
        gl.viewport(0, 0, this._activeRenderTarget.width, this._activeRenderTarget.height);
      }
    } else if (postProcessingEnabled && this._hdrFbo) {
      this._hdrFbo.bind();
      gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    }

    return isOffscreen;
  }

  /**
   * Lazily creates or tears down the HDR post-processing framebuffer and passes to match
   * the current `postProcessing.enabled` state and canvas dimensions.
   */
  public ensurePostProcessFbo(
    gl: WebGL2RenderingContext,
    postProcessingEnabled: boolean,
    normalBufferEnabled: boolean,
    shaderRegistry: ShaderRegistry,
  ): void {
    if (postProcessingEnabled && !this._hdrFbo && gl.canvas.width > 0 && gl.canvas.height > 0) {
      // RGBA16F rendering requires EXT_color_buffer_float; without it, WebGL2FrameBuffer's
      // checkFramebufferStatus() throws. Fall back to an UNSIGNED_BYTE target.
      const supportsFloatColorBuffer = gl.getExtension("EXT_color_buffer_float") !== null;
      const wantsNormalBuffer = normalBufferEnabled && supportsFloatColorBuffer;
      this._hdrFbo = new WebGL2FrameBuffer(gl, {
        width: gl.canvas.width,
        height: gl.canvas.height,
        internalFormat: supportsFloatColorBuffer ? gl.RGBA16F : gl.RGBA8,
        format: gl.RGBA,
        type: supportsFloatColorBuffer ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE,
        secondary: wantsNormalBuffer
          ? { internalFormat: gl.RG16F, format: gl.RG, type: gl.HALF_FLOAT }
          : undefined,
      });
      this._postEffects ??= new GLPostEffects(gl, true, shaderRegistry);
    } else if (!postProcessingEnabled && this._hdrFbo) {
      this._postEffects?.destroy();
      this._postEffects = undefined;
      this._postCtx = undefined;
      this._hdrFbo.destroy();
      this._hdrFbo = undefined;
    }
  }

  public flushPostProcess(gl: WebGL2RenderingContext, params: WebGL2PostFrameParams): void {
    if (
      this._activeRenderTarget !== null ||
      !params.postProcessing.enabled ||
      !this._hdrFbo ||
      !this._postEffects
    ) {
      return;
    }
    this._postEffects.execute(this._buildPostEffectContext(gl, params));
  }

  public resize(
    gl: WebGL2RenderingContext,
    postProcessingEnabled: boolean,
    normalBufferEnabled: boolean,
    shaderRegistry: ShaderRegistry,
  ): void {
    if (postProcessingEnabled) {
      if (this._hdrFbo) {
        this._hdrFbo.resize(gl.canvas.width, gl.canvas.height);
      } else {
        this.ensurePostProcessFbo(gl, true, normalBufferEnabled, shaderRegistry);
      }
    } else if (this._hdrFbo) {
      this.ensurePostProcessFbo(gl, false, normalBufferEnabled, shaderRegistry);
    }
  }

  public notifyCameraTeleport(): void {
    this._postEffects?.resetHistory();
  }

  public releaseRenderTarget(
    target: RenderTarget | RenderTargetCube,
    textures: WebGLTextureManager,
  ): void {
    if (target instanceof RenderTargetCube) {
      this._renderTargetCubeFbos.get(target)?.destroy();
      this._renderTargetCubeFbos.delete(target);
      textures.unregisterCubeTexture(target);
    } else {
      this._renderTargetFbos.get(target)?.destroy();
      this._renderTargetFbos.delete(target);
      textures.unregisterTexture(target);
    }
    // The FBO (and its colour texture) is gone: a later render into the target re-allocates it.
    target.isLoaded = false;
  }

  public resetOnContextRestored(): void {
    this._renderTargetFbos.clear();
    this._renderTargetCubeFbos.clear();
    this._hdrFbo = undefined;
    this._postEffects = undefined;
    this._postCtx = undefined;
  }

  public destroy(): void {
    for (const fbo of this._renderTargetFbos.values()) fbo.destroy();
    for (const fbo of this._renderTargetCubeFbos.values()) fbo.destroy();
    this._hdrFbo?.destroy();
    this._postEffects?.destroy();
    this._renderTargetFbos.clear();
    this._renderTargetCubeFbos.clear();
    this._hdrFbo = undefined;
    this._postEffects = undefined;
    this._postCtx = undefined;
  }

  private _warnIfNormalBufferUnavailable(normalBufferEnabled: boolean): void {
    if (this._warnedNormalBufferUnavailable || !normalBufferEnabled) return;
    if (this._activeRenderTarget || this._hdrFbo?.secondaryTexture) return;

    this._warnedNormalBufferUnavailable = true;
    console.warn(
      "[WebGL2Renderer] quality.normalBuffer needs postProcessing.enabled and EXT_color_buffer_float; " +
        "no normal buffer is written (consumers fall back to depth-derived normals).",
    );
  }

  /**
   * Repopulates the reusable per-frame post context from the current frame state (zero allocation).
   */
  private _buildPostEffectContext(
    gl: WebGL2RenderingContext,
    p: WebGL2PostFrameParams,
  ): GLPostEffectPassContext {
    let ctx = this._postCtx;
    if (!ctx) {
      ctx = createGLPostEffectContext();
      this._postCtx = ctx;
    }
    ctx.gl = gl;
    ctx.group = p.postProcessing;
    ctx.width = gl.canvas.width;
    ctx.height = gl.canvas.height;
    ctx.colorTexture = this._hdrFbo!.texture;
    ctx.depthTexture = p.opaqueDepthTexture;
    ctx.viewProjMatrix = p.viewProj.data;
    ctx.camPos = p.camPos;
    ctx.near = p.near;
    ctx.far = p.far;
    ctx.projMatrixData = p.projMatrixData;
    ctx.lights = p.lights;
    ctx.fogVolumes = p.fogVolumes;
    ctx.time = p.frameInfo.time;
    ctx.realTime = p.frameInfo.realTime;
    ctx.dirShadowTexture = p.dirShadowTexture;
    ctx.spotShadowTextures = p.spotShadowTextures;
    ctx.fallbackShadowTexture = p.fallbackShadowTexture;
    ctx.fallbackSpotShadowArray = p.fallbackSpotShadowArray;
    ctx.irradianceMap = p.scene?.irradianceMap
      ? p.textures.getWebGLCubeTexture(p.scene.irradianceMap, p.quality)
      : p.blackCubeTexture;
    ctx.envIntensity = p.scene?.environmentIntensity ?? 0;
    ctx.pointLights = p.lights?.pLights ?? [];
    ctx.spotLights = p.lights?.sLights ?? [];
    ctx.bloomTexture = null;
    ctx.hbaoTexture = null;
    ctx.lightShaftsTexture = null;
    ctx.volumetricFogTexture = null;
    return ctx;
  }
}
