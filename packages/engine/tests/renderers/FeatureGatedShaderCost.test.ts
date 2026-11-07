import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ShaderFlag } from "../../src/enums/index.js";
import { preprocessConditionals } from "../../src/renderers/shaders/preprocessConditionals.js";

// Measured on SwiftShader: before the anisotropy / iridescence code was compile-gated, the first visible frame
// of a plain PBR sphere took 2.1 s instead of 1.1 s on WebGPU (WGSL has no compile flags) and 0.9 s -> 1.6 s on
// WebGL2, because the helper functions of every feature were compiled into every program. These tests pin the
// fix: a material without the feature receives none of its helper functions or call sites.

const CHUNKS = join(__dirname, "../../src/renderers/shaders/source");
const read = (relative: string): string => readFileSync(join(CHUNKS, relative), "utf8");

const wgsl = (flags: readonly string[]): string =>
  preprocessConditionals(
    [read("web_gpu/chunks/pbr_math.wgsl"), read("web_gpu/chunks/lighting_pbr.wgsl")].join("\n"),
    flags,
  );

const ANISOTROPY_TOKENS = [
  "specularAnisotropic",
  "anisotropyBentNormal",
  "anisoT",
  "anisotropyStrength",
];
const IRIDESCENCE_TOKENS = [
  "evalIridescence",
  "iridescenceSensitivity",
  "schlickToF0",
  "XYZ_TO_REC709",
];

describe("feature-gated PBR shader code (compile cost)", () => {
  it("WGSL: a material without the features carries none of their code and no directive lines", () => {
    const source = wgsl([]);

    for (const token of [...ANISOTROPY_TOKENS, ...IRIDESCENCE_TOKENS]) {
      expect(source, `${token} leaked into a feature-less program`).not.toContain(token);
    }
    expect(source).not.toMatch(/^\s*#/m);
    expect(source).toContain("fn F_Schlick90");
    expect(source).toContain("let RSpec = R;");
  });

  it("WGSL: anisotropy alone brings only the anisotropy code (4 light sites + bent normal)", () => {
    const source = wgsl([ShaderFlag.ANISOTROPY]);

    expect(source.match(/specularAnisotropic\(/g)).toHaveLength(5);
    expect(source).toContain("fn anisotropyBentNormal");
    expect(source).toContain("let RSpec = reflect(");
    for (const token of IRIDESCENCE_TOKENS) expect(source).not.toContain(token);
  });

  it("WGSL: iridescence alone brings only the thin-film code", () => {
    const source = wgsl([ShaderFlag.IRIDESCENCE]);

    expect(source).toContain("fn evalIridescence");
    expect(source).toContain("fn iridescenceSensitivity");
    for (const token of ANISOTROPY_TOKENS) expect(source).not.toContain(token);
  });

  it("WGSL: both features together keep every piece, and the stripped program is much smaller", () => {
    const both = wgsl([ShaderFlag.ANISOTROPY, ShaderFlag.IRIDESCENCE]);
    const none = wgsl([]);

    expect(both).toContain("fn evalIridescence");
    expect(both).toContain("fn specularAnisotropic");
    expect(none.length).toBeLessThan(both.length * 0.9);
  });

  it.each([
    ["WebGL2", "web_gl2/chunks/pbr_math.frag.glsl"],
    ["WebGL1", "web_gl1/chunks/pbr_math.frag.glsl"],
  ])("%s: the helper functions sit behind the feature flags in the math chunk", (_tier, file) => {
    const source = read(file);

    expect(source).toMatch(/#ifdef USE_IRIDESCENCE[\s\S]*schlickToF0[\s\S]*#endif/);
    expect(source).toMatch(
      /#ifdef USE_ANISOTROPY[\s\S]*specularAnisotropic[\s\S]*anisotropyBentNormal[\s\S]*#endif/,
    );

    const stripped = preprocessConditionals(source, []);
    for (const token of ["specularAnisotropic", "anisotropyBentNormal", "schlickToF0"]) {
      expect(stripped, `${token} leaked`).not.toContain(token);
    }
    expect(stripped).toContain("F_Schlick90");
  });

  it("WebGL1 declares the extension lanes only for programs compiled with the feature", () => {
    const source = read("../../../core/materials/surface/shaders/Standard.frag.glsl100");

    expect(source).toMatch(/#ifdef USE_IRIDESCENCE\s*[\s\S]*?uniform vec4 u_matParam14;\s*#endif/);
    expect(source).toMatch(/#ifdef USE_ANISOTROPY\s*[\s\S]*?uniform vec4 u_matParam15;\s*#endif/);
  });

  describe("cheap iridescence switch (quality.cheapIridescence)", () => {
    const SPECTRAL_TOKENS = ["evalIridescence", "iridescenceSensitivity", "XYZ_TO_REC709"];
    const glsl300 = (flags: readonly string[]): string =>
      preprocessConditionals(
        [
          read("web_gl2/chunks/pbr_math.frag.glsl"),
          read("web_gl2/chunks/light_calc_pbr.frag.glsl"),
        ].join("\n"),
        flags,
      );

    it.each([
      ["WGSL", wgsl],
      ["WebGL2", glsl300],
    ])("%s: the cheap flag swaps the spectral model for the two-beam one", (_tier, build) => {
      const cheap = build([ShaderFlag.IRIDESCENCE, ShaderFlag.IRIDESCENCE_CHEAP]);
      const spectral = build([ShaderFlag.IRIDESCENCE]);

      expect(cheap).toContain("iridescenceFresnelCheap(");
      expect(cheap).toContain("schlickToF0(");
      for (const token of SPECTRAL_TOKENS) expect(cheap, `${token} in cheap`).not.toContain(token);
      expect(spectral).toContain("evalIridescence(");
      expect(spectral).not.toContain("iridescenceFresnelCheap");
      expect(cheap.length).toBeLessThan(spectral.length);
    });

    it.each([
      ["WGSL", wgsl],
      ["WebGL2", glsl300],
    ])("%s: the cheap flag alone, without iridescence, brings nothing", (_tier, build) => {
      expect(build([ShaderFlag.IRIDESCENCE_CHEAP])).toBe(build([]));
    });
  });
});
