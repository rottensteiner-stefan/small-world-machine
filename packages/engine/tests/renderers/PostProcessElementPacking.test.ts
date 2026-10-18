import { describe, expect, it, vi, beforeAll } from "vitest";
import { ShaderRegistry } from "../../src/renderers/shaders/ShaderRegistry.js";
import { PostProcessPass } from "../../src/renderers/passes/PostProcessPass.js";
import { PostProcessingGroup } from "../../src/renderers/post/PostProcessingGroup.js";
import { ToneMappingMode } from "../../src/enums/index.js";
import { CoreShaderChunks } from "../../src/renderers/shaders/CoreShaderChunks.js";
import {
  ToneMappingElement,
  VignetteElement,
  GrainElement,
  BloomElement,
  QuantizeElement,
  ColorGradingElement,
  OutlineElement,
  FlashElement,
  GravitationalLensingElement,
  LightShaftsElement,
  HbaoElement,
} from "../../src/renderers/post/elements/index.js";
import type { PostProcessingElement } from "../../src/renderers/post/PostProcessingElement.js";
import POST_PROCESS_FRAG_WGSL from "../../src/renderers/post/shaders/PostProcess.frag.wgsl?raw";

const testShaderRegistry = new ShaderRegistry();

(globalThis as unknown as { GPUShaderStage: Record<string, number> }).GPUShaderStage ??= {
  VERTEX: 0x1,
  FRAGMENT: 0x2,
  COMPUTE: 0x4,
};
(globalThis as unknown as { GPUBufferUsage: Record<string, number> }).GPUBufferUsage ??= {
  MAP_READ: 0x0001,
  MAP_WRITE: 0x0002,
  COPY_SRC: 0x0004,
  COPY_DST: 0x0008,
  INDEX: 0x0010,
  VERTEX: 0x0020,
  UNIFORM: 0x0040,
  STORAGE: 0x0080,
  INDIRECT: 0x0100,
  QUERY_RESOLVE: 0x0200,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PassInternals = any;

const FLOAT_TOLERANCE = 5; // Float32 on write; assert to 5 decimals so representable-only math never
// falsely fails, while a wrong-slot/off-by-one pack still fails loudly.

/** Packs with a fresh element and asserts the exact slice values at their documented offsets. */
function expectPack(
  elements: PostProcessingElement[],
  expectations: Array<[number, number]>,
): void {
  const out = new Float32Array(52);
  for (const el of elements) {
    el.packUniforms!(out, 0);
  }
  for (const [index, value] of expectations) {
    expect(out[index]).toBeCloseTo(value, FLOAT_TOLERANCE);
  }
}

describe("PostProcess elements own their DynUniforms slices", () => {
  it("ToneMappingElement packs exposure and inverseGamma at 1..2", () => {
    const tm = new ToneMappingElement();
    tm.exposure = 2.5;
    tm.gamma = 2.2;
    expectPack(
      [tm],
      [
        [1, 2.5],
        [2, 1.0 / 2.2],
      ],
    );
  });

  it("VignetteElement packs offset/darkness/roundness at 3..5", () => {
    const vig = new VignetteElement();
    vig.offset = 0.42;
    vig.darkness = 0.9;
    vig.roundness = 5.0;
    expectPack(
      [vig],
      [
        [3, 0.42],
        [4, 0.9],
        [5, 5.0],
      ],
    );
  });

  it("GrainElement packs intensity at 6", () => {
    const grain = new GrainElement();
    grain.intensity = 0.17;
    expectPack([grain], [[6, 0.17]]);
  });

  it("BloomElement packs intensity/color and its pad at 7 and 12..15", () => {
    const bloom = new BloomElement();
    bloom.intensity = 1.3;
    bloom.color.set(0.2, 0.4, 0.6);
    expectPack(
      [bloom],
      [
        [7, 1.3],
        [12, 0.2],
        [13, 0.4],
        [14, 0.6],
        [15, 0.0],
      ],
    );
  });

  it("QuantizeElement packs steps at 8", () => {
    const quant = new QuantizeElement();
    quant.steps = 4.0;
    expectPack([quant], [[8, 4.0]]);
  });

  it("OutlineElement packs thickness/sensitivity/color and its pad at 9..10 and 16..19", () => {
    const outline = new OutlineElement();
    outline.thickness = 3.0;
    outline.sensitivity = 0.5;
    outline.color.set(1.0, 0.25, 0.0);
    expectPack(
      [outline],
      [
        [9, 3.0],
        [10, 0.5],
        [16, 1.0],
        [17, 0.25],
        [18, 0.0],
        [19, 0.0],
      ],
    );
  });

  it("ColorGradingElement packs the full grading block (11, 20..31)", () => {
    const grade = new ColorGradingElement();
    grade.contrast = 1.2;
    grade.saturation = 0.7;
    grade.temperature = -0.3;
    grade.tint = 0.4;
    grade.lift.set(0.1, 0.2, 0.3);
    grade.gamma.set(0.9, 1.1, 1.2);
    grade.gain.set(0.8, 0.9, 1.0);
    expectPack(
      [grade],
      [
        [11, 1.0], // c.w: gainB
        [20, 1.2],
        [21, 0.7],
        [22, -0.3],
        [23, 0.4],
        [24, 0.1],
        [25, 0.2],
        [26, 0.3],
        [27, 0.9],
        [28, 1.1],
        [29, 1.2],
        [30, 0.8],
        [31, 0.9],
      ],
    );
  });

  it("GravitationalLensingElement packs singularity + params at 32..39", () => {
    const lensing = new GravitationalLensingElement();
    lensing.singularityScreenPos.set(0.5, -0.5, 0.0);
    lensing.eventHorizonRadius = 0.05;
    lensing.strength = 0.9;
    lensing.spaghettification = 0.3;
    lensing.relativisticBeaming = 1.5;
    lensing.ringGlowIntensity = 3.0;
    expectPack(
      [lensing],
      [
        [32, 0.5],
        [33, -0.5],
        [34, 0.0],
        [35, 0.05],
        [36, 0.9],
        [37, 0.3],
        [38, 1.5],
        [39, 3.0],
      ],
    );
  });

  it("FlashElement packs color/intensity at 40..43", () => {
    const flash = new FlashElement();
    flash.color.set(0.1, 0.2, 0.3);
    flash.intensity = 0.75;
    expectPack(
      [flash],
      [
        [40, 0.1],
        [41, 0.2],
        [42, 0.3],
        [43, 0.75],
      ],
    );
  });

  it("LightShaftsElement packs intensity/density/color and the constant tail at 44..51", () => {
    const shafts = new LightShaftsElement();
    shafts.intensity = 2.0;
    shafts.density = 0.2;
    shafts.color.set(1.0, 0.8, 0.6);
    expectPack(
      [shafts],
      [
        [44, 2.0],
        [45, 0.2],
        [46, 0.0],
        [47, 0.0],
        [48, 1.0],
        [49, 0.8],
        [50, 0.6],
        [51, 1.0],
      ],
    );
  });

  it("two elements pack disjoint slices into the same buffer without cross-talk", () => {
    const tm = new ToneMappingElement();
    tm.exposure = 9.0;
    const vig = new VignetteElement();
    vig.offset = 8.0;
    const out = new Float32Array(52);
    tm.packUniforms!(out, 0);
    vig.packUniforms!(out, 0);
    expect(out[1]).toBe(9.0);
    expect(out[3]).toBe(8.0);
    expect(out[2]).toBeCloseTo(1.0 / 2.2, FLOAT_TOLERANCE);
  });

  it("honors a non-zero offset (writes at offset + slice base)", () => {
    const vig = new VignetteElement();
    vig.offset = 0.42;
    const out = new Float32Array(52 + 8);
    vig.packUniforms!(out, 8);
    expect(out[8 + 3]).toBeCloseTo(0.42, FLOAT_TOLERANCE);
    expect(out[3]).toBe(0.0);
  });

  it("structuralKey reflects enabled + mode and never continuous tuning values", () => {
    const tm = new ToneMappingElement();
    tm.mode = ToneMappingMode.REINHARD;
    tm.exposure = 77.0; // must NOT leak into the key
    expect(tm.structuralKey()).toBe(`1|${ToneMappingMode.REINHARD}`);
    tm.enabled = false;
    expect(tm.structuralKey()).toBe("0|0");
    tm.enabled = true;
    expect(tm.structuralKey()).toBe(`1|${ToneMappingMode.REINHARD}`);
  });
});

describe("structuralKey contracts", () => {
  it("returns enabled-marker only for flag-gated elements", () => {
    const cases: PostProcessingElement[] = [
      new VignetteElement(),
      new GrainElement(),
      new BloomElement(),
      new QuantizeElement(),
      new ColorGradingElement(),
      new FlashElement(),
      new LightShaftsElement(),
      new HbaoElement(),
    ];
    for (const el of cases) {
      el.enabled = true;
      expect(el.structuralKey!()).toBe("1");
      el.enabled = false;
      expect(el.structuralKey!()).toBe("0");
    }
  });

  it("structuralKey is stable under continuous tuning changes", () => {
    const vig = new VignetteElement();
    const before = vig.structuralKey!();
    vig.offset = 0.1;
    vig.darkness = 0.99;
    vig.roundness = 9.0;
    expect(vig.structuralKey!()).toBe(before);
  });
});

describe("PostProcessPass fails loudly on shader drift", () => {
  beforeAll(async () => {
    await CoreShaderChunks.init(testShaderRegistry);
  });

  function makeStrippedRenderer(missingToken: string): PassInternals {
    const device = {
      createSampler: vi.fn(() => ({})),
      createBuffer: vi.fn(() => ({})),
      createBindGroupLayout: vi.fn(() => ({})),
      createPipelineLayout: vi.fn(() => ({})),
      createShaderModule: vi.fn(() => ({})),
      createRenderPipeline: vi.fn(() => ({})),
      createBindGroup: vi.fn(() => ({})),
      queue: { writeBuffer: vi.fn() },
      __commandEncoder: {
        beginRenderPass: vi.fn(() => ({
          setPipeline: vi.fn(),
          setBindGroup: vi.fn(),
          draw: vi.fn(),
          end: vi.fn(),
        })),
      },
    } as unknown as GPUDevice;
    const group = new PostProcessingGroup();
    group.enabled = true;
    const stripped = POST_PROCESS_FRAG_WGSL.replace(missingToken, "");
    return {
      postProcessing: group,
      context: { shaderRegistry: { assemble: (): string => stripped } },
      frameInfo: { time: 0, deltaTime: 0, realTime: 0, realDeltaTime: 0, frameIndex: 0 },
      hdrTextureView: {},
      bloomTextureView: {},
      hbaoTextureView: {},
      lightShaftsTextureView: {},
      volumetricFogTextureView: {},
      whiteTextureView: {},
      gpuDevice: device,
      gpuFormat: "rgba8unorm",
      gpuCanvasContext: { getCurrentTexture: () => ({ createView: () => ({}) }) },
    };
  }

  it("throws with the offending constant when a structural WGSL token is missing", () => {
    const renderer = makeStrippedRenderer("const u_bloomEnabled: u32 = 0u;");
    const pass = new PostProcessPass() as PassInternals;
    const ce = (renderer as PassInternals).gpuDevice.__commandEncoder;
    expect(() =>
      pass.execute(renderer, {}, ce, {}, new Float32Array(16), { x: 0, y: 0, z: 0 }),
    ).toThrow(/u_bloomEnabled/);
  });

  it("throws even when a later constant (filterMode) is missing", () => {
    const renderer = makeStrippedRenderer("const u_filterMode: u32 = 0u;");
    const pass = new PostProcessPass() as PassInternals;
    const ce = (renderer as PassInternals).gpuDevice.__commandEncoder;
    expect(() =>
      pass.execute(renderer, {}, ce, {}, new Float32Array(16), { x: 0, y: 0, z: 0 }),
    ).toThrow(/u_filterMode/);
  });
});
