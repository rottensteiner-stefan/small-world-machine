import FULLSCREEN_VERT_WGSL from "../shaders/PostProcess.vert.wgsl?raw";
import { PostEffectPipelineGate } from "../PostEffectPipelineGate.js";
import type { PostEffectPass, PostEffectPassContext } from "../PostEffectPass.js";
import { PostProcessingEffectType, TextureFilter, TextureWrap, Topology } from "../../../enums/index.js";
import { Matrix4 } from "../../../math/index.js";

const REPROJECTED_TAA_FRAG_WGSL = /* wgsl */ `
@group(0) @binding(0) var taaSampler: sampler;
@group(0) @binding(1) var currentTexture: texture_2d<f32>;
@group(0) @binding(2) var historyTexture: texture_2d<f32>;
@group(0) @binding(3) var<uniform> u: HistoryBlendUniforms;
@group(0) @binding(4) var depthTexture: texture_depth_2d;

struct HistoryBlendUniforms {
    invViewProj: mat4x4f,
    prevViewProj: mat4x4f,
    params: vec4f, // [feedback, hasHistory, useReprojection, 0.0]
}

fn rgbToYCoCg(rgb: vec3f) -> vec3f {
    let co = rgb.r - rgb.b;
    let t = rgb.b + co * 0.5;
    let cg = rgb.g - t;
    let y = t + cg * 0.5;
    return vec3f(y, co, cg);
}

fn yCoCgToRgb(ycocg: vec3f) -> vec3f {
    let t = ycocg.x - ycocg.z * 0.5;
    let g = ycocg.z + t;
    let b = t - ycocg.y * 0.5;
    let r = b + ycocg.y;
    return max(vec3f(r, g, b), vec3f(0.0));
}

@fragment
fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
    let current = textureSample(currentTexture, taaSampler, uv).rgb;

    if (u.params.y < 0.5) {
        return vec4f(current, 1.0);
    }

    if (u.params.z < 0.5) {
        let history = textureSample(historyTexture, taaSampler, uv).rgb;
        return vec4f(mix(current, history, u.params.x), 1.0);
    }

    let dims = vec2i(textureDimensions(currentTexture, 0));
    let maxCoord = max(dims - vec2i(1), vec2i(0));
    let pixelCoord = clamp(vec2i(uv * vec2f(dims)), vec2i(0), maxCoord);
    let depth = textureLoad(depthTexture, pixelCoord, 0);

    if (depth >= 0.99999) {
        return vec4f(current, 1.0);
    }

    let ndcX = uv.x * 2.0 - 1.0;
    let ndcY = 1.0 - uv.y * 2.0;
    let clipPos = vec4f(ndcX, ndcY, depth, 1.0);
    let worldH = u.invViewProj * clipPos;
    if (abs(worldH.w) < 1e-6) {
        return vec4f(current, 1.0);
    }
    let worldPos = worldH.xyz / worldH.w;
    let prevClip = u.prevViewProj * vec4f(worldPos, 1.0);
    if (prevClip.w <= 1e-6) {
        return vec4f(current, 1.0);
    }
    let prevUV = prevClip.xy / prevClip.w * vec2f(0.5, -0.5) + vec2f(0.5, 0.5);
    if (prevUV.x < 0.0 || prevUV.x > 1.0 || prevUV.y < 0.0 || prevUV.y > 1.0) {
        return vec4f(current, 1.0);
    }

    // 3x3 neighborhood YCoCg variance clipping (Salvi 2016, 1.25 sigma)
    var m1 = vec3f(0.0);
    var m2 = vec3f(0.0);
    for (var dy = -1; dy <= 1; dy++) {
        for (var dx = -1; dx <= 1; dx++) {
            let tc = clamp(pixelCoord + vec2i(dx, dy), vec2i(0), maxCoord);
            let sampleRgb = textureLoad(currentTexture, tc, 0).rgb;
            let sampleYCoCg = rgbToYCoCg(sampleRgb);
            m1 += sampleYCoCg;
            m2 += sampleYCoCg * sampleYCoCg;
        }
    }
    let mean = m1 / 9.0;
    let variance = max(m2 / 9.0 - mean * mean, vec3f(0.0));
    let stddev = sqrt(variance);
    let gamma = 1.25;
    let boxMin = mean - gamma * stddev;
    let boxMax = mean + gamma * stddev;

    let historyRgb = textureSample(historyTexture, taaSampler, prevUV).rgb;
    let historyYCoCg = rgbToYCoCg(historyRgb);
    let clampedYCoCg = clamp(historyYCoCg, boxMin, boxMax);
    let clampedHistory = yCoCgToRgb(clampedYCoCg);

    let resolved = mix(current, clampedHistory, u.params.x);
    return vec4f(resolved, 1.0);
}
`;

/**
 * Temporal Anti-Aliasing (S9 depth-reprojected TAA with 3x3 YCoCg 1.25-sigma variance clamping)
 * and exponential history blend for WebGPU (used by both `TaaElement` and `MotionTrailElement`;
 * the renderer keeps one separate instance per effect type in its `PostEffectPass` registry).
 */
export class HistoryBlendPassGPU implements PostEffectPass {
  private _device: GPUDevice;
  private readonly _gate: PostEffectPipelineGate;
  private _pipeline!: GPURenderPipeline;
  private _sampler!: GPUSampler;
  private _uniformBuffer!: GPUBuffer;
  /** 36 floats (144 bytes): invViewProj (16) + prevViewProj (16) + params (4). */
  private _uniformData: Float32Array = new Float32Array(36);
  private _dummyDepthTexture!: GPUTexture;
  private _dummyDepthView!: GPUTextureView;

  private _pingPong?: [GPUTexture, GPUTexture];
  private _pingPongViews?: [GPUTextureView, GPUTextureView];
  private _parity: number = 0;
  private _width = 0;
  private _height = 0;
  private _hasHistory = false;

  private readonly _scratchInvViewProj: Matrix4 = new Matrix4();
  private readonly _prevViewProj: Float32Array = new Float32Array(16);

  private _bindGroups: [GPUBindGroup, GPUBindGroup] | undefined = undefined;
  private _builtCurrentView?: GPUTextureView;
  private _builtDepthView?: GPUTextureView;

  constructor(device: GPUDevice) {
    this._device = device;
    this._gate = new PostEffectPipelineGate(device, "HistoryBlend");
    this._gate.begin();
    this._buildPipeline();
    this._gate.end();
  }

  private _buildPipeline(): void {
    this._sampler = this._device.createSampler({
      minFilter: TextureFilter.LINEAR,
      magFilter: TextureFilter.LINEAR,
      addressModeU: TextureWrap.CLAMP_TO_EDGE,
      addressModeV: TextureWrap.CLAMP_TO_EDGE,
    });

    this._uniformBuffer = this._device.createBuffer({
      size: 144, // HistoryBlendUniforms: 2 x mat4x4f (128B) + 1 x vec4f (16B) = 144 bytes
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this._dummyDepthTexture = this._device.createTexture({
      size: [1, 1],
      format: "depth24plus",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this._dummyDepthView = this._dummyDepthTexture.createView();

    const bgl = this._device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: {} },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
        { binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "depth" } },
      ],
    });

    const layout = this._device.createPipelineLayout({ bindGroupLayouts: [bgl] });
    const vertModule = this._device.createShaderModule({ code: FULLSCREEN_VERT_WGSL });
    const fragModule = this._device.createShaderModule({ code: REPROJECTED_TAA_FRAG_WGSL });

    this._pipeline = this._device.createRenderPipeline({
      layout,
      vertex: { module: vertModule, entryPoint: "vs_main" },
      fragment: {
        module: fragModule,
        entryPoint: "fs_main",
        targets: [{ format: "rgba16float" }],
      },
      primitive: { topology: Topology.TRIANGLE_LIST },
    });
  }

  private _resize(width: number, height: number): void {
    if (this._pingPong && this._width === width && this._height === height) return;

    for (const old of this._pingPong ?? []) old.destroy();

    this._width = width;
    this._height = height;
    this._hasHistory = false;
    this._parity = 0;
    this._bindGroups = undefined;

    const makeTexture = (): GPUTexture =>
      this._device.createTexture({
        size: [width, height],
        format: "rgba16float",
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      });
    this._pingPong = [makeTexture(), makeTexture()];
    this._pingPongViews = [this._pingPong[0].createView(), this._pingPong[1].createView()];
  }

  /**
   * Direct render entrypoint with backwards-compatible optional depth & reprojection matrices.
   */
  public render(
    ce: GPUCommandEncoder,
    currentView: GPUTextureView,
    width: number,
    height: number,
    feedback: number,
    depthView?: GPUTextureView,
    invViewProj?: Float32Array,
    prevViewProj?: Float32Array,
  ): GPUTextureView | null {
    if (!this._gate.ready) return null;
    this._resize(width, height);
    if (!this._pingPong || !this._pingPongViews) return null;

    const activeDepthView = depthView ?? this._dummyDepthView;
    const useReprojection =
      Boolean(depthView && depthView !== this._dummyDepthView && invViewProj && prevViewProj);

    if (
      !this._bindGroups ||
      this._builtCurrentView !== currentView ||
      this._builtDepthView !== activeDepthView
    ) {
      const bgl = this._pipeline.getBindGroupLayout(0);
      this._bindGroups = [0, 1].map((i) =>
        this._device.createBindGroup({
          layout: bgl,
          entries: [
            { binding: 0, resource: this._sampler },
            { binding: 1, resource: currentView },
            { binding: 2, resource: this._pingPongViews![1 - i]! },
            { binding: 3, resource: { buffer: this._uniformBuffer } },
            { binding: 4, resource: activeDepthView },
          ],
        }),
      ) as [GPUBindGroup, GPUBindGroup];
      this._builtCurrentView = currentView;
      this._builtDepthView = activeDepthView;
    }

    if (invViewProj) {
      this._uniformData.set(invViewProj, 0);
    }
    if (prevViewProj) {
      this._uniformData.set(prevViewProj, 16);
    }
    this._uniformData[32] = feedback;
    this._uniformData[33] = this._hasHistory ? 1.0 : 0.0;
    this._uniformData[34] = useReprojection ? 1.0 : 0.0;
    this._uniformData[35] = 0.0;
    this._device.queue.writeBuffer(this._uniformBuffer, 0, this._uniformData);

    const writeView = this._pingPongViews[this._parity]!;
    const rp = ce.beginRenderPass({
      colorAttachments: [
        {
          view: writeView,
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });
    rp.setPipeline(this._pipeline);
    rp.setBindGroup(0, this._bindGroups[this._parity]);
    rp.draw(3);
    rp.end();

    this._hasHistory = true;
    this._parity = 1 - this._parity;

    return writeView;
  }

  /**
   * Resolves the current frame against history via the PostEffectPass contract.
   * @returns This frame's resolved HDR texture view (becomes history for the next call), or null if unavailable.
   */
  public execute(ctx: PostEffectPassContext): GPUTextureView | null {
    const { ce, width, height, colorView, depthView, vp } = ctx;
    const config = ctx.element as unknown as { type?: PostProcessingEffectType; feedback: number };
    const isTaa = config.type === PostProcessingEffectType.TAA;

    let invVpData: Float32Array | undefined = undefined;
    let prevVpData: Float32Array | undefined = undefined;

    if (isTaa && vp) {
      this._scratchInvViewProj.data.set(vp);
      if (Matrix4.invert(this._scratchInvViewProj, this._scratchInvViewProj)) {
        invVpData = this._scratchInvViewProj.data;
        prevVpData = this._hasHistory ? this._prevViewProj : vp;
      }
    }

    const out = this.render(
      ce,
      colorView,
      width,
      height,
      config.feedback,
      isTaa ? depthView : undefined,
      invVpData,
      prevVpData,
    );

    if (vp) {
      this._prevViewProj.set(vp);
    }
    return out;
  }

  /**
   * Discards the temporal history (S3 DP-4A): clears the `_hasHistory` flag so the next `execute`
   * blends against a blank history instead of the pre-cut frame.
   */
  public resetHistory(): void {
    this._hasHistory = false;
    this._parity = 0;
  }

  public destroy(): void {
    this._pingPong?.[0].destroy();
    this._pingPong?.[1].destroy();
    this._uniformBuffer?.destroy();
    this._dummyDepthTexture?.destroy();
  }
}

