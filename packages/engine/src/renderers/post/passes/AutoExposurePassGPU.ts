import FULLSCREEN_VERT_WGSL from "../shaders/PostProcess.vert.wgsl?raw";
import LUMINANCE_WGSL from "../shaders/AutoExposureLuminance.frag.wgsl?raw";
import ADAPT_WGSL from "../shaders/AutoExposureAdapt.frag.wgsl?raw";
import { PostEffectPipelineGate } from "../PostEffectPipelineGate.js";
import type { PostEffectPass, PostEffectPassContext } from "../PostEffectPass.js";
import type { AutoExposureElement } from "../elements/AutoExposureElement.js";
import { AUTO_EXPOSURE_GRID } from "../elements/AutoExposureElement.js";
import { TextureFilter, TextureWrap, Topology } from "../../../enums/index.js";

const FORMAT: GPUTextureFormat = "rgba16float";
/** IEEE half 1.0 (exposure multiplier) / 0.0 (EV): the stable texture starts neutral. */
const HALF_ONE = 0x3c00;

/**
 * Eye adaptation on WebGPU (ADR 0061): HDR frame -> 16x16 log-luminance grid -> 1x1 adapted
 * exposure, all recorded into the frame encoder (no readback, no per-frame allocation). The
 * adapted value is copied into a stable 1x1 texture so the uber pass keeps one bind group.
 */
export class AutoExposurePassGPU implements PostEffectPass {
  private readonly _device: GPUDevice;
  private readonly _gate: PostEffectPipelineGate;
  private _luminancePipeline!: GPURenderPipeline;
  private _adaptPipeline!: GPURenderPipeline;
  private _sampler!: GPUSampler;
  private _lumBgl!: GPUBindGroupLayout;

  private readonly _luminance: GPUTexture;
  private readonly _luminanceView: GPUTextureView;
  private readonly _scratch: GPUTexture;
  private readonly _scratchView: GPUTextureView;
  private readonly _current: GPUTexture;
  private readonly _currentView: GPUTextureView;
  private readonly _lumParams: GPUBuffer;
  private readonly _adaptParams: GPUBuffer;
  private _adaptBindGroup!: GPUBindGroup;
  private _lumBindGroup?: GPUBindGroup;
  private _builtSourceView?: GPUTextureView;

  private readonly _lumData = new Float32Array(4);
  private readonly _adaptData = new Float32Array(8);
  private _snap: boolean = true;

  constructor(device: GPUDevice) {
    this._device = device;
    const target = (size: number, extra: number): GPUTexture =>
      device.createTexture({
        size: [size, size, 1],
        format: FORMAT,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | extra,
      });
    this._luminance = target(AUTO_EXPOSURE_GRID, 0);
    this._scratch = target(1, GPUTextureUsage.COPY_SRC);
    this._current = target(1, GPUTextureUsage.COPY_DST);
    this._luminanceView = this._luminance.createView();
    this._scratchView = this._scratch.createView();
    this._currentView = this._current.createView();
    device.queue.writeTexture(
      { texture: this._current },
      new Uint16Array([HALF_ONE, 0, 0, HALF_ONE]),
      { bytesPerRow: 8 },
      [1, 1, 1],
    );
    this._lumParams = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this._adaptParams = device.createBuffer({
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this._gate = new PostEffectPipelineGate(device, "AutoExposure");
    this._gate.begin();
    this._buildPipelines();
    this._gate.end();
  }

  private _buildPipelines(): void {
    const device = this._device;
    this._sampler = device.createSampler({
      minFilter: TextureFilter.LINEAR,
      magFilter: TextureFilter.LINEAR,
      addressModeU: TextureWrap.CLAMP_TO_EDGE,
      addressModeV: TextureWrap.CLAMP_TO_EDGE,
    });
    this._lumBgl = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
      ],
    });
    const adaptBgl = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: "unfilterable-float" },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: "unfilterable-float" },
        },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
      ],
    });
    const vertex = {
      module: device.createShaderModule({ code: FULLSCREEN_VERT_WGSL }),
      entryPoint: "vs_main",
    };
    const pipeline = (bgl: GPUBindGroupLayout, code: string): GPURenderPipeline =>
      device.createRenderPipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [bgl] }),
        vertex,
        fragment: {
          module: device.createShaderModule({ code }),
          entryPoint: "fs_main",
          targets: [{ format: FORMAT }],
        },
        primitive: { topology: Topology.TRIANGLE_LIST },
      });
    this._luminancePipeline = pipeline(this._lumBgl, LUMINANCE_WGSL);
    this._adaptPipeline = pipeline(adaptBgl, ADAPT_WGSL);
    this._adaptBindGroup = device.createBindGroup({
      layout: adaptBgl,
      entries: [
        { binding: 0, resource: this._luminanceView },
        { binding: 1, resource: this._currentView },
        { binding: 2, resource: { buffer: this._adaptParams } },
      ],
    });
  }

  /** Returns the stable 1x1 view holding the adapted exposure (r = multiplier, g = EV). */
  public execute(ctx: PostEffectPassContext): GPUTextureView | null {
    if (!this._gate.ready) return null;
    const element = ctx.element as AutoExposureElement;
    const { ce } = ctx;

    if (this._builtSourceView !== ctx.colorView || !this._lumBindGroup) {
      this._lumBindGroup = this._device.createBindGroup({
        layout: this._lumBgl,
        entries: [
          { binding: 0, resource: this._sampler },
          { binding: 1, resource: ctx.colorView },
          { binding: 2, resource: { buffer: this._lumParams } },
        ],
      });
      this._builtSourceView = ctx.colorView;
    }

    this._lumData[0] = element.centerWeight;
    this._device.queue.writeBuffer(this._lumParams, 0, this._lumData);
    const a = this._adaptData;
    a[0] = element.minEv;
    a[1] = element.maxEv;
    a[2] = element.compensationEv;
    a[3] = ctx.renderer.frameInfo.realDeltaTime;
    a[4] = element.speedDark;
    a[5] = element.speedBright;
    a[6] = this._snap ? 1 : 0;
    a[7] = 0;
    this._device.queue.writeBuffer(this._adaptParams, 0, a);
    this._snap = false;

    this._draw(ce, this._luminanceView, this._luminancePipeline, this._lumBindGroup);
    this._draw(ce, this._scratchView, this._adaptPipeline, this._adaptBindGroup);
    ce.copyTextureToTexture({ texture: this._scratch }, { texture: this._current }, [1, 1, 1]);
    return this._currentView;
  }

  /** Camera cut: the next frame jumps straight to the metered exposure. */
  public resetHistory(): void {
    this._snap = true;
  }

  public destroy(): void {
    this._luminance.destroy();
    this._scratch.destroy();
    this._current.destroy();
    this._lumParams.destroy();
    this._adaptParams.destroy();
  }

  private _draw(
    ce: GPUCommandEncoder,
    view: GPUTextureView,
    pipeline: GPURenderPipeline,
    bindGroup: GPUBindGroup,
  ): void {
    const rp = ce.beginRenderPass({
      colorAttachments: [
        { view, loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 1 } },
      ],
    });
    rp.setPipeline(pipeline);
    rp.setBindGroup(0, bindGroup);
    rp.draw(3);
    rp.end();
  }
}
