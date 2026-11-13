import { describe, expect, it, beforeAll } from "vitest";
import { ShaderRegistry } from "../../src/index.js";
import { CoreShaderChunks } from "../../src/renderers/shaders/CoreShaderChunks.js";
import * as fs from "fs";
import * as path from "path";

// Repo root derived from this file, so the test passes from any vitest cwd.
const REPO_ROOT = path.resolve(__dirname, "../../../..");

const testShaderRegistry = new ShaderRegistry();

describe("Post-Processing Shader Chunks & Groups", () => {
  beforeAll(async () => {
    await CoreShaderChunks.init(testShaderRegistry);
  });

  it("should register the post-processing filter chunks in ShaderRegistry", () => {
    const registry = testShaderRegistry;

    const glitchGLSL = registry.getChunk("FILTER_GLITCH_DISTORT", "glsl300");
    const glitchWGSL = registry.getChunk("FILTER_GLITCH_DISTORT", "wgsl");

    expect(glitchGLSL).toBeDefined();
    expect(glitchWGSL).toBeDefined();
    expect(glitchGLSL).toContain("glitchTime");
    expect(glitchWGSL).toContain("let glitchTime");

    const vhsGLSL = registry.getChunk("FILTER_VHS_DISTORT", "glsl300");
    const vhsWGSL = registry.getChunk("FILTER_VHS_DISTORT", "wgsl");

    expect(vhsGLSL).toBeDefined();
    expect(vhsWGSL).toBeDefined();
    expect(vhsGLSL).toContain("jitterTime");
    expect(vhsWGSL).toContain("let jitterTime");

    const gradingGLSL = registry.getChunk("FILTER_COLOR_GRADING", "glsl300");
    const gradingWGSL = registry.getChunk("FILTER_COLOR_GRADING", "wgsl");

    expect(gradingGLSL).toBeDefined();
    expect(gradingWGSL).toBeDefined();
    expect(gradingGLSL).toContain("u_filterMode");
    expect(gradingWGSL).toContain("u_filterMode");
  });

  it("should assemble GLSL post-processing fragment shader resolving all chunks", () => {
    const glslPath = path.resolve(
      REPO_ROOT,
      "packages/engine/src/renderers/post/shaders/PostProcess.frag.glsl",
    );
    const glslRaw = fs.readFileSync(glslPath, "utf-8");

    // Ensure placeholder strings exist before assembly
    expect(glslRaw).toContain("[FILTER_GLITCH_DISTORT]");
    expect(glslRaw).toContain("[FILTER_VHS_DISTORT]");
    expect(glslRaw).toContain("[FILTER_COLOR_GRADING]");

    const glslAssembled = testShaderRegistry.assemble(glslRaw, "glsl300");

    // Ensure placeholders have been replaced and code injected
    expect(glslAssembled).not.toContain("[FILTER_GLITCH_DISTORT]");
    expect(glslAssembled).not.toContain("[FILTER_VHS_DISTORT]");
    expect(glslAssembled).not.toContain("[FILTER_COLOR_GRADING]");
    expect(glslAssembled).toContain("glitchTime = u_time * 3.0;");
    expect(glslAssembled).toContain("if (u_filterMode == 1)");
    expect(glslAssembled).toContain("else if (u_filterMode == 6)");
    expect(glslAssembled).toContain("else if (u_filterMode == 7)");
  });

  it("should assemble WGSL post-processing fragment shader resolving all chunks", () => {
    const wgslPath = path.resolve(
      REPO_ROOT,
      "packages/engine/src/renderers/post/shaders/PostProcess.frag.wgsl",
    );
    const wgslRaw = fs.readFileSync(wgslPath, "utf-8");

    // Ensure placeholder strings exist before assembly
    expect(wgslRaw).toContain("[FILTER_GLITCH_DISTORT]");
    expect(wgslRaw).toContain("[FILTER_VHS_DISTORT]");
    expect(wgslRaw).toContain("[FILTER_COLOR_GRADING]");

    const wgslAssembled = testShaderRegistry.assemble(wgslRaw, "wgsl");

    // Ensure placeholders have been replaced and code injected
    expect(wgslAssembled).not.toContain("[FILTER_GLITCH_DISTORT]");
    expect(wgslAssembled).not.toContain("[FILTER_VHS_DISTORT]");
    expect(wgslAssembled).not.toContain("[FILTER_COLOR_GRADING]");
    expect(wgslAssembled).toContain("let glitchTime = u_time * 3.0;");
    expect(wgslAssembled).toContain("if (1u == u_filterMode)");
    expect(wgslAssembled).toContain("else if (6u == u_filterMode)");
    expect(wgslAssembled).toContain("else if (7u == u_filterMode)");
  });
});
