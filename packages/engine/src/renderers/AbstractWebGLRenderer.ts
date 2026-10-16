import { AbstractRenderer } from "./AbstractRenderer.js";
import { Color } from "../core/colors/index.js";
import { Scene } from "../core/Scene.js";
import { Object3D } from "../core/Object3D.js";
import { Matrix4, Vector3D } from "../math/index.js";
import { LightDataInterface } from "../interfaces/index.js";
import { WebGLRenderPass } from "./WebGLRenderPass.js";
import { Texture, RenderTarget } from "../core/textures/index.js";
export abstract class AbstractWebGLRenderer extends AbstractRenderer {
  // WebGL2 context inherits from WebGL1 context
  protected gl!: WebGLRenderingContext | WebGL2RenderingContext;

  public get webglContext(): WebGLRenderingContext | WebGL2RenderingContext {
    return this.gl;
  }

  protected defaultTexture!: WebGLTexture;
  protected defaultNormalMap!: WebGLTexture;
  protected defaultSpecularMap!: WebGLTexture;
  protected defaultCubeTexture!: WebGLTexture;

  /** Shared by WebGL1Renderer/WebGL2Renderer's `_getWebGLTexture()` -- also written to from
   * their render-target and disposal code paths. */
  protected _texCache: Map<Texture, WebGLTexture> = new Map();

  /** Common early-exit checks `_getWebGLTexture()` needs regardless of WebGL1 vs. WebGL2 (whose
   * upload paths otherwise differ -- WebGL2 additionally handles `TextureArray` via
   * `texImage3D`). Returns the texture to use if any of these apply, or `undefined` if the
   * caller should fall through to its own upload logic.
   * A `RenderTarget` has no `.image` -- its GL texture already exists from being rendered into
   * (populated in each renderer's own render-target bind path), so it's looked up in the cache
   * instead of uploaded, mirroring the WebGPU renderer's identical `RenderTarget` handling. */
  protected _getWebGLTextureFastPath(tex: Texture): WebGLTexture | undefined {
    if (this._quality?.disableTextures) return this.defaultTexture;
    if (!tex.isLoaded) return this.defaultTexture;
    if (tex instanceof RenderTarget) {
      return this._texCache.get(tex) || this.defaultTexture;
    }
    if (!tex.image) return this.defaultTexture;
    return undefined;
  }

  protected _passes: WebGLRenderPass[] = [];

  /** This frame's camera near/far and raw projection matrix, stashed here so `flushPostProcess()`
   * (called later, from a pass with no camera parameters of its own) can hand them to HBAO for
   * reconstructing view-space position from the opaque depth buffer. `_frameProjMatrix` is also
   * handed to `WebGLRenderPass.execute()` as an explicit parameter every frame (see below) for
   * `WebGLClusterCullPass`, rather than being a public field passes reach for directly. */
  protected _frameNear: number = 0.1;
  protected _frameFar: number = 1000;
  protected _frameProjMatrix: Float32Array | undefined = undefined;
  protected _frameCamPos: Vector3D = Vector3D.ZERO;
  protected _frameLights?: LightDataInterface;
  /** Inverse of this frame's view-projection: decals unproject opaque depth with it. */
  protected readonly _frameInvViewProj: Matrix4 = new Matrix4();
  protected readonly _frameViewProj: Matrix4 = new Matrix4();

  public addPass(pass: WebGLRenderPass): void {
    this._passes.push(pass);
  }

  public render(
    scene: Scene,
    vp: Float32Array,
    camPos: Vector3D = Vector3D.ZERO,
    vMat?: Float32Array,
    near?: number,
    far?: number,
    projMatrix?: Float32Array,
  ): void {
    this._releaseRemovedObjects(scene.consumeRemovedObjects());

    this.resetStateCache();
    this._frameNear = near ?? 0.1;
    this._frameFar = far ?? 1000;
    this._frameProjMatrix = projMatrix;
    this._frameCamPos = camPos;
    this._frameViewProj.data.set(vp);
    Matrix4.invert(this._frameViewProj, this._frameInvViewProj);
    const extractedLights = this.extractLights(scene);
    this._frameLights = extractedLights;
    this.extractFogVolumes(scene);
    const renderList = scene.getVisibleObjectsSorted(vp, camPos);
    if (renderList.decals.length > 0 && !this.isOffscreenRenderTarget) this.requestNormalBuffer();

    for (const pass of this._passes) {
      pass.execute(
        this,
        scene,
        vp,
        camPos,
        vMat,
        renderList,
        extractedLights,
        near,
        far,
        this._frameProjMatrix,
      );
    }
  }

  private _releaseRemovedObjects(removed: Object3D[]): void {
    for (const obj of removed) {
      this.releaseObjectResources(obj);
    }
  }

  /**
   * Releases the GPU geometry buffer, compiled program, and textures this object was
   * referencing, for whichever of those its refCount drops to zero. Called once per
   * removed object per frame; implemented per-renderer since these caches are
   * renderer-specific (each renderer has its own GL context).
   */
  protected abstract releaseObjectResources(obj: Object3D): void;

  public abstract resetStateCache(): void;

  /**
   * True while the current `render()` call is targeting an offscreen `RenderTarget`/
   * `RenderTargetCube` (a `DynamicReflectionProbe` face or a `PlanarReflectionNode`), rather
   * than the main camera's canvas. `WebGLShadowPass` uses this to skip re-rendering the
   * directional-light cascade atlas for these secondary, differently-angled cameras -- the
   * atlas is fit to the main camera once per frame and shared by every pass; rebuilding it
   * from a probe's much wider, differently-positioned view clobbered it with geometry culled
   * to that probe's frustum, which could leave nearby dynamic objects (e.g. an orbiting moon)
   * unlit/black in the reflection.
   */
  public abstract get isOffscreenRenderTarget(): boolean;

  /**
   * True while the main pass can write the normal buffer (ADR 0028): only WebGL2 with
   * `quality.normalBuffer` and post-processing, rendering to the main target.
   */
  public get hasNormalTarget(): boolean {
    return false;
  }

  /** True while the main pass can draw box-projected decals: the main camera target on WebGL2. */
  public get canDrawDecals(): boolean {
    return false;
  }

  /** Copies the normal buffer into a sampleable texture for decals. No-op without a normal target. */
  public copyToOpaqueNormalTexture(): void {}

  /** Routes fragment output 1 to the normal buffer or discards it. No-op without a normal target. */
  public setNormalWriteEnabled(_enabled: boolean): void {}

  /** Clears the normal buffer to the "no normal" sentinel. No-op without a normal target. */
  public clearNormalTarget(): void {}

  public abstract bindMainRenderTarget(): boolean;
  public abstract bindPostProcessRenderTarget(): void;
  public abstract copyToOpaqueTexture(): void;
  /**
   * Captures the opaque depth buffer into a sampleable texture for underwater/refraction
   * effects. No-op on renderers without a compatible depth-capture path (see WebGL1Renderer).
   */
  public abstract copyToOpaqueDepthTexture(): void;

  private readonly _opaqueDepthRequirement = new Map<string, boolean>();

  /**
   * Whether the shader registered under `shaderId` samples `u_opaqueDepthMap` (declared in its
   * layout). Lets the main pass capture the opaque depth only when a transparent material
   * actually needs it. Cached per shader id.
   */
  public requiresOpaqueDepth(shaderId: string): boolean {
    let needed = this._opaqueDepthRequirement.get(shaderId);
    if (undefined === needed) {
      const definition = this.context.shaderRegistry.get(shaderId);
      // A shader that is not registered (yet) is not cached, so a lazily registered one still gets asked again.
      if (undefined === definition) return false;
      const textures = definition.layout.textures;
      needed = undefined !== textures && "u_opaqueDepthMap" in textures;
      this._opaqueDepthRequirement.set(shaderId, needed);
    }
    return needed;
  }
  public abstract flushPostProcess(): void;

  public abstract renderBatch(
    batch: import("../core/Scene.js").RenderBatch,
    vMat: Float32Array | undefined,
    vp: Float32Array,
    camPos: Vector3D,
    lights: LightDataInterface,
    scene: Scene,
  ): void;
  public override destroy(): void {
    if (this.gl) {
      const ext: WEBGL_lose_context | undefined =
        this.gl.getExtension("WEBGL_lose_context") ?? undefined;
      if (ext) {
        ext.loseContext();
      }
    }
  }

  public setSize(w: number, h: number): void {
    const maxRatio = this._quality.maxPixelRatio ?? 2;
    const d = Math.min(devicePixelRatio, maxRatio);
    this.gl.canvas.width = w * d;
    this.gl.canvas.height = h * d;

    if ("style" in this.gl.canvas) {
      this.gl.canvas.style.width = `${w}px`;
      this.gl.canvas.style.height = `${h}px`;
    }

    this.gl.viewport(0, 0, this.gl.canvas.width, this.gl.canvas.height);
  }

  public override setClearColor(color: Color): void {
    super.setClearColor(color);
    this.gl.clearColor(color.r, color.g, color.b, color.a);
  }

  // Compiles and links a shader program
  protected createShaderProgram(vSrc: string, fSrc: string): WebGLProgram {
    if (!this.gl) {
      throw new Error("[WebGL] Cannot create shader program, context is undefined.");
    }
    const v: WebGLShader = this.gl.createShader(this.gl.VERTEX_SHADER)!;
    this.gl.shaderSource(v, vSrc);
    this.gl.compileShader(v);

    if (!this.gl.getShaderParameter(v, this.gl.COMPILE_STATUS)) {
      console.error("[WebGL] Vertex Shader Error:", this.gl.getShaderInfoLog(v));
    }

    const f: WebGLShader = this.gl.createShader(this.gl.FRAGMENT_SHADER)!;
    this.gl.shaderSource(f, fSrc);
    this.gl.compileShader(f);

    if (!this.gl.getShaderParameter(f, this.gl.COMPILE_STATUS)) {
      console.error("[WebGL] Fragment Shader Error:", this.gl.getShaderInfoLog(f));
    }

    const p: WebGLProgram = this.gl.createProgram()!;
    this.gl.attachShader(p, v);
    this.gl.attachShader(p, f);
    this.gl.linkProgram(p);

    if (!this.gl.getProgramParameter(p, this.gl.LINK_STATUS)) {
      console.error("[WebGL] Program Link Error:", this.gl.getProgramInfoLog(p));
    }

    // Free memory
    this.gl.deleteShader(v);
    this.gl.deleteShader(f);
    return p;
  }

  // Builds the white/blue fallback textures
  protected initDefaultTextures(): void {
    if (!this.gl) {
      throw new Error("[WebGL] Cannot init default textures, context is undefined.");
    }
    this.defaultTexture = this.gl.createTexture()!;
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.defaultTexture);
    this.gl.texImage2D(
      this.gl.TEXTURE_2D,
      0,
      this.gl.RGBA,
      1,
      1,
      0,
      this.gl.RGBA,
      this.gl.UNSIGNED_BYTE,
      new Uint8Array([255, 255, 255, 255]),
    );
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.NEAREST);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.NEAREST);

    this.defaultNormalMap = this.gl.createTexture()!;
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.defaultNormalMap);
    this.gl.texImage2D(
      this.gl.TEXTURE_2D,
      0,
      this.gl.RGBA,
      1,
      1,
      0,
      this.gl.RGBA,
      this.gl.UNSIGNED_BYTE,
      new Uint8Array([128, 128, 255, 255]),
    );
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.NEAREST);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.NEAREST);

    this.defaultSpecularMap = this.gl.createTexture()!;
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.defaultSpecularMap);
    this.gl.texImage2D(
      this.gl.TEXTURE_2D,
      0,
      this.gl.RGBA,
      1,
      1,
      0,
      this.gl.RGBA,
      this.gl.UNSIGNED_BYTE,
      new Uint8Array([255, 255, 255, 255]),
    );
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.NEAREST);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.NEAREST);

    this.defaultCubeTexture = this.gl.createTexture()!;
    this.gl.bindTexture(this.gl.TEXTURE_CUBE_MAP, this.defaultCubeTexture);
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
        new Uint8Array([50, 50, 100, 255]),
      );
    }
  }
}
