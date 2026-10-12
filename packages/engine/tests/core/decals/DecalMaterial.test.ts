import { describe, expect, it } from "vitest";
import { DecalMaterial } from "../../../src/core/materials/index.js";
import { Texture } from "../../../src/core/textures/index.js";
import { Color } from "../../../src/core/colors/index.js";

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

describe("DecalMaterial ORM and emissive", () => {
  it("has no ORM/emissive flags or textures by default", () => {
    const manifest = new DecalMaterial().getRenderManifest();
    expect(manifest.flags).not.toContain("USE_DECAL_ORM");
    expect(manifest.flags).not.toContain("USE_EMISSIVE_MAP");
    expect(manifest.textures["u_aoMap"]).toBeUndefined();
    expect((manifest.properties["u_matParam6"] as Float32Array)[0]).toBe(0);
    expect(Array.from(manifest.properties["u_specColor"] as Float32Array)).toEqual([0, 0, 0, 1]);
  });

  it("binds the ORM map to the shared u_aoMap slot and flags it", () => {
    const orm = Texture.empty();
    const manifest = new DecalMaterial({ ormMap: orm }).getRenderManifest();
    expect(manifest.flags).toContain("USE_DECAL_ORM");
    expect(manifest.textures["u_aoMap"]).toBe(orm);
    expect((manifest.properties["u_matParam6"] as Float32Array)[0]).toBe(1);
  });

  it("packs emissive colour and intensity and flags the emissive map", () => {
    const emissive = Texture.empty();
    const material = new DecalMaterial({
      emissiveMap: emissive,
      emissiveColor: new Color(1, 0.5, 0, 1),
      emissiveIntensity: 3,
    });
    const manifest = material.getRenderManifest();
    expect(manifest.flags).toContain("USE_EMISSIVE_MAP");
    expect(manifest.textures["u_emissiveMap"]).toBe(emissive);
    expect(Array.from(manifest.properties["u_specColor"] as Float32Array)).toEqual([1, 0.5, 0, 3]);
  });

  it("declares u_aoMap in the shader layout", () => {
    const layout = new DecalMaterial().getShaderDefinition().layout;
    expect(layout.textures).toHaveProperty("u_aoMap");
  });
});
