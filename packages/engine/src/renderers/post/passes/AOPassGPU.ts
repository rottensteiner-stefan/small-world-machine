import AO_WGSL from "../shaders/AO.frag.wgsl?raw";
import { HbaoElement } from "../elements/index.js";

/**
 * Generates the HBAO texture for WebGPU via a compute pass -- reading the opaque
 * depth texture directly via `textureLoad` and writing to a storage texture (`r8unorm`).
 */
export class AOPassGPU {
  private _device: GPUDevice;
  private _pipeline!: GPUComputePipeline;
  private _uniformBuffer!: GPUBuffer;
  private _uniformData: Float32Array = new Float32Array(20);

  private _aoTexture?: GPUTexture;
  private _aoTextureView?: GPUTextureView;
  private _bindGroup?: GPUBindGroup;
  private _builtDepthView?: GPUTextureView;
  private _builtNormalView: GPUTextureView | undefined = undefined;
  private _dummyNormalView!: GPUTextureView;
  private _width = 0;
  private _height = 0;

  constructor(device: GPUDevice) {
    this._device = device;
    this._buildPipeline();
  }

  private _buildPipeline(): void {
    this._uniformBuffer = this._device.createBuffer({
      size: 80, // AOUniforms: 8 x f32 + 3 x vec4f view rotation columns
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
        {
          binding: 3,
          visibility: GPUShaderStage.COMPUTE,
          texture: { sampleType: "unfilterable-float" },
        },
      ],
    });

    // Bound in place of the real normal buffer while it is off (the shader skips it then).
    this._dummyNormalView = this._device
      .createTexture({ size: [1, 1], format: "rg16float", usage: GPUTextureUsage.TEXTURE_BINDING })
      .createView();

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

  private _resize(
    width: number,
    height: number,
    depthView: GPUTextureView,
    normalView: GPUTextureView | undefined,
  ): void {
    if (
      this._aoTexture &&
      this._width === width &&
      this._height === height &&
      this._builtDepthView === depthView &&
      this._builtNormalView === normalView
    ) {
      return;
    }

    this._aoTexture?.destroy();
    this._width = width;
    this._height = height;
    this._builtDepthView = depthView;
    this._builtNormalView = normalView;

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
        { binding: 3, resource: normalView ?? this._dummyNormalView },
      ],
    });
  }

  /**
   * Computes the HBAO texture from the opaque depth texture via a compute pass.
   * @param ce The command encoder to record into.
   * @param depthView View of the already-captured opaque (pre-transparent) depth texture.
   * @param width Canvas width in pixels.
   * @param height Canvas height in pixels.
   * @param near Camera near plane.
   * @param far Camera far plane.
   * @param projMatrixData The camera's raw perspective projection matrix.
   * @param hbao The HBAO effect parameters (radius, intensity).
   * @param viewMatrix The camera's view matrix; rotates the world-space normal buffer into view space.
   * @param normalView The world-space normal buffer (ADR 0028), or undefined to derive normals from depth.
   * @returns A view of the single-channel AO texture (R = occlusion factor), or null if unavailable.
   */
  public execute(
    ce: GPUCommandEncoder,
    depthView: GPUTextureView,
    width: number,
    height: number,
    near: number,
    far: number,
    projMatrixData: Float32Array,
    hbao: HbaoElement,
    viewMatrix: Float32Array | undefined,
    normalView: GPUTextureView | undefined,
  ): GPUTextureView | null {
    const useNormals = normalView !== undefined && viewMatrix !== undefined;
    this._resize(width, height, depthView, useNormals ? normalView : undefined);
    if (!this._aoTexture || !this._aoTextureView || !this._bindGroup) return null;

    // Perspective matrix diagonal scale terms (see Matrix4.perspective): data[0]=A, data[5]=B.
    this._uniformData[0] = near;
    this._uniformData[1] = far;
    this._uniformData[2] = projMatrixData[0]!;
    this._uniformData[3] = projMatrixData[5]!;
    this._uniformData[4] = hbao.radius;
    this._uniformData[5] = hbao.intensity;
    this._uniformData[6] = useNormals ? 1 : 0;
    if (useNormals) {
      // Column-major view matrix: rotation columns are elements 0-2, 4-6 and 8-10.
      for (let c = 0; c < 3; c++) {
        const out = 8 + c * 4;
        this._uniformData[out] = viewMatrix[c * 4]!;
        this._uniformData[out + 1] = viewMatrix[c * 4 + 1]!;
        this._uniformData[out + 2] = viewMatrix[c * 4 + 2]!;
        this._uniformData[out + 3] = 0;
      }
    }
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
