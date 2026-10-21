import FULLSCREEN_VERT_WGSL from "../shaders/PostProcess.vert.wgsl?raw";
import SHAFTS_FRAG_WGSL from "../shaders/LightShafts.frag.wgsl?raw";
import BILATERAL_FRAG_WGSL from "../shaders/LightShaftsBilateral.frag.wgsl?raw";

import type { LightShaftsElement } from "../elements/index.js";
import { Matrix4, Vector3D } from "../../../math/index.js";
import { TextureFilter, TextureWrap } from "../../../enums/index.js";
import { PostEffectPipelineGate } from "../PostEffectPipelineGate.js";
import type { PostEffectPass, PostEffectPassContext } from "../PostEffectPass.js";

/**
 * WebGPU implementation of atmospheric volumetric light shafts (God Rays):
 * - Half-resolution raymarching against Cascaded Shadow Maps (CSM).
 * - Joint 2x2 depth-aware cross-bilateral upsample to full screen resolution.
 */
export class LightShaftsPassGPU implements PostEffectPass {
  private readonly _device: GPUDevice;
  private readonly _gate: PostEffectPipelineGate;

  private _sampler?: GPUSampler;
  private _shadowSampler?: GPUSampler;

  // Pipeline 1: Raymarching
  private _pipelineRaymarch!: GPURenderPipeline;
  private _bglRaymarch!: GPUBindGroupLayout;
  private _uniformBufferRaymarch!: GPUBuffer;
  private readonly _uniformDataRaymarch: Float32Array = new Float32Array(104); // 416 bytes

  // Pipeline 2: Bilateral upsampling
  private _pipelineBilateral!: GPURenderPipeline;
  private _bglBilateral!: GPUBindGroupLayout;
  private _uniformBufferBilateral!: GPUBuffer;
  private readonly _uniformDataBilateral: Float32Array = new Float32Array(8); // 32 bytes (vec4 + vec4)

  // Targets
  private _width: number = 0;
  private _height: number = 0;
  private _halfTexture?: GPUTexture;
  private _halfTextureView?: GPUTextureView;
  private _fullTexture?: GPUTexture;
  private _fullTextureView?: GPUTextureView;

  private _cachedDepthView: GPUTextureView | undefined = undefined;
  private _cachedShadowView: GPUTextureView | undefined = undefined;
  private _bindGroupRaymarch: GPUBindGroup | undefined = undefined;
  private _bindGroupBilateral: GPUBindGroup | undefined = undefined;

  // Scratch math
  private readonly _scratchInvViewProj: Matrix4 = new Matrix4();
  private readonly _scratchSunDir: Vector3D = new Vector3D();
  private readonly _scratchCascadeVp: Matrix4 = new Matrix4();
  private readonly _scratchCascadeVpZO: Matrix4 = new Matrix4();

  constructor(device: GPUDevice) {
    this._device = device;
    this._gate = new PostEffectPipelineGate(device, "LightShafts");
    this._gate.begin();
    this._buildPipelines();
    this._gate.end();
  }

  private _buildPipelines(): void {
    const device = this._device;

    this._sampler ??= device.createSampler({
      minFilter: TextureFilter.LINEAR,
      magFilter: TextureFilter.LINEAR,
      addressModeU: TextureWrap.CLAMP_TO_EDGE,
      addressModeV: TextureWrap.CLAMP_TO_EDGE,
    });

    this._shadowSampler ??= device.createSampler({
      compare: "less-equal",
    });

    this._uniformBufferRaymarch = device.createBuffer({
      size: 416,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this._uniformBufferBilateral = device.createBuffer({
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // 1. Raymarch Pipeline
    this._bglRaymarch = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "depth" } },
        {
          binding: 1,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: "depth", viewDimension: "2d-array" },
        },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "comparison" } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
      ],
    });

    const layoutRaymarch = device.createPipelineLayout({ bindGroupLayouts: [this._bglRaymarch] });
    const moduleVert = device.createShaderModule({ code: FULLSCREEN_VERT_WGSL });
    const moduleRaymarch = device.createShaderModule({ code: SHAFTS_FRAG_WGSL });

    this._pipelineRaymarch = device.createRenderPipeline({
      layout: layoutRaymarch,
      vertex: { module: moduleVert, entryPoint: "vs_main" },
      fragment: {
        module: moduleRaymarch,
        entryPoint: "fs_main",
        targets: [{ format: "rgba16float" }],
      },
      primitive: { topology: "triangle-list" },
    });

    // 2. Bilateral Upsample Pipeline
    this._bglBilateral = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "depth" } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
      ],
    });

    const layoutBilateral = device.createPipelineLayout({ bindGroupLayouts: [this._bglBilateral] });
    const moduleBilateral = device.createShaderModule({ code: BILATERAL_FRAG_WGSL });

    this._pipelineBilateral = device.createRenderPipeline({
      layout: layoutBilateral,
      vertex: { module: moduleVert, entryPoint: "vs_main" },
      fragment: {
        module: moduleBilateral,
        entryPoint: "fs_main",
        targets: [{ format: "rgba16float" }],
      },
      primitive: { topology: "triangle-list" },
    });
  }

  private _resizeTargets(width: number, height: number): void {
    if (this._width === width && this._height === height && this._fullTexture) {
      return;
    }
    this._width = width;
    this._height = height;

    this._halfTexture?.destroy();
    this._fullTexture?.destroy();

    const halfW = Math.max(Math.floor(width / 2), 1);
    const halfH = Math.max(Math.floor(height / 2), 1);

    this._halfTexture = this._device.createTexture({
      size: [halfW, halfH, 1],
      format: "rgba16float",
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    this._halfTextureView = this._halfTexture.createView();

    this._fullTexture = this._device.createTexture({
      size: [width, height, 1],
      format: "rgba16float",
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    this._fullTextureView = this._fullTexture.createView();

    this._bindGroupRaymarch = undefined;
    this._bindGroupBilateral = undefined;
  }

  /**
   * Executes the volumetric light shafts passes on WebGPU.
   */
  public execute(ctx: PostEffectPassContext): GPUTextureView | null {
    if (!this._gate.ready) return null;
    const { renderer, ce, depthView, width, height, vp, camPos, lights } = ctx;
    const viewProjMatrix = vp;
    const dirLight = lights.dLight;
    const element = ctx.element as LightShaftsElement;
    if (!element.enabled || width <= 0 || height <= 0 || !dirLight) {
      return null;
    }

    const shadowView = renderer.defaultDirShadowTextureView;
    if (!shadowView) return null;

    this._resizeTargets(width, height);

    const halfW = Math.max(Math.floor(width / 2), 1);
    const halfH = Math.max(Math.floor(height / 2), 1);

    // Rebuild bind groups if attachments changed
    if (
      !this._bindGroupRaymarch ||
      this._cachedDepthView !== depthView ||
      this._cachedShadowView !== shadowView
    ) {
      this._cachedDepthView = depthView;
      this._cachedShadowView = shadowView;

      this._bindGroupRaymarch = this._device.createBindGroup({
        layout: this._bglRaymarch,
        entries: [
          { binding: 0, resource: depthView },
          { binding: 1, resource: shadowView },
          { binding: 2, resource: this._shadowSampler! },
          { binding: 3, resource: { buffer: this._uniformBufferRaymarch } },
        ],
      });

      this._bindGroupBilateral = this._device.createBindGroup({
        layout: this._bglBilateral,
        entries: [
          { binding: 0, resource: this._sampler! },
          { binding: 1, resource: this._halfTextureView! },
          { binding: 2, resource: depthView },
          { binding: 3, resource: { buffer: this._uniformBufferBilateral } },
        ],
      });
    }

    // Populate raymarch uniform data
    this._scratchInvViewProj.data.set(viewProjMatrix);
    Matrix4.invert(this._scratchInvViewProj, this._scratchInvViewProj);

    const d = this._uniformDataRaymarch;
    d.set(this._scratchInvViewProj.data, 0); // 0-15: invViewProj

    d[16] = camPos.x;
    d[17] = camPos.y;
    d[18] = camPos.z;
    d[19] = element.maxDistance; // camPos.w

    this._scratchSunDir.set(-dirLight.direction.x, -dirLight.direction.y, -dirLight.direction.z);
    this._scratchSunDir.normalize();
    d[20] = this._scratchSunDir.x;
    d[21] = this._scratchSunDir.y;
    d[22] = this._scratchSunDir.z;
    d[23] = element.asymmetry; // sunDir.w

    d[24] = element.color.r * dirLight.intensity;
    d[25] = element.color.g * dirLight.intensity;
    d[26] = element.color.b * dirLight.intensity;
    d[27] = 1.0; // sunColor.w (intensity is cleanly applied in PostProcess composite)

    d[28] = element.density;
    d[29] = element.samples;
    d[30] = 0.0; // pad
    d[31] = 0.0; // pad

    const numCascades = Math.min(dirLight.numCascades, 4);
    d[32] = dirLight.cascadeSplits[0] ?? 10.0;
    d[33] = dirLight.cascadeSplits[1] ?? 25.0;
    d[34] = dirLight.cascadeSplits[2] ?? 50.0;
    d[35] = dirLight.cascadeSplits[3] ?? 100.0;

    d[36] = dirLight.shadowBias;
    d[37] = 0.0; // unused normalBias
    d[38] = dirLight.castShadow ? 1.0 : 0.0;
    d[39] = numCascades;

    for (let i = 0; i < numCascades; i++) {
      const cam = dirLight.cascadeCameras[i];
      if (cam) {
        // The shadow map is rendered with ZO_CORRECTION * raw (see CascadedShadowPassGPU), so its
        // depth is in [0, 1]. Sampling with the raw GL-clip matrix compares against z in [-1, 1]
        // and starts every shadow far behind its occluder. Same matrix the main PBR shader uses.
        this._scratchCascadeVp.data.set(cam.viewProjectionMatrix);
        Matrix4.multiply(Matrix4.ZO_CORRECTION, this._scratchCascadeVp, this._scratchCascadeVpZO);
        d.set(this._scratchCascadeVpZO.data, 40 + i * 16);
      }
    }

    this._device.queue.writeBuffer(this._uniformBufferRaymarch, 0, d);

    // Populate bilateral uniform data
    this._uniformDataBilateral[0] = 1.0 / halfW;
    this._uniformDataBilateral[1] = 1.0 / halfH;
    this._uniformDataBilateral[2] = element.depthThreshold;
    this._uniformDataBilateral[3] = ctx.near;
    this._uniformDataBilateral[4] = ctx.far;
    this._device.queue.writeBuffer(this._uniformBufferBilateral, 0, this._uniformDataBilateral);

    // --- PASS 1: Half-Resolution Raymarching ---
    const rp1 = ce.beginRenderPass({
      colorAttachments: [
        {
          view: this._halfTextureView!,
          loadOp: "clear",
          storeOp: "store",
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
        },
      ],
    });
    rp1.setPipeline(this._pipelineRaymarch);
    rp1.setBindGroup(0, this._bindGroupRaymarch!);
    rp1.draw(3, 1, 0, 0);
    rp1.end();

    // --- PASS 2: Bilateral Depth-Aware Upsample ---
    const rp2 = ce.beginRenderPass({
      colorAttachments: [
        {
          view: this._fullTextureView!,
          loadOp: "clear",
          storeOp: "store",
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
        },
      ],
    });
    rp2.setPipeline(this._pipelineBilateral);
    rp2.setBindGroup(0, this._bindGroupBilateral!);
    rp2.draw(3, 1, 0, 0);
    rp2.end();

    return this._fullTextureView!;
  }

  public destroy(): void {
    this._halfTexture?.destroy();
    this._fullTexture?.destroy();
    this._uniformBufferRaymarch?.destroy();
    this._uniformBufferBilateral?.destroy();
    this._bindGroupRaymarch = undefined;
    this._bindGroupBilateral = undefined;
    this._cachedDepthView = undefined;
    this._cachedShadowView = undefined;
  }
}
