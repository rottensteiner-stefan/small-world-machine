import { describe, it, expect } from "vitest";
import { FluidSurfaceMaterial } from "../../../src/core/materials/liquid/FluidSurfaceMaterial.js";
import { LavaMaterial } from "../../../src/core/materials/liquid/LavaMaterial.js";
import { SlimeMaterial } from "../../../src/core/materials/liquid/SlimeMaterial.js";
import type { Texture } from "../../../src/core/textures/index.js";

describe("FluidSurfaceMaterial depth pre-pass opt-out", () => {
  it("skips the depth pre-pass for opaque displaced surfaces (lava)", () => {
    const lava = new LavaMaterial();
    expect(lava.transparent).toBe(false);
    expect(lava.getRenderManifest().state?.skipDepthPrePass).toBe(true);
  });

  it("keeps an opaque surface with zero wave amplitude in the pre-pass", () => {
    const lava = new LavaMaterial();
    lava.waveAmplitude = 0;
    expect(lava.getRenderManifest().state?.skipDepthPrePass).toBe(false);
  });

  it("is unaffected for transparent fluids (slime, generic fluid)", () => {
    expect(new SlimeMaterial().getRenderManifest().state?.skipDepthPrePass).toBe(false);
    expect(new FluidSurfaceMaterial().getRenderManifest().state?.skipDepthPrePass).toBe(false);
  });

  describe("planar reflection support", () => {
    it("packs reflection parameters into u_matParam9 and registers u_reflectionMap", () => {
      const mat = new FluidSurfaceMaterial({
        reflectionStrength: 0.8,
        reflectionDistortion: 0.08,
        reflectionRoughness: 0.35,
      });

      // Without map, reflection strength in lane 0 is 0
      let manifest = mat.getRenderManifest();
      let p9 = manifest.properties["u_matParam9"] as number[];
      expect(p9[0]).toBe(0);
      expect(p9[1]).toBeCloseTo(0.08);
      expect(p9[2]).toBeCloseTo(0.35);

      // Provide a dummy texture
      const mockTex = {} as unknown as Texture;
      mat.reflectionMap = mockTex;
      manifest = mat.getRenderManifest();
      p9 = manifest.properties["u_matParam9"] as number[];
      expect(p9[0]).toBeCloseTo(0.8);
      expect(manifest.textures["u_reflectionMap"]).toBe(mockTex);
    });
  });
});
