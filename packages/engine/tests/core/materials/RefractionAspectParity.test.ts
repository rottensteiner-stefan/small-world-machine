import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC_DIR = join(__dirname, "../../../src");
const GLASS_DIR = join(SRC_DIR, "core/materials/glass/shaders");
const STANDARD_DIR = join(SRC_DIR, "core/materials/surface/shaders");
const GL2_CHUNK = join(SRC_DIR, "renderers/shaders/source/web_gl2/chunks/light_calc_pbr.frag.glsl");

// ── P3/S1 R2 (warning, D3): the screen-space refraction offset `refrDir.xy * thickness * 0.05`
// had NO aspect term, so the bokeh/refraction read elliptically on non-square targets. The ratified
// fix multiplies the horizontal component by h/w (factor equals exactly 1.0 at square aspect, so no
// existing golden shifts: x*1.0 is a numeric identity) on every tier with the path (WebGPU + WebGL2
// fragment stages). WebGL1 stays untouched: GLSL ES 1.00 has neither `textureSize` nor a screen-size
// uniform, so the aspect term is unavailable there -- documented tier limitation.
// ── E-M9 (A1 hardening): restore the missing `rawNormal.xy *= u_extraParams.zw` normal-scale
// multiply in the glsl100 Glass USE_NORMAL_MAP branch (dormant today, but a future normalScale
// wiring must behave identically on every tier).

describe("R2: refraction offset is aspect-compensated on every tier with the path", () => {
  const sitesGitSHA1Form = [
    join(GLASS_DIR, "Glass.frag.wgsl"),
    join(GLASS_DIR, "Glass.frag.glsl"),
    join(STANDARD_DIR, "Standard.frag.wgsl"),
    GL2_CHUNK,
  ];

  it("multiplies refrDir.xy by the h/w aspect factor at all four sites", () => {
    for (const file of sitesGitSHA1Form) {
      const source = readFileSync(file, "utf8");
      expect(source, file).toMatch(
        /refrDir\.xy \* (?:vec2f?|vec2)\s*\(refrAspect,\s*1\.0\) \* thickness \* 0\.05/,
      );
      // X is driven by an h/w aspect ratio term `refrAspect` (y stays 1.0) -- the isotropic view-space form.
      expect(source, file).toMatch(/refrAspect\s*=.*\.y.*\.x/);
      expect(source, file).toMatch(/,\s*1\.0\)/);
    }
  });

  it("no site keeps the bare (uncompensated) offset", () => {
    for (const file of sitesGitSHA1Form) {
      const source = readFileSync(file, "utf8");
      expect(
        source,
        `${file} must not contain the raw refrDir.xy * thickness * 0.05 offset`,
      ).not.toMatch(/refrDir\.xy \* thickness \* 0\.05/);
    }
  });

  it("documents that the factor is an identity at square aspect", () => {
    const wgsl = readFileSync(join(GLASS_DIR, "Glass.frag.wgsl"), "utf8");
    expect(wgsl).toMatch(/1\.0 at square aspect|byte-identical|identity/i);
  });
});

describe("E-M9: glsl100 Glass normal-scale multiply restored (A1 hardening)", () => {
  it("applies rawNormal.xy *= u_extraParams.zw in the USE_NORMAL_MAP branch", () => {
    const glsl100 = readFileSync(join(GLASS_DIR, "Glass.frag.glsl100"), "utf8");
    expect(glsl100).toContain("rawNormal.xy *= u_extraParams.zw;");
  });
});
