import { TextureFilter, TextureWrap } from "../../../enums/index.js";

/**
 * Fallback/placeholder GPU resources used whenever real per-object data doesn't exist yet: 1x1
 * default textures (white / BRDF LUT / flat-normal / default & black cube), a 1x1 dummy depth
 * texture, dummy zero-filled growable vertex-attribute buffers (normal/UV/tangent/joints/
 * weights, for meshes missing that attribute), and dummy shadow-map textures + their shared
 * comparison sampler, bound whenever no real shadow pass has produced a real one yet this frame.
 *
 * Extracted from `WebGPURenderer` -- see
 * .agents/collaborate/god-objects-refactoring.md Phase 4. No behavior change, including one
 * pre-existing coupling worth flagging rather than silently "fixing": growing the dummy vertex
 * buffers (`ensureDummyBufferSize()`) also regenerates the dummy shadow textures and the shadow
 * sampler, every time it grows -- that's how the source already worked (both lived in the same
 * function), kept exactly as-is here rather than re-architected as part of this extraction.
 */
export class GPUFallbackResources {
  private readonly _device: GPUDevice;

  private _whiteTexView!: GPUTextureView;
  private _defaultBrdfTexView!: GPUTextureView;
  private _flatNormalTexView!: GPUTextureView;
  private _defaultCubeTexView!: GPUTextureView;
  private _blackCubeTexView!: GPUTextureView;
  private _dummyDepthTexView!: GPUTextureView;

  private _defaultDirShadowTexView!: GPUTextureView;
  private _dummyDirShadowTexView!: GPUTextureView;
  private _defaultSpotShadowTexView!: GPUTextureView;
  private _dummySpotShadowTexView!: GPUTextureView;
  private _shadowSampler!: GPUSampler;

  private _defaultEVSMTexView!: GPUTextureView;
  private _dummyEVSMTexView!: GPUTextureView;
  private _evsmSampler!: GPUSampler;

  private _dummyNormalBuffer!: GPUBuffer;
  private _dummyUvBuffer!: GPUBuffer;
  private _dummyTangentBuffer!: GPUBuffer;
  private _dummyJointsBuffer!: GPUBuffer;
  private _dummyWeightsBuffer!: GPUBuffer;
  private _dummyColorBuffer!: GPUBuffer;
  private _dummyBufferSize = 0;
  /** Buffers replaced by a growth call, held here instead of destroyed immediately --
   * `ensureDummyBufferSize()` can run mid-frame from the main render loop, so an earlier object
   * in the same not-yet-submitted command encoder may already have recorded a `setVertexBuffer`
   * call referencing the old buffer. The caller drains (destroys) this list right after
   * `queue.submit()`, once nothing can reference the stale buffers anymore. */
  private _buffersPendingDestroy: GPUBuffer[] = [];
  private _texturesPendingDestroy: GPUTexture[] = [];

  constructor(device: GPUDevice) {
    this._device = device;
    this._initStaticResources();
    this.ensureDummyBufferSize(1000);
  }

  public get whiteTextureView(): GPUTextureView {
    return this._whiteTexView;
  }
  public get defaultBrdfTextureView(): GPUTextureView {
    return this._defaultBrdfTexView;
  }
  public get flatNormalTextureView(): GPUTextureView {
    return this._flatNormalTexView;
  }
  public get defaultCubeTextureView(): GPUTextureView {
    return this._defaultCubeTexView;
  }
  public get blackCubeTextureView(): GPUTextureView {
    return this._blackCubeTexView;
  }
  public get dummyDepthTextureView(): GPUTextureView {
    return this._dummyDepthTexView;
  }
  public get shadowSampler(): GPUSampler {
    return this._shadowSampler;
  }

  /** Read by the fragment shader's global bind group; reassigned once by `CascadedShadowPassGPU`
   * when a real cascaded shadow map first exists. */
  public get defaultDirShadowTextureView(): GPUTextureView {
    return this._defaultDirShadowTexView;
  }
  public set defaultDirShadowTextureView(view: GPUTextureView) {
    this._defaultDirShadowTexView = view;
  }
  public get dummyDirShadowTextureView(): GPUTextureView {
    return this._dummyDirShadowTexView;
  }

  /** Read by the fragment shader's global bind group; reassigned once by `SpotShadowPassGPU`
   * when a real spot shadow map first exists. */
  public get defaultSpotShadowTextureView(): GPUTextureView {
    return this._defaultSpotShadowTexView;
  }
  public set defaultSpotShadowTextureView(view: GPUTextureView) {
    this._defaultSpotShadowTexView = view;
  }
  public get dummySpotShadowTextureView(): GPUTextureView {
    return this._dummySpotShadowTexView;
  }

  /** Read by the fragment shader's EVSM sampler binding of the global bind group; reassigned once
   * by `CascadedShadowPassGPU` when a real EVSM moment map first exists (ADR 0043). */
  public get defaultEVSMTextureView(): GPUTextureView {
    return this._defaultEVSMTexView;
  }
  public set defaultEVSMTextureView(view: GPUTextureView) {
    this._defaultEVSMTexView = view;
  }
  public get dummyEVSMTextureView(): GPUTextureView {
    return this._dummyEVSMTexView;
  }
  /** Linear clamp-to-edge sampler for the EVSM moment map; mirrors `_shadowSampler` minus the
   * comparison, because moments are ordinary float data that must be filtered (not compared). */
  public get evsmSampler(): GPUSampler {
    return this._evsmSampler;
  }

  public get dummyNormalBuffer(): GPUBuffer {
    return this._dummyNormalBuffer;
  }
  public get dummyUvBuffer(): GPUBuffer {
    return this._dummyUvBuffer;
  }
  public get dummyTangentBuffer(): GPUBuffer {
    return this._dummyTangentBuffer;
  }
  public get dummyJointsBuffer(): GPUBuffer {
    return this._dummyJointsBuffer;
  }
  public get dummyWeightsBuffer(): GPUBuffer {
    return this._dummyWeightsBuffer;
  }
  /** Opaque white (1,1,1,1) per vertex: the neutral stand-in for meshes without vertex colors. */
  public get dummyColorBuffer(): GPUBuffer {
    return this._dummyColorBuffer;
  }

  private _initStaticResources(): void {
    const create1x1 = (col: number[]): GPUTextureView => {
      const t = this._device.createTexture({
        size: [1, 1],
        format: "rgba8unorm",
        usage:
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.COPY_DST |
          GPUTextureUsage.RENDER_ATTACHMENT,
      });
      this._device.queue.writeTexture(
        { texture: t },
        new Uint8Array(col),
        { bytesPerRow: 4 },
        [1, 1],
      );
      return t.createView();
    };
    this._whiteTexView = create1x1([255, 255, 255, 255]);
    this._defaultBrdfTexView = create1x1([255, 0, 0, 255]); // scale=1, bias=0
    this._flatNormalTexView = create1x1([128, 128, 255, 255]);

    const dummyDepth = this._device.createTexture({
      size: [1, 1],
      format: "depth32float",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this._dummyDepthTexView = dummyDepth.createView();

    const createCube = (col: number[]): GPUTextureView => {
      const cube = this._device.createTexture({
        size: [1, 1, 6],
        format: "rgba8unorm",
        usage:
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.COPY_DST |
          GPUTextureUsage.RENDER_ATTACHMENT,
      });
      for (let i = 0; i < 6; i++) {
        this._device.queue.writeTexture(
          { texture: cube, origin: [0, 0, i] },
          new Uint8Array(col),
          { bytesPerRow: 4 },
          [1, 1],
        );
      }
      return cube.createView({ dimension: "cube" });
    };

    this._defaultCubeTexView = createCube([50, 50, 100, 255]);
    this._blackCubeTexView = createCube([0, 0, 0, 255]);

    // Default dummy shadow textures (2D Arrays, Depth32Float) and shared comparison sampler
    const dummyDirShadow = this._device.createTexture({
      size: [1, 1, 4],
      format: "depth32float",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this._dummyDirShadowTexView = dummyDirShadow.createView({ dimension: "2d-array" });
    this._defaultDirShadowTexView = this._dummyDirShadowTexView;

    const dummySpotShadow = this._device.createTexture({
      size: [1, 1, 16],
      format: "depth32float",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this._dummySpotShadowTexView = dummySpotShadow.createView({ dimension: "2d-array" });
    this._defaultSpotShadowTexView = this._dummySpotShadowTexView;

    this._shadowSampler = this._device.createSampler({
      magFilter: TextureFilter.LINEAR,
      minFilter: TextureFilter.LINEAR,
      compare: "less",
      addressModeU: TextureWrap.CLAMP_TO_EDGE,
      addressModeV: TextureWrap.CLAMP_TO_EDGE,
    });

    // EVSM moment fallback textures (rgba32float 2d-array) + linear clamp-to-edge sampler. The
    // dummy hands every fragment a neutral all-zero moment read until a real map exists (a full
    // zero read would imply infinite variance only via the floor guard, so getEVSM() early-outs
    // on the evsmParams.x mode flag before sampling anyway).
    const dummyEvsm = this._device.createTexture({
      size: [1, 1, 4],
      format: "rgba32float",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this._dummyEVSMTexView = dummyEvsm.createView({ dimension: "2d-array" });
    this._defaultEVSMTexView = this._dummyEVSMTexView;

    this._evsmSampler = this._device.createSampler({
      magFilter: TextureFilter.LINEAR,
      minFilter: TextureFilter.LINEAR,
      addressModeU: TextureWrap.CLAMP_TO_EDGE,
      addressModeV: TextureWrap.CLAMP_TO_EDGE,
    });
  }

  /** Grows the dummy vertex buffers to cover at least `vertexCount` vertices. A no-op if the
   * current buffers are already large enough. */
  public ensureDummyBufferSize(vertexCount: number): void {
    if (this._dummyBufferSize >= vertexCount * 4 && this._dummyNormalBuffer) return;
    const newSize = Math.max(this._dummyBufferSize * 2, vertexCount * 4, 3000);
    if (this._dummyNormalBuffer) this._buffersPendingDestroy.push(this._dummyNormalBuffer);
    if (this._dummyUvBuffer) this._buffersPendingDestroy.push(this._dummyUvBuffer);
    if (this._dummyTangentBuffer) this._buffersPendingDestroy.push(this._dummyTangentBuffer);
    if (this._dummyJointsBuffer) this._buffersPendingDestroy.push(this._dummyJointsBuffer);
    if (this._dummyWeightsBuffer) this._buffersPendingDestroy.push(this._dummyWeightsBuffer);
    if (this._dummyColorBuffer) this._buffersPendingDestroy.push(this._dummyColorBuffer);
    const normalData = new Float32Array(newSize).fill(0);
    for (let i = 0; i < newSize; i += 3) normalData[i + 1] = 1.0;

    this._dummyNormalBuffer = this._device.createBuffer({
      size: normalData.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this._device.queue.writeBuffer(this._dummyNormalBuffer, 0, normalData);
    const uvData = new Float32Array(newSize).fill(0);
    this._dummyUvBuffer = this._device.createBuffer({
      size: uvData.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this._device.queue.writeBuffer(this._dummyUvBuffer, 0, uvData);
    const tangentData = new Float32Array(newSize).fill(0);
    // vec4 tangent contract (tx, ty, tz, w): x = 1 (neutral direction), w = 1 (no mirroring).
    for (let i = 0; i < newSize; i += 4) {
      tangentData[i] = 1.0;
      tangentData[i + 3] = 1.0;
    }
    this._dummyTangentBuffer = this._device.createBuffer({
      size: tangentData.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this._device.queue.writeBuffer(this._dummyTangentBuffer, 0, tangentData);

    const jointsData = new Float32Array(newSize).fill(0);
    this._dummyJointsBuffer = this._device.createBuffer({
      size: jointsData.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this._device.queue.writeBuffer(this._dummyJointsBuffer, 0, jointsData);

    const weightsData = new Float32Array(newSize).fill(0);
    for (let i = 0; i < newSize; i += 4) weightsData[i] = 1.0;
    this._dummyWeightsBuffer = this._device.createBuffer({
      size: weightsData.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this._device.queue.writeBuffer(this._dummyWeightsBuffer, 0, weightsData);

    const colorData = new Float32Array(newSize).fill(1.0);
    this._dummyColorBuffer = this._device.createBuffer({
      size: colorData.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this._device.queue.writeBuffer(this._dummyColorBuffer, 0, colorData);

    this._dummyBufferSize = newSize;
  }

  public deferDestroyTexture(t: GPUTexture): void {
    this._texturesPendingDestroy.push(t);
  }

  /** Queues a replaced buffer for `drainPendingDestroy()`; use instead of `destroy()` when commands
   * recorded earlier in the same frame might still reference it. */
  public deferDestroyBuffer(b: GPUBuffer): void {
    this._buffersPendingDestroy.push(b);
  }

  /** Destroys buffers and textures replaced mid-frame or during dynamic resize -- call once
   * per frame, right after `queue.submit()`, once nothing can still reference them. */
  public drainPendingDestroy(): void {
    if (this._buffersPendingDestroy.length > 0) {
      for (const b of this._buffersPendingDestroy) b.destroy();
      this._buffersPendingDestroy.length = 0;
    }
    if (this._texturesPendingDestroy.length > 0) {
      for (const t of this._texturesPendingDestroy) t.destroy();
      this._texturesPendingDestroy.length = 0;
    }
  }

  public dispose(): void {
    this._dummyNormalBuffer?.destroy();
    this._dummyUvBuffer?.destroy();
    this._dummyTangentBuffer?.destroy();
    for (const b of this._buffersPendingDestroy) b.destroy();
    this._buffersPendingDestroy.length = 0;
    for (const t of this._texturesPendingDestroy) t.destroy();
    this._texturesPendingDestroy.length = 0;
  }
}
