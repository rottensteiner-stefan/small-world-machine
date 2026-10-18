import AO_WGSL from "../shaders/AO.frag.wgsl?raw";
import type { PostEffectPass, PostEffectPassContext } from "../PostEffectPass.js";
import type { HbaoElement } from "../elements/index.js";

/**
 * Generates the HBAO texture for WebGPU via a compute pass -- reading the opaque
 * depth texture directly via `textureLoad` and writing to a storage texture (`r8unorm`).
 */
export class AOPassGPU implements PostEffectPass {
  private _device: GPUDevice;
  private _pipeline!: GPUComputePipeline;
  private _uniformBuffer!: GPUBuffer;
  private _uniformData: Float32Array = new Float32Array(8);

  private _aoTexture?: GPUTexture;
  private _aoTextureView?: GPUTextureView;
  private _bindGroup?: GPUBindGroup;
  private _builtDepthView?: GPUTextureView;
  private _width = 0;
  private _height = 0;

  constructor(device: GPUDevice) {
    this._device = device;
    this._buildPipeline();
  }

  private _buildPipeline(): void {
    this._uniformBuffer = this._device.createBuffer({
      size: 32, // AOUniforms: 8 x f32
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const bgl = this._device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: "depth" } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
        {
          binding: 2,
          visibility: GPUShaderStage.COMPUTE,
          storageTexture: { access: "write-only", format: "rgba8unorm" },
        },
      ],
    });

    const layout = this._device.createPipelineLayout({ bindGroupLayouts: [bgl] });
    const module = this._device.createShaderModule({ code: AO_WGSL });

    this._pipeline = this._device.createComputePipeline({
      layout,
      compute: {
        module,
        entryPoint: "cs_main",
      },
    });
  }

  private _resize(width: number, height: number, depthView: GPUTextureView): void {
    if (
      this._aoTexture &&
      this._width === width &&
      this._height === height &&
      this._builtDepthView === depthView
    ) {
      return;
    }

    this._aoTexture?.destroy();
    this._width = width;
    this._height = height;
    this._builtDepthView = depthView;

    this._aoTexture = this._device.createTexture({
      size: [width, height],
      format: "rgba8unorm",
      usage:
        GPUTextureUsage.STORAGE_BINDING |
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_SRC,
    });
    this._aoTextureView = this._aoTexture.createView();

    const bgl = this._pipeline.getBindGroupLayout(0);
    this._bindGroup = this._device.createBindGroup({
      layout: bgl,
      entries: [
        { binding: 0, resource: depthView },
        { binding: 1, resource: { buffer: this._uniformBuffer } },
        { binding: 2, resource: this._aoTextureView },
      ],
    });
  }

  /**
   * Computes the HBAO texture from the opaque depth texture via a compute pass. The effect's
   * parameters come from `ctx.element` (typed as `HbaoElement`); the camera projection matrix from
   * `ctx.projMatrix` -- the renderer only dispatches this pass while both a real opaque depth
   * capture and the projection matrix are available (see the `PostEffectPass` contract).
   * @returns A view of the single-channel AO texture (R = occlusion factor), or null if unavailable.
   */
  public execute(ctx: PostEffectPassContext): GPUTextureView | null {
    const { ce, depthView, width, height, near, far, element } = ctx;
    const hbao = element as HbaoElement;
    const projMatrixData = ctx.projMatrix!;
    this._resize(width, height, depthView);
    if (!this._aoTexture || !this._aoTextureView || !this._bindGroup) return null;

    // Perspective matrix diagonal scale terms (see Matrix4.perspective): data[0]=A, data[5]=B.
    this._uniformData[0] = near;
    this._uniformData[1] = far;
    this._uniformData[2] = projMatrixData[0]!;
    this._uniformData[3] = projMatrixData[5]!;
    this._uniformData[4] = hbao.radius;
    this._uniformData[5] = hbao.intensity;
    this._device.queue.writeBuffer(this._uniformBuffer, 0, this._uniformData);

    const pass = ce.beginComputePass({ label: "AOPassGPU" });
    pass.setPipeline(this._pipeline);
    pass.setBindGroup(0, this._bindGroup);
    pass.dispatchWorkgroups(Math.ceil(width / 8), Math.ceil(height / 8), 1);
    pass.end();

    return this._aoTextureView;
  }

  public destroy(): void {
    this._aoTexture?.destroy();
    this._uniformBuffer?.destroy();
  }
}
