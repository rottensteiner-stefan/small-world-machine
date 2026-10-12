import { describe, expect, it } from "vitest";
import { DecalMaterial } from "../../../src/core/materials/index.js";

describe("DecalMaterial mipBias", () => {
  it("packs exp2(mipBias) into the 4th fade component, 1 by default", () => {
    const material = new DecalMaterial();
    expect(material.getRenderManifest().properties["u_decalFade"]).toHaveProperty("3", 1);

    material.mipBias = -0.5;
    const fade = material.getRenderManifest().properties["u_decalFade"] as Float32Array;
    expect(fade[3]).toBeCloseTo(Math.SQRT1_2, 5);
    expect(material.getRenderManifest().properties["u_matParam4"]).toBe(fade);
  });

  it("takes mipBias from the options", () => {
    const fade = new DecalMaterial({ mipBias: -1 }).getRenderManifest().properties[
      "u_decalFade"
    ] as Float32Array;
    expect(fade[3]).toBeCloseTo(0.5, 5);
  });
});

describe("DecalMaterial unlit", () => {
  it("is lit by default and only flags USE_DECAL_UNLIT when asked", () => {
    expect(new DecalMaterial().getRenderManifest().flags).not.toContain("USE_DECAL_UNLIT");
    expect(new DecalMaterial({ unlit: true }).getRenderManifest().flags).toContain(
      "USE_DECAL_UNLIT",
    );
  });

  it("follows `unlit` changes on the same material instance", () => {
    const material = new DecalMaterial();
    expect(material.getRenderManifest().flags).not.toContain("USE_DECAL_UNLIT");

    material.unlit = true;

    expect(material.getRenderManifest().flags).toContain("USE_DECAL_UNLIT");
  });

  it("keeps the gradient flag and adds the normal-map flag independently", () => {
    const flags = new DecalMaterial({ unlit: true }).getRenderManifest().flags;

    expect(flags).toContain("USE_DECAL_GRADIENTS");
    expect(flags).not.toContain("USE_NORMAL_MAP");
  });
});
