import spectrumInitWGSL from "../../shaders/source/web_gpu/compute/ocean_spectrum_init.wgsl?raw";
import spectrumStepWGSL from "../../shaders/source/web_gpu/compute/ocean_spectrum_step.wgsl?raw";
import ifftPassWGSL from "../../shaders/source/web_gpu/compute/ocean_ifft_pass.wgsl?raw";
import assembleWGSL from "../../shaders/source/web_gpu/compute/ocean_assemble.wgsl?raw";

/** Fixed grid resolution for the WebGPU compute 2D JONSWAP IFFT wavefield (shared memory 8 KB). */
export const OCEAN_FFT_RESOLUTION = 256;

const WORKGROUP_SIZE_2D = 8;
const DISPATCH_GROUPS_2D = OCEAN_FFT_RESOLUTION / WORKGROUP_SIZE_2D;
const TEXEL_COUNT = OCEAN_FFT_RESOLUTION * OCEAN_FFT_RESOLUTION;
const SPECTRUM_BUFFER_BYTES = TEXEL_COUNT * 16;
const FOAM_BUFFER_BYTES = TEXEL_COUNT * 4;
const DEFAULT_SEED = 0x517cc1b7;
const PARAM_EPSILON = 1e-4;

/** Parameters extracted from `OceanMaterial` manifest lanes driving JONSWAP synthesis. */
export interface OceanFftUpdateParams {
  windDirX: number;
  windDirZ: number;
  windSpeed: number;
  waveScale: number;
  patchSize: number;
  choppiness: number;
  time: number;
}

function logShaderErrors(module: GPUShaderModule, label: string): void {
  void module.getCompilationInfo().then((info) => {
    for (let i = 0; i < info.messages.length; i++) {
      const msg = info.messages[i]!;
      if (msg.type === "error") {
        console.error(
          `[OceanFftSystem:${label}] WGSL line ${msg.lineNum}:${msg.linePos}: ${msg.message}`,
        );
      }
    }
  });
}

/**
 * WebGPU compute manager synthesizing a periodic 256x256 JONSWAP directional ocean wavefield
 * (Tessendorf 2001 / Hasselmann et al. 1973). Produces filterable `rgba16float` displacement
 * (`u_oceanDispMap`) and slope/Jacobian/persistent-foam (`u_oceanNormFoamMap`) textures cleanly
 * in zero-allocation per-frame passes.
 */
export class OceanFftSystem {
  public readonly dispTexture: GPUTexture;
  public readonly dispView: GPUTextureView;
  public readonly normFoamTexture: GPUTexture;
  public readonly normFoamView: GPUTextureView;

  private readonly _device: GPUDevice;
  private readonly _h0Buffer: GPUBuffer;
  private readonly _pingABuffer: GPUBuffer;
  private readonly _pingBBuffer: GPUBuffer;
  private readonly _pongABuffer: GPUBuffer;
  private readonly _pongBBuffer: GPUBuffer;
  private readonly _foamStateBuffer: GPUBuffer;

  private readonly _initUniformBuffer: GPUBuffer;
  private readonly _stepUniformBuffer: GPUBuffer;
  private readonly _ifftHorizUniformBuffer: GPUBuffer;
  private readonly _ifftVertUniformBuffer: GPUBuffer;
  private readonly _assembleUniformBuffer: GPUBuffer;

  // Pre-allocated uniform staging views (zero heap allocations inside update()).
  private readonly _initBuf = new ArrayBuffer(32);
  private readonly _initU32 = new Uint32Array(this._initBuf);
  private readonly _initF32 = new Float32Array(this._initBuf);

  private readonly _stepBuf = new ArrayBuffer(16);
  private readonly _stepU32 = new Uint32Array(this._stepBuf);
  private readonly _stepF32 = new Float32Array(this._stepBuf);

  private readonly _assembleBuf = new ArrayBuffer(16);
  private readonly _assembleU32 = new Uint32Array(this._assembleBuf);
  private readonly _assembleF32 = new Float32Array(this._assembleBuf);

  private readonly _initPipeline: GPUComputePipeline;
  private readonly _stepPipeline: GPUComputePipeline;
  private readonly _ifftPipeline: GPUComputePipeline;
  private readonly _assemblePipeline: GPUComputePipeline;

  private readonly _initBindGroup: GPUBindGroup;
  private readonly _stepBindGroup: GPUBindGroup;
  private readonly _ifftHorizBindGroup: GPUBindGroup;
  private readonly _ifftVertBindGroup: GPUBindGroup;
  private readonly _assembleBindGroup: GPUBindGroup;

  private _initialized = false;
  private _lastWindDirX = NaN;
  private _lastWindDirZ = NaN;
  private _lastWindSpeed = NaN;
  private _lastWaveScale = NaN;
  private _lastPatchSize = NaN;
  private _lastTime = NaN;
  private _lastUpdateFrame = -1;
  private _disposed = false;

  constructor(device: GPUDevice) {
    this._device = device;

    this.dispTexture = device.createTexture({
      size: [OCEAN_FFT_RESOLUTION, OCEAN_FFT_RESOLUTION],
      format: "rgba16float",
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.dispView = this.dispTexture.createView();

    this.normFoamTexture = device.createTexture({
      size: [OCEAN_FFT_RESOLUTION, OCEAN_FFT_RESOLUTION],
      format: "rgba16float",
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.normFoamView = this.normFoamTexture.createView();

    this._h0Buffer = device.createBuffer({
      size: SPECTRUM_BUFFER_BYTES,
      usage: GPUBufferUsage.STORAGE,
    });
    this._pingABuffer = device.createBuffer({
      size: SPECTRUM_BUFFER_BYTES,
      usage: GPUBufferUsage.STORAGE,
    });
    this._pingBBuffer = device.createBuffer({
      size: SPECTRUM_BUFFER_BYTES,
      usage: GPUBufferUsage.STORAGE,
    });
    this._pongABuffer = device.createBuffer({
      size: SPECTRUM_BUFFER_BYTES,
      usage: GPUBufferUsage.STORAGE,
    });
    this._pongBBuffer = device.createBuffer({
      size: SPECTRUM_BUFFER_BYTES,
      usage: GPUBufferUsage.STORAGE,
    });
    this._foamStateBuffer = device.createBuffer({
      size: FOAM_BUFFER_BYTES,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    this._initUniformBuffer = device.createBuffer({
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this._stepUniformBuffer = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this._ifftHorizUniformBuffer = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this._ifftVertUniformBuffer = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this._assembleUniformBuffer = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const staticHoriz = new Uint32Array([OCEAN_FFT_RESOLUTION, 0, 0, 0]);
    const staticVert = new Uint32Array([OCEAN_FFT_RESOLUTION, 1, 0, 0]);
    device.queue.writeBuffer(this._ifftHorizUniformBuffer, 0, staticHoriz);
    device.queue.writeBuffer(this._ifftVertUniformBuffer, 0, staticVert);

    const initMod = device.createShaderModule({ code: spectrumInitWGSL });
    const stepMod = device.createShaderModule({ code: spectrumStepWGSL });
    const ifftMod = device.createShaderModule({ code: ifftPassWGSL });
    const assembleMod = device.createShaderModule({ code: assembleWGSL });
    logShaderErrors(initMod, "init");
    logShaderErrors(stepMod, "step");
    logShaderErrors(ifftMod, "ifft");
    logShaderErrors(assembleMod, "assemble");

    const initBGL = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
      ],
    });
    const stepBGL = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
      ],
    });
    const ifftBGL = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
        { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
      ],
    });
    const assembleBGL = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
        {
          binding: 4,
          visibility: GPUShaderStage.COMPUTE,
          storageTexture: { access: "write-only", format: "rgba16float", viewDimension: "2d" },
        },
        {
          binding: 5,
          visibility: GPUShaderStage.COMPUTE,
          storageTexture: { access: "write-only", format: "rgba16float", viewDimension: "2d" },
        },
      ],
    });

    this._initPipeline = device.createComputePipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [initBGL] }),
      compute: { module: initMod, entryPoint: "main" },
    });
    this._stepPipeline = device.createComputePipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [stepBGL] }),
      compute: { module: stepMod, entryPoint: "main" },
    });
    this._ifftPipeline = device.createComputePipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [ifftBGL] }),
      compute: { module: ifftMod, entryPoint: "main" },
    });
    this._assemblePipeline = device.createComputePipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [assembleBGL] }),
      compute: { module: assembleMod, entryPoint: "main" },
    });

    this._initBindGroup = device.createBindGroup({
      layout: initBGL,
      entries: [
        { binding: 0, resource: { buffer: this._initUniformBuffer } },
        { binding: 1, resource: { buffer: this._h0Buffer } },
      ],
    });
    this._stepBindGroup = device.createBindGroup({
      layout: stepBGL,
      entries: [
        { binding: 0, resource: { buffer: this._stepUniformBuffer } },
        { binding: 1, resource: { buffer: this._h0Buffer } },
        { binding: 2, resource: { buffer: this._pingABuffer } },
        { binding: 3, resource: { buffer: this._pingBBuffer } },
      ],
    });
    this._ifftHorizBindGroup = device.createBindGroup({
      layout: ifftBGL,
      entries: [
        { binding: 0, resource: { buffer: this._ifftHorizUniformBuffer } },
        { binding: 1, resource: { buffer: this._pingABuffer } },
        { binding: 2, resource: { buffer: this._pingBBuffer } },
        { binding: 3, resource: { buffer: this._pongABuffer } },
        { binding: 4, resource: { buffer: this._pongBBuffer } },
      ],
    });
    this._ifftVertBindGroup = device.createBindGroup({
      layout: ifftBGL,
      entries: [
        { binding: 0, resource: { buffer: this._ifftVertUniformBuffer } },
        { binding: 1, resource: { buffer: this._pongABuffer } },
        { binding: 2, resource: { buffer: this._pongBBuffer } },
        { binding: 3, resource: { buffer: this._pingABuffer } },
        { binding: 4, resource: { buffer: this._pingBBuffer } },
      ],
    });
    this._assembleBindGroup = device.createBindGroup({
      layout: assembleBGL,
      entries: [
        { binding: 0, resource: { buffer: this._assembleUniformBuffer } },
        { binding: 1, resource: { buffer: this._pingABuffer } },
        { binding: 2, resource: { buffer: this._pingBBuffer } },
        { binding: 3, resource: { buffer: this._foamStateBuffer } },
        { binding: 4, resource: this.dispView },
        { binding: 5, resource: this.normFoamView },
      ],
    });
  }

  /** Whether at least one spectrum evaluation has been recorded into `dispView` & `normFoamView`. */
  public get isReady(): boolean {
    return this._initialized && !this._disposed;
  }

  /**
   * Records JONSWAP synthesis + 2D IFFT compute passes for this frame. Zero heap allocations;
   * skips redundant work if invoked more than once for the same `frameIndex` (e.g. reflection passes).
   */
  public update(
    encoder: GPUCommandEncoder,
    frameIndex: number,
    params: OceanFftUpdateParams,
  ): void {
    if (this._disposed || this._lastUpdateFrame === frameIndex) return;
    this._lastUpdateFrame = frameIndex;

    const patchSize = Math.max(params.patchSize, 16.0);
    const windSpeed = Math.max(params.windSpeed, 0.05);
    const waveScale = Math.max(params.waveScale, 0.0);
    const choppiness = Math.max(params.choppiness, 0.0);
    const time = params.time;

    const needsInit =
      !this._initialized ||
      Math.abs(params.windDirX - this._lastWindDirX) > PARAM_EPSILON ||
      Math.abs(params.windDirZ - this._lastWindDirZ) > PARAM_EPSILON ||
      Math.abs(windSpeed - this._lastWindSpeed) > PARAM_EPSILON ||
      Math.abs(waveScale - this._lastWaveScale) > PARAM_EPSILON ||
      Math.abs(patchSize - this._lastPatchSize) > PARAM_EPSILON;

    if (needsInit) {
      this._initU32[0] = OCEAN_FFT_RESOLUTION;
      this._initF32[1] = patchSize;
      this._initF32[2] = windSpeed;
      this._initF32[3] = waveScale;
      this._initF32[4] = params.windDirX;
      this._initF32[5] = params.windDirZ;
      this._initU32[6] = DEFAULT_SEED;
      this._initU32[7] = 0;
      this._device.queue.writeBuffer(this._initUniformBuffer, 0, this._initBuf);

      this._lastWindDirX = params.windDirX;
      this._lastWindDirZ = params.windDirZ;
      this._lastWindSpeed = windSpeed;
      this._lastWaveScale = waveScale;
      this._lastPatchSize = patchSize;
      this._initialized = true;
    }

    const deltaTime = Number.isFinite(this._lastTime)
      ? Math.max(0.0, Math.min(0.1, time - this._lastTime))
      : 0.016;
    this._lastTime = time;

    this._stepU32[0] = OCEAN_FFT_RESOLUTION;
    this._stepF32[1] = patchSize;
    this._stepF32[2] = time * Math.max(windSpeed, 0.25);
    this._stepU32[3] = 0;
    this._device.queue.writeBuffer(this._stepUniformBuffer, 0, this._stepBuf);

    this._assembleU32[0] = OCEAN_FFT_RESOLUTION;
    this._assembleF32[1] = choppiness;
    this._assembleF32[2] = deltaTime;
    this._assembleU32[3] = 0;
    this._device.queue.writeBuffer(this._assembleUniformBuffer, 0, this._assembleBuf);

    const pass = encoder.beginComputePass();

    if (needsInit) {
      pass.setPipeline(this._initPipeline);
      pass.setBindGroup(0, this._initBindGroup);
      pass.dispatchWorkgroups(DISPATCH_GROUPS_2D, DISPATCH_GROUPS_2D, 1);
    }

    pass.setPipeline(this._stepPipeline);
    pass.setBindGroup(0, this._stepBindGroup);
    pass.dispatchWorkgroups(DISPATCH_GROUPS_2D, DISPATCH_GROUPS_2D, 1);

    pass.setPipeline(this._ifftPipeline);
    pass.setBindGroup(0, this._ifftHorizBindGroup);
    pass.dispatchWorkgroups(1, OCEAN_FFT_RESOLUTION, 1);

    pass.setBindGroup(0, this._ifftVertBindGroup);
    pass.dispatchWorkgroups(OCEAN_FFT_RESOLUTION, 1, 1);

    pass.setPipeline(this._assemblePipeline);
    pass.setBindGroup(0, this._assembleBindGroup);
    pass.dispatchWorkgroups(DISPATCH_GROUPS_2D, DISPATCH_GROUPS_2D, 1);

    pass.end();
  }

  /** Releases all GPU textures and buffers owned by the FFT wavefield subsystem. */
  public dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this._initialized = false;
    this.dispTexture.destroy();
    this.normFoamTexture.destroy();
    this._h0Buffer.destroy();
    this._pingABuffer.destroy();
    this._pingBBuffer.destroy();
    this._pongABuffer.destroy();
    this._pongBBuffer.destroy();
    this._foamStateBuffer.destroy();
    this._initUniformBuffer.destroy();
    this._stepUniformBuffer.destroy();
    this._ifftHorizUniformBuffer.destroy();
    this._ifftVertUniformBuffer.destroy();
    this._assembleUniformBuffer.destroy();
  }
}
