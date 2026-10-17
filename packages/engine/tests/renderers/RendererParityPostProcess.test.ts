import { describe, it, expect, vi, beforeAll } from "vitest";
import { PostProcessingGroup } from "../../src/renderers/post/PostProcessingGroup.js";
import type {
  ToneMappingElement,
  VignetteElement,
  GrainElement,
  BloomElement,
  ColorGradingElement,
  QuantizeElement,
  OutlineElement,
  GravitationalLensingElement,
  FlashElement,
  LightShaftsElement,
} from "../../src/renderers/post/elements/index.js";
import { PostProcessingEffectType } from "../../src/enums/index.js";
import { PostProcessPassGL } from "../../src/renderers/post/passes/PostProcessPassGL.js";
import { PostProcessPass } from "../../src/renderers/passes/PostProcessPass.js";
import { CoreShaderChunks } from "../../src/renderers/shaders/CoreShaderChunks.js";

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

// Mock WebGL2 context capturing uniform calls
function createMockGL(): {
  uniforms: Map<string, unknown>;
  gl: WebGL2RenderingContext;
} {
  const uniforms = new Map<string, unknown>();
  const uniformLocations = new Map<string, object>();

  const getLoc = (name: string): object => {
    if (!uniformLocations.has(name)) {
      uniformLocations.set(name, { name });
    }
    return uniformLocations.get(name)!;
  };

  return {
    uniforms,
    gl: {
      createProgram: (): object => ({}),
      createShader: (): object => ({}),
      shaderSource: (): void => {},
      compileShader: (): void => {},
      getShaderParameter: (): boolean => true,
      getShaderInfoLog: (): string => "",
      attachShader: (): void => {},
      linkProgram: (): void => {},
      getProgramParameter: (): boolean => true,
      getProgramInfoLog: (): string => "",
      deleteShader: (): void => {},
      deleteProgram: (): void => {},
      deleteBuffer: (): void => {},
      deleteVertexArray: (): void => {},
      createBuffer: (): object => ({}),
      createVertexArray: (): object => ({}),
      bindVertexArray: (): void => {},
      bindBuffer: (): void => {},
      bufferData: (): void => {},
      useProgram: (): void => {},
      disable: (): void => {},
      enable: (): void => {},
      depthMask: (): void => {},
      activeTexture: (): void => {},
      bindTexture: (): void => {},
      bindFramebuffer: (): void => {},
      viewport: (): void => {},
      drawArrays: (): void => {},
      enableVertexAttribArray: (): void => {},
      disableVertexAttribArray: (): void => {},
      vertexAttribPointer: (): void => {},
      canvas: { width: 800, height: 600 },
      getUniformLocation: (_prog: unknown, name: string): object => getLoc(name),
      uniform1i: (loc: { name: string }, v: number): void => {
        uniforms.set(loc.name, v);
      },
      uniform1f: (loc: { name: string }, v: number): void => {
        uniforms.set(loc.name, v);
      },
      uniform3f: (loc: { name: string }, x: number, y: number, z: number): void => {
        uniforms.set(loc.name, [x, y, z]);
      },
      uniform4f: (loc: { name: string }, x: number, y: number, z: number, w: number): void => {
        uniforms.set(loc.name, [x, y, z, w]);
      },
    } as unknown as WebGL2RenderingContext,
  };
}

function createMockGPU(): {
  device: GPUDevice;
  getWrittenUniforms: () => Float32Array | null;
  makeRenderer: (group: PostProcessingGroup) => unknown;
} {
  let writtenUniforms: Float32Array | null = null;
  const renderPass = {
    setPipeline: vi.fn(),
    setBindGroup: vi.fn(),
    draw: vi.fn(),
    end: vi.fn(),
  };
  const commandEncoder = { beginRenderPass: vi.fn(() => renderPass) };
  const device = {
    createSampler: vi.fn(() => ({})),
    createBuffer: vi.fn(() => ({})),
    createBindGroupLayout: vi.fn(() => ({})),
    createPipelineLayout: vi.fn(() => ({})),
    createShaderModule: vi.fn(() => ({})),
    createRenderPipeline: vi.fn(() => ({})),
    createBindGroup: vi.fn(() => ({})),
    queue: {
      writeBuffer: vi.fn((_buf: unknown, _offset: number, data: Float32Array) => {
        writtenUniforms = new Float32Array(data);
      }),
    },
    __commandEncoder: commandEncoder,
  } as unknown as GPUDevice;

  const makeRenderer = (group: PostProcessingGroup): unknown => ({
    postProcessing: group,
    frameInfo: { time: 0, deltaTime: 0, realTime: 0, realDeltaTime: 0, frameIndex: 0 },
    hdrTextureView: {},
    motionTrailResolvedView: undefined,
    taaResolvedView: undefined,
    bloomTextureView: {},
    hbaoTextureView: {},
    whiteTextureView: {},
    gpuDevice: device,
    gpuFormat: "rgba8unorm",
    gpuCanvasContext: {
      getCurrentTexture: (): { createView: () => object } => ({
        createView: (): object => ({}),
      }),
    },
  });

  return { device, getWrittenUniforms: (): Float32Array | null => writtenUniforms, makeRenderer };
}

describe("Post-Processing Renderer Parity (WebGL2 vs WebGPU)", () => {
  beforeAll(async () => {
    await CoreShaderChunks.init();
  });

  it("ensures exact 1:1 parity of all post-process uniform values across WebGL2 and WebGPU", () => {
    const group = new PostProcessingGroup();
    group.enabled = true;
    group.filterMode = 8; // Black hole / gravitational lensing mode

    // Configure all elements with distinct continuous values
    const tm = group.get<ToneMappingElement>(PostProcessingEffectType.TONE_MAPPING)!;
    tm.enabled = true;
    tm.exposure = 2.75;
    tm.gamma = 1.8;

    const vig = group.get<VignetteElement>(PostProcessingEffectType.VIGNETTE)!;
    vig.enabled = true;
    vig.offset = 0.35;
    vig.darkness = 0.85;
    vig.roundness = 2.5;

    const grain = group.get<GrainElement>(PostProcessingEffectType.GRAIN)!;
    grain.enabled = true;
    grain.intensity = 0.12;

    const bloom = group.get<BloomElement>(PostProcessingEffectType.BLOOM)!;
    bloom.enabled = true;
    bloom.intensity = 3.2;
    bloom.color.set(0.9, 0.6, 0.3);

    const grade = group.get<ColorGradingElement>(PostProcessingEffectType.COLOR_GRADING)!;
    grade.enabled = true;
    grade.contrast = 1.25;
    grade.saturation = 0.95;
    grade.temperature = 0.15;
    grade.tint = -0.05;
    grade.lift.set(0.02, 0.01, -0.01);
    grade.gamma.set(1.05, 0.98, 1.02);
    grade.gain.set(1.1, 1.0, 0.9);

    const quant = group.get<QuantizeElement>(PostProcessingEffectType.QUANTIZE)!;
    quant.enabled = true;
    quant.steps = 16.0;

    const outline = group.get<OutlineElement>(PostProcessingEffectType.OUTLINE)!;
    outline.enabled = true;
    outline.thickness = 2.0;
    outline.sensitivity = 0.75;
    outline.color.set(0.2, 0.8, 1.0);

    const lensing = group.get<GravitationalLensingElement>(
      PostProcessingEffectType.GRAVITATIONAL_LENSING,
    )!;
    lensing.enabled = true;
    lensing.singularityScreenPos.set(0.1, -0.2, 0.85);
    lensing.eventHorizonRadius = 0.045;
    lensing.strength = 0.4;
    lensing.spaghettification = 0.22;
    lensing.relativisticBeaming = 1.5;
    lensing.ringGlowIntensity = 3.0;

    const flash = group.get<FlashElement>(PostProcessingEffectType.FLASH)!;
    flash.enabled = true;
    flash.color.set(1.0, 0.3, 0.2);
    flash.intensity = 0.65;

    const shafts = group.get<LightShaftsElement>(PostProcessingEffectType.LIGHT_SHAFTS)!;
    shafts.enabled = true;
    shafts.intensity = 1.8;
    shafts.density = 0.9;
    shafts.asymmetry = 0.75;
    shafts.color.set(1.0, 0.9, 0.7);

    // 1. Execute WebGL2 Pass
    const { gl, uniforms } = createMockGL();
    const glPass = new PostProcessPassGL(gl, true);
    glPass.execute(
      gl,
      {} as WebGLTexture,
      group,
      {} as WebGLTexture,
      {} as WebGLTexture,
      {} as WebGLTexture,
    );

    // 2. Execute WebGPU Pass
    const { device, getWrittenUniforms, makeRenderer } = createMockGPU();
    const gpuRenderer = makeRenderer(group);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const gpuPass = new PostProcessPass() as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ce = (device as any).__commandEncoder;
    gpuPass.execute(gpuRenderer, {}, ce, {}, new Float32Array(16), { x: 0, y: 0, z: 0 });

    const gpuData = getWrittenUniforms();
    expect(gpuData).toBeDefined();
    expect(gpuData!.length).toBe(52); // 13 x vec4f (208 bytes)

    // === VERIFY 1:1 UNIFORM PARITY ===

    // Tone Mapping (Exposure & Gamma)
    expect(uniforms.get("u_exposure")).toBeCloseTo(tm.exposure);
    expect(gpuData![1]).toBeCloseTo(tm.exposure);
    expect(uniforms.get("u_inverseGamma")).toBeCloseTo(1.0 / tm.gamma);
    expect(gpuData![2]).toBeCloseTo(1.0 / tm.gamma);

    // Vignette (Offset, Darkness, Roundness)
    expect(uniforms.get("u_vignetteOffset")).toBeCloseTo(vig.offset);
    expect(gpuData![3]).toBeCloseTo(vig.offset);
    expect(uniforms.get("u_vignetteDarkness")).toBeCloseTo(vig.darkness);
    expect(gpuData![4]).toBeCloseTo(vig.darkness);
    expect(uniforms.get("u_vignetteRoundness")).toBeCloseTo(vig.roundness);
    expect(gpuData![5]).toBeCloseTo(vig.roundness);

    // Grain
    expect(uniforms.get("u_grainIntensity")).toBeCloseTo(grain.intensity);
    expect(gpuData![6]).toBeCloseTo(grain.intensity);

    // Bloom
    expect(uniforms.get("u_bloomIntensity")).toBeCloseTo(bloom.intensity);
    expect(gpuData![7]).toBeCloseTo(bloom.intensity);
    expect(uniforms.get("u_bloomColor")).toEqual([bloom.color.r, bloom.color.g, bloom.color.b]);
    expect(gpuData![12]).toBeCloseTo(bloom.color.r);
    expect(gpuData![13]).toBeCloseTo(bloom.color.g);
    expect(gpuData![14]).toBeCloseTo(bloom.color.b);

    // Quantize
    expect(uniforms.get("u_quantizeSteps")).toBeCloseTo(quant.steps);
    expect(gpuData![8]).toBeCloseTo(quant.steps);

    // Outline
    expect(uniforms.get("u_outlineThickness")).toBeCloseTo(outline.thickness);
    expect(gpuData![9]).toBeCloseTo(outline.thickness);
    expect(uniforms.get("u_outlineSensitivity")).toBeCloseTo(outline.sensitivity);
    expect(gpuData![10]).toBeCloseTo(outline.sensitivity);
    expect(uniforms.get("u_outlineColor")).toEqual([
      outline.color.r,
      outline.color.g,
      outline.color.b,
    ]);
    expect(gpuData![16]).toBeCloseTo(outline.color.r);
    expect(gpuData![17]).toBeCloseTo(outline.color.g);
    expect(gpuData![18]).toBeCloseTo(outline.color.b);

    // Color Grading
    expect(uniforms.get("u_contrast")).toBeCloseTo(grade.contrast);
    expect(gpuData![20]).toBeCloseTo(grade.contrast);
    expect(uniforms.get("u_saturation")).toBeCloseTo(grade.saturation);
    expect(gpuData![21]).toBeCloseTo(grade.saturation);
    expect(uniforms.get("u_temperature")).toBeCloseTo(grade.temperature);
    expect(gpuData![22]).toBeCloseTo(grade.temperature);
    expect(uniforms.get("u_tint")).toBeCloseTo(grade.tint);
    expect(gpuData![23]).toBeCloseTo(grade.tint);
    expect(uniforms.get("u_liftColor")).toEqual([grade.lift.r, grade.lift.g, grade.lift.b]);
    expect(gpuData![24]).toBeCloseTo(grade.lift.r);
    expect(gpuData![25]).toBeCloseTo(grade.lift.g);
    expect(gpuData![26]).toBeCloseTo(grade.lift.b);
    expect(uniforms.get("u_gammaColor")).toEqual([grade.gamma.r, grade.gamma.g, grade.gamma.b]);
    expect(gpuData![27]).toBeCloseTo(grade.gamma.r);
    expect(gpuData![28]).toBeCloseTo(grade.gamma.g);
    expect(gpuData![29]).toBeCloseTo(grade.gamma.b);
    expect(uniforms.get("u_gainColor")).toEqual([grade.gain.r, grade.gain.g, grade.gain.b]);
    expect(gpuData![30]).toBeCloseTo(grade.gain.r);
    expect(gpuData![31]).toBeCloseTo(grade.gain.g);
    expect(gpuData![11]).toBeCloseTo(grade.gain.b);

    // Gravitational Lensing & Relativistic Spacetime Distortions
    expect(uniforms.get("u_singularityScreenPos")).toEqual([
      lensing.singularityScreenPos.x,
      lensing.singularityScreenPos.y,
      lensing.singularityScreenPos.z,
    ]);
    expect(gpuData![32]).toBeCloseTo(lensing.singularityScreenPos.x);
    expect(gpuData![33]).toBeCloseTo(lensing.singularityScreenPos.y);
    expect(gpuData![34]).toBeCloseTo(lensing.singularityScreenPos.z);
    expect(uniforms.get("u_lensingEventHorizon")).toBeCloseTo(lensing.eventHorizonRadius);
    expect(gpuData![35]).toBeCloseTo(lensing.eventHorizonRadius);
    expect(uniforms.get("u_lensingStrength")).toBeCloseTo(lensing.strength);
    expect(gpuData![36]).toBeCloseTo(lensing.strength);
    expect(uniforms.get("u_lensingSpaghetti")).toBeCloseTo(lensing.spaghettification);
    expect(gpuData![37]).toBeCloseTo(lensing.spaghettification);
    expect(uniforms.get("u_lensingBeaming")).toBeCloseTo(lensing.relativisticBeaming);
    expect(gpuData![38]).toBeCloseTo(lensing.relativisticBeaming);
    expect(uniforms.get("u_lensingRingGlow")).toBeCloseTo(lensing.ringGlowIntensity);
    expect(gpuData![39]).toBeCloseTo(lensing.ringGlowIntensity);

    // Flash overlay
    expect(uniforms.get("u_flashColor")).toEqual([flash.color.r, flash.color.g, flash.color.b]);
    expect(gpuData![40]).toBeCloseTo(flash.color.r);
    expect(gpuData![41]).toBeCloseTo(flash.color.g);
    expect(gpuData![42]).toBeCloseTo(flash.color.b);
    expect(uniforms.get("u_flashIntensity")).toBeCloseTo(flash.intensity);
    expect(gpuData![43]).toBeCloseTo(flash.intensity);

    // Light Shafts
    expect(uniforms.get("u_lightShaftsIntensity")).toBeCloseTo(shafts.intensity);
    expect(gpuData![44]).toBeCloseTo(shafts.intensity);
    expect(gpuData![45]).toBeCloseTo(shafts.density);
    expect(gpuData![46]).toBeCloseTo(0.0);
    expect(gpuData![47]).toBeCloseTo(0.0);
    expect(gpuData![48]).toBeCloseTo(shafts.color.r);
    expect(gpuData![49]).toBeCloseTo(shafts.color.g);
    expect(gpuData![50]).toBeCloseTo(shafts.color.b);
  });

  it("correctly propagates singularity sentinel (Z = -2 behind camera) to bypass lensing in both pipelines", () => {
    const group = new PostProcessingGroup();
    group.enabled = true;
    group.filterMode = 8;
    const lensing = group.get<GravitationalLensingElement>(
      PostProcessingEffectType.GRAVITATIONAL_LENSING,
    )!;
    // Sentinel from Camera.project indicating point is behind near plane
    lensing.singularityScreenPos.set(0.5, 0.5, -2.0);

    const { gl, uniforms } = createMockGL();
    const glPass = new PostProcessPassGL(gl, true);
    glPass.execute(gl, {} as WebGLTexture, group, null, null);

    const { device, getWrittenUniforms, makeRenderer } = createMockGPU();
    const gpuRenderer = makeRenderer(group);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const gpuPass = new PostProcessPass() as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ce = (device as any).__commandEncoder;
    gpuPass.execute(gpuRenderer, {}, ce, {}, new Float32Array(16), { x: 0, y: 0, z: 0 });

    const gpuData = getWrittenUniforms()!;
    expect(uniforms.get("u_singularityScreenPos")).toEqual([0.5, 0.5, -2.0]);
    expect(gpuData[32]).toBeCloseTo(0.5);
    expect(gpuData[33]).toBeCloseTo(0.5);
    expect(gpuData[34]).toBeCloseTo(-2.0);
  });
});
