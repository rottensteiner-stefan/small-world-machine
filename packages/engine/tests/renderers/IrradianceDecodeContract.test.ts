import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// F01: the IBL diffuse-irradiance cube (`u_irradianceMap`) is stored sRGB-encoded like every other
// IBL map, so EVERY probe must decode through the sRGB->linear transfer before the sampled value
// is used in linear-space lighting. The PBR chunk (`lighting_pbr.wgsl`, `light_calc_pbr.frag.glsl`)
// and the fog injection (`froxel_inject.wgsl`) already did; the glass materials probed it RAW, only
// to test `dot(...) > 1e-6` as an "IBL present" gate -- the gate still works on the decoded value
// (0 stays 0 under the transfer), but the raw probe broke the single-decoding rule for that map.
// This guard scans every engine shader: any `u_irradianceMap` SAMPLING line must decode. The
// VolumetricFog path uses the intentional manual `pow(x, vec3(2.2))` variant and is allowed.

const ROOT = join(__dirname, "..", "..", "..", "..");
const SHADER_EXT = /\.(?:glsl|glsl100|wgsl)$/;
const GLASS_WGSL = join(ROOT, "packages/engine/src/core/materials/glass/shaders/Glass.frag.wgsl");
const FROSTGLASS_WGSL = join(
  ROOT,
  "packages/engine/src/core/materials/glass/shaders/Frostglass.frag.wgsl",
);

function shaderFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry.startsWith(".")) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) shaderFiles(path, out);
    else if (SHADER_EXT.test(entry)) out.push(path);
  }
  return out;
}

/** True when `line` actually samples the irradiance cube (vs. declaring/binding its uniform). */
const isIrradianceSample = (line: string): boolean =>
  /(?:textureSampleLevel\s*\(\s*u_irradianceMap|texture\s*\(\s*u_irradianceMap)/.test(line);

/** A sampling line is decoded through the exact transfer fn or the manual pow(2.2) variant. */
const isDecoded = (line: string): boolean =>
  /\bsRGBToLinear\s*\(/.test(line) || /pow\([^;\n]*vec3\(\s*2\.2\s*\)/.test(line);

describe("every u_irradianceMap probe decodes sRGB->linear (F01)", () => {
  it("no engine shader samples the irradiance cube without decoding it", () => {
    const violations: string[] = [];
    for (const file of shaderFiles(join(ROOT, "packages/engine/src"))) {
      const source = readFileSync(file, "utf8");
      for (const line of source.split("\n")) {
        if (!isIrradianceSample(line)) continue;
        if (!isDecoded(line)) {
          violations.push(`${relative(ROOT, file)}: ${line.trim()}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("both glass shaders decode their irradiance probe (F01 regression)", () => {
    for (const file of [GLASS_WGSL, FROSTGLASS_WGSL]) {
      const source = readFileSync(file, "utf8");
      const probes = source.split("\n").filter(isIrradianceSample);
      expect(probes.length, file).toBeGreaterThan(0);
      for (const probe of probes) expect(probe, file).toMatch(/\bsRGBToLinear\s*\(/);
    }
  });
});
