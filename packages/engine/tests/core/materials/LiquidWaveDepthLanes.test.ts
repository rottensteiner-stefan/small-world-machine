import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { OpenWaterMaterial } from "../../../src/core/materials/liquid/OpenWaterMaterial.js";
import { StylizedWaterMaterial } from "../../../src/core/materials/liquid/StylizedWaterMaterial.js";

const SRC_DIR = join(__dirname, "../../../src");
const FRAG_DIR = join(SRC_DIR, "core/materials/liquid/shaders");

// ── P3/S1 R5 + E4-B: the liquid wave family's frag shaders carried hardcoded *meter* depth
// constants (refraction damping depth 0.3m, OpenWater caustics cutoff 3.0m, and -- StylizedWater
// only, per A2 attribution -- the depth-discontinuity guard 0.25m, caustics cutoff 6.0m and the
// 4.0m depth ramp End). R5 moves each into a lane "scoped to the owning material": OpenWater
// owns u_matParam7, StylizedWater owns u_matParam8 (it already owns u_matParam7 for specular).
// E4-B adds `domainScale` (default 1.0) on the LiquidWave base, pre-scaling the world-anchored
// lanes inside getRenderManifest: length semantics DIVIDE by domainScale (depth lanes, Gerstner
// wavelengths), so a node scaled by s with domainScale = 1/s keeps the same water look. At
// domainScale 1.0 every lane is a numeric identity (x/1.0), so committed goldens don't drift.
// WebGL1 (glsl100) is untouched: it has no depth capture, so none of these depth literals exist
// there (documented tier limitation).

describe("E4-B: LiquidWave base domainScale pre-scaling (value-preserving at 1.0)", () => {
  it("OpenWater default manifest carries byte-identical depth + wave lanes", () => {
    const mat = new OpenWaterMaterial();
    const props = mat.getRenderManifest().properties as Record<string, number[]>;
    expect(props["u_matParam7"] as number[]).toEqual([0.3, 3.0, 0, 0]);
    // Gerstner wavelengths (matParam3/4/5 .w) are the authored defaults ÷ 1.0.
    expect((props["u_matParam3"] as number[])[3]).toBe(10.0);
    expect((props["u_matParam4"] as number[])[3]).toBe(6.0);
    expect((props["u_matParam5"] as number[])[3]).toBe(3.0);
  });

  it("StylizedWater default manifest carries byte-identical depth lanes", () => {
    const mat = new StylizedWaterMaterial();
    const props = mat.getRenderManifest().properties as Record<string, number[]>;
    expect(props["u_matParam8"] as number[]).toEqual([0.3, 0.25, 6.0, 4.0]);
    expect((props["u_matParam7"] as number[])[0]).toBe(0.4); // specularStrength lane untouched
  });

  describe("scale-invariance across the domain range", () => {
    it("OpenWater: depth lanes and wavelengths divide by domainScale", () => {
      const mat = new OpenWaterMaterial();
      mat.domainScale = 2.0;
      const props = mat.getRenderManifest().properties as Record<string, number[]>;
      expect(props["u_matParam7"] as number[]).toEqual([0.15, 1.5, 0, 0]);
      expect((props["u_matParam3"] as number[])[3]).toBeCloseTo(5.0, 8);
      expect((props["u_matParam4"] as number[])[3]).toBeCloseTo(3.0, 8);
      expect((props["u_matParam5"] as number[])[3]).toBeCloseTo(1.5, 8);
    });

    it("StylizedWater: depth lanes and wavelengths divide by domainScale (A2 ownership)", () => {
      const mat = new StylizedWaterMaterial();
      mat.domainScale = 0.5;
      const props = mat.getRenderManifest().properties as Record<string, number[]>;
      expect(props["u_matParam8"] as number[]).toEqual([0.6, 0.5, 12.0, 8.0]);
      expect((props["u_matParam3"] as number[])[3]).toBeCloseTo(3.2 / 0.5, 8);
    });

    it("domainScale flows through the options interface", () => {
      const mat = new OpenWaterMaterial({ domainScale: 4.0 });
      expect(mat.domainScale).toBe(4.0);
      const p7 = mat.getRenderManifest().properties["u_matParam7"] as number[];
      expect(p7[0]).toBeCloseTo(0.3 / 4.0, 8);
      expect(p7[1]).toBeCloseTo(3.0 / 4.0, 8);
    });
  });
});

describe("R5: OpenWater frag tiers read the depth literals from u_matParam7", () => {
  const sites = [
    {
      file: join(FRAG_DIR, "OpenWater.frag.wgsl"),
      reads: [/obj\.matParam7\.x/, /obj\.matParam7\.y/],
    },
    { file: join(FRAG_DIR, "OpenWater.frag.glsl"), reads: [/u_matParam7\.x/, /u_matParam7\.y/] },
  ];
  for (const site of sites) {
    it(`declares and uses the lane at ${site.file.split("/").pop()} (no hardcoded meters)`, () => {
      const source = readFileSync(site.file, "utf8");
      for (const re of site.reads) expect(source, site.file).toMatch(re);
      expect(source, site.file).not.toMatch(/depthDiff \/ 0\.3/);
      expect(source, site.file).not.toMatch(/CAUSTICS_MAX_DEPTH\s*=\s*3\.0/);
    });
  }
});

describe("R5: StylizedWater frag tiers read the depth literals from u_matParam8 (A2 ownership)", () => {
  const sites = [
    {
      file: join(FRAG_DIR, "StylizedWater.frag.wgsl"),
      reads: [/obj\.matParam8\.x/, /obj\.matParam8\.y/, /obj\.matParam8\.z/, /obj\.matParam8\.w/],
    },
    {
      file: join(FRAG_DIR, "StylizedWater.frag.glsl"),
      reads: [/u_matParam8\.x/, /u_matParam8\.y/, /u_matParam8\.z/, /u_matParam8\.w/],
    },
  ];
  for (const site of sites) {
    it(`declares and uses the lane at ${site.file.split("/").pop()} (no hardcoded meters)`, () => {
      const source = readFileSync(site.file, "utf8");
      for (const re of site.reads) expect(source, site.file).toMatch(re);
      expect(source, site.file).not.toMatch(/depthDiff \/ 0\.3|effDepth \/ 4\.0/);
      expect(source, site.file).not.toMatch(/=== .*0\.25|maxCausticsDepth = 6\.0/);
    });
  }

  it("keeps the specularStrength lane (u_matParam7.x) separate from the depth lane", () => {
    const wgsl = readFileSync(join(FRAG_DIR, "StylizedWater.frag.wgsl"), "utf8");
    expect(wgsl).toMatch(/obj\.matParam7\.x/);
    expect(wgsl).not.toMatch(/obj\.matParam7\.[^x]/);
  });

  it("documents the WebGL1 tier exclusion (no depth capture => no R5 depth meters)", () => {
    const glsl100 = readFileSync(join(FRAG_DIR, "StylizedWater.frag.glsl100"), "utf8");
    // WebGL1 derives its caustic fade from Fresnel -- no depth meters, but must carry a note.
    expect(glsl100).toMatch(/no depth|depth const|R5|fresnel|proxy/i);
  });
});
