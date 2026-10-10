import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";

// Regression for the Showcase 29 WebGL2 darkness bug: the vertex shader replaced the normal with
// (0, 1, 0) when the TRANSFORMED normal's squared length fell below 0.0001. Meshes with a small
// world scale (Sponza: 0.008 -> |N|^2 = 6.4e-5) therefore lost almost every normal to +Y, so
// ceilings and walls got no point-light contribution while WebGL1/WebGPU (no such threshold)
// rendered correctly. The fallback must key off the LOCAL vertex normal, whose length is
// independent of the model matrix.

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), "utf-8");
}

const VERTEX_CHUNK =
  "packages/engine/src/renderers/shaders/source/web_gl2/chunks/base_vertex_main.vert.glsl";

describe("WebGL2 vertex normal fallback", () => {
  it("tests the local normal, not only the model-matrix-scaled one, for the +Y fallback", () => {
    const source = read(VERTEX_CHUNK);
    expect(source).toMatch(/dot\(localNormal,\s*localNormal\)\s*<\s*0\.0001/);
  });

  it("never compares the transformed normal's squared length against a scale-sensitive threshold", () => {
    const source = read(VERTEX_CHUNK);
    const comparisons = [
      ...source.matchAll(/dot\(computedNormal,\s*computedNormal\)\s*<\s*([0-9.eE+-]+)/g),
    ];
    for (const match of comparisons) {
      // Anything above ~1e-10 would already misfire for a mesh scaled to 0.001 (|N|^2 = 1e-6).
      expect(Number(match[1])).toBeLessThanOrEqual(1e-10);
    }
  });

  it("still normalizes the transformed normal afterwards", () => {
    expect(read(VERTEX_CHUNK)).toContain("v_normal = normalize(computedNormal);");
  });
});

// Regression for the WebGPU Bloom rectangles in Showcase 29: Sponza albedo x tint exceeds 1, which
// pushed F0 above 1 and made kD = (1 - kS) * (1 - metallic) negative. The negative R channel then
// went through pow() in the gamma step and became NaN; Bloom's mip chain smeared that NaN into
// grid-aligned rectangles. F0 must stay inside [0, 1] in every PBR path.
describe("PBR F0 stays within [0, 1]", () => {
  const cases: Array<[string, RegExp]> = [
    [
      "packages/engine/src/renderers/shaders/source/web_gpu/chunks/lighting_pbr.wgsl",
      /var F0 = clamp\(mix\(vec3f\(f0_dielectric\), albedo, metallic\), vec3f\(0\.0\), vec3f\(1\.0\)\);/,
    ],
    [
      "packages/engine/src/renderers/shaders/source/web_gl2/chunks/light_calc_pbr.frag.glsl",
      /F0 = clamp\(mix\(F0, albedo, metallic\), vec3\(0\.0\), vec3\(1\.0\)\);/,
    ],
    [
      "packages/engine/src/renderers/shaders/source/web_gl1/chunks/light_calc_pbr.frag.glsl",
      /F0 = clamp\(mix\(F0, albedo, metallic\), vec3\(0\.0\), vec3\(1\.0\)\);/,
    ],
  ];

  for (const [file, pattern] of cases) {
    it(`${file} clamps the metallic mix`, () => {
      expect(read(file)).toMatch(pattern);
    });
  }
});
