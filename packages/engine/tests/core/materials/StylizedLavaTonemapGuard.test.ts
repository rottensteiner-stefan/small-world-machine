import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC_DIR = join(__dirname, "../../../src");
const LAVA_DIR = join(SRC_DIR, "core/materials/liquid/shaders");

// ── P3/S1 R3 (warning): StylizedLava multiplies the top-lava color by `brightnessTopLava`
// (default 4.94), pushing the result to HDR ~5.0. On the HDR tiers the color was sent straight
// through `linearToSRGB()`, which clips to (1,1,1) and burns to pure white before bloom/single-
// pass tonemapping can act. The ratified fix mirrors the Standard material's guard: when
// gamma != 1.0 (post-processing disabled, i.e. quality.gamma == 2.2) a Reinhard clamp runs
// before the sRGB encode; at the default gamma == 1.0 (post-processing enabled) the guard is a
// numeric no-op, so default output is byte-identical. WebGL1 (glsl100) is untouched: it has no
// exposure/gamma uniform path and no HDR post/bloom stage -- documented tier limitation.
// The world-XZ UV frequencies (uvDistort/uvMain), the depth edge thickness and the object-space
// vertex wave frequency already travel in owned lanes (matParam0.x/.y, matParam3.x, matParam4.y)
// on every tier, so no extra lane is needed; the tests below pin that they stay lane-driven and
// never regress to hardcoded literals.

describe("R3: StylizedLava tonemap guard before linearToSRGB on the HDR tiers", () => {
  const sites = [
    {
      file: join(LAVA_DIR, "StylizedLava.frag.wgsl"),
      guard: /if \(global\.gamma != 1\.0\)/,
      reinhard: /color \/ \(color \+ vec3f\(1\.0\)\)/,
    },
    {
      file: join(LAVA_DIR, "StylizedLava.frag.glsl"),
      guard: /if \(u_gamma != 1\.0\)/,
      reinhard: /color \/ \(color \+ vec3\(1\.0\)\)/,
    },
  ];

  it("runs a gamma-guarded Reinhard clamp before linearToSRGB at both HDR sites", () => {
    for (const site of sites) {
      const source = readFileSync(site.file, "utf8");
      expect(source, site.file).toMatch(site.guard);
      expect(source, site.file).toMatch(site.reinhard);
      // The clamp must sit between the exposure multiply and the sRGB encode.
      const guardIdx = source.search(site.guard);
      const reinhardIdx = source.search(site.reinhard);
      const srgBIdx = source.indexOf("linearToSRGB");
      expect(guardIdx, `${site.file}: guard present`).toBeGreaterThanOrEqual(0);
      expect(reinhardIdx, `${site.file}: reinhard present`).toBeGreaterThan(guardIdx);
      expect(srgBIdx, `${site.file}: linearToSRGB after the guard`).toBeGreaterThan(reinhardIdx);
    }
  });

  it("documents the WebGL1 tier limitation (no exposure/gamma path, no HDR bloom)", () => {
    const glsl100 = readFileSync(join(LAVA_DIR, "StylizedLava.frag.glsl100"), "utf8");
    expect(glsl100).toMatch(/tier limitation|no exposure|no HDR|LDR/i);
  });
});

describe("R3: world-space UV / edge / vertex-frequency couplings stay lane-driven", () => {
  it("fragment tiers multiply world XZ by owned lanes, never by a hardcoded literal", () => {
    const frags = [
      // Depth-capable tiers (source-depth edge): world UV freqs AND the edge-thickness lane.
      {
        file: join(LAVA_DIR, "StylizedLava.frag.wgsl"),
        required: [/obj\.matParam0\.y/, /obj\.matParam0\.x/, /obj\.matParam3\.x/],
        forbidden: [/wp\.xz \* [0-9]/],
      },
      {
        file: join(LAVA_DIR, "StylizedLava.frag.glsl"),
        required: [/u_matParam0\.y/, /u_matParam0\.x/, /u_matParam3\.x/],
        forbidden: [/v_worldPos\.xz \* [0-9]/],
      },
      // WebGL1 (glsl100): no scene-depth capture, so the edge thickness lane is intentionally
      // unused -- only the world UV frequencies travel in lanes here.
      {
        file: join(LAVA_DIR, "StylizedLava.frag.glsl100"),
        required: [/u_matParam0\.y/, /u_matParam0\.x/],
        forbidden: [/v_worldPos\.xz \* [0-9]/],
      },
    ];
    for (const frag of frags) {
      const source = readFileSync(frag.file, "utf8");
      for (const re of frag.required) {
        expect(source, `${frag.file} must keep ${re} lane-driven`).toMatch(re);
      }
      for (const re of frag.forbidden) {
        expect(source, frag.file).not.toMatch(re);
      }
    }
  });

  it("vertex tiers keep the object-space quadratic wave frequency in matParam4.y", () => {
    const verts = [
      {
        file: join(LAVA_DIR, "StylizedLava.vert.wgsl"),
        laneRe: /pos\.x \* pos\.z \* obj\.matParam4\.y/,
      },
      {
        file: join(LAVA_DIR, "StylizedLava.vert.glsl"),
        laneRe: /a_position\.x \* a_position\.z \* u_matParam4\.y/,
      },
      {
        file: join(LAVA_DIR, "StylizedLava.vert.glsl100"),
        laneRe: /a_position\.x \* a_position\.z \* u_matParam4\.y/,
      },
    ];
    for (const vert of verts) {
      const source = readFileSync(vert.file, "utf8");
      expect(source, vert.file).toMatch(vert.laneRe);
      expect(source, vert.file).not.toMatch(/\.x \* [^ ]*\.z \* [0-9]/);
    }
  });
});
