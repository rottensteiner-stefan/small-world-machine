import BLOOM_DOWNSAMPLE_WGSL from "../shaders/BloomDownsample.frag.wgsl?raw";
import BLOOM_UPSAMPLE_WGSL from "../shaders/BloomUpsample.frag.wgsl?raw";
import FULLSCREEN_VERT_WGSL from "../shaders/PostProcess.vert.wgsl?raw";
import type { PostEffectPass, PostEffectPassContext } from "../PostEffectPass.js";
import type { BloomElement } from "../elements/index.js";
import { TextureFilter, TextureWrap, Topology } from "../../../enums/index.js";

/**
 * Handles the Bloom generation (Kawase Dual Filtering) for WebGPU.
 */
export class BloomPassGPU implements PostEffectPass {
  private _device: GPUDevice;
  private _downsamplePipeline!: GPURenderPipeline;
  private _upsamplePipeline!: GPURenderPipeline;
  private _sampler!: GPUSampler;

  private _bloomTexture?: GPUTexture;
  private _mipViews: GPUTextureView[] = [];
  private _downBindGroups: GPUBindGroup[] = [];
  private _upBindGroups: GPUBindGroup[] = [];
  private _uniformBuffers: GPUBuffer[] = []; // Reuse buffers across passes

  private _width = 0;
  private _height = 0;
  private _mipCount = 1;
  private _builtSourceView?: GPUTextureView;

  private _downUniformData = new Float32Array(8);
  private _upUniformData = new Float32Array(4);

  constructor(device: GPUDevice) {
    this._device = device;
    this._buildPipelines();
  }

  private _buildPipelines(): void {
    this._sampler = this._device.createSampler({
      minFilter: TextureFilter.LINEAR,
      magFilter: TextureFilter.LINEAR,
      addressModeU: TextureWrap.CLAMP_TO_EDGE,
      addressModeV: TextureWrap.CLAMP_TO_EDGE,
    });

    const bgl = this._device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
      ],
    });

    const layout = this._device.createPipelineLayout({ bindGroupLayouts: [bgl] });
    const vertModule = this._device.createShaderModule({ code: FULLSCREEN_VERT_WGSL });
    const downModule = this._device.createShaderModule({ code: BLOOM_DOWNSAMPLE_WGSL });
    const upModule = this._device.createShaderModule({ code: BLOOM_UPSAMPLE_WGSL });

    this._downsamplePipeline = this._device.createRenderPipeline({
      layout,
      vertex: { module: vertModule, entryPoint: "vs_main" },
      fragment: {
        module: downModule,
        entryPoint: "fs_main",
        targets: [{ format: "rgba16float" }],
      },
      primitive: { topology: Topology.TRIANGLE_LIST },
    });

    this._upsamplePipeline = this._device.createRenderPipeline({
      layout,
      vertex: { module: vertModule, entryPoint: "vs_main" },
      fragment: {
        module: upModule,
        entryPoint: "fs_main",
        targets: [
          {
            format: "rgba16float",
            blend: {
              color: { srcFactor: "one", dstFactor: "one", operation: "add" },
              alpha: { srcFactor: "one", dstFactor: "one", operation: "add" },
            },
          },
        ],
      },
      primitive: { topology: Topology.TRIANGLE_LIST },
    });
  }

  private _resizeMipChain(width: number, height: number, sourceView: GPUTextureView): void {
    // Generate bloom texture size (downscaled to 1/2 size)
    const bloomW = Math.max(1, Math.floor(width / 2));
    const bloomH = Math.max(1, Math.floor(height / 2));

    if (
      this._bloomTexture &&
      this._width === bloomW &&
      this._height === bloomH &&
      this._builtSourceView === sourceView
    ) {
      return;
    }

    if (this._bloomTexture) {
      // The previous mip chain is being replaced on resize -- release its native resources
      // explicitly (WebGPU does not GC them automatically, so without this every resize leaks
      // VRAM for the old rgba16float texture and uniform buffers).
      this._bloomTexture.destroy();
      for (const buf of this._uniformBuffers) buf.destroy();
      this._uniformBuffers = [];
    }

    this._width = bloomW;
    this._height = bloomH;
    this._builtSourceView = sourceView;

    // WebGPU rejects a mipLevelCount above 1 + floor(log2(max(width, height))) -- a fixed
    // count of 5 is invalid once the bloom target (already half the source resolution) shrinks
    // below 16px on its longest side. Mirrors BloomPassGL's dynamic mip-chain length.
    const maxValidMipCount = 1 + Math.floor(Math.log2(Math.max(bloomW, bloomH)));
    this._mipCount = Math.min(5, maxValidMipCount);

    this._bloomTexture = this._device.createTexture({
      size: [bloomW, bloomH, 1],
      format: "rgba16float",
      mipLevelCount: this._mipCount,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });

    this._mipViews = [];
    this._downBindGroups = [];
    this._upBindGroups = [];

    // Create a uniform buffer for each level (down + up passes)
    const totalPasses = this._mipCount * 2;
    for (let i = 0; i < totalPasses; i++) {
      this._uniformBuffers.push(
        this._device.createBuffer({
          size: 32, // DownUniforms/UpUniforms size (32 bytes aligned)
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        }),
      );
    }

    // 1. Create mip views
    for (let i = 0; i < this._mipCount; i++) {
      this._mipViews.push(
        this._bloomTexture.createView({
          baseMipLevel: i,
          mipLevelCount: 1,
        }),
      );
    }

    const bgl = this._downsamplePipeline.getBindGroupLayout(0);

    // 2. Create downsample bind groups
    for (let i = 0; i < this._mipCount; i++) {
      const readView = i === 0 ? sourceView : this._mipViews[i - 1]!;
      this._downBindGroups.push(
        this._device.createBindGroup({
          layout: bgl,
          entries: [
            { binding: 0, resource: this._sampler },
            { binding: 1, resource: readView },
            { binding: 2, resource: { buffer: this._uniformBuffers[i]! } },
          ],
        }),
      );
    }

    // 3. Create upsample bind groups
    for (let i = this._mipCount - 2; i >= 0; i--) {
      const readView = this._mipViews[i + 1]!;
      const bufIdx = this._mipCount + i;
      this._upBindGroups.push(
        this._device.createBindGroup({
          layout: bgl,
          entries: [
            { binding: 0, resource: this._sampler },
            { binding: 1, resource: readView },
            { binding: 2, resource: { buffer: this._uniformBuffers[bufIdx]! } },
          ],
        }),
      );
    }
  }

  public execute(ctx: PostEffectPassContext): GPUTextureView | null {
    const { ce, element } = ctx;
    const hdrTexture = ctx.colorTexture!;
    const hdrTextureView = ctx.colorView;
    const bloomConfig = element as BloomElement;
    const width = hdrTexture.width;
    const height = hdrTexture.height;

    this._resizeMipChain(width, height, hdrTextureView);
    if (!this._bloomTexture) return null;

    // --- DOWNSAMPLE ---
    const threshold = bloomConfig.threshold;
    const knee = bloomConfig.softThreshold * threshold + 0.0001;

    let currentW = width;
    let currentH = height;

    for (let i = 0; i < this._mipCount; i++) {
      const destW = Math.max(1, Math.floor(this._width / Math.pow(2, i)));
      const destH = Math.max(1, Math.floor(this._height / Math.pow(2, i)));

      const data = this._downUniformData;
      data[0] = threshold;
      data[1] = threshold - knee;
      data[2] = 2.0 * knee;
      data[3] = 0.25 / knee;
      data[4] = 1.0 / currentW;
      data[5] = 1.0 / currentH;
      data[6] = i === 0 ? 1.0 : 0.0; // isFirstPass
      data[7] = 0.0; // padding
      this._device.queue.writeBuffer(this._uniformBuffers[i]!, 0, data);

      const rp = ce.beginRenderPass({
        colorAttachments: [
          {
            view: this._mipViews[i]!,
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
            loadOp: "clear",
            storeOp: "store",
          },
        ],
      });

      rp.setPipeline(this._downsamplePipeline);
      rp.setBindGroup(0, this._downBindGroups[i]!);
      rp.draw(3);
      rp.end();

      currentW = destW;
      currentH = destH;
    }

    // --- UPSAMPLE ---
    for (let i = this._mipCount - 2; i >= 0; i--) {
      const srcW = Math.max(1, Math.floor(this._width / Math.pow(2, i + 1)));
      const srcH = Math.max(1, Math.floor(this._height / Math.pow(2, i + 1)));

      const bufIdx = this._mipCount + i;
      const data = this._upUniformData;
      data[0] = 1.0 / srcW;
      data[1] = 1.0 / srcH;
      data[2] = bloomConfig.radius;
      data[3] = 0.0; // padding
      this._device.queue.writeBuffer(this._uniformBuffers[bufIdx]!, 0, data);

      const rp = ce.beginRenderPass({
        colorAttachments: [
          {
            view: this._mipViews[i]!,
            loadOp: "load",
            storeOp: "store",
          },
        ],
      });

      rp.setPipeline(this._upsamplePipeline);
      const bgIdx = this._mipCount - 2 - i;
      rp.setBindGroup(0, this._upBindGroups[bgIdx]!);
      rp.draw(3);
      rp.end();
    }

    // Return the largest mip view (index 0) containing the final combined bloom blur
    return this._mipViews[0] ?? null;
  }

  public destroy(): void {
    if (this._bloomTexture) this._bloomTexture.destroy();
    for (const buf of this._uniformBuffers) buf.destroy();
  }
}
