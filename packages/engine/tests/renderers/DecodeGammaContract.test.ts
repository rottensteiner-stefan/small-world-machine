import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";

// ADR 0049: assets decode with a fixed 2.2 (`sRGBToLinear`), engine render targets the forward pass
// wrote through the gamma lane decode with that lane (`targetToLinear`), and display-referred
// shaders convert with `displayToTarget`. Source guards -- vitest has no shader compiler.

const ROOT = path.resolve(__dirname, "../../../..");

function read(relative: string): string {
  return fs.readFileSync(path.join(ROOT, relative), "utf-8");
}

function body(source: string, fn: string): string {
  const start = source.search(new RegExp(`(fn|vec3) ${fn}\\(`));
  expect(start).toBeGreaterThan(-1);
  return source.slice(start, source.indexOf("}", start));
}

/** Source lines that sample one of the render-target inputs (not their size queries). */
function targetSampleLines(source: string): string[] {
  return source
    .split("\n")
    .filter(
      (line) =>
        /(texture|textureLod|textureSample|textureSampleLevel)\((u_opaqueMap|u_reflectionMap)\b/.test(
          line,
        ) && !line.trim().startsWith("//"),
    );
}

// displayToTarget sits where every shader of the tier can reach the lane: WGSL_STRUCTS (all WGSL
// shaders) and LIGHT_DEFS (every GLSL300 fog/display user).
const COLOR_CHUNKS = [
  {
    tier: "WebGPU",
    file: "packages/engine/src/renderers/shaders/source/web_gpu/chunks/pbr_math.wgsl",
    displayFile: "packages/engine/src/renderers/shaders/source/web_gpu/chunks/structs.wgsl",
    lane: "global.gamma",
  },
  {
    tier: "WebGL2",
    file: "packages/engine/src/renderers/shaders/source/web_gl2/chunks/lights.frag.glsl",
    displayFile: "packages/engine/src/renderers/shaders/source/web_gl2/chunks/lights.frag.glsl",
    lane: "u_gamma",
  },
];

const TARGET_READERS = [
  "packages/engine/src/renderers/shaders/source/web_gl2/chunks/light_calc_pbr.frag.glsl",
  "packages/engine/src/core/materials/surface/shaders/Standard.frag.glsl",
  "packages/engine/src/core/materials/surface/shaders/Standard.frag.wgsl",
  "packages/engine/src/core/materials/glass/shaders/Glass.frag.glsl",
  "packages/engine/src/core/materials/glass/shaders/Glass.frag.wgsl",
  "packages/engine/src/core/materials/glass/shaders/Frostglass.frag.glsl",
  "packages/engine/src/core/materials/glass/shaders/Frostglass.frag.wgsl",
  "packages/engine/src/core/materials/liquid/shaders/OpenWater.frag.glsl",
  "packages/engine/src/core/materials/liquid/shaders/OpenWater.frag.wgsl",
  "packages/engine/src/core/materials/liquid/shaders/StylizedWater.frag.glsl",
  "packages/engine/src/core/materials/liquid/shaders/StylizedWater.frag.wgsl",
  "packages/liquid-extras/src/materials/OilPuddle/OilPuddle.frag.glsl",
  "packages/liquid-extras/src/materials/OilPuddle/OilPuddle.frag.wgsl",
  "packages/liquid-extras/src/materials/RainPuddle/RainPuddle.frag.glsl",
  "packages/liquid-extras/src/materials/RainPuddle/RainPuddle.frag.wgsl",
];

const DISPLAY_SHADERS = ["Skybox", "Sprite", "Wireframe", "RetroScreen"].map(
  (name) => `packages/engine/src/core/materials/shaders/${name}.frag`,
);
DISPLAY_SHADERS.push("packages/engine/src/core/materials/surface/shaders/Basic.frag");

describe("decode vs output gamma (ADR 0049)", () => {
  for (const { tier, file, displayFile, lane } of COLOR_CHUNKS) {
    const source = read(file);

    it(`${tier}: sRGBToLinear decodes assets with a fixed 2.2, never the output lane`, () => {
      const decode = body(source, "sRGBToLinear");
      expect(decode).toContain("2.2");
      expect(decode).not.toContain(lane);
    });

    it(`${tier}: targetToLinear and displayToTarget follow the output lane`, () => {
      expect(body(source, "targetToLinear")).toContain(lane);
      expect(body(read(displayFile), "displayToTarget")).toContain(lane);
    });
  }

  for (const file of TARGET_READERS) {
    it(`${path.basename(file)}: every render-target sample decodes with targetToLinear`, () => {
      const lines = targetSampleLines(read(file));
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) expect(line).not.toContain("sRGBToLinear(");
      expect(read(file)).toContain("targetToLinear(");
    });
  }

  for (const base of DISPLAY_SHADERS) {
    for (const ext of ["glsl", "wgsl"]) {
      it(`${path.basename(base)}.${ext}: display-referred output goes through displayToTarget`, () => {
        expect(read(`${base}.${ext}`)).toContain("displayToTarget(");
      });
    }
  }

  it("both fog chunks convert the display-referred fog colour", () => {
    expect(read("packages/engine/src/core/materials/shaders/chunks/fog_calc.glsl")).toContain(
      "displayToTarget(u_fogColor)",
    );
    expect(
      read("packages/engine/src/renderers/shaders/source/web_gpu/chunks/fog_calc.wgsl"),
    ).toContain("displayToTarget(global.fogColor.rgb)");
  });

  it("the fog ambient decodes the sRGB irradiance cube on both tiers", () => {
    for (const file of [
      "packages/engine/src/renderers/shaders/source/web_gpu/compute/froxel_inject.wgsl",
      "packages/engine/src/renderers/post/shaders/VolumetricFog.frag.glsl",
    ]) {
      const lines = read(file)
        .split("\n")
        .filter((l) => /u_irradianceMap,/.test(l) && !l.trim().startsWith("//"));
      expect(lines.length).toBe(6);
      for (const line of lines) expect(line).toMatch(/pow\(|sRGBToLinear\(/);
    }
  });
});
