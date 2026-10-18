import FULLSCREEN_VERT_WGSL from "../shaders/PostProcess.vert.wgsl?raw";
import HISTORY_BLEND_FRAG_WGSL from "../shaders/HistoryBlend.frag.wgsl?raw";
import type { PostEffectPass, PostEffectPassContext } from "../PostEffectPass.js";
import { TextureFilter, TextureWrap, Topology } from "../../../enums/index.js";

/**
 * Generic exponential history blend for WebGPU -- see HistoryBlendPassGL for the shared
 * rationale/trade-offs (used by both `TaaElement` and `MotionTrailElement`; the renderer keeps
 * one separate instance per effect type in its `PostEffectPass` registry, so each keeps its own
 * history buffer).
 */
export class HistoryBlendPassGPU implements PostEffectPass {
  private _device: GPUDevice;
  private _pipeline!: GPURenderPipeline;
  private _sampler!: GPUSampler;
  private _uniformBuffer!: GPUBuffer;
  private _uniformData: Float32Array = new Float32Array(4);

  private _pingPong?: [GPUTexture, GPUTexture];
  private _pingPongViews?: [GPUTextureView, GPUTextureView];
  private _parity: number = 0;
  private _width = 0;
  private _height = 0;
  private _hasHistory = false;

  private _bindGroups: [GPUBindGroup, GPUBindGroup] | undefined = undefined;
  private _builtCurrentView?: GPUTextureView;

  constructor(device: GPUDevice) {
    this._device = device;
    this._buildPipeline();
  }

  private _buildPipeline(): void {
    this._sampler = this._device.createSampler({
      minFilter: TextureFilter.LINEAR,
      magFilter: TextureFilter.LINEAR,
      addressModeU: TextureWrap.CLAMP_TO_EDGE,
      addressModeV: TextureWrap.CLAMP_TO_EDGE,
    });

    this._uniformBuffer = this._device.createBuffer({
      size: 16, // HistoryBlendUniforms: 4 x f32
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const bgl = this._device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: {} },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
      ],
    });

    const layout = this._device.createPipelineLayout({ bindGroupLayouts: [bgl] });
    const vertModule = this._device.createShaderModule({ code: FULLSCREEN_VERT_WGSL });
    const fragModule = this._device.createShaderModule({ code: HISTORY_BLEND_FRAG_WGSL });

    this._pipeline = this._device.createRenderPipeline({
      layout,
      vertex: { module: vertModule, entryPoint: "vs_main" },
      fragment: {
        module: fragModule,
        entryPoint: "fs_main",
        targets: [{ format: "rgba16float" }],
      },
      primitive: { topology: Topology.TRIANGLE_LIST },
    });
  }

  private _resize(width: number, height: number): void {
    if (this._pingPong && this._width === width && this._height === height) return;

    // Release the previous ping-pong pair on resize -- WebGPU does not GC native resources
    // automatically, so skipping this leaks VRAM for the old rgba16float textures.
    for (const old of this._pingPong ?? []) old.destroy();

    this._width = width;
    this._height = height;
    this._hasHistory = false;
    this._parity = 0;
    this._bindGroups = undefined;

    const makeTexture = (): GPUTexture =>
      this._device.createTexture({
        size: [width, height],
        format: "rgba16float",
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      });
    this._pingPong = [makeTexture(), makeTexture()];
    this._pingPongViews = [this._pingPong[0].createView(), this._pingPong[1].createView()];
  }

  /**
   * Resolves the current frame against history.
   * @returns This frame's resolved HDR texture view (becomes history for the next call), or null if unavailable.
   */
  public execute(ctx: PostEffectPassContext): GPUTextureView | null {
    const { ce, width, height } = ctx;
    const currentView = ctx.colorView;
    // `PostProcessingElement`'s base type has no `feedback` member -- the renderer only ever
    // hands this pass a `TaaElement`/`MotionTrailElement` (both of which declare it), so the
    // cast through `unknown` is safe and pinned by the renderer's dispatch sites.
    const config = ctx.element as unknown as { feedback: number };
    this._resize(width, height);
    if (!this._pingPong || !this._pingPongViews) return null;

    // Bind groups depend on which ping-pong slot is being read as history this call, plus the
    // (possibly-changing, e.g. on canvas resize) current-frame source view -- rebuild if either
    // input view is different from what's currently bound.
    if (!this._bindGroups || this._builtCurrentView !== currentView) {
      const bgl = this._pipeline.getBindGroupLayout(0);
      this._bindGroups = [0, 1].map((i) =>
        this._device.createBindGroup({
          layout: bgl,
          entries: [
            { binding: 0, resource: this._sampler },
            { binding: 1, resource: currentView },
            { binding: 2, resource: this._pingPongViews![1 - i]! },
            { binding: 3, resource: { buffer: this._uniformBuffer } },
          ],
        }),
      ) as [GPUBindGroup, GPUBindGroup];
      this._builtCurrentView = currentView;
    }

    this._uniformData[0] = config.feedback;
    this._uniformData[1] = this._hasHistory ? 1.0 : 0.0;
    this._device.queue.writeBuffer(this._uniformBuffer, 0, this._uniformData);

    const writeView = this._pingPongViews[this._parity]!;
    const rp = ce.beginRenderPass({
      colorAttachments: [
        {
          view: writeView,
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });
    rp.setPipeline(this._pipeline);
    rp.setBindGroup(0, this._bindGroups[this._parity]);
    rp.draw(3);
    rp.end();

    this._hasHistory = true;
    this._parity = 1 - this._parity;

    return writeView;
  }

  public destroy(): void {
    this._pingPong?.[0].destroy();
    this._pingPong?.[1].destroy();
    this._uniformBuffer?.destroy();
  }
}
