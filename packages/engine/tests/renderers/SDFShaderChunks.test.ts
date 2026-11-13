import { CoreShaderChunks } from "../../src/renderers/shaders/CoreShaderChunks.js";
import { ShaderRegistry } from "../../src/renderers/shaders/ShaderRegistry.js";

const testShaderRegistry = new ShaderRegistry();

describe("SDF & Raymarching Shader Chunks", () => {
  beforeAll(async () => {
    await CoreShaderChunks.init(testShaderRegistry);
  });

  it("should register SDF_MATH chunk for GLSL 300 and GLSL 100", () => {
    const registry = testShaderRegistry;
    const glsl300 = registry.getChunk("SDF_MATH", "glsl300");
    const glsl100 = registry.getChunk("SDF_MATH", "glsl100");

    expect(glsl300).toBeDefined();
    expect(glsl100).toBeDefined();

    // Verify key functions exist in GLSL
    expect(glsl300).toContain("float sdfSphere(vec3 p, float r)");
    expect(glsl300).toContain("float sdfBox(vec3 p, vec3 b)");
    expect(glsl300).toContain("float sdfTorus(vec3 p, vec2 t)");
    expect(glsl300).toContain("float opSmoothUnion(float d1, float d2, float k)");
    expect(glsl300).toContain("vec3 opTwist(vec3 p, float k)");
    expect(glsl300).toContain("vec3 opRepeat(vec3 p, vec3 c)");
  });

  it("should register WGSL_SDF_MATH chunk for WebGPU", () => {
    const registry = testShaderRegistry;
    const wgsl = registry.getChunk("WGSL_SDF_MATH", "wgsl");

    expect(wgsl).toBeDefined();

    // Verify key functions exist in WGSL
    expect(wgsl).toContain("fn sdfSphere(p: vec3f, r: f32) -> f32");
    expect(wgsl).toContain("fn sdfBox(p: vec3f, b: vec3f) -> f32");
    expect(wgsl).toContain("fn sdfTorus(p: vec3f, t: vec2f) -> f32");
    expect(wgsl).toContain("fn opSmoothUnion(d1: f32, d2: f32, k: f32) -> f32");
    expect(wgsl).toContain("fn opTwist(p: vec3f, k: f32) -> vec3f");
    expect(wgsl).toContain("fn opRepeat(p: vec3f, c: vec3f) -> vec3f");
  });
});

describe("WebGPU DeviceCaps Limits & Hardening", () => {
  // The first dynamic import transforms the whole renderer module graph (shader `?raw` imports
  // included); under the parallel full suite that alone can exceed vitest's default 5 s.
  it("should correctly report isContextLost on WebGPURenderer", { timeout: 30000 }, async () => {
    const { WebGPURenderer } = await import("../../src/renderers/WebGPU/WebGPURenderer.js");
    const renderer = new WebGPURenderer();
    expect(renderer.isContextLost).toBe(false);

    // Trigger destroy
    renderer.destroy();
    expect(renderer.isContextLost).toBe(true);
  });
});
