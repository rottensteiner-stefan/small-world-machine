import { CoreShaderChunks } from "../../src/renderers/shaders/CoreShaderChunks.js";
import { ShaderRegistry } from "../../src/renderers/shaders/ShaderRegistry.js";

describe("SDF & Raymarching Shader Chunks", () => {
  beforeAll(async () => {
    await CoreShaderChunks.init();
  });

  it("should register SDF_MATH chunk for GLSL 300 and GLSL 100", () => {
    const registry = ShaderRegistry.instance;
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
    const registry = ShaderRegistry.instance;
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

  it("should assemble SDF math without syntax errors in custom shader strings", () => {
    const registry = ShaderRegistry.instance;
    const glslChunk = registry.getChunk("SDF_MATH", "glsl300")!;
    const wgslChunk = registry.getChunk("WGSL_SDF_MATH", "wgsl")!;

    // Test replacement in a mock shader template
    const glslTemplate = `#version 300 es\nprecision highp float;\n[SDF_MATH]\nvoid main() { float d = sdfSphere(vec3(0.0), 1.0); }`;
    const assembledGLSL = glslTemplate.replace("[SDF_MATH]", glslChunk);
    expect(assembledGLSL).toContain("float sdfSphere");
    expect(assembledGLSL).not.toContain("[SDF_MATH]");

    const wgslTemplate = `[WGSL_SDF_MATH]\nfn test() { let d = sdfSphere(vec3f(0.0), 1.0); }`;
    const assembledWGSL = wgslTemplate.replace("[WGSL_SDF_MATH]", wgslChunk);
    expect(assembledWGSL).toContain("fn sdfSphere");
    expect(assembledWGSL).not.toContain("[WGSL_SDF_MATH]");
  });
});

describe("WebGPU DeviceCaps Limits & Hardening", () => {
  it("should have correct spec guaranteed minimums for WebGPU limits", async () => {
    const { DeviceCaps, DeviceLimit } = await import("../../src/core/DeviceCaps.js");
    expect(
      DeviceCaps.getGuaranteedMinimum(DeviceLimit.WEBGPU_MAX_STORAGE_BUFFER_BINDING_SIZE),
    ).toBe(134217728);
    expect(
      DeviceCaps.getGuaranteedMinimum(DeviceLimit.WEBGPU_MAX_COMPUTE_WORKGROUP_STORAGE_SIZE),
    ).toBe(16384);
    expect(
      DeviceCaps.getGuaranteedMinimum(DeviceLimit.WEBGPU_MAX_UNIFORM_BUFFER_BINDING_SIZE),
    ).toBe(65536);
    expect(DeviceCaps.getGuaranteedMinimum(DeviceLimit.WEBGPU_MAX_TEXTURE_DIMENSION_2D)).toBe(8192);
  });

  it("should update DeviceCaps limits when provided with WebGPU device limits", async () => {
    const { DeviceCaps, DeviceLimit } = await import("../../src/core/DeviceCaps.js");
    DeviceCaps.updateLimits({
      webgpuMaxStorageBufferBindingSize: 268435456,
      webgpuMaxComputeWorkgroupStorageSize: 32768,
    });

    expect(
      DeviceCaps.getLimit(DeviceLimit.WEBGPU_MAX_STORAGE_BUFFER_BINDING_SIZE),
    ).toBeGreaterThanOrEqual(268435456);
    expect(
      DeviceCaps.getLimit(DeviceLimit.WEBGPU_MAX_COMPUTE_WORKGROUP_STORAGE_SIZE),
    ).toBeGreaterThanOrEqual(32768);
  });

  it("should correctly report isContextLost on WebGPURenderer", async () => {
    const { WebGPURenderer } = await import("../../src/renderers/WebGPU/WebGPURenderer.js");
    const renderer = new WebGPURenderer();
    expect(renderer.isContextLost).toBe(false);

    // Trigger destroy
    renderer.destroy();
    expect(renderer.isContextLost).toBe(true);
  });
});
