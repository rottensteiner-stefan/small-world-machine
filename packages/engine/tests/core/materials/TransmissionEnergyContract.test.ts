import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "../../../src");
const read = (rel: string): string => readFileSync(join(SRC, rel), "utf8");

// Energy contracts for transmissive surfaces (2026-11-02 audit). Two copy-pasted errors were removed:
// 1. Glass/Frostglass added the refraction ON TOP of a full diffuse lobe (light loops + ambient), so
//    clear glass read milky. Transmitted light must REPLACE the diffuse share (KHR_materials_transmission
//    semantics): diffuse is weighted by (1 - transmission).
// 2. OpenWater/StylizedWater applied Beer-Lambert twice: `mix(deep, seabed*T + scatter*(1-T), T)` gives
//    seabed*T^2. One pass: `seabed*T + deep*(1-T)` (same endpoints at T = 0 and T = 1).

describe("glass: transmission replaces the diffuse lobe on every tier", () => {
  const loops = [
    "renderers/shaders/source/shared/glass_pbr_loops.frag.glsl",
    "renderers/shaders/source/web_gpu/chunks/glass_pbr_loops.wgsl",
  ];
  const shaders = ["Glass", "Frostglass"].flatMap((name) =>
    ["frag.glsl", "frag.glsl100", "frag.wgsl"].map(
      (ext) => `core/materials/glass/shaders/${name}.${ext}`,
    ),
  );

  it("the shared light loops shade diffuse with diffuseColor, never the raw tint", () => {
    for (const file of loops) {
      const src = read(file);
      expect(src, file).toMatch(/kD \* diffuseColor \/ 3\.14159265359/);
      expect(src, file).not.toMatch(/kD \* tintColor \/ 3\.14159265359/);
    }
  });

  it("each glass shader weights diffuse (loops + ambient) by (1 - transmission)", () => {
    for (const file of shaders) {
      const src = read(file);
      expect(src, file).toMatch(/diffuseColor = tintColor \* \(1\.0 - transmission\);/);
      expect(src, file).toMatch(/ambientColor(?:\.rgb)? \* diffuseColor/);
      expect(src, file).not.toMatch(/ambientColor(?:\.rgb)? \* tintColor/);
      // Declared before the shared loops read it.
      expect(src.indexOf("diffuseColor ="), file).toBeLessThan(
        src.search(/\[(?:WGSL_)?GLASS_PBR_LOOPS\]/),
      );
    }
  });
});

// 3. With the diffuse share correctly removed, glass needs its Fresnel environment reflection (it never had
//    one; the bogus full diffuse had hidden that). Split-sum IBL where available, ambient x Fresnel otherwise.
describe("glass: Fresnel environment reflection on every tier", () => {
  const shaders = ["Glass", "Frostglass"].flatMap((name) =>
    ["frag.glsl", "frag.glsl100", "frag.wgsl"].map(
      (ext) => `core/materials/glass/shaders/${name}.${ext}`,
    ),
  );

  // Double-sided glass (cullMode NONE, e.g. showcase-12 lab vessels): back faces must face the viewer,
  // else dot(N, V) < 0 saturates Fresnel to 1 and the far wall mirrors the environment as a flat sheet.
  it("turns the shading normal toward the viewer before dotNV", () => {
    for (const file of shaders) {
      const src = read(file);
      const flip = src.search(/if \(dot\(N, V\) < 0\.0\)/);
      expect(flip, file).toBeGreaterThan(-1);
      expect(flip, file).toBeLessThan(src.search(/dotNV = max\(dot\(N, V\), 0\.0001\)/));
    }
  });

  it("adds envSpecular to the composed colour", () => {
    for (const file of shaders) {
      const src = read(file);
      expect(src, file).toMatch(/= ambient \+ envSpecular \+ Lo \+ finalRefraction \* kD_refr;/);
      expect(src, file).toMatch(
        /envSpecular = (?:global\.ambientColor\.rgb|u_ambientColor) \* F_Schlick\(dotNV, F0\);/,
      );
      if (!file.endsWith(".glsl100")) {
        expect(src, file).toMatch(
          /envSpecular = envRadiance \* \(F0 \* envBRDF\.x \+ envBRDF\.y\);/,
        );
      }
    }
  });
});

describe("water: a single Beer-Lambert pass on every tier", () => {
  const files = ["OpenWater", "StylizedWater"].flatMap((name) =>
    ["frag.glsl", "frag.glsl100", "frag.wgsl"].map(
      (ext) => `core/materials/liquid/shaders/${name}.${ext}`,
    ),
  );

  it("attenuates the seabed once and fills the absorbed share with the deep colour", () => {
    for (const file of files) {
      const src = read(file);
      expect(src, file).toMatch(
        /= tintedSeabed \* transmittance \+ (?:deepWaterColor|deepColor) \* \(1\.0 - transmittance\);/,
      );
      expect(src, file).not.toMatch(/mix\(\w+, underwaterLighting, transmittance\)/);
    }
  });
});
