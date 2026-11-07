import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC_DIR = join(__dirname, "../../../src");
const GLASS_DIR = join(SRC_DIR, "core/materials/glass/shaders");
const STANDARD_DIR = join(SRC_DIR, "core/materials/surface/shaders");
const GL2_CHUNK = join(SRC_DIR, "renderers/shaders/source/web_gl2/chunks/light_calc_pbr.frag.glsl");
const WGSL_CHUNK = join(SRC_DIR, "renderers/shaders/source/web_gpu/chunks/lighting_pbr.wgsl");

// ── History: P3/S1 R2 aspect-compensated the old screen-space offset `refrDir.xy * thickness * 0.05`.
// That offset itself was wrong: `refrDir` is WORLD space, so adding its .xy to screen UV made the
// distortion rotate with the camera (2026-11-02 audit S4). GlassMaterial now projects the refracted
// exit point through the view-projection on all three tiers -- aspect-correct by construction, which
// also lifts the former WebGL1 "no aspect term" limitation.
// ── E-M9 (A1 hardening): restore the missing `rawNormal.xy *= u_extraParams.zw` normal-scale
// multiply in the glsl100 Glass USE_NORMAL_MAP branch (dormant today, but a future normalScale
// wiring must behave identically on every tier).

describe("GlassMaterial refraction: projected exit point on every tier", () => {
  const glass = ["Glass.frag.glsl", "Glass.frag.glsl100", "Glass.frag.wgsl"].map((f) =>
    join(GLASS_DIR, f),
  );

  it("projects the modelScale-scaled refracted exit point through the view-projection (E01)", () => {
    for (const file of glass) {
      const source = readFileSync(file, "utf8");
      // E01: the march converts mesh-local thickness to world units via the model scale --
      // exactly the Standard volume ray (light_calc_pbr / lighting_pbr). Unit-scale models are
      // identity; non-uniformly scaled meshes now match Standard instead of diverging.
      expect(source, file).toMatch(
        /modelScale = vec3f?\(length\((?:u_model|obj\.model)\[0\]\.xyz\), length\((?:u_model|obj\.model)\[1\]\.xyz\), length\((?:u_model|obj\.model)\[2\]\.xyz\)/,
      );
      expect(source, file).toMatch(/refrMarch = refrDir \* thickness \* modelScale/);
      expect(source, file).toMatch(
        /exitClip = (?:u_vp|global\.vp) \* vec4f?\((?:v_worldPos|i\.wp) \+ refrMarch, 1\.0\)/,
      );
      // Beer absorption integrates over the SAME scaled distance the ray travelled.
      expect(source, file).toMatch(/length\(refrMarch\) \* 3\.0/);
    }
  });

  it("no tier keeps a world-space vector as a screen-UV offset", () => {
    for (const file of glass) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toMatch(/refrDir\.xy/);
      expect(source, file).not.toMatch(/thickness \* 0\.05/);
    }
  });
});

// ── Water (OpenWater, StylizedWater, FluidSurface; all tiers): the wave normal's horizontal tilt
// distorts the refraction and mirror lookups. It is a WORLD-space direction and must be projected
// (`worldDirToScreen`) instead of being used as `normal.xz` screen offset (2026-11-02 audit S3; WGSL
// additionally disagreed in sign with GLSL).
describe("water distortion offsets go through worldDirToScreen", () => {
  const LIQUID_DIR = join(SRC_DIR, "core/materials/liquid/shaders");
  const files = ["OpenWater", "StylizedWater", "FluidSurface"].flatMap((n) =>
    ["frag.glsl", "frag.glsl100", "frag.wgsl"].map((e) => join(LIQUID_DIR, `${n}.${e}`)),
  );

  it("no screen-UV line adds a raw normal .xz", () => {
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const line of source.split("\n")) {
        if (/(?:distortedUv|refractionUv|mirrorUv) =/.test(line)) {
          expect(line, file).not.toMatch(/(?:v_normal|i\.n|\bN)\.xz/);
        }
      }
      expect(source, file).toMatch(/worldDirToScreen\(vec3f?\(/);
    }
  });
});

// ── KHR_materials_transmission (StandardMaterial, WebGPU + WebGL2): Khronos-reference volume ray.
// The view ray is refracted, marched `thickness` (mesh space -> world via the model scale), the exit
// point is projected with the view-projection and the opaque snapshot is sampled there (thick spheres
// show the scene inverted). The BTDF replaces the diffuse lobe (spec: mix(diffuse, btdf, T)) -- the
// old path ADDED it on top of full diffuse, which turned clear glass milky.
describe("KHR_materials_transmission: projected volume ray, BTDF replaces diffuse (both tiers)", () => {
  const chunks = [GL2_CHUNK, WGSL_CHUNK];

  it("projects the refracted exit point through the view-projection", () => {
    for (const file of chunks) {
      const source = readFileSync(file, "utf8");
      expect(source, file).toMatch(
        /transmissionRay = normalize\(refract\(-V, N, 1\.0 \/ ior\)\) \* thickness \* modelScale/,
      );
      expect(source, file).toMatch(
        /(?:u_vp|global\.vp) \* vec4f?\((?:v_worldPos|i\.wp) \+ transmissionRay, 1\.0\)/,
      );
      expect(source, file).not.toMatch(/thickness \* 0\.05/);
    }
  });

  it("weights every diffuse term by (1 - transmission)", () => {
    for (const file of chunks) {
      const source = readFileSync(file, "utf8");
      expect(source, file).toMatch(/diffuseAlbedo = albedo \* \(1\.0 - transmissionWeight\)/);
      expect(source, file).not.toMatch(/kD \* albedo \/ 3\.14159265359/);
      expect(source, file).toMatch(/diffuseAmbient = irradiance \* diffuseAlbedo/);
    }
  });

  it("Standard.frag.wgsl no longer carries a second, additive transmission block", () => {
    const wgsl = readFileSync(join(STANDARD_DIR, "Standard.frag.wgsl"), "utf8");
    expect(wgsl).not.toMatch(/u_opaqueMap/);
    expect(wgsl).not.toMatch(/refract\(/);
  });
});

describe("E-M9: glsl100 Glass normal-scale multiply restored (A1 hardening)", () => {
  it("applies rawNormal.xy *= u_extraParams.zw in the USE_NORMAL_MAP branch", () => {
    const glsl100 = readFileSync(join(GLASS_DIR, "Glass.frag.glsl100"), "utf8");
    expect(glsl100).toContain("rawNormal.xy *= u_extraParams.zw;");
  });
});
