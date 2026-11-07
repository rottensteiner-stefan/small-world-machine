import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { StandardMaterial } from "../../../src/core/materials/surface/StandardMaterial.js";

const SRC_DIR = join(__dirname, "../../../src");
const read = (relative: string): string => readFileSync(join(SRC_DIR, relative), "utf8");

/** Khronos KHR_materials_anisotropy D (Burley), exactly as written in the shaders' `specularAnisotropic`. */
function dAnisotropic(dotTH: number, dotBH: number, dotNH: number, at: number, ab: number): number {
  const a2 = at * ab;
  const f = [ab * dotTH, at * dotBH, a2 * dotNH];
  const w2 = a2 / Math.max(f[0]! * f[0]! + f[1]! * f[1]! + f[2]! * f[2]!, 1e-8);
  return (a2 * w2 * w2) / Math.PI;
}

/** The engine's isotropic GGX (`D_GGX` in pbr_math): perceptual roughness in, alpha = roughness^2. */
function dGgx(dotNH: number, roughness: number): number {
  const a = roughness * roughness;
  const a2 = a * a;
  const denom = dotNH * dotNH * (a2 - 1) + 1;
  return a2 / (Math.PI * denom * denom);
}

describe("KHR_materials_anisotropy: StandardMaterial lane u_matParam15", () => {
  it("is off at the defaults (strength 0, no compile flag)", () => {
    const manifest = new StandardMaterial().getRenderManifest();
    const lane = (manifest.properties as Record<string, number[]>)["u_matParam15"]!;

    expect(lane[0]).toBe(0);
    expect(manifest.flags).not.toContain("USE_ANISOTROPY");
  });

  it("packs strength with the CPU-folded cos/sin of the rotation and sets the compile flag", () => {
    const material = new StandardMaterial({
      anisotropyStrength: 0.6,
      anisotropyRotation: Math.PI / 3,
    });
    const manifest = material.getRenderManifest();
    const lane = (manifest.properties as Record<string, number[]>)["u_matParam15"]!;

    expect(lane[0]).toBeCloseTo(0.6);
    expect(lane[1]).toBeCloseTo(Math.cos(Math.PI / 3));
    expect(lane[2]).toBeCloseTo(Math.sin(Math.PI / 3));
    expect(manifest.flags).toContain("USE_ANISOTROPY");
  });

  it("re-disables the lane and flag when the strength returns to 0", () => {
    const material = new StandardMaterial({ anisotropyStrength: 0.4 });
    material.getRenderManifest();
    material.anisotropyStrength = 0;
    const manifest = material.getRenderManifest();

    expect((manifest.properties as Record<string, number[]>)["u_matParam15"]![0]).toBe(0);
    expect(manifest.flags).not.toContain("USE_ANISOTROPY");
  });
});

describe("KHR_materials_anisotropy: BRDF math", () => {
  it("reduces to the engine's isotropic GGX when both alphas are equal", () => {
    for (const roughness of [0.2, 0.5, 0.9]) {
      const alpha = roughness * roughness;
      for (const dotNH of [0.4, 0.8, 0.99]) {
        const sinNH = Math.sqrt(1 - dotNH * dotNH);

        expect(dAnisotropic(sinNH, 0, dotNH, alpha, alpha)).toBeCloseTo(dGgx(dotNH, roughness), 8);
      }
    }
  });

  it("is a normalised distribution: the projected D integrates to 1 over the hemisphere", () => {
    const [at, ab] = [0.45, 0.12];
    const steps = 700;
    let integral = 0;
    for (let i = 0; i < steps; i++) {
      const theta = ((i + 0.5) / steps) * (Math.PI / 2);
      for (let j = 0; j < steps; j++) {
        const phi = ((j + 0.5) / steps) * 2 * Math.PI;
        const dotNH = Math.cos(theta);
        const sinTheta = Math.sin(theta);
        const dotTH = sinTheta * Math.cos(phi);
        const dotBH = sinTheta * Math.sin(phi);
        integral +=
          dAnisotropic(dotTH, dotBH, dotNH, at, ab) *
          dotNH *
          sinTheta *
          (Math.PI / 2 / steps) *
          ((2 * Math.PI) / steps);
      }
    }

    expect(integral).toBeCloseTo(1, 1);
  });

  it("stretches the highlight along the rougher axis (alpha_t > alpha_b)", () => {
    const [at, ab] = [0.6, 0.1];
    const offAxisT = dAnisotropic(0.3, 0, Math.sqrt(1 - 0.09), at, ab);
    const offAxisB = dAnisotropic(0, 0.3, Math.sqrt(1 - 0.09), at, ab);

    expect(offAxisT).toBeGreaterThan(offAxisB);
  });
});

describe("KHR_materials_anisotropy: shader parity across the three tiers", () => {
  const chunks: ReadonlyArray<readonly [string, string, number]> = [
    ["WGSL", "renderers/shaders/source/web_gpu/chunks/lighting_pbr.wgsl", 4],
    ["WebGL2", "renderers/shaders/source/web_gl2/chunks/light_calc_pbr.frag.glsl", 4],
    ["WebGL1", "renderers/shaders/source/web_gl1/chunks/light_calc_pbr.frag.glsl", 3],
  ];

  for (const [tier, file, lightSites] of chunks) {
    it(`${tier}: every direct-light specular term has the anisotropic branch (${lightSites} sites)`, () => {
      const source = read(file);

      expect(source.match(/specularAnisotropic\(/g)).toHaveLength(lightSites);
      expect(
        source.match(
          /F \* specularAnisotropic\(anisoT, anisoB, V, L, H, dotNL, dotNV, dotNH, anisoAlphaT, anisoAlpha\)/g,
        ),
      ).toHaveLength(lightSites);
    });

    it(`${tier}: the IBL specular lookup uses the bent normal`, () => {
      expect(read(file)).toContain(
        "anisotropyBentNormal(anisoB, V, N, anisotropyStrength, roughness)",
      );
    });
  }

  it("every tier compiles the anisotropy setup only behind USE_ANISOTROPY (no runtime gate left)", () => {
    for (const [, file] of chunks) {
      const source = read(file);

      expect(source).toContain("#ifdef USE_ANISOTROPY");
      expect(source).not.toContain("anisotropyEnabled");
    }
    expect(read(chunks[0]![1])).toContain("let anisotropyStrength = obj.matParam15.x;");
    expect(read(chunks[1]![1])).toContain("float anisotropyStrength = u_matParam15.x;");
    expect(read(chunks[2]![1])).toContain("float anisotropyStrength = u_matParam15.x;");
  });

  it("the Decal program, sharing the WebGL2 chunk, never references the anisotropy lane", () => {
    expect(read("core/materials/surface/shaders/Decal.frag.glsl")).not.toContain("u_matParam15");
  });

  it("Standard declares the lane (gated on WebGL2, plain on WebGL1)", () => {
    expect(read("core/materials/surface/shaders/Standard.frag.glsl")).toMatch(
      /#ifdef USE_ANISOTROPY[\s\S]*uniform vec4 u_matParam15;/,
    );
    expect(read("core/materials/surface/shaders/Standard.frag.glsl100")).toContain(
      "uniform vec4 u_matParam15;",
    );
  });

  const mathFiles: ReadonlyArray<readonly [string, string]> = [
    ["WGSL", "renderers/shaders/source/web_gpu/chunks/pbr_math.wgsl"],
    ["WebGL2", "renderers/shaders/source/web_gl2/chunks/pbr_math.frag.glsl"],
    ["WebGL1", "renderers/shaders/source/web_gl1/chunks/pbr_math.frag.glsl"],
  ];

  for (const [tier, file] of mathFiles) {
    it(`${tier}: the Burley D and the height-correlated V match the Khronos formulas`, () => {
      const source = read(file);

      expect(source).toMatch(/a2 \* w2 \* w2 \/ 3\.14159265359/);
      expect(source).toMatch(
        /dotNL \* length\(\w*(vec3f?)\(at \* dot\(T, V\), ab \* dot\(B, V\), dotNV\)\)/,
      );
      expect(source).toMatch(
        /dotNV \* length\(\w*(vec3f?)\(at \* dot\(T, L\), ab \* dot\(B, L\), dotNL\)\)/,
      );
    });
  }
});

describe("anisotropyBentNormal degenerate case (V parallel to B)", () => {
  const strip = (src: string): string =>
    src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const tiers: ReadonlyArray<readonly [string, string, RegExp]> = [
    [
      "WGSL",
      "renderers/shaders/source/web_gpu/chunks/pbr_math.wgsl",
      /select\(N, bentRaw \* inverseSqrt\(bentLen2\), bentLen2 > 1e-12\)/,
    ],
    [
      "WebGL2",
      "renderers/shaders/source/web_gl2/chunks/pbr_math.frag.glsl",
      /bentLen2 > 1e-12 \? bentRaw \* inversesqrt\(bentLen2\) : N/,
    ],
    [
      "WebGL1",
      "renderers/shaders/source/web_gl1/chunks/pbr_math.frag.glsl",
      /bentLen2 > 1e-12 \? bentRaw \* inversesqrt\(bentLen2\) : N/,
    ],
  ];

  for (const [tier, file, guard] of tiers) {
    it(`${tier}: the bent normal never normalizes the zero vector (falls back to N)`, () => {
      const source = strip(read(file));
      const fn = source.slice(source.indexOf("anisotropyBentNormal("));

      expect(fn).toMatch(guard);
      expect(fn.slice(0, fn.indexOf("return"))).not.toMatch(
        /normalize\(cross\(cross\(B, V\), B\)\)/,
      );
    });
  }
});
