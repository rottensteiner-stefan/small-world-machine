import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  AUTO_EXPOSURE_GRID,
  AUTO_EXPOSURE_KEY,
  AutoExposureElement,
  autoExposureStep,
} from "../../src/renderers/post/elements/AutoExposureElement.js";
import { PostProcessingGroup } from "../../src/renderers/post/PostProcessingGroup.js";
import { PostProcessingEffectType } from "../../src/enums/index.js";
import { AutoExposurePassGL } from "../../src/renderers/post/passes/AutoExposurePassGL.js";
import { AutoExposurePassGPU } from "../../src/renderers/post/passes/AutoExposurePassGPU.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Internals = any;

// WebGPU globals are absent in the node test runtime; seed minimal usage/shader-stage constants
// (mirror of WebGPUOffscreenTargetFormat.test.ts) so the eager `AutoExposurePassGPU` constructor
// and its bind-group layouts can read them.
(globalThis as unknown as { GPUShaderStage: Record<string, number> }).GPUShaderStage ??= {
  VERTEX: 0x1,
  FRAGMENT: 0x2,
};
(globalThis as unknown as { GPUTextureUsage: Record<string, number> }).GPUTextureUsage ??= {
  RENDER_ATTACHMENT: 0x10,
  TEXTURE_BINDING: 0x04,
  COPY_SRC: 0x01,
  COPY_DST: 0x02,
  STORAGE_BINDING: 0x08,
};
(globalThis as unknown as { GPUBufferUsage: Record<string, number> }).GPUBufferUsage ??= {
  UNIFORM: 0x40,
  COPY_DST: 0x08,
};

const SHADERS = join(__dirname, "../../src/renderers/post/shaders");
const read = (name: string): string => readFileSync(join(SHADERS, name), "utf8");

describe("AutoExposureElement (ADR 0061)", () => {
  it("is registered in every group and off by default (existing scenes unchanged)", () => {
    const element = new PostProcessingGroup().get<AutoExposureElement>(
      PostProcessingEffectType.AUTO_EXPOSURE,
    );
    expect(element).toBeInstanceOf(AutoExposureElement);
    expect(element!.enabled).toBe(false);
  });
});

describe("autoExposureStep (CPU mirror of the adapt shader)", () => {
  const el = new AutoExposureElement();

  it("maps a middle-grey frame to EV 0 (multiplier 1)", () => {
    expect(autoExposureStep(0, Math.log2(AUTO_EXPOSURE_KEY), 1, el, true)).toBeCloseTo(0, 10);
  });

  it("brightens dark frames and darkens bright ones, clamped to [minEv, maxEv]", () => {
    expect(autoExposureStep(0, Math.log2(AUTO_EXPOSURE_KEY / 4), 0, el, true)).toBeCloseTo(2, 10);
    expect(autoExposureStep(0, -20, 0, el, true)).toBe(el.maxEv);
    expect(autoExposureStep(0, 20, 0, el, true)).toBe(el.minEv);
  });

  it("applies the compensation as a plain EV offset", () => {
    const comp = new AutoExposureElement();
    comp.compensationEv = 0.5;
    expect(autoExposureStep(0, Math.log2(AUTO_EXPOSURE_KEY), 0, comp, true)).toBeCloseTo(0.5, 10);
  });

  it("adapts slower into the dark than into the light (asymmetric rates)", () => {
    const toDark = autoExposureStep(0, Math.log2(AUTO_EXPOSURE_KEY / 4), 0.1, el, false);
    const toBright = autoExposureStep(0, Math.log2(AUTO_EXPOSURE_KEY * 4), 0.1, el, false);
    expect(toDark).toBeGreaterThan(0);
    expect(toBright).toBeLessThan(0);
    expect(toDark).toBeLessThan(-toBright);
  });

  it("converges monotonically and is frame-rate independent", () => {
    const target = Math.log2(AUTO_EXPOSURE_KEY / 4);
    let ev60 = 0;
    for (let i = 0; i < 60; i++) ev60 = autoExposureStep(ev60, target, 1 / 60, el, false);
    let ev30 = 0;
    for (let i = 0; i < 30; i++) ev30 = autoExposureStep(ev30, target, 1 / 30, el, false);
    expect(ev60).toBeGreaterThan(0);
    expect(ev60).toBeLessThan(2);
    expect(ev60).toBeCloseTo(ev30, 10);
  });
});

describe("auto exposure shaders: two-dialect parity", () => {
  const adapt = {
    wgsl: read("AutoExposureAdapt.frag.wgsl"),
    glsl: read("AutoExposureAdapt.frag.glsl"),
  };
  const lum = {
    wgsl: read("AutoExposureLuminance.frag.wgsl"),
    glsl: read("AutoExposureLuminance.frag.glsl"),
  };

  for (const [dialect, source] of Object.entries(adapt)) {
    it(`${dialect}: key and grid match the CPU constants`, () => {
      const key = Number(/LOG2_KEY[^=]*=\s*(-?[0-9.]+)/.exec(source)![1]);
      expect(key).toBeCloseTo(Math.log2(AUTO_EXPOSURE_KEY), 10);
      expect(source).toMatch(new RegExp(`GRID[^=]*=\\s*${AUTO_EXPOSURE_GRID}\\b`));
      expect(source).toMatch(/exp2\(ev\), ev/);
    });
  }

  for (const [dialect, source] of Object.entries(lum)) {
    it(`${dialect}: Rec.709 luminance, 4x4 taps over a 1/64 spacing, center weighting`, () => {
      expect(source).toContain("0.2126, 0.7152, 0.0722");
      expect(source).toMatch(/TAPS_PER_AXIS[^=]*=\s*4\b/);
      expect(source).toMatch(/TAP_SPACING[^=]*=\s*1\.0 \/ 64\.0/);
      expect(source).toMatch(/max\(1\.0 - radius, MIN_WEIGHT\)/);
    });
  }

  it("both Luminance dialects clamp non-finite samples instead of poisoning the grid average (defense in depth)", () => {
    // WP-C2 scope: a NaN/Inf scene pixel must never poison the metering average (step 1 guard).
    expect(lum.wgsl).toMatch(/select\(MIN_LUMINANCE, lum, lum == lum && lum < 65504\.0\)/);
    expect(lum.glsl).toContain("(lum == lum && lum < 65504.0) ? lum : MIN_LUMINANCE");
  });

  it("WGSL adapt shader sanitizes targetEv and prevEv before the blend (WP-C2 NaN-poisoning fix)", () => {
    // P0: a non-finite grid average must not make `targetEv` NaN and permanently poison the 1x1
    // history texture. The fix guards BOTH inputs with `isFiniteF32` and falls back to a sane
    // value (0 / safeTargetEv) -- the exact WP-C2-spec tokens.
    expect(adapt.wgsl).toContain("safeTargetEv");
    expect(adapt.wgsl).toContain("safePrevEv");
    expect(adapt.wgsl).toContain("isFiniteF32");
    expect(adapt.wgsl).toMatch(
      /let safeTargetEv = select\(0\.0, targetEv, isFiniteF32\(targetEv\)\);/,
    );
    expect(adapt.wgsl).toMatch(
      /let safePrevEv = select\(safeTargetEv, prevEv, isFiniteF32\(prevEv\)\);/,
    );
    // The final output must derive from the sanitized chain, never resurrect the raw NaN-able
    // blend fallback.
    expect(adapt.wgsl).not.toMatch(/let ev = select\(targetEv, blended/);
  });

  it("GLSL adapt shader sanitizes targetEv and prevEv with a finiteness guard (WP-C2)", () => {
    // GLSL ES 3.00 has no `isFiniteF32`; the mirror must still apply an explicit finiteness
    // predicate before the fallback select.
    expect(adapt.glsl).toContain("safeTargetEv");
    expect(adapt.glsl).toContain("safePrevEv");
    expect(adapt.glsl).toMatch(/!isnan\(/);
  });

  it("both uber shaders scale the radiance by the 1x1 exposure texture before the tone curve", () => {
    expect(read("PostProcess.frag.wgsl")).toMatch(
      /hdr \*= textureLoad\(autoExposureTexture, vec2i\(0, 0\), 0\)\.r;\s*\n\s*let tonemapped/,
    );
    expect(read("PostProcess.frag.glsl")).toMatch(
      /hdr \*= texelFetch\(u_autoExposureTexture, ivec2\(0\), 0\)\.r;\s*\n\s*vec3 tonemapped/,
    );
    expect(read("PostProcess100.frag.glsl")).not.toContain("autoExposure");
  });
});

describe("AutoExposurePassGL.resetHistory (WP-C2 NaN/reset fix)", () => {
  it("resets the frame-timer basis so a re-enabled pass never applies a stale multi-second deltaTime", () => {
    const pass = new AutoExposurePassGL({} as unknown as WebGL2RenderingContext) as Internals;
    // Simulate a pass that ran, then sat idle -- on re-enable it must start adapting from a
    // fresh frame (deltaTime == 0) instead of seeing a multi-second spike.
    pass._lastRealTime = 5.0;
    pass._snap = false;
    pass.resetHistory();
    expect(pass._snap, "camera-cut contract: the next frame snaps to the metered target").toBe(
      true,
    );
    expect(pass._lastRealTime, "deltaTime basis reset to 'no previous frame'").toBe(-1);
  });
});

/** IEEE half 1.0 -- the neutral exposure multiplier both lanes seed the 1x1 history with. */
const IEEE_HALF_ONE = 0x3c00;

function makeGpuDevice(): GPUDevice {
  return {
    createBuffer: vi.fn(() => ({
      destroy: vi.fn(),
      getMappedRange: () => new ArrayBuffer(256),
      unmap: vi.fn(),
    })),
    createBindGroup: vi.fn(() => ({})),
    createBindGroupLayout: vi.fn(() => ({})),
    createShaderModule: vi.fn(() => ({
      getCompilationInfo: () => Promise.resolve({ messages: [] }),
    })),
    createPipelineLayout: vi.fn((desc: { bindGroupLayouts: unknown[] }) => ({
      bindGroupLayouts: desc.bindGroupLayouts,
    })),
    createRenderPipeline: vi.fn((desc: { layout: { bindGroupLayouts: unknown[] } }) => ({
      layout: desc.layout,
      getBindGroupLayout: vi.fn(() => ({})),
    })),
    createSampler: vi.fn(() => ({})),
    createTexture: vi.fn((desc: { format: string; usage: number }) => ({
      format: desc.format,
      usage: desc.usage,
      createView: vi.fn(() => ({})),
      destroy: vi.fn(),
    })),
    queue: { writeBuffer: vi.fn(), writeTexture: vi.fn() },
  } as unknown as GPUDevice;
}

/** Latest recorded adapt-params upload (Float32Array(8)) from `queue.writeBuffer`. */
function lastAdaptUpload(device: GPUDevice): Float32Array {
  const calls = vi
    .mocked(device.queue.writeBuffer)
    .mock.calls.filter(
      (c: unknown[]) => c[2] instanceof Float32Array && (c[2] as Float32Array).length === 8,
    );
  return (calls[calls.length - 1]?.[2] as Float32Array) ?? new Float32Array();
}

function makeGpuContext(realTime: number, realDeltaTime: number): Internals {
  const rp = { setPipeline: vi.fn(), setBindGroup: vi.fn(), draw: vi.fn(), end: vi.fn() };
  return {
    element: {
      centerWeight: 0.5,
      minEv: -8,
      maxEv: 8,
      compensationEv: 0,
      speedDark: 0.3,
      speedBright: 0.3,
    },
    ce: { beginRenderPass: vi.fn(() => rp), copyTextureToTexture: vi.fn() },
    renderer: { frameInfo: { realTime, realDeltaTime } },
    colorView: {},
  };
}

describe("AutoExposurePassGPU.resetHistory (WP-C2 GPU/GL reset parity)", () => {
  it("re-seeds the exposure texture and forces snap + delta 0 on the next frame (GL parity)", () => {
    const device = makeGpuDevice();
    const pass = new AutoExposurePassGPU(device) as Internals;
    // Init parity with AutoExposurePassGL: 'no previous frame' + snap defaults.
    expect(pass._lastRealTime).toBe(-1);
    expect(pass._snap).toBe(true);
    // Simulate a pass that ran, then sat idle -- on re-enable it must start from a fresh basis.
    pass._lastRealTime = 5.0;
    pass._snap = false;
    const seedsBefore = vi.mocked(device.queue.writeTexture).mock.calls.length;
    pass.resetHistory();
    expect(pass._snap, "camera-cut contract: the next frame snaps to the metered target").toBe(
      true,
    );
    expect(pass._lastRealTime, "deltaTime basis reset to 'no previous frame'").toBe(-1);
    // The reset must re-seed the stable 1x1 exposure texture with the neutral multiplier
    // (parity with AutoExposurePassGL._seedExposureHistory's clearColor(1,0,0,1)).
    const writes = vi.mocked(device.queue.writeTexture).mock.calls;
    expect(writes.length).toBe(seedsBefore + 1);
    const texels = writes[writes.length - 1]?.[1] as Uint16Array;
    expect(texels[0], "multiplier re-seeded to neutral IEEE half 1.0").toBe(IEEE_HALF_ONE);
    expect(texels[3], "alpha re-seeded (GL clearColor alpha parity)").toBe(IEEE_HALF_ONE);
    // The frame after the reset must apply delta 0 (never a stale multi-second spike) and snap.
    pass.execute(makeGpuContext(12.5, 0.016) as never);
    const adapt = lastAdaptUpload(device);
    expect(adapt[3]).toBe(0);
    expect(adapt[6]).toBe(1);
    expect(pass._lastRealTime).toBe(12.5);
  });

  it("applies the real per-frame delta from the second frame on (the guard is not permanent)", () => {
    const device = makeGpuDevice();
    const pass = new AutoExposurePassGPU(device) as Internals;
    pass.execute(makeGpuContext(10.0, 0.016) as never);
    expect(lastAdaptUpload(device)[3], "first frame on a fresh basis applies delta 0").toBe(0);
    expect(lastAdaptUpload(device)[6], "and snaps to the metered target").toBe(1);
    pass.execute(makeGpuContext(10.0, 0.016) as never);
    expect(
      lastAdaptUpload(device)[3],
      "subsequent frames apply the real deltaTime (float32-rounded, as uploaded)",
    ).toBe(Math.fround(0.016));
    expect(lastAdaptUpload(device)[6], "snap consumed after the first frame").toBe(0);
  });
});
