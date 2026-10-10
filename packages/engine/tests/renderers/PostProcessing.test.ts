import { describe, expect, it, beforeAll } from "vitest";
import {
  PostProcessingGroup,
  ShaderRegistry,
  ToneMappingElement,
  VignetteElement,
  GrainElement,
} from "../../src/index.js";
import { PostProcessingEffectType } from "../../src/enums/index.js";
import { CoreShaderChunks } from "../../src/renderers/shaders/CoreShaderChunks.js";
import * as fs from "fs";
import * as path from "path";

describe("Post-Processing Shader Chunks & Groups", () => {
  beforeAll(async () => {
    await CoreShaderChunks.init();
  });

  it("should successfully initialize filterMode with default value 0", () => {
    const group = new PostProcessingGroup();
    expect(group.filterMode).toBe(0);

    group.filterMode = 3;
    expect(group.filterMode).toBe(3);
  });

  it("should initialize singularityScreenPos to default (0, 0, 1)", () => {
    const group = new PostProcessingGroup();
    expect(group.singularityScreenPos.x).toBe(0);
    expect(group.singularityScreenPos.y).toBe(0);
    expect(group.singularityScreenPos.z).toBe(1);

    group.singularityScreenPos.set(0.5, -0.2, 0.8);
    expect(group.singularityScreenPos.x).toBe(0.5);
    expect(group.singularityScreenPos.y).toBe(-0.2);
    expect(group.singularityScreenPos.z).toBe(0.8);
  });

  it("should register the post-processing filter chunks in ShaderRegistry", () => {
    const registry = ShaderRegistry.instance;

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
      process.cwd(),
      "packages/engine/src/renderers/post/shaders/PostProcess.frag.glsl",
    );
    const glslRaw = fs.readFileSync(glslPath, "utf-8");

    // Ensure placeholder strings exist before assembly
    expect(glslRaw).toContain("[FILTER_GLITCH_DISTORT]");
    expect(glslRaw).toContain("[FILTER_VHS_DISTORT]");
    expect(glslRaw).toContain("[FILTER_COLOR_GRADING]");

    const glslAssembled = ShaderRegistry.instance.assemble(glslRaw, "glsl300");

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
      process.cwd(),
      "packages/engine/src/renderers/post/shaders/PostProcess.frag.wgsl",
    );
    const wgslRaw = fs.readFileSync(wgslPath, "utf-8");

    // Ensure placeholder strings exist before assembly
    expect(wgslRaw).toContain("[FILTER_GLITCH_DISTORT]");
    expect(wgslRaw).toContain("[FILTER_VHS_DISTORT]");
    expect(wgslRaw).toContain("[FILTER_COLOR_GRADING]");

    const wgslAssembled = ShaderRegistry.instance.assemble(wgslRaw, "wgsl");

    // Ensure placeholders have been replaced and code injected
    expect(wgslAssembled).not.toContain("[FILTER_GLITCH_DISTORT]");
    expect(wgslAssembled).not.toContain("[FILTER_VHS_DISTORT]");
    expect(wgslAssembled).not.toContain("[FILTER_COLOR_GRADING]");
    expect(wgslAssembled).toContain("let glitchTime = u_time * 3.0;");
    expect(wgslAssembled).toContain("if (1u == u_filterMode)");
    expect(wgslAssembled).toContain("else if (6u == u_filterMode)");
    expect(wgslAssembled).toContain("else if (7u == u_filterMode)");
  });

  it("should correctly load settings from config and inject them into GLSL and WGSL source templates", () => {
    const group = new PostProcessingGroup();
    group.loadConfig({
      effects: {
        vignette: {
          enabled: true,
          offset: 0.123456,
          darkness: 0.789,
          roundness: 3.5,
        },
        toneMapping: {
          enabled: true,
          mode: 2,
          exposure: 1.5,
          gamma: 1.8,
        },
        grain: {
          enabled: true,
          intensity: 0.08,
        },
      },
    });

    const tm = group.get<ToneMappingElement>(PostProcessingEffectType.TONE_MAPPING)!;
    const vig = group.get<VignetteElement>(PostProcessingEffectType.VIGNETTE)!;
    const grain = group.get<GrainElement>(PostProcessingEffectType.GRAIN)!;

    expect(vig.enabled).toBe(true);
    expect(vig.offset).toBe(0.123456);
    expect(vig.darkness).toBe(0.789);
    expect(vig.roundness).toBe(3.5);
    expect(tm.enabled).toBe(true);
    expect(tm.mode).toBe(2);
    expect(tm.exposure).toBe(1.5);
    expect(tm.gamma).toBe(1.8);
    expect(grain.enabled).toBe(true);
    expect(grain.intensity).toBe(0.08);

    // Simulate WGSL string replacement in PostProcessPass -- only STRUCTURAL flags/modes are
    // baked as consts (see PostProcessPass.ts's _build()). Continuous tuning values (exposure,
    // vignette offset/darkness/roundness, grain intensity, ...) live in the DynUniforms buffer
    // instead and must never appear in the compiled shader text.
    const wgslPath = path.resolve(
      process.cwd(),
      "packages/engine/src/renderers/post/shaders/PostProcess.frag.wgsl",
    );
    const wgslSource = fs.readFileSync(wgslPath, "utf-8");
    let assembledWgsl = ShaderRegistry.instance.assemble(wgslSource, "wgsl");

    const tmEnabled = tm && tm.enabled;
    const vigEnabled = vig && vig.enabled;
    const grainEnabled = grain && grain.enabled;

    assembledWgsl = assembledWgsl.replace(
      "const u_toneMappingMode: u32 = 0u;",
      `const u_toneMappingMode: u32 = ${tmEnabled ? tm.mode : 0}u;`,
    );
    assembledWgsl = assembledWgsl.replace(
      "const u_vignetteEnabled: u32 = 0u;",
      `const u_vignetteEnabled: u32 = ${vigEnabled ? 1 : 0}u;`,
    );
    assembledWgsl = assembledWgsl.replace(
      "const u_grainEnabled: u32 = 0u;",
      `const u_grainEnabled: u32 = ${grainEnabled ? 1 : 0}u;`,
    );

    expect(assembledWgsl).toContain("const u_toneMappingMode: u32 = 2u;");
    expect(assembledWgsl).toContain("const u_vignetteEnabled: u32 = 1u;");
    expect(assembledWgsl).toContain("const u_grainEnabled: u32 = 1u;");
    // The continuous values themselves must never be baked as WGSL consts anymore.
    expect(assembledWgsl).not.toContain("u_vignetteOffset: f32 =");
    expect(assembledWgsl).not.toContain("u_exposure: f32 =");
    expect(assembledWgsl).not.toContain("u_grainIntensity: f32 =");

    // The whole point of this UBO refactor: two DIFFERENT continuous tuning configs must
    // assemble to the IDENTICAL WGSL text (only structural flags/modes affect it), so tuning
    // exposure/vignette/grain sliders never triggers a shader rebuild.
    const groupB = new PostProcessingGroup();
    groupB.loadConfig({
      effects: {
        vignette: { enabled: true, offset: 0.9, darkness: 0.1, roundness: 1.0 },
        toneMapping: { enabled: true, mode: 2, exposure: 3.3, gamma: 2.4 },
        grain: { enabled: true, intensity: 0.5 },
      },
    });
    let assembledWgslB = ShaderRegistry.instance.assemble(wgslSource, "wgsl");
    const tmB = groupB.get<ToneMappingElement>(PostProcessingEffectType.TONE_MAPPING)!;
    const vigB = groupB.get<VignetteElement>(PostProcessingEffectType.VIGNETTE)!;
    const grainB = groupB.get<GrainElement>(PostProcessingEffectType.GRAIN)!;
    assembledWgslB = assembledWgslB.replace(
      "const u_toneMappingMode: u32 = 0u;",
      `const u_toneMappingMode: u32 = ${tmB.enabled ? tmB.mode : 0}u;`,
    );
    assembledWgslB = assembledWgslB.replace(
      "const u_vignetteEnabled: u32 = 0u;",
      `const u_vignetteEnabled: u32 = ${vigB.enabled ? 1 : 0}u;`,
    );
    assembledWgslB = assembledWgslB.replace(
      "const u_grainEnabled: u32 = 0u;",
      `const u_grainEnabled: u32 = ${grainB.enabled ? 1 : 0}u;`,
    );
    expect(assembledWgslB).toBe(assembledWgsl);

    // Simulate GLSL string replacement in PostProcessPassGL
    const glslPath = path.resolve(
      process.cwd(),
      "packages/engine/src/renderers/post/shaders/PostProcess.frag.glsl",
    );
    const glslSource = fs.readFileSync(glslPath, "utf-8");
    let assembledGlsl = ShaderRegistry.instance.assemble(glslSource, "glsl300");

    assembledGlsl = assembledGlsl.replace(
      "uniform float u_exposure;",
      `#define u_exposure ${tmEnabled ? tm.exposure.toFixed(6) : "1.0"}`,
    );
    assembledGlsl = assembledGlsl.replace(
      "uniform float u_gamma;",
      `#define u_gamma ${tmEnabled ? tm.gamma.toFixed(6) : "2.2"}`,
    );
    assembledGlsl = assembledGlsl.replace(
      "uniform int u_toneMappingMode;",
      `#define u_toneMappingMode ${tmEnabled ? tm.mode : 0}`,
    );
    assembledGlsl = assembledGlsl.replace(
      "uniform int u_vignetteEnabled;",
      `#define u_vignetteEnabled ${vigEnabled ? 1 : 0}`,
    );
    assembledGlsl = assembledGlsl.replace(
      "uniform float u_vignetteOffset;",
      `#define u_vignetteOffset ${vig ? vig.offset.toFixed(6) : "0.8"}`,
    );
    assembledGlsl = assembledGlsl.replace(
      "uniform float u_vignetteDarkness;",
      `#define u_vignetteDarkness ${vig ? vig.darkness.toFixed(6) : "0.5"}`,
    );
    assembledGlsl = assembledGlsl.replace(
      "uniform float u_vignetteRoundness;",
      `#define u_vignetteRoundness ${vig ? vig.roundness.toFixed(6) : "2.0"}`,
    );
    assembledGlsl = assembledGlsl.replace(
      "uniform int u_grainEnabled;",
      `#define u_grainEnabled ${grainEnabled ? 1 : 0}`,
    );
    assembledGlsl = assembledGlsl.replace(
      "uniform float u_grainIntensity;",
      `#define u_grainIntensity ${grain ? grain.intensity.toFixed(6) : "0.05"}`,
    );

    expect(assembledGlsl).toContain("#define u_vignetteOffset 0.123456");
    expect(assembledGlsl).toContain("#define u_vignetteDarkness 0.789000");
    expect(assembledGlsl).toContain("#define u_vignetteRoundness 3.500000");
    expect(assembledGlsl).toContain("#define u_exposure 1.500000");
    expect(assembledGlsl).toContain("#define u_gamma 1.800000");
    expect(assembledGlsl).toContain("#define u_toneMappingMode 2");
    expect(assembledGlsl).toContain("#define u_grainIntensity 0.080000");
    expect(assembledGlsl).not.toContain("uniform float u_vignetteOffset;");
  });
});
