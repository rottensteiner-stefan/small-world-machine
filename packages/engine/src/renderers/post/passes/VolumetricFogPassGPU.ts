import FULLSCREEN_VERT_WGSL from "../shaders/PostProcess.vert.wgsl?raw";
import VOLUMETRIC_FOG_FRAG_WGSL from "../shaders/VolumetricFog.frag.wgsl?raw";
import FROXEL_INJECT_WGSL from "../../shaders/source/web_gpu/compute/froxel_inject.wgsl?raw";

import { VolumetricFogElement } from "../elements/index.js";
import { DirectionalLight } from "../../../core/lights/index.js";
import { Matrix4, Vector3D } from "../../../math/index.js";
import { TextureFilter, TextureWrap } from "../../../enums/index.js";
import { WebGPURenderer } from "../../WebGPU/WebGPURenderer.js";

/**
 * WebGPU implementation of true 3D volumetric fog ("Froxel Stage 3"), see ADR 0031.
 *
 * Option R coupling: the froxel volume IS the clustered light grid (16x16pt tiles, log-staggered
 * depth slices). This pass therefore only:
 *  1. Injects per-froxel in-scattering from the clustered light lists into a 3D volume texture
 *     (compute, `froxel_inject.wgsl`) -- reusing the engine's global bind group 0 so the volume
 *     can never disagree with the light culling.
 *  2. Ray-marches the volume per pixel (fragment, `VolumetricFog.frag.wgsl`), with directional
 *     contribution and CSM self-shadowing evaluated per step (V1), writing additively-composit-
 *     able in-scattering into an rgba16float target.
 *
 * The result is composed additively BEFORE tonemapping by PostProcessPass (LightShafts pattern).
 * Compositing is deliberately additive: the analytic distance/height fog of `Scene.fog` (Roadmap
 * Stufe 1) stays parallel, per the approved plan.
 */
export class VolumetricFogPassGPU {
  private readonly _device: GPUDevice;

  private _volumeSampler?: GPUSampler;
  private _shadowSampler?: GPUSampler;

  // Injection compute pipeline -- the pipeline depends on the engine's global bind-group layout,
  // which exists only after the renderer is configured, so it is built lazily on first execute.
  private _injectPipeline?: GPUComputePipeline;
  private _injectBGL!: GPUBindGroupLayout;
  private _injectUniformBuffer!: GPUBuffer;
  /** 28 floats: FroxelUniforms in froxel_inject.wgsl (invView + 3x vec4f). */
  private readonly _injectUniformData: Float32Array = new Float32Array(28);

  // Raymarch integration pipeline
  private _pipeline!: GPURenderPipeline;
  private _bgl!: GPUBindGroupLayout;
  private _uniformBuffer!: GPUBuffer;
  /** 108 floats: FroxelSettings in VolumetricFog.frag.wgsl (invViewProj + 7x vec4f + 4x mat4x4f). */
  private readonly _uniformData: Float32Array = new Float32Array(108);

  // Targets
  private _width: number = 0;
  private _height: number = 0;
  /** Froxel volume texture, one cell per clustered-light-grid cell (Option R). */
  private _volumeTexture?: GPUTexture;
  private _volumeView?: GPUTextureView;
  private _volumeDims: [number, number, number] = [0, 0, 0];
  /** Full-resolution in-scattering target. */
  private _fogTexture?: GPUTexture;
  private _fogTextureView?: GPUTextureView;

  // Cached bind inputs to rebuild bind groups only when the attachments change
  private _cachedDepthView: GPUTextureView | undefined = undefined;
  private _cachedShadowView: GPUTextureView | undefined = undefined;
  private _cachedGlobalBindGroup: GPUBindGroup | undefined = undefined;
  private _injectBindGroup: GPUBindGroup | undefined = undefined;
  private _bindGroup: GPUBindGroup | undefined = undefined;

  // Scratch math
  private readonly _scratchView: Matrix4 = new Matrix4();
  private readonly _scratchInvView: Matrix4 = new Matrix4();
  private readonly _scratchInvViewProj: Matrix4 = new Matrix4();
  private readonly _scratchSunDir: Vector3D = new Vector3D();

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

    this._injectUniformBuffer = device.createBuffer({
      size: 112, // FroxelUniforms: 28 x f32
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this._uniformBuffer = device.createBuffer({
      size: 432, // FroxelSettings: 108 x f32
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // --- 1. Injection compute pipeline -----------------------------------------------------
    // Group 0 = the engine's global bind group (light lists + cluster grid, COMPUTE-visible for
    // exactly the bindings this shader reads). Group 4 = this pass's volume bindings: the
    // injection shader is assembled with structs.wgsl prepended (which already claims group
    // 1..3 for material/object/view), so the own bind group deliberately lives at the sparse
    // pipeline-layout index 4.
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

    // --- 2. Raymarch integration pipeline --------------------------------------------------
    this._bgl = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "depth" } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
        {
          binding: 2,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: "float", viewDimension: "3d" },
        },
        {
          binding: 3,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: "depth", viewDimension: "2d-array" },
        },
        { binding: 4, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "comparison" } },
        { binding: 5, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
      ],
    });

    const layout = device.createPipelineLayout({ bindGroupLayouts: [this._bgl] });
    const moduleVert = device.createShaderModule({ code: FULLSCREEN_VERT_WGSL });
    const moduleFrag = device.createShaderModule({ code: VOLUMETRIC_FOG_FRAG_WGSL });

    this._pipeline = device.createRenderPipeline({
      layout: layout,
      vertex: { module: moduleVert, entryPoint: "vs_main" },
      fragment: { module: moduleFrag, entryPoint: "fs_main", targets: [{ format: "rgba16float" }] },
      primitive: { topology: "triangle-list" },
    });
  }

  /**
   * Lazily builds the injection compute pipeline against the engine's global bind-group layout
   * (`structs.wgsl` bindings live in group 0, this pass owns group 1). Fail-fast: throws if the
   * renderer has no global layout yet, mirroring the engine's "throw when the subsystem
   * processes the object" lifecycle rule.
   */
  private _ensureInjectionLayout(renderer: WebGPURenderer): void {
    if (this._injectPipeline) return;
    const layout = renderer.globalBGL;
    // The inject shader reads the engine's shared light-list/cluster-grid bindings from
    // structs.wgsl (group 0), exactly like `clusterCullPipeline` is assembled -- so it must see
    // the same structs chunk prepended.
    this._injectPipeline = this._device.createComputePipeline({
      layout: this._device.createPipelineLayout({
        bindGroupLayouts: [layout, null, null, null, this._injectBGL],
      }),
      compute: {
        module: this._device.createShaderModule({
          code: renderer.computeStructsChunk + "\n" + FROXEL_INJECT_WGSL,
        }),
        entryPoint: "injectFog",
      },
    });
    this._injectBindGroup = undefined;
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

      this._volumeTexture?.destroy();
      this._fogTexture?.destroy();

      this._volumeTexture = this._device.createTexture({
        size: volDims,
        format: "rgba16float",
        usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
      });
      this._volumeView = this._volumeTexture.createView();
      this._volumeDims = volDims;

      this._fogTexture = this._device.createTexture({
        size: [width, height, 1],
        format: "rgba16float",
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      });
      this._fogTextureView = this._fogTexture.createView();

      this._injectBindGroup = undefined;
      this._bindGroup = undefined;
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

      this._injectBindGroup = this._device.createBindGroup({
        layout: this._injectBGL,
        entries: [
          { binding: 0, resource: { buffer: this._injectUniformBuffer } },
          { binding: 1, resource: this._volumeView! },
        ],
      });

      this._bindGroup = this._device.createBindGroup({
        layout: this._bgl,
        entries: [
          { binding: 0, resource: depthView },
          { binding: 1, resource: this._volumeSampler! },
          { binding: 2, resource: this._volumeView! },
          { binding: 3, resource: shadowView },
          { binding: 4, resource: this._shadowSampler! },
          { binding: 5, resource: { buffer: this._uniformBuffer } },
        ],
      });
    }
  }

  /**
   * Executes the volumetric fog pass on WebGPU: injects the froxel volume from the clustered
   * light lists, then ray-marches per pixel with directional/CSM self-shadowing. Returns the
   * full-screen in-scattering target view (for additive PostProcess compositing) or null when
   * the effect is disabled / inputs are missing.
   */
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
  ): GPUTextureView | null {
    if (!element.enabled || width <= 0 || height <= 0) {
      return null;
    }

    const shadowView = renderer.defaultDirShadowTextureView;
    if (!shadowView) return null;

    this._resizeTargets(renderer, width, height, depthView, shadowView);
    this._ensureInjectionLayout(renderer);

    const dims = renderer.clusterDims;

    // --- Injection uniform data (FroxelUniforms) ---
    const view = this._scratchView;
    if (vMat) view.data.set(vMat);
    else view.identity();
    Matrix4.invert(view, this._scratchInvView);

    const inj = this._injectUniformData;
    inj.set(this._scratchInvView.data, 0); // 0-15: invView

    inj[16] = element.density; // params.x: density
    inj[17] = element.height; // params.y: height
    inj[18] = element.heightFalloff; // params.z: heightFalloff
    inj[19] = Math.min(element.maxDistance, far); // params.w: maxWorldDistance (clamped to far)

    inj[20] = element.asymmetry; // phase.x: asymmetry g
    inj[21] = element.intensity; // phase.y: intensity
    inj[22] = element.jitter; // phase.z: jitter
    inj[23] = 0.0; // pad

    inj[24] = near; // nearFar.x
    inj[25] = far; // nearFar.y
    inj[26] = dims.z; // nearFar.z: slice count
    inj[27] = 0.0; // pad

    this._device.queue.writeBuffer(this._injectUniformBuffer, 0, inj);

    // --- Injection pass (compute) ---
    const cp = ce.beginComputePass({ label: "VolumetricFogInject" });
    cp.setPipeline(this._injectPipeline!);
    cp.setBindGroup(0, renderer.globalBindGroup);
    cp.setBindGroup(4, this._injectBindGroup!);
    cp.dispatchWorkgroups(Math.ceil(dims.x / 4), Math.ceil(dims.y / 4), dims.z);
    cp.end();

    // --- Raymarch integration uniform data (FroxelSettings) ---
    this._scratchInvViewProj.data.set(viewProjMatrix);
    Matrix4.invert(this._scratchInvViewProj, this._scratchInvViewProj);

    const d = this._uniformData;
    d.set(this._scratchInvViewProj.data, 0); // 0-15: invViewProj

    d[16] = camPos.x;
    d[17] = camPos.y;
    d[18] = camPos.z;
    d[19] = 0.0; // camPos.w

    d[20] = near; // nearFar.x
    d[21] = far; // nearFar.y
    d[22] = width; // nearFar.z: screenW
    d[23] = height; // nearFar.w: screenH

    d[24] = element.density; // params.x: density
    d[25] = Math.min(element.maxDistance, far); // params.y: maxWorldDistance
    d[26] = element.asymmetry; // params.z: asymmetry g
    d[27] = element.intensity; // params.w: intensity (used as march jitter seed)

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
    d[28] = this._scratchSunDir.x;
    d[29] = this._scratchSunDir.y;
    d[30] = this._scratchSunDir.z;
    d[31] = 0.0; // sunDir.w

    d[32] = element.color.r * (sunActive ? dirLight!.intensity : 0.0);
    d[33] = element.color.g * (sunActive ? dirLight!.intensity : 0.0);
    d[34] = element.color.b * (sunActive ? dirLight!.intensity : 0.0);
    d[35] = sunActive ? 1.0 : 0.0; // sunColorIntensity.w: active flag

    const numCascades = Math.min(dirLight?.numCascades ?? 0, 4);
    d[36] = dirLight?.cascadeSplits[0] ?? 10.0;
    d[37] = dirLight?.cascadeSplits[1] ?? 25.0;
    d[38] = dirLight?.cascadeSplits[2] ?? 50.0;
    d[39] = dirLight?.cascadeSplits[3] ?? 100.0;

    d[40] = dirLight?.shadowBias ?? 0.001;
    d[41] = 0.0; // normalBias
    d[42] = dirLight?.castShadow && element.castDirectionalShadow ? 1.0 : 0.0;
    d[43] = numCascades;

    for (let i = 0; i < numCascades; i++) {
      const cam = dirLight!.cascadeCameras[i];
      if (cam) {
        d.set(cam.viewProjectionMatrix, 44 + i * 16);
      }
    }

    this._device.queue.writeBuffer(this._uniformBuffer, 0, d);

    // --- Raymarch integration pass (fragment) ---
    const rp = ce.beginRenderPass({
      colorAttachments: [
        {
          view: this._fogTextureView!,
          loadOp: "clear",
          storeOp: "store",
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
        },
      ],
    });
    rp.setPipeline(this._pipeline);
    rp.setBindGroup(0, this._bindGroup!);
    rp.draw(3, 1, 0, 0);
    rp.end();

    return this._fogTextureView!;
  }

  public destroy(): void {
    this._volumeTexture?.destroy();
    this._fogTexture?.destroy();
    this._injectUniformBuffer?.destroy();
    this._uniformBuffer?.destroy();
    this._injectBindGroup = undefined;
    this._bindGroup = undefined;
    this._cachedDepthView = undefined;
    this._cachedShadowView = undefined;
    this._cachedGlobalBindGroup = undefined;
  }
}
