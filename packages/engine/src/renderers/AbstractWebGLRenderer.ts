import { AbstractRenderer } from "./AbstractRenderer.js";
import { compileProgram } from "./compileProgram.js";
import type { Color } from "../core/colors/index.js";
import type { Scene } from "../core/Scene.js";
import type { Object3D } from "../core/Object3D.js";
import { Matrix4, Vector3D } from "../math/index.js";
import type { LightDataInterface } from "../interfaces/index.js";
import type { WebGLRenderPass } from "./WebGLRenderPass.js";
import type { Fog } from "../core/Fog.js";
import type { Texture } from "../core/textures/index.js";
import { BlendingMode, CullMode } from "../enums/index.js";
import type { RenderManifest } from "./shaders/RenderManifest.js";
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

  /** Cache of uploaded 2D textures shared by `WebGLTextureManager` -- also written to from
   * the render-target and disposal code paths. */
  protected _texCache: Map<Texture, WebGLTexture> = new Map();

  // Per-frame-draw-state cache, shared verbatim by WebGL1Renderer/WebGL2Renderer: material
  // state is only pushed to the driver when it actually changed (see `_bindMaterialState`),
  // and `resetStateCache()` wipes it at the start of every `render()` call so no stale state
  // leaks across frames or render targets.
  protected _stateCullFaceEnabled: boolean | null = null;
  protected _stateCullFaceMode: number = -1;
  protected _stateBlendEnabled: boolean | null = null;
  protected _stateBlendSrc: number = -1;
  protected _stateBlendDst: number = -1;
  protected _stateDepthMask: boolean | null = null;
  protected _stateDepthTest: boolean | null = null;

  /** Scratch upload buffer for the per-object model matrix (billboarded for sprites) -- shared by
   * both renderers' `_uploadModelMatrix()`, which copies the object's world matrix into it so the
   * billboard rewrite never mutates the live scene-graph matrix. */
  protected _scratchModelMatrix: Float32Array = new Float32Array(16);

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
  /** The scene of the current frame, for post passes that need scene-level data (e.g. IBL). */
  protected _frameScene?: Scene;
  /** Inverse of this frame's view-projection: decals unproject opaque depth with it. */
  protected readonly _frameInvViewProj: Matrix4 = new Matrix4();
  protected readonly _frameViewProj: Matrix4 = new Matrix4();

  public addPass(pass: WebGLRenderPass): void {
    this._passes.push(pass);
  }

  /** True between `webglcontextlost` and `webglcontextrestored`: every GL object is invalid then. */
  private _contextLost = false;
  private _removeContextListeners: (() => void) | undefined;

  /**
   * Listens for context loss on `canvas`. `preventDefault()` on `webglcontextlost` is what tells
   * the browser the page wants the context back; until it returns `render()` is a no-op (instead
   * of throwing on every frame), and on restore the subclass rebuilds its GPU resources.
   */
  protected installContextLossHandling(canvas: HTMLCanvasElement): void {
    this._removeContextListeners?.();
    const onLost = (event: Event): void => {
      event.preventDefault();
      this._contextLost = true;
      console.warn("[WebGL] Context lost; rendering is paused until the browser restores it.");
      this.onContextLost?.({ reason: "webglcontextlost", message: "WebGL context lost" });
    };
    const onRestored = (): void => {
      this.onContextRestored();
      this._contextLost = false;
      console.warn("[WebGL] Context restored; GPU resources were re-created.");
    };
    canvas.addEventListener("webglcontextlost", onLost);
    canvas.addEventListener("webglcontextrestored", onRestored);
    this._removeContextListeners = (): void => {
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
    };
  }

  /** Drops every handle created on the lost context (they are dead, nothing to delete) and rebuilds the renderer's GPU resources. */
  protected onContextRestored(): void {
    // Renderers without GPU state of their own have nothing to rebuild.
  }

  /** Removes the context-loss listeners; subclasses call it from `destroy()`. */
  protected uninstallContextLossHandling(): void {
    this._removeContextListeners?.();
    this._removeContextListeners = undefined;
  }

  /** Whether the context is currently lost (rendering is skipped). @inheritdoc */
  public override get isContextLost(): boolean {
    return this._contextLost;
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
    if (this._contextLost) return;
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
    this._frameScene = scene;
    this.extractFogVolumes(scene);
    const renderList = scene.getVisibleObjectsSorted(vp, camPos);
    this._registerRenderListProviders(renderList);
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

  /**
   * Resets the per-frame draw-state cache. Called at the start of every `render()` call -- shared
   * verbatim by WebGL1Renderer/WebGL2Renderer (see the state fields above).
   */
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
   * Binds the scene's fog uniforms (or disables fog, `u_fogMode = NONE`) on the current program.
   * Bit-identical to what WebGL1Renderer and WebGL2Renderer both did inline; hoisted unchanged.
   * Zero-allocation: reads `u.get()` from the caller-provided uniform map and the existing `gl`.
   */
  protected _bindFogUniforms(
    u: Map<string, WebGLUniformLocation | undefined>,
    fog: Fog | undefined,
  ): void {
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
  }

  /**
   * Applies the material's rasterizer/blend/depth state through the per-frame state cache, so the
   * driver is only touched when the state actually changed. Bit-identical to what WebGL1Renderer
   * and WebGL2Renderer both did inline; hoisted unchanged. Zero-allocation.
   */
  protected _bindMaterialState(state: RenderManifest["state"]): void {
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
  }

  /**
   * Uploads the generic material `properties` from the render manifest as uniforms on the current
   * program. Shared by both renderers. The `glsl100` flag preserves one WebGL1-only branch that
   * WebGL2's original did not have (a plain-array `mat4` property): hoisting stops at a behavior
   * divergence, so WebGL2 stays exactly as it was (it still handles `mat4` via the
   * `Float32Array` branch). Zero-allocation.
   */
  protected _bindGenericMaterialProperties(
    u: Map<string, WebGLUniformLocation | undefined>,
    properties: Record<string, unknown>,
    glsl100: boolean,
  ): void {
    for (const name in properties) {
      const value = properties[name];
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
        else if (glsl100 && value.length === 16)
          this.gl.uniformMatrix4fv(loc, false, value as number[]);
      }
    }
  }

  /**
   * Uploads an object's model matrix (billboarded for sprites) on the current program. Shared by
   * both renderers; the shadow/instanced paths call it with `state`/`vMat` unset, which skips the
   * billboard rewrite exactly as they did before. Walks the matrix through `_scratchModelMatrix`
   * so the live scene-graph matrix is never mutated. Zero-allocation.
   */
  protected _uploadModelMatrix(
    worldData: Float32Array,
    state: RenderManifest["state"],
    vMat: Float32Array | undefined,
    u: Map<string, WebGLUniformLocation | undefined>,
  ): void {
    this._scratchModelMatrix.set(worldData);
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
  }

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

  // Compiles and links a shader program (throws on a compile or link error)
  protected createShaderProgram(vSrc: string, fSrc: string): WebGLProgram {
    if (!this.gl) {
      throw new Error("[WebGL] Cannot create shader program, context is undefined.");
    }
    return compileProgram(this.gl, vSrc, fSrc, "AbstractWebGLRenderer");
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
