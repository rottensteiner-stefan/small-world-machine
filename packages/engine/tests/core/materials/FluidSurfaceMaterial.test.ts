import { describe, it, expect } from "vitest";
import { FluidSurfaceMaterial } from "../../../src/core/materials/liquid/FluidSurfaceMaterial.js";
import { LavaMaterial } from "../../../src/core/materials/liquid/LavaMaterial.js";
import { SlimeMaterial } from "../../../src/core/materials/liquid/SlimeMaterial.js";

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
});
