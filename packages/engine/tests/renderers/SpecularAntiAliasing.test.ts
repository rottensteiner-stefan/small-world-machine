import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";

// ADR 0051: geometric specular anti-aliasing (Tokuyoshi & Kaplanyan 2019, Filament's normal
// filtering) widens the GGX roughness by the screen-space variance of the shading normal on every
// tier. Source guards -- vitest has no shader compiler; the browser captures compile the programs.

const ROOT = path.resolve(__dirname, "../../../..");
const SRC = "packages/engine/src/renderers/shaders/source";

function read(relative: string): string {
  return fs.readFileSync(path.join(ROOT, relative), "utf-8");
}

const TIERS = [
  {
    tier: "WebGPU",
    math: `${SRC}/web_gpu/chunks/pbr_math.wgsl`,
    lighting: `${SRC}/web_gpu/chunks/lighting_pbr.wgsl`,
    normalLine: "let N = normalize(TBN * rawNormal);",
    derivative: "dpdx(n)",
  },
  {
    tier: "WebGL2",
    math: `${SRC}/web_gl2/chunks/pbr_math.frag.glsl`,
    lighting: `${SRC}/web_gl2/chunks/light_calc_pbr.frag.glsl`,
    normalLine: "N = normalize(N);",
    derivative: "dFdx(n)",
  },
  {
    tier: "WebGL1",
    math: `${SRC}/web_gl1/chunks/pbr_math.frag.glsl`,
    lighting: `${SRC}/web_gl1/chunks/light_calc_pbr.frag.glsl`,
    normalLine: "vec3 N = normalize(v_tbn * rawNormal);",
    derivative: "dFdx(n)",
  },
];

describe("geometric specular anti-aliasing (ADR 0051)", () => {
  for (const t of TIERS) {
    it(`${t.tier}: the filter uses the Filament kernel (variance 0.15, threshold 0.2) on normal derivatives`, () => {
      const math = read(t.math);
      expect(math).toContain("SPECULAR_AA_VARIANCE");
      expect(math).toMatch(/SPECULAR_AA_VARIANCE[^=]*=\s*0\.15/);
      expect(math).toMatch(/SPECULAR_AA_THRESHOLD[^=]*=\s*0\.2\b/);
      expect(math).toContain(t.derivative);
      expect(math).toContain("sqrt(sqrt(clamp(r * r + kernelRoughness, 0.0, 1.0)))");
      // Toksvig term from the mipmapped normal length, 8-bit quantisation tolerance 0.99
      expect(math).toContain("normalLength / 0.99");
      expect(math).toContain("(1.0 - nl * nl) / (3.0 * nl - nl * nl * nl)");
    });

    it(`${t.tier}: the lighting chunk filters roughness once, after the final shading normal`, () => {
      const lighting = read(t.lighting);
      const filter = lighting.indexOf(
        "roughness = specularAntiAliasing(roughness, N, normalMapLength, ",
      );
      expect(filter).toBeGreaterThan(-1);
      expect(lighting.indexOf("roughness = specularAntiAliasing", filter + 1)).toBe(-1);
      expect(filter).toBeGreaterThan(lighting.lastIndexOf(t.normalLine, filter));
      // every specular term reads the filtered value
      expect(lighting.indexOf("D_GGX(")).toBeGreaterThan(filter);
    });
  }

  it("WebGPU materials that include the lighting chunk declare a mutable roughness", () => {
    for (const file of [
      "packages/engine/src/core/materials/surface/shaders/Standard.frag.wgsl",
      "packages/engine/src/core/materials/surface/shaders/Decal.frag.wgsl",
    ]) {
      expect(read(file)).toContain("var roughness = ");
    }
  });

  it("WebGL1 enables OES_standard_derivatives and keeps an unfiltered fallback", () => {
    expect(read(`${SRC}/web_gl1/base.frag.glsl`)).toMatch(
      /^#ifdef GL_OES_standard_derivatives\n#extension GL_OES_standard_derivatives : enable/,
    );
    expect(read(`${SRC}/web_gl1/chunks/pbr_math.frag.glsl`)).toContain("#else");
    const renderer = read("packages/engine/src/renderers/WebGL1/WebGL1Renderer.ts");
    expect(renderer.match(/getExtension\("OES_standard_derivatives"\)/g)?.length).toBe(2);
  });
});
