import CONTACT_SHADOW_WGSL from "../shaders/ContactShadow.comp.wgsl?raw";
import { PostEffectPipelineGate } from "../PostEffectPipelineGate.js";
import type { PostEffectPass, PostEffectPassContext } from "../PostEffectPass.js";
import type { ContactShadowsElement } from "../elements/index.js";

/**
 * Screen-Space Contact Shadows pass for WebGPU via a compute shader.
 * Reads opaque depth directly via `textureLoad` and writes to an `rgba8unorm` storage texture.
 */
export class ContactShadowPassGPU implements PostEffectPass {
  private _device: GPUDevice;
  private readonly _gate: PostEffectPipelineGate;
  private _pipeline!: GPUComputePipeline;
  private _uniformBuffer!: GPUBuffer;
  private _uniformData: Float32Array = new Float32Array(16);

  private _shadowTexture?: GPUTexture;
  private _shadowTextureView?: GPUTextureView;
  private _bindGroup?: GPUBindGroup;
  private _builtDepthView?: GPUTextureView;
  private _width = 0;
  private _height = 0;

  constructor(device: GPUDevice) {
    this._device = device;
    this._gate = new PostEffectPipelineGate(device, "ContactShadows");
    this._gate.begin();
    this._buildPipeline();
    this._gate.end();
  }

  private _buildPipeline(): void {
    this._uniformBuffer = this._device.createBuffer({
      size: 64, // 16 x f32 (64 bytes)
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
    const module = this._device.createShaderModule({ code: CONTACT_SHADOW_WGSL });

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
      this._shadowTexture &&
      this._width === width &&
      this._height === height &&
      this._builtDepthView === depthView
    ) {
      return;
    }

    this._shadowTexture?.destroy();
    this._width = width;
    this._height = height;
    this._builtDepthView = depthView;

    this._shadowTexture = this._device.createTexture({
      size: [width, height],
      format: "rgba8unorm",
      usage:
        GPUTextureUsage.STORAGE_BINDING |
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_SRC,
    });
    this._shadowTextureView = this._shadowTexture.createView();

    const bgl = this._pipeline.getBindGroupLayout(0);
    this._bindGroup = this._device.createBindGroup({
      layout: bgl,
      entries: [
        { binding: 0, resource: depthView },
        { binding: 1, resource: { buffer: this._uniformBuffer } },
        { binding: 2, resource: this._shadowTextureView },
      ],
    });
  }

  public execute(ctx: PostEffectPassContext): GPUTextureView | null {
    if (!this._gate.ready) return null;
    const { ce, depthView, width, height, near, far, element, projMatrix, vMat, lights } = ctx;
    const cs = element as ContactShadowsElement;
    if (!projMatrix || !vMat || !lights.dLight) return null;

    this._resize(width, height, depthView);
    if (!this._shadowTexture || !this._shadowTextureView || !this._bindGroup) return null;

    // Directional light direction points along the ray (away from light source).
    // The vector pointing TOWARDS light in world space:
    const dLight = lights.dLight;
    const lxW = -dLight.direction.x;
    const lyW = -dLight.direction.y;
    const lzW = -dLight.direction.z;

    // Transform towards-light vector into view space (3x3 rotation):
    let lxV = vMat[0]! * lxW + vMat[4]! * lyW + vMat[8]! * lzW;
    let lyV = vMat[1]! * lxW + vMat[5]! * lyW + vMat[9]! * lzW;
    let lzV = vMat[2]! * lxW + vMat[6]! * lyW + vMat[10]! * lzW;
    const len = Math.hypot(lxV, lyV, lzV) || 1.0;
    lxV /= len;
    lyV /= len;
    lzV /= len;

    // Pack uniform data
    this._uniformData[0] = near;
    this._uniformData[1] = far;
    this._uniformData[2] = projMatrix[0]!;
    this._uniformData[3] = projMatrix[5]!;
    this._uniformData[4] = lxV;
    this._uniformData[5] = lyV;
    this._uniformData[6] = lzV;
    this._uniformData[7] = cs.intensity;
    this._uniformData[8] = cs.maxDistance;
    this._uniformData[9] = cs.thickness;
    this._uniformData[10] = cs.fadeDistance;
    this._uniformData[11] = cs.bias;
    this._uniformData[12] = cs.raySteps;
    this._uniformData[13] = 0.0;
    this._uniformData[14] = 0.0;
    this._uniformData[15] = 0.0;
    this._device.queue.writeBuffer(this._uniformBuffer, 0, this._uniformData);

    const pass = ce.beginComputePass({ label: "ContactShadowPassGPU" });
    pass.setPipeline(this._pipeline);
    pass.setBindGroup(0, this._bindGroup);
    pass.dispatchWorkgroups(Math.ceil(width / 8), Math.ceil(height / 8), 1);
    pass.end();

    return this._shadowTextureView;
  }

  public destroy(): void {
    this._shadowTexture?.destroy();
    this._uniformBuffer?.destroy();
  }
}
