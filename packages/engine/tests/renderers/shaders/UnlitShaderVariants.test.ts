import { describe, expect, it, beforeAll } from "vitest";
import { StandardMaterial } from "../../../src/core/materials/surface/StandardMaterial.js";
import {
  ShaderBootstrap,
  ShaderRegistry,
  preprocessConditionals,
} from "../../../src/renderers/shaders/index.js";

let reg: ShaderRegistry;

beforeAll(async () => {
  reg = new ShaderRegistry();
  await ShaderBootstrap.init(reg);
});

/**
 * The `USE_UNLIT` branch (KHR_materials_unlit, `StandardMaterial.unlit`) is guarded in all three
 * dialect fragments. WGSL has no native preprocessor, so the JS `preprocessConditionals` pass IS
 * its compile gate: both flag states must resolve with zero leftover directives, and the unlit
 * variant must not reference lighting-chunk locals (e.g. the transmission block's `F0`) that
 * would not exist in the flat-color branch. The glsl300/glsl100 variants are verified structurally
 * here and compile-tested by the production showcase gate (real GLSL preprocessor).
 */
describe("USE_UNLIT shader variant", () => {
  const wgslDef = (): string => new StandardMaterial().getShaderDefinition().sources.wgsl!;

  it("resolves every WGSL directive for both USE_UNLIT states (the WGSL compile gate)", () => {
    for (const useUnlit of [false, true]) {
      const out = preprocessConditionals(
        reg.assemble(wgslDef(), "wgsl"),
        useUnlit ? ["USE_UNLIT"] : [],
      );
      expect(out).not.toMatch(/^\s*#(ifdef|ifndef|else|endif)\b/gm);
    }
  });

  it("keeps the WGSL unlit variant disjoint from the lighting/transmission code", () => {
    const lit = preprocessConditionals(reg.assemble(wgslDef(), "wgsl"), []);
    const unlit = preprocessConditionals(reg.assemble(wgslDef(), "wgsl"), ["USE_UNLIT"]);
    expect(lit).toContain("var color = ambient + Lo;");
    expect(unlit).toContain("var color = albedo;");
    // The transmission block is moved into the lit `#else`; excluding it under USE_UNLIT removes
    // its dependency on the chunk-local `F0` that would otherwise break the flat-color branch.
    expect(unlit).not.toContain("refrDir");
    expect(unlit).not.toContain("var color = ambient + Lo;");
  });

  it("guards the glsl300 fragment with a well-formed USE_UNLIT flat-color branch", () => {
    const src = new StandardMaterial().getShaderDefinition().sources.glsl300!.fs;
    expect(src).toContain("#ifdef USE_UNLIT");
    expect(src).toContain("#else\n    [LIGHT_CALC_PBR]");
    // A02: the planar-reflection blend moved OUT of this material into the LIGHT_CALC_PBR chunk
    // (whose USE_REFLECTION_MAP block references chunk-local V/F0). The chunk sits inside the lit
    // `#else` branch, so the flat-color variant can no longer reach the blend -- assert both sides:
    // no inline blend in the material source, and the chunk still carries its own behind a
    // USE_REFLECTION_MAP gate that only reflection-enabled variants define. The u_useReflectionMap
    // uniform declaration stays in the material (the chunk's blend reads it on this tier).
    expect(src).not.toContain("if (u_useReflectionMap > 0.5)");
    expect(src).toContain("uniform float u_useReflectionMap;");
    const chunk = reg.getChunk("LIGHT_CALC_PBR", "glsl300");
    expect(chunk).toBeDefined();
    expect(chunk).toContain("#ifdef USE_REFLECTION_MAP");
    expect(chunk).toContain("if (u_useReflectionMap > 0.5)");
    expect(src).toContain("vec3 color = albedo * u_exposure;");
  });

  it("guards the glsl100 fragment with a well-formed USE_UNLIT flat-color branch", () => {
    const src = new StandardMaterial().getShaderDefinition().sources.glsl100!.fs;
    expect(src).toContain("#ifdef USE_UNLIT");
    expect(src).toContain("#else\n    [LIGHT_CALC_PBR]");
    // WebGL1 has no post-processing pass: the unlit branch applies the tier's hardcoded
    // forward-path contract (Reinhard + sRGB encode) exactly like the lit chunk.
    expect(src).toContain("color = linearToSRGB(color);");
    expect(src).toContain("gl_FragColor = vec4(color, u_color.a * texColor.a);");
  });
});
