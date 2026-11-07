import { describe, expect, it } from "vitest";
import { readSource } from "../math/_shaderScalar.js";

// A03/G01 wiring on the WebGL1 tier: the uniforms the shaders read must be declared and uploaded.
// (Uniform plumbing is legitimately a text contract; the math lives in EnvBrdfApproxGl1.test.ts.)

const GL1 = "packages/engine/src/renderers/shaders/source/web_gl1/chunks/";
const MAT = "packages/engine/src/core/materials/";

describe("WebGL1 forward exposure + env intensity wiring", () => {
  const lights = readSource(`${GL1}lights.frag.glsl`);
  const renderer = readSource("packages/engine/src/renderers/WebGL1/WebGL1Renderer.ts");

  it("declares and uploads u_exposure / u_envIntensity", () => {
    expect(lights).toMatch(/uniform float u_exposure;/);
    expect(lights).toMatch(/uniform float u_envIntensity;/);
    expect(renderer).toMatch(/u\.get\("u_exposure"\)/);
    expect(renderer).toMatch(/postProcessing\.enabled \? 1\.0/);
    expect(renderer).toMatch(/u\.get\("u_envIntensity"\)/);
    expect(renderer).toContain("scene.environmentIntensity");
  });

  it("applies exposure BEFORE the forward tone curve on every GL1 forward tail", () => {
    for (const file of [
      `${GL1}light_calc_pbr.frag.glsl`,
      `${MAT}surface/shaders/Standard.frag.glsl100`,
      `${MAT}glass/shaders/Glass.frag.glsl100`,
      `${MAT}glass/shaders/Frostglass.frag.glsl100`,
    ]) {
      const src = readSource(file);
      expect(src, file).toMatch(
        /color \*= u_exposure;\s*\n(\s*\/\/[^\n]*\n)*\s*color = forwardToneMap\(color\);/,
      );
    }
  });

  it("clamps the analytic env BRDF so the fit can never subtract light", () => {
    expect(readSource(`${GL1}pbr_math.frag.glsl`)).toContain(
      "max(vec2(-1.04, 1.04) * a004 + r.zw, vec2(0.0))",
    );
  });

  it("wires the optional BRDF LUT: flag only with scene LUT + probe, bound from scene.brdfLUT, analytic fallback kept", () => {
    expect(renderer).toContain(
      'if (scene.brdfLUT && texs["u_envMap"]) flags.push(ShaderFlag.BRDF_LUT);',
    );
    expect(renderer).toContain('uniformName === "u_brdfLUT" ? scene.brdfLUT');
    const pbr = readSource(`${GL1}light_calc_pbr.frag.glsl`);
    expect(pbr).toMatch(
      /#ifdef USE_BRDF_LUT[\s\S]*texture2D\(u_brdfLUT[\s\S]*#else[\s\S]*EnvBRDFApprox\(roughness/,
    );
    expect(lights).toMatch(/#ifdef USE_BRDF_LUT\s*\n\s*uniform sampler2D u_brdfLUT;/);
  });
});
