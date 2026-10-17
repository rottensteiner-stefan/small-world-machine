import FULLSCREEN_VERT_WGSL from "../shaders/PostProcess.vert.wgsl?raw";
import VOLUMETRIC_FOG_FRAG_WGSL from "../shaders/VolumetricFog.frag.wgsl?raw";
import FROXEL_INJECT_WGSL from "../../shaders/source/web_gpu/compute/froxel_inject.wgsl?raw";
import FROXEL_REPROJECT_WGSL from "../../shaders/source/web_gpu/compute/froxel_reproject.wgsl?raw";
import FROXEL_INTEGRATE_WGSL from "../../shaders/source/web_gpu/compute/froxel_integrate.wgsl?raw";

import { VolumetricFogElement } from "../elements/index.js";
import {
  DirectionalLight,
  PointLight,
  SpotLight,
  MAX_CLUSTERED_LIGHTS_PER_TYPE,
} from "../../../core/lights/index.js";
import { FogVolume } from "../../../core/objects/FogVolume.js";
import { Matrix4, Vector3D } from "../../../math/index.js";
import { TextureFilter, TextureWrap } from "../../../enums/index.js";
import { WebGPURenderer } from "../../WebGPU/WebGPURenderer.js";

/** Uniform-array capacity of FogVolumes per pass (matches `FogVolumeData[16]` in the shaders). */
const MAX_FOG_VOLUMES = 16;

/** Float offset of `scatterTint` (vec4) in FroxelUniforms, right after the 16 FogVolumeData. */
const SCATTER_TINT_OFFSET = 32 + MAX_FOG_VOLUMES * 32;

/** Float offset of the per-light scale arrays, after `scatterTint`. */
const LIGHT_SCALE_OFFSET = SCATTER_TINT_OFFSET + 4;

/** Total floats of FroxelUniforms: base + volumes + 64 point + 64 spot light scales. */
const INJECT_UNIFORM_FLOATS = LIGHT_SCALE_OFFSET + 2 * MAX_CLUSTERED_LIGHTS_PER_TYPE;

/**
 * Interleaved-Gradient-Noise-style hash (after Jorge Jimenez 2014) for the temporal sub-voxel jitter.
 * Called with constant (x, y) per axis it is a per-frame pseudo-random sequence, not a screen pattern.
 */
function ign(x: number, y: number, frame: number): number {
  const magic = 52.9829189 * (((0.06711056 * x + 0.00583715 * y + 0.00583715 * frame) % 1.0) + 1.0);
  return magic - Math.floor(magic);
}

/**
 * WebGPU implementation of true 3D volumetric fog ("Froxel Stage 3", Phase 1).
 *
 * Option R coupling: The froxel volume reuses the clustered light grid (16x16pt tiles, log-staggered
 * depth slices).
 *
 * Phase 1 Multi-Pass Pipeline:
 *  1. Injection (Compute, `froxel_inject.wgsl`): Injects per-froxel in-scattering (sigma_s * L) and
 *     extinction from the clustered light lists and FogVolumes into a transient 3D volume texture `_injectedTexture` (rgba16float).
 *  2. Reprojection & TAA (Compute, `froxel_reproject.wgsl`): Blends current frame with previous
 *     frame's history volume using 3D AABB 7-tap variance clamping and sub-voxel jitter to
 *     eliminate IGN noise and slice stepping.
 *  3. In-Register Integration (Compute, `froxel_integrate.wgsl`): Walks along depth slices in
 *     registers with `@workgroup_size(8, 8, 1)`, evaluates directional CSM self-shadowing and the
 *     Decima Powder Effect, storing accumulated optical depth and radiance into `_integratedTexture`.
 *  4. Single-Tap Composite (Fragment, `VolumetricFog.frag.wgsl`): Reconstructs depth and performs
 *     a single hardware-trilinear 3D texture sample, writing into the HDR buffer before tonemapping.
 */
export class VolumetricFogPassGPU {
  private readonly _device: GPUDevice;

  private _volumeSampler?: GPUSampler;
  private _shadowSampler?: GPUSampler;

  // --- 1. Injection Compute Pipeline ---
  private _injectPipeline?: GPUComputePipeline;
  private _injectBGL!: GPUBindGroupLayout;
  private _injectUniformBuffer!: GPUBuffer;
  /** FroxelUniforms in froxel_inject.wgsl: invView + 4x vec4f + 16x FogVolumeData + 2x per-light scale arrays. */
  private readonly _injectUniformData: Float32Array = new Float32Array(INJECT_UNIFORM_FLOATS);

  // --- 2. Reprojection Compute Pipeline (Temporal Filtering) ---
  private _reprojectPipeline!: GPUComputePipeline;
  private _reprojectBGL!: GPUBindGroupLayout;
  private _reprojectUniformBuffer!: GPUBuffer;
  /** 44 floats: FroxelReprojectSettings (invViewProj + prevViewProj + 3x vec4f). */
  private readonly _reprojectUniformData: Float32Array = new Float32Array(44);

  // --- 3. Integration Compute Pipeline (In-Register Prefix-Sum) ---
  private _integratePipeline!: GPUComputePipeline;
  private _integrateBGL!: GPUBindGroupLayout;
  private _integrateUniformBuffer!: GPUBuffer;
  /** 108 floats: FroxelIntegrationSettings (invViewProj + 7x vec4f + 4x mat4x4f). */
  private readonly _integrateUniformData: Float32Array = new Float32Array(108);

  // --- 4. Composite Render Pipeline (Single-Tap Trilinear Fragment Lookup) ---
  private _compositePipeline!: GPURenderPipeline;
  private _compositeBGL!: GPUBindGroupLayout;
  private _compositeUniformBuffer!: GPUBuffer;
  /** 8 floats: FroxelCompositeSettings (nearFar + params). */
  private readonly _compositeUniformData: Float32Array = new Float32Array(8);

  // --- 3D & 2D Targets ---
  private _width: number = 0;
  private _height: number = 0;
  private _volumeDims: [number, number, number] = [0, 0, 0];

  private _injectedTexture?: GPUTexture;
  private _injectedView?: GPUTextureView;

  private _historyTextureA?: GPUTexture;
  private _historyViewA?: GPUTextureView;

  private _historyTextureB?: GPUTexture;
  private _historyViewB?: GPUTextureView;

  private _historyPingPong: boolean = false;
  private _hasHistory: boolean = false;
  private readonly _prevViewProjMatrix: Float32Array = new Float32Array(16);

  private _integratedTexture?: GPUTexture;
  private _integratedView?: GPUTextureView;

  /** Full-resolution in-scattering target. */
  private _fogTexture?: GPUTexture;
  private _fogTextureView?: GPUTextureView;

  // Cached bind inputs
  private _cachedDepthView: GPUTextureView | undefined = undefined;
  private _cachedShadowView: GPUTextureView | undefined = undefined;
  private _cachedGlobalBindGroup: GPUBindGroup | undefined = undefined;

  private _injectBindGroup: GPUBindGroup | undefined = undefined;
  private _reprojectBindGroupA: GPUBindGroup | undefined = undefined;
  private _reprojectBindGroupB: GPUBindGroup | undefined = undefined;
  private _integrateBindGroupA: GPUBindGroup | undefined = undefined;
  private _integrateBindGroupB: GPUBindGroup | undefined = undefined;
  private _compositeBindGroup: GPUBindGroup | undefined = undefined;

  // Scratch math
  private readonly _scratchView: Matrix4 = new Matrix4();
  private readonly _scratchInvView: Matrix4 = new Matrix4();
  private readonly _scratchInvViewProj: Matrix4 = new Matrix4();
  private readonly _scratchSunDir: Vector3D = new Vector3D();
  private _warnedVolumeLimit: boolean = false;

  constructor(device: GPUDevice) {
    this._device = device;
    this._buildPipelines();
  }

  private _buildPipelines(): void {
    const device = this._device;

    this._volumeSampler ??= device.createSampler({
      minFilter: TextureFilter.LINEAR,
      magFilter: TextureFilter.LINEAR,
      addressModeU: TextureWrap.CLAMP_TO_EDGE,
      addressModeV: TextureWrap.CLAMP_TO_EDGE,
      addressModeW: TextureWrap.CLAMP_TO_EDGE,
    });

    this._shadowSampler ??= device.createSampler({
      compare: "less-equal",
    });

    // Uniform buffers
    this._injectUniformBuffer = device.createBuffer({
      size: INJECT_UNIFORM_FLOATS * 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this._reprojectUniformBuffer = device.createBuffer({
      size: 176, // 44 x f32
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this._integrateUniformBuffer = device.createBuffer({
      size: 432, // 108 x f32
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this._compositeUniformBuffer = device.createBuffer({
      size: 32, // 8 x f32 (2 x vec4f)
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // 1. Injection BGL
    this._injectBGL = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          storageTexture: { access: "write-only", format: "rgba16float", viewDimension: "3d" },
        },
      ],
    });

    // 2. Reprojection BGL & Pipeline
    this._reprojectBGL = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          texture: { sampleType: "float", viewDimension: "3d" },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          texture: { sampleType: "float", viewDimension: "3d" },
        },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, sampler: { type: "filtering" } },
        {
          binding: 3,
          visibility: GPUShaderStage.COMPUTE,
          storageTexture: { access: "write-only", format: "rgba16float", viewDimension: "3d" },
        },
        { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
      ],
    });
    const reprojectLayout = device.createPipelineLayout({ bindGroupLayouts: [this._reprojectBGL] });
    this._reprojectPipeline = device.createComputePipeline({
      layout: reprojectLayout,
      compute: {
        module: device.createShaderModule({ code: FROXEL_REPROJECT_WGSL }),
        entryPoint: "main",
      },
    });

    // 3. Integration BGL & Pipeline
    this._integrateBGL = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          texture: { sampleType: "float", viewDimension: "3d" },
        },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, sampler: { type: "filtering" } },
        {
          binding: 2,
          visibility: GPUShaderStage.COMPUTE,
          texture: { sampleType: "depth", viewDimension: "2d-array" },
        },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, sampler: { type: "comparison" } },
        {
          binding: 4,
          visibility: GPUShaderStage.COMPUTE,
          storageTexture: { access: "write-only", format: "rgba16float", viewDimension: "3d" },
        },
        { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
      ],
    });
    const integrateLayout = device.createPipelineLayout({ bindGroupLayouts: [this._integrateBGL] });
    this._integratePipeline = device.createComputePipeline({
      layout: integrateLayout,
      compute: {
        module: device.createShaderModule({ code: FROXEL_INTEGRATE_WGSL }),
        entryPoint: "main",
      },
    });

    // 4. Composite Render Pipeline (Single-Tap Fragment Lookup)
    this._compositeBGL = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "depth" } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
        {
          binding: 2,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: "float", viewDimension: "3d" },
        },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
      ],
    });
    const compositeLayout = device.createPipelineLayout({ bindGroupLayouts: [this._compositeBGL] });
    const moduleVert = device.createShaderModule({ code: FULLSCREEN_VERT_WGSL });
    const moduleFrag = device.createShaderModule({ code: VOLUMETRIC_FOG_FRAG_WGSL });

    this._compositePipeline = device.createRenderPipeline({
      layout: compositeLayout,
      vertex: { module: moduleVert, entryPoint: "vs_main" },
      fragment: { module: moduleFrag, entryPoint: "fs_main", targets: [{ format: "rgba16float" }] },
      primitive: { topology: "triangle-list" },
    });
  }

  private _ensureInjectionLayout(renderer: WebGPURenderer): void {
    if (this._injectPipeline) return;
    const layout = renderer.globalBGL;
    this._injectPipeline = this._device.createComputePipeline({
      layout: this._device.createPipelineLayout({
        bindGroupLayouts: [layout, this._injectBGL],
      }),
      compute: {
        module: this._device.createShaderModule({
          code: renderer.computeStructsChunk + "\n" + FROXEL_INJECT_WGSL,
        }),
        entryPoint: "injectFog",
      },
    });
  }

  private _resizeTargets(
    renderer: WebGPURenderer,
    width: number,
    height: number,
    depthView: GPUTextureView,
    shadowView: GPUTextureView,
  ): void {
    const dims = renderer.clusterDims;
    const volDims: [number, number, number] = [dims.x, dims.y, dims.z];

    if (
      this._width !== width ||
      this._height !== height ||
      this._volumeDims[0] !== volDims[0] ||
      this._volumeDims[1] !== volDims[1] ||
      this._volumeDims[2] !== volDims[2]
    ) {
      this._width = width;
      this._height = height;

      this._injectedTexture?.destroy();
      this._historyTextureA?.destroy();
      this._historyTextureB?.destroy();
      this._integratedTexture?.destroy();
      this._fogTexture?.destroy();

      const usage3D = GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING;

      this._injectedTexture = this._device.createTexture({
        size: volDims,
        dimension: "3d",
        format: "rgba16float",
        usage: usage3D,
      });
      this._injectedView = this._injectedTexture.createView({ dimension: "3d" });

      this._historyTextureA = this._device.createTexture({
        size: volDims,
        dimension: "3d",
        format: "rgba16float",
        usage: usage3D,
      });
      this._historyViewA = this._historyTextureA.createView({ dimension: "3d" });

      this._historyTextureB = this._device.createTexture({
        size: volDims,
        dimension: "3d",
        format: "rgba16float",
        usage: usage3D,
      });
      this._historyViewB = this._historyTextureB.createView({ dimension: "3d" });

      this._integratedTexture = this._device.createTexture({
        size: volDims,
        dimension: "3d",
        format: "rgba16float",
        usage: usage3D,
      });
      this._integratedView = this._integratedTexture.createView({ dimension: "3d" });

      this._fogTexture = this._device.createTexture({
        size: [width, height, 1],
        format: "rgba16float",
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      });
      this._fogTextureView = this._fogTexture.createView();

      this._volumeDims = volDims;
      this._hasHistory = false;
      this._historyPingPong = false;

      this._injectBindGroup = undefined;
      this._reprojectBindGroupA = undefined;
      this._reprojectBindGroupB = undefined;
      this._integrateBindGroupA = undefined;
      this._integrateBindGroupB = undefined;
      this._compositeBindGroup = undefined;
    }

    if (
      !this._injectBindGroup ||
      this._cachedDepthView !== depthView ||
      this._cachedShadowView !== shadowView ||
      this._cachedGlobalBindGroup !== renderer.globalBindGroup
    ) {
      this._cachedDepthView = depthView;
      this._cachedShadowView = shadowView;
      this._cachedGlobalBindGroup = renderer.globalBindGroup;

      // 1. Injection bind group
      this._injectBindGroup = this._device.createBindGroup({
        layout: this._injectBGL,
        entries: [
          { binding: 0, resource: { buffer: this._injectUniformBuffer } },
          { binding: 1, resource: this._injectedView! },
        ],
      });

      // 2. Reproject bind groups (Ping-Pong A -> B, and B -> A)
      this._reprojectBindGroupA = this._device.createBindGroup({
        layout: this._reprojectBGL,
        entries: [
          { binding: 0, resource: this._injectedView! },
          { binding: 1, resource: this._historyViewA! },
          { binding: 2, resource: this._volumeSampler! },
          { binding: 3, resource: this._historyViewB! },
          { binding: 4, resource: { buffer: this._reprojectUniformBuffer } },
        ],
      });
      this._reprojectBindGroupB = this._device.createBindGroup({
        layout: this._reprojectBGL,
        entries: [
          { binding: 0, resource: this._injectedView! },
          { binding: 1, resource: this._historyViewB! },
          { binding: 2, resource: this._volumeSampler! },
          { binding: 3, resource: this._historyViewA! },
          { binding: 4, resource: { buffer: this._reprojectUniformBuffer } },
        ],
      });

      // 3. Integrate bind groups (reads history filtered volume, writes integrated volume)
      this._integrateBindGroupA = this._device.createBindGroup({
        layout: this._integrateBGL,
        entries: [
          { binding: 0, resource: this._historyViewB! },
          { binding: 1, resource: this._volumeSampler! },
          { binding: 2, resource: shadowView },
          { binding: 3, resource: this._shadowSampler! },
          { binding: 4, resource: this._integratedView! },
          { binding: 5, resource: { buffer: this._integrateUniformBuffer } },
        ],
      });
      this._integrateBindGroupB = this._device.createBindGroup({
        layout: this._integrateBGL,
        entries: [
          { binding: 0, resource: this._historyViewA! },
          { binding: 1, resource: this._volumeSampler! },
          { binding: 2, resource: shadowView },
          { binding: 3, resource: this._shadowSampler! },
          { binding: 4, resource: this._integratedView! },
          { binding: 5, resource: { buffer: this._integrateUniformBuffer } },
        ],
      });

      // 4. Composite bind group (Single-tap trilinear 3D sample into integrated volume)
      this._compositeBindGroup = this._device.createBindGroup({
        layout: this._compositeBGL,
        entries: [
          { binding: 0, resource: depthView },
          { binding: 1, resource: this._volumeSampler! },
          { binding: 2, resource: this._integratedView! },
          { binding: 3, resource: { buffer: this._compositeUniformBuffer } },
        ],
      });
    }
  }

  public execute(
    renderer: WebGPURenderer,
    ce: GPUCommandEncoder,
    depthView: GPUTextureView,
    width: number,
    height: number,
    viewProjMatrix: Float32Array,
    vMat: Float32Array | undefined,
    camPos: Vector3D,
    near: number,
    far: number,
    dirLight: DirectionalLight | undefined,
    element: VolumetricFogElement,
    fogVolumes: FogVolume[] = [],
    pointLights: readonly PointLight[] = [],
    spotLights: readonly SpotLight[] = [],
  ): GPUTextureView | null {
    if (!element.enabled || width <= 0 || height <= 0) {
      return null;
    }

    const shadowView = renderer.defaultDirShadowTextureView;
    if (!shadowView) return null;

    this._ensureInjectionLayout(renderer);
    this._resizeTargets(renderer, width, height, depthView, shadowView);

    const dims = renderer.clusterDims;
    const frameIndex = renderer.frameInfo.frameIndex;

    // Sub-voxel temporal jitter
    const jx = (ign(0, 1, frameIndex) - 0.5) * element.jitter;
    const jy = (ign(2, 3, frameIndex) - 0.5) * element.jitter;
    const jz = (ign(4, 5, frameIndex) - 0.5) * element.jitter;

    // --- 1. Injection uniform data (FroxelUniforms) ---
    const view = this._scratchView;
    if (vMat) view.data.set(vMat);
    else view.identity();
    Matrix4.invert(view, this._scratchInvView);

    const inj = this._injectUniformData;
    inj.set(this._scratchInvView.data, 0); // 0-15: invView
    inj[16] = element.density;
    inj[17] = element.height;
    inj[18] = element.heightFalloff;
    inj[19] = Math.min(element.maxDistance, far);

    if (fogVolumes.length > MAX_FOG_VOLUMES && !this._warnedVolumeLimit) {
      this._warnedVolumeLimit = true;
      console.warn(
        `[VolumetricFog] ${fogVolumes.length} FogVolumes in the scene, only the first ${MAX_FOG_VOLUMES} are evaluated.`,
      );
    }
    const numVols = Math.min(fogVolumes.length, MAX_FOG_VOLUMES);
    inj[20] = element.asymmetry;
    inj[21] = element.ambientInject; // (`intensity` is applied once, in the composite pass)
    inj[22] = renderer.frameInfo.time; // gameplay time in seconds for rolling mist
    inj[23] = numVols;

    inj[24] = near;
    inj[25] = far;
    inj[26] = dims.z;
    inj[27] = 0.0;

    inj[28] = jx;
    inj[29] = jy;
    inj[30] = jz;
    inj[31] = 0.0;

    let offset = 32;
    for (let v = 0; v < 16; v++) {
      if (v < numVols) {
        const vol = fogVolumes[v]!;
        const invMat = vol.getInverseWorldMatrix();
        inj.set(invMat.data, offset);
        inj[offset + 16] = vol.shape;
        inj[offset + 17] = vol.density;
        inj[offset + 18] = vol.edgeFade;
        inj[offset + 19] = vol.emissionIntensity;
        inj[offset + 20] = vol.albedo.r;
        inj[offset + 21] = vol.albedo.g;
        inj[offset + 22] = vol.albedo.b;
        inj[offset + 23] = vol.noiseScale;
        inj[offset + 24] = vol.emission.r;
        inj[offset + 25] = vol.emission.g;
        inj[offset + 26] = vol.emission.b;
        inj[offset + 27] = vol.noiseAmount;
        inj[offset + 28] = vol.size.x;
        inj[offset + 29] = vol.size.y;
        inj[offset + 30] = vol.size.z;
        inj[offset + 31] = vol.noiseSpeed;
      } else {
        inj.fill(0, offset, offset + 32);
      }
      offset += 32;
    }

    const albedo = Math.min(Math.max(element.scatteringAlbedo, 0.0), 1.0);
    inj[SCATTER_TINT_OFFSET] = element.color.r * albedo;
    inj[SCATTER_TINT_OFFSET + 1] = element.color.g * albedo;
    inj[SCATTER_TINT_OFFSET + 2] = element.color.b * albedo;
    inj[SCATTER_TINT_OFFSET + 3] = element.localLightShadows ? 1.0 : 0.0;

    // Per-light volumetric intensity, indexed like the renderer's light buffers.
    for (let i = 0; i < MAX_CLUSTERED_LIGHTS_PER_TYPE; i++) {
      inj[LIGHT_SCALE_OFFSET + i] = pointLights[i]?.volumetricIntensity ?? 0.0;
      inj[LIGHT_SCALE_OFFSET + MAX_CLUSTERED_LIGHTS_PER_TYPE + i] =
        spotLights[i]?.volumetricIntensity ?? 0.0;
    }

    this._device.queue.writeBuffer(this._injectUniformBuffer, 0, inj);

    // Pass 1: Injection Compute
    const cpInject = ce.beginComputePass({ label: "VolumetricFogInject" });
    cpInject.setPipeline(this._injectPipeline!);
    cpInject.setBindGroup(0, renderer.globalBindGroup);
    cpInject.setBindGroup(1, this._injectBindGroup!);
    cpInject.dispatchWorkgroups(Math.ceil(dims.x / 4), Math.ceil(dims.y / 4), dims.z);
    cpInject.end();

    // --- 2. Reprojection & Temporal Filter (Compute) ---
    this._scratchInvViewProj.data.set(viewProjMatrix);
    Matrix4.invert(this._scratchInvViewProj, this._scratchInvViewProj);

    const rep = this._reprojectUniformData;
    rep.set(this._scratchInvViewProj.data, 0); // 0-15: invViewProj
    if (this._hasHistory) {
      rep.set(this._prevViewProjMatrix, 16); // 16-31: prevViewProj
    } else {
      rep.set(viewProjMatrix, 16);
    }
    rep[32] = camPos.x;
    rep[33] = camPos.y;
    rep[34] = camPos.z;
    rep[35] = 0.0;

    rep[36] = near;
    rep[37] = far;
    rep[38] = dims.z;
    rep[39] = 0.0;

    // History weight of the temporal EMA: 0.9 while jittering (the filter resolves the jitter), 0 without
    // jitter or on the first frame (nothing to resolve, and history would only smear moving lights).
    rep[40] = this._hasHistory && element.jitter > 0.0 ? 0.9 : 0.0;
    rep[41] = jx;
    rep[42] = jy;
    rep[43] = jz;

    this._device.queue.writeBuffer(this._reprojectUniformBuffer, 0, rep);

    const reprojectBindGroup = this._historyPingPong
      ? this._reprojectBindGroupB!
      : this._reprojectBindGroupA!;
    const cpReproject = ce.beginComputePass({ label: "VolumetricFogReproject" });
    cpReproject.setPipeline(this._reprojectPipeline);
    cpReproject.setBindGroup(0, reprojectBindGroup);
    cpReproject.dispatchWorkgroups(Math.ceil(dims.x / 8), Math.ceil(dims.y / 8), dims.z);
    cpReproject.end();

    // --- 3. Integration Compute (In-Register Prefix-Sum) ---
    const intg = this._integrateUniformData;
    intg.set(this._scratchInvViewProj.data, 0); // 0-15: invViewProj
    intg[16] = camPos.x;
    intg[17] = camPos.y;
    intg[18] = camPos.z;
    intg[19] = 0.0;

    intg[20] = near;
    intg[21] = far;
    intg[22] = dims.z;
    intg[23] = 0.0;

    intg[24] = element.density;
    intg[25] = Math.min(element.maxDistance, far);
    intg[26] = element.asymmetry;
    intg[27] = element.intensity;

    const sunActive = dirLight !== undefined && dirLight.intensity > 0.0;
    if (sunActive) {
      this._scratchSunDir.set(
        -dirLight!.direction.x,
        -dirLight!.direction.y,
        -dirLight!.direction.z,
      );
      this._scratchSunDir.normalize();
    } else {
      this._scratchSunDir.set(0.0, 0.0, -1.0);
    }
    intg[28] = this._scratchSunDir.x;
    intg[29] = this._scratchSunDir.y;
    intg[30] = this._scratchSunDir.z;
    intg[31] = 0.0;

    const sunScale = sunActive
      ? dirLight!.intensity *
        dirLight!.volumetricIntensity *
        Math.min(Math.max(element.scatteringAlbedo, 0.0), 1.0)
      : 0.0;
    intg[32] = element.color.r * sunScale;
    intg[33] = element.color.g * sunScale;
    intg[34] = element.color.b * sunScale;
    intg[35] = sunActive ? 1.0 : 0.0;

    const numCascades = Math.min(dirLight?.numCascades ?? 0, 4);
    intg[36] = dirLight?.cascadeSplits[0] ?? 10.0;
    intg[37] = dirLight?.cascadeSplits[1] ?? 25.0;
    intg[38] = dirLight?.cascadeSplits[2] ?? 50.0;
    intg[39] = dirLight?.cascadeSplits[3] ?? 100.0;

    intg[40] = dirLight?.shadowBias ?? 0.001;
    intg[41] = 0.0;
    intg[42] = dirLight?.castShadow && element.castDirectionalShadow ? 1.0 : 0.0;
    intg[43] = numCascades;

    for (let i = 0; i < numCascades; i++) {
      const cam = dirLight!.cascadeCameras[i];
      if (cam) {
        intg.set(cam.viewProjectionMatrix, 44 + i * 16);
      }
    }

    this._device.queue.writeBuffer(this._integrateUniformBuffer, 0, intg);

    const integrateBindGroup = this._historyPingPong
      ? this._integrateBindGroupB!
      : this._integrateBindGroupA!;
    const cpIntegrate = ce.beginComputePass({ label: "VolumetricFogIntegrate" });
    cpIntegrate.setPipeline(this._integratePipeline);
    cpIntegrate.setBindGroup(0, integrateBindGroup);
    cpIntegrate.dispatchWorkgroups(Math.ceil(dims.x / 8), Math.ceil(dims.y / 8), 1);
    cpIntegrate.end();

    // --- 4. Single-Tap Composite Lookup (Fragment) ---
    const cmp = this._compositeUniformData;
    cmp[0] = near;
    cmp[1] = far;
    cmp[2] = width;
    cmp[3] = height;

    cmp[4] = element.density;
    cmp[5] = Math.min(element.maxDistance, far);
    cmp[6] = dims.z;
    cmp[7] = element.intensity;

    this._device.queue.writeBuffer(this._compositeUniformBuffer, 0, cmp);

    const rp = ce.beginRenderPass({
      colorAttachments: [
        {
          view: this._fogTextureView!,
          loadOp: "clear",
          storeOp: "store",
          clearValue: { r: 0, g: 0, b: 0, a: 1 }, // a = transmittance: clear == no fog
        },
      ],
    });
    rp.setPipeline(this._compositePipeline);
    rp.setBindGroup(0, this._compositeBindGroup!);
    rp.draw(3, 1, 0, 0);
    rp.end();

    // Cycle history buffers
    this._prevViewProjMatrix.set(viewProjMatrix);
    this._historyPingPong = !this._historyPingPong;
    this._hasHistory = true;

    return this._fogTextureView!;
  }

  public destroy(): void {
    this._injectedTexture?.destroy();
    this._historyTextureA?.destroy();
    this._historyTextureB?.destroy();
    this._integratedTexture?.destroy();
    this._fogTexture?.destroy();

    this._injectUniformBuffer?.destroy();
    this._reprojectUniformBuffer?.destroy();
    this._integrateUniformBuffer?.destroy();
    this._compositeUniformBuffer?.destroy();

    this._injectBindGroup = undefined;
    this._reprojectBindGroupA = undefined;
    this._reprojectBindGroupB = undefined;
    this._integrateBindGroupA = undefined;
    this._integrateBindGroupB = undefined;
    this._compositeBindGroup = undefined;

    this._cachedDepthView = undefined;
    this._cachedShadowView = undefined;
    this._cachedGlobalBindGroup = undefined;
    this._hasHistory = false;
  }
}
