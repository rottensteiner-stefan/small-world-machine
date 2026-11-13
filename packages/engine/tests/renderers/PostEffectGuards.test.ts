/* eslint-disable @typescript-eslint/explicit-function-return-type -- terse GPU mock stubs */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { Matrix4, Vector3D } from "../../src/math/index.js";
import { Color } from "../../src/core/colors/index.js";
import { PostEffectPipelineGate } from "../../src/renderers/post/PostEffectPipelineGate.js";
import { DepthOfFieldPassGPU } from "../../src/renderers/post/passes/DepthOfFieldPassGPU.js";
import { LightShaftsPassGPU } from "../../src/renderers/post/passes/LightShaftsPassGPU.js";
import type { PostEffectPassContext } from "../../src/renderers/post/PostEffectPass.js";

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
        color: new Color(1, 1, 1),
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
