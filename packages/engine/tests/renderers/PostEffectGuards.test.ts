/* eslint-disable @typescript-eslint/explicit-function-return-type -- terse GPU mock stubs */
import { describe, expect, it, vi, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { Matrix4, Vector3D } from "../../src/math/index.js";
import { PostEffectPipelineGate } from "../../src/renderers/post/PostEffectPipelineGate.js";
import { DepthOfFieldPassGPU } from "../../src/renderers/post/passes/DepthOfFieldPassGPU.js";
import { LightShaftsPassGPU } from "../../src/renderers/post/passes/LightShaftsPassGPU.js";
import { PostProcessPass } from "../../src/renderers/passes/PostProcessPass.js";
import { PostFxChain } from "../../src/renderers/WebGPU/managers/PostFxChain.js";
import { PostProcessingGroup } from "../../src/index.js";
import { PostProcessingEffectType } from "../../src/enums/index.js";
import { ShaderRegistry } from "../../src/renderers/shaders/ShaderRegistry.js";
import { CoreShaderChunks } from "../../src/renderers/shaders/CoreShaderChunks.js";
import type { PostEffectPassContext } from "../../src/renderers/post/PostEffectPass.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

const g = globalThis as unknown as Record<string, Record<string, number>>;
g["GPUShaderStage"] ??= { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 };
g["GPUBufferUsage"] ??= { COPY_DST: 8, UNIFORM: 0x40 };
g["GPUTextureUsage"] ??= {
  COPY_SRC: 1,
  COPY_DST: 2,
  TEXTURE_BINDING: 4,
  STORAGE_BINDING: 8,
  RENDER_ATTACHMENT: 16,
};

interface MockDevice {
  device: GPUDevice;
  textures: { size: number[]; destroy: ReturnType<typeof vi.fn> }[];
  writes: { buffer: unknown; data: Float32Array }[];
  /** The next popErrorScope resolves with this message (null = no error), then resets. */
  failNext: { message: string | null };
}

function makeDevice(withErrorScopes: boolean): MockDevice {
  const textures: MockDevice["textures"] = [];
  const writes: MockDevice["writes"] = [];
  const failNext = { message: null as string | null };
  const device: Record<string, unknown> = {
    createSampler: vi.fn(() => ({})),
    createBuffer: vi.fn(() => ({ destroy: vi.fn() })),
    createBindGroupLayout: vi.fn(() => ({})),
    createPipelineLayout: vi.fn(() => ({})),
    createShaderModule: vi.fn(() => ({})),
    createRenderPipeline: vi.fn(() => ({ getBindGroupLayout: () => ({}) })),
    createComputePipeline: vi.fn(() => ({ getBindGroupLayout: () => ({}) })),
    createBindGroup: vi.fn(() => ({})),
    createTexture: vi.fn((d: { size: number[] }) => {
      const t = { size: d.size, destroy: vi.fn(), createView: () => ({}) };
      textures.push(t);
      return t;
    }),
    queue: {
      writeBuffer: vi.fn((buffer: unknown, _o: number, data: Float32Array) =>
        writes.push({ buffer, data: new Float32Array(data) }),
      ),
      writeTexture: vi.fn(),
    },
  };
  if (withErrorScopes) {
    device["pushErrorScope"] = vi.fn();
    // One-shot: only the next scope fails, later ones (e.g. a fallback rebuild) succeed.
    device["popErrorScope"] = vi.fn(() => {
      const message = failNext.message;
      failNext.message = null;
      return Promise.resolve(message === null ? null : { message });
    });
  }
  return { device: device as unknown as GPUDevice, textures, writes, failNext };
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

const ceStub = (): GPUCommandEncoder =>
  ({
    beginRenderPass: () => ({ setPipeline() {}, setBindGroup() {}, draw() {}, end() {} }),
  }) as unknown as GPUCommandEncoder;

describe("PostEffectPipelineGate (A8)", () => {
  it("is ready only after the error scope popped clean", async () => {
    const m = makeDevice(true);
    const gate = new PostEffectPipelineGate(m.device, "T");
    gate.begin();
    gate.end();
    expect(gate.ready).toBe(false); // pending
    await flush();
    expect(gate.ready).toBe(true);
  });

  it("fails and warns exactly once on a validation error", async () => {
    const m = makeDevice(true);
    m.failNext.message = "bad wgsl";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const gate = new PostEffectPipelineGate(m.device, "T");
    gate.begin();
    gate.end();
    await flush();
    expect(gate.failed).toBe(true);
    expect(gate.ready).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain("bad wgsl");
    warn.mockRestore();
  });

  it("settles immediately on devices without error scopes", () => {
    const gate = new PostEffectPipelineGate(makeDevice(false).device, "T");
    gate.begin();
    gate.end();
    expect(gate.ready).toBe(true);
  });

  it("an effect pass with an invalid pipeline returns null instead of recording work", async () => {
    const m = makeDevice(true);
    m.failNext.message = "invalid pipeline";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const pass = new DepthOfFieldPassGPU(m.device);
    await flush();
    const ctx = {
      ce: ceStub(),
      colorView: {},
      depthView: {},
      width: 64,
      height: 64,
      near: 0.1,
      far: 100,
      element: { enabled: true, focusDistance: 5, cocScalePx: () => 4, maxCocPx: () => 8 },
    } as unknown as PostEffectPassContext;
    expect(pass.execute(ctx)).toBeNull();
    expect(m.device.createTexture).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("DepthOfFieldPassGPU odd widths (K9)", () => {
  it("allocates half-res CoC targets with ceil so the last column of an odd width is kept", () => {
    const m = makeDevice(false);
    const pass = new DepthOfFieldPassGPU(m.device);
    const ctx = {
      ce: ceStub(),
      colorView: {},
      depthView: {},
      width: 101,
      height: 61,
      near: 0.1,
      far: 100,
      element: { enabled: true, focusDistance: 5, cocScalePx: () => 4, maxCocPx: () => 8 },
    } as unknown as PostEffectPassContext;
    expect(pass.execute(ctx)).not.toBeNull();
    // coc + gather are the half-res targets (first two), output is full res.
    expect(m.textures[0]!.size).toEqual([51, 31, 1]);
    expect(m.textures[1]!.size).toEqual([51, 31, 1]);
    expect(m.textures[2]!.size).toEqual([101, 61, 1]);
  });
});

describe("LightShaftsPassGPU shadow matrices (A1 shafts bullet, A10)", () => {
  function runShafts(
    near: number,
    far: number,
  ): { raw: Matrix4; d: Float32Array; bil: Float32Array } {
    const m = makeDevice(false);
    const pass = new LightShaftsPassGPU(m.device);
    const raw = new Matrix4();
    const view = new Matrix4();
    Matrix4.orthographic(-20, 20, -20, 20, 1, 80, raw);
    Matrix4.lookAt(new Vector3D(10, 40, 10), new Vector3D(0, 0, 0), new Vector3D(0, 1, 0), view);
    const vpRaw = new Matrix4();
    Matrix4.multiply(raw, view, vpRaw);
    const cascadeVp = new Float32Array(vpRaw.data);
    const camVp = new Matrix4();
    Matrix4.perspective(1, 1, 0.1, 100, camVp);
    const ctx = {
      renderer: { defaultDirShadowTextureView: {} },
      ce: ceStub(),
      depthView: {},
      width: 64,
      height: 64,
      vp: new Float32Array(camVp.data),
      camPos: new Vector3D(0, 0, 0),
      near,
      far,
      lights: {
        dLight: {
          direction: new Vector3D(0, -1, 0),
          intensity: 1,
          numCascades: 1,
          cascadeSplits: [50],
          cascadeCameras: [{ viewProjectionMatrix: cascadeVp }],
          shadowBias: 0.001,
          castShadow: true,
        },
      },
      element: {
        enabled: true,
        maxDistance: 50,
        asymmetry: 0.5,
        color: { r: 1, g: 1, b: 1 },
        density: 0.1,
        samples: 16,
        depthThreshold: 0.1,
      },
    } as unknown as PostEffectPassContext;
    expect(pass.execute(ctx)).not.toBeNull();
    const ray = m.writes.find((w) => w.data.length === 104)!;
    const bil = m.writes.find((w) => w.data.length === 8)!;
    return { raw: vpRaw, d: ray.data, bil: bil.data };
  }

  it("uploads ZO-corrected cascade matrices (same as the shadow map was rendered with)", () => {
    const { raw, d } = runShafts(0.1, 100);
    const expected = new Matrix4();
    Matrix4.multiply(Matrix4.ZO_CORRECTION, raw, expected);
    for (let i = 0; i < 16; i++) expect(d[40 + i]).toBeCloseTo(expected.data[i]!, 5);

    // Numeric: an occluder at world origin. Shadow-map depth is (ZO*raw*p).z/w in [0,1]; the old
    // raw upload would compare against 2*depth-1.
    const p = new Vector3D(0, 0, 0);
    const written = new Vector3D();
    expected.transformVector(p, written);
    const rawZ = new Vector3D();
    raw.transformVector(p, rawZ);
    const uploaded = new Matrix4();
    uploaded.data.set(d.subarray(40, 56));
    const sampled = new Vector3D();
    uploaded.transformVector(p, sampled);
    expect(sampled.z).toBeCloseTo(written.z, 5);
    expect(sampled.z).toBeGreaterThanOrEqual(0);
    expect(Math.abs(rawZ.z - written.z)).toBeGreaterThan(0.1); // old behaviour was visibly off
  });

  it("passes the camera near/far to the bilateral upsample instead of hardcoded 0.1/1000", () => {
    const { bil } = runShafts(0.5, 250);
    expect(bil[3]).toBeCloseTo(0.5);
    expect(bil[4]).toBeCloseTo(250);
  });

  it("WGSL samples with the main shader's convention (Y flip, ZO range) and no hardcoded planes", () => {
    const dir = new URL("../../src/renderers/post/shaders/", import.meta.url);
    const shafts = readFileSync(new URL("LightShafts.frag.wgsl", dir), "utf8");
    expect(shafts).toContain("0.5 - proj.y * 0.5");
    expect(shafts).toContain("proj.z < 0.0");
    const bil = readFileSync(new URL("LightShaftsBilateral.frag.wgsl", dir), "utf8");
    expect(bil).not.toMatch(/let far = 1000\.0/);
    expect(bil).toContain("bp.params.w");
  });
});

describe("PostProcessPass neutral fallbacks (A9, K1, A8)", () => {
  const registry = new ShaderRegistry();
  beforeAll(async () => {
    await CoreShaderChunks.init(registry);
  });

  function setup(withErrorScopes = false): {
    m: MockDevice;
    renderer: Any;
    group: PostProcessingGroup;
    pass: Any;
  } {
    const m = makeDevice(withErrorScopes);
    const group = new PostProcessingGroup();
    group.enabled = true;
    group.get<Any>(PostProcessingEffectType.BLOOM).enabled = true;
    group.get<Any>(PostProcessingEffectType.HBAO).enabled = true;
    group.get<Any>(PostProcessingEffectType.LIGHT_SHAFTS).enabled = true;
    group.get<Any>(PostProcessingEffectType.VOLUMETRIC_FOG).enabled = true;
    const white = { white: true };
    const renderer = {
      postProcessing: group,
      context: { shaderRegistry: registry },
      frameInfo: { realTime: 0 },
      hdrTextureView: {},
      whiteTextureView: white,
      gpuDevice: m.device,
      gpuFormat: "rgba8unorm",
      gpuCanvasContext: { getCurrentTexture: () => ({ createView: () => ({}) }) },
    };
    return { m, renderer, group, pass: new PostProcessPass() };
  }

  it("binds neutral BLACK (not white) for enabled-but-missing bloom/shafts/fog, white only for AO", () => {
    const { m, renderer, pass } = setup();
    pass.execute(renderer, {}, ceStub(), {}, new Float32Array(16), {});
    const bg = (m.device.createBindGroup as Any).mock.calls.at(-1)[0].entries as {
      binding: number;
      resource: unknown;
    }[];
    const byBinding = (b: number): unknown => bg.find((e) => e.binding === b)!.resource;
    expect(byBinding(4)).toBe(renderer.whiteTextureView); // hbao
    const black = byBinding(3);
    expect(black).not.toBe(renderer.whiteTextureView);
    expect(byBinding(5)).toBe(black); // shafts
    expect(byBinding(6)).toBe(black); // fog
    const wt = (m.device.queue.writeTexture as Any).mock.calls[0];
    expect(Array.from(wt[1] as Uint8Array)).toEqual([0, 0, 0, 255]);
  });

  it("does not allocate a new effect bundle per frame (K1)", () => {
    const { renderer, pass } = setup();
    pass.execute(renderer, {}, ceStub(), {}, new Float32Array(16), {});
    const bundle = pass._bundle;
    pass.execute(renderer, {}, ceStub(), {}, new Float32Array(16), {});
    expect(pass._bundle).toBe(bundle);
  });

  it("falls back to the neutral variant when the first uber pipeline is invalid, and still draws", async () => {
    const { m, renderer, pass } = setup(true);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    m.failNext.message = "uber broke";
    const draws = vi.fn();
    const ce = {
      beginRenderPass: () => ({ setPipeline() {}, setBindGroup() {}, draw: draws, end() {} }),
    } as unknown as GPUCommandEncoder;
    pass.execute(renderer, {}, ce, {}, new Float32Array(16), {});
    expect(draws).not.toHaveBeenCalled(); // first build still validating: no frame with an unverified pipeline
    await flush(); // first verdict: failure -> safe variant requested and verified
    pass.execute(renderer, {}, ce, {}, new Float32Array(16), {});
    expect(draws).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

describe("PostFxChain frees idle effect passes (A11)", () => {
  it("destroys a pass that stayed disabled for IDLE_DESTROY_FRAMES and drops its registry entry", () => {
    const m = makeDevice(false);
    const group = new PostProcessingGroup();
    group.enabled = true;
    const host = {
      gpuDevice: m.device,
      postProcessing: group,
      gpuCanvasContext: { canvas: { width: 32, height: 32 } },
      hdrTexture: undefined,
      hdrTextureView: undefined,
      opaqueDepthView: undefined,
      dummyDepthTextureView: {},
    } as Any;
    const chain = new PostFxChain(host) as Any;
    const destroy = vi.fn();
    chain._getOrCreatePass(PostProcessingEffectType.BLOOM, function (this: Any) {
      this.execute = () => null;
      this.destroy = destroy;
    });
    expect(chain._passes.size).toBe(1);
    const run = (): void =>
      chain.runPostEffects(
        ceStub(),
        {},
        new Float32Array(16),
        undefined,
        new Vector3D(),
        0.1,
        100,
        undefined,
        {},
      );
    for (let i = 0; i < PostFxChain.IDLE_DESTROY_FRAMES; i++) run();
    expect(destroy).not.toHaveBeenCalled();
    run();
    run();
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(chain._passes.size).toBe(0);
  });
});
