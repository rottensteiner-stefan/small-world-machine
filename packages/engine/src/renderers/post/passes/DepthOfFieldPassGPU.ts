import FULLSCREEN_VERT_WGSL from "../shaders/PostProcess.vert.wgsl?raw";
import COC_FRAG_WGSL from "../shaders/DepthOfFieldCoc.frag.wgsl?raw";
import GATHER_FRAG_WGSL from "../shaders/DepthOfFieldGather.frag.wgsl?raw";
import COMPOSITE_FRAG_WGSL from "../shaders/DepthOfFieldComposite.frag.wgsl?raw";

import type { DepthOfFieldElement } from "../elements/index.js";
import { TextureFilter, TextureWrap } from "../../../enums/index.js";
import type { PostEffectPass, PostEffectPassContext } from "../PostEffectPass.js";

const TARGET_FORMAT: GPUTextureFormat = "rgba16float";

/**
 * WebGPU thin-lens depth of field:
 * 1. Half-res CoC prefilter (colour + signed CoC from the opaque depth capture).
 * 2. Half-res 64-tap golden-angle scatter-as-gather bokeh.
 * 3. Full-res composite with a CoC-aware bilateral upsample.
 */
export class DepthOfFieldPassGPU implements PostEffectPass {
  private readonly _device: GPUDevice;
  private readonly _sampler: GPUSampler;
  private readonly _uniformBuffer: GPUBuffer;
  // DofUniforms: near, far, focusDistance, cocScale, maxCoc, 3x pad (32 bytes).
  private readonly _uniformData: Float32Array = new Float32Array(8);

  private readonly _pipelineCoc: GPURenderPipeline;
  private readonly _pipelineGather: GPURenderPipeline;
  private readonly _pipelineComposite: GPURenderPipeline;

  private _width: number = 0;
  private _height: number = 0;
  private _cocTexture: GPUTexture | undefined = undefined;
  private _cocView: GPUTextureView | undefined = undefined;
  private _gatherTexture: GPUTexture | undefined = undefined;
  private _gatherView: GPUTextureView | undefined = undefined;
  private _outputTexture: GPUTexture | undefined = undefined;
  private _outputView: GPUTextureView | undefined = undefined;

  private _bindGroupCoc: GPUBindGroup | undefined = undefined;
  private _bindGroupGather: GPUBindGroup | undefined = undefined;
  private _bindGroupComposite: GPUBindGroup | undefined = undefined;
  private _builtColorView: GPUTextureView | undefined = undefined;
  private _builtDepthView: GPUTextureView | undefined = undefined;

  constructor(device: GPUDevice) {
    this._device = device;
    this._sampler = device.createSampler({
      minFilter: TextureFilter.LINEAR,
      magFilter: TextureFilter.LINEAR,
      addressModeU: TextureWrap.CLAMP_TO_EDGE,
      addressModeV: TextureWrap.CLAMP_TO_EDGE,
    });
    this._uniformBuffer = device.createBuffer({
      size: this._uniformData.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const vert = device.createShaderModule({ code: FULLSCREEN_VERT_WGSL });
    this._pipelineCoc = this._createPipeline(vert, COC_FRAG_WGSL);
    this._pipelineGather = this._createPipeline(vert, GATHER_FRAG_WGSL);
    this._pipelineComposite = this._createPipeline(vert, COMPOSITE_FRAG_WGSL);
  }

  private _createPipeline(vert: GPUShaderModule, fragCode: string): GPURenderPipeline {
    return this._device.createRenderPipeline({
      layout: "auto",
      vertex: { module: vert, entryPoint: "vs_main" },
      fragment: {
        module: this._device.createShaderModule({ code: fragCode }),
        entryPoint: "fs_main",
        targets: [{ format: TARGET_FORMAT }],
      },
      primitive: { topology: "triangle-list" },
    });
  }

  private _createTarget(width: number, height: number): GPUTexture {
    return this._device.createTexture({
      size: [width, height, 1],
      format: TARGET_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
  }

  private _resizeTargets(width: number, height: number): void {
    if (this._outputTexture && this._width === width && this._height === height) return;
    this._width = width;
    this._height = height;
    this._cocTexture?.destroy();
    this._gatherTexture?.destroy();
    this._outputTexture?.destroy();

    const halfW = Math.max(Math.floor(width / 2), 1);
    const halfH = Math.max(Math.floor(height / 2), 1);
    this._cocTexture = this._createTarget(halfW, halfH);
    this._cocView = this._cocTexture.createView();
    this._gatherTexture = this._createTarget(halfW, halfH);
    this._gatherView = this._gatherTexture.createView();
    this._outputTexture = this._createTarget(width, height);
    this._outputView = this._outputTexture.createView();
    this._bindGroupCoc = undefined;
  }

  private _buildBindGroups(colorView: GPUTextureView, depthView: GPUTextureView): void {
    const device = this._device;
    const uniforms = { buffer: this._uniformBuffer };
    this._bindGroupCoc = device.createBindGroup({
      layout: this._pipelineCoc.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: colorView },
        { binding: 1, resource: depthView },
        { binding: 2, resource: uniforms },
      ],
    });
    this._bindGroupGather = device.createBindGroup({
      layout: this._pipelineGather.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this._sampler },
        { binding: 1, resource: this._cocView! },
        { binding: 2, resource: uniforms },
      ],
    });
    this._bindGroupComposite = device.createBindGroup({
      layout: this._pipelineComposite.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: colorView },
        { binding: 1, resource: depthView },
        { binding: 2, resource: this._cocView! },
        { binding: 3, resource: this._gatherView! },
        { binding: 4, resource: uniforms },
      ],
    });
    this._builtColorView = colorView;
    this._builtDepthView = depthView;
  }

  private _drawFullscreen(
    ce: GPUCommandEncoder,
    target: GPUTextureView,
    pipeline: GPURenderPipeline,
    bindGroup: GPUBindGroup,
  ): void {
    const rp = ce.beginRenderPass({
      colorAttachments: [
        {
          view: target,
          loadOp: "clear",
          storeOp: "store",
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
        },
      ],
    });
    rp.setPipeline(pipeline);
    rp.setBindGroup(0, bindGroup);
    rp.draw(3, 1, 0, 0);
    rp.end();
  }

  /**
   * Defocuses `ctx.colorView` using the opaque depth capture. The renderer only dispatches this
   * pass while a real capture exists (see the `PostEffectPass` contract).
   * @returns The defocused HDR colour view that replaces the chained colour, or null.
   */
  public execute(ctx: PostEffectPassContext): GPUTextureView | null {
    const { ce, colorView, depthView, width, height } = ctx;
    const element = ctx.element as DepthOfFieldElement;
    if (!element.enabled || width <= 0 || height <= 0) return null;

    this._resizeTargets(width, height);
    if (
      !this._bindGroupCoc ||
      this._builtColorView !== colorView ||
      this._builtDepthView !== depthView
    ) {
      this._buildBindGroups(colorView, depthView);
    }

    const d = this._uniformData;
    d[0] = ctx.near;
    d[1] = ctx.far;
    d[2] = element.focusDistance;
    d[3] = element.cocScalePx(height);
    d[4] = element.maxCocPx(height);
    this._device.queue.writeBuffer(this._uniformBuffer, 0, d);

    this._drawFullscreen(ce, this._cocView!, this._pipelineCoc, this._bindGroupCoc!);
    this._drawFullscreen(ce, this._gatherView!, this._pipelineGather, this._bindGroupGather!);
    this._drawFullscreen(ce, this._outputView!, this._pipelineComposite, this._bindGroupComposite!);
    return this._outputView!;
  }

  public destroy(): void {
    this._cocTexture?.destroy();
    this._gatherTexture?.destroy();
    this._outputTexture?.destroy();
    this._uniformBuffer.destroy();
    this._bindGroupCoc = undefined;
    this._bindGroupGather = undefined;
    this._bindGroupComposite = undefined;
  }
}
