import { OpenWaterMaterial } from "../../src/core/materials/liquid/OpenWaterMaterial.js";
import { MaterialType } from "../../src/enums/index.js";
import { Color } from "../../src/core/colors/index.js";

describe("OpenWaterMaterial", () => {
  it("should initialize with default values", () => {
    const material = new OpenWaterMaterial();

    expect(material.type).toBe(MaterialType.OPEN_WATER);
    expect(material.refractionStrength).toBe(0.03);
  });

  it("should accept a custom refractionStrength", () => {
    const material = new OpenWaterMaterial({ refractionStrength: 0.1 });

    expect(material.refractionStrength).toBe(0.1);
  });

  it("should default waterAbsorption to a red-fades-fastest coefficient", () => {
    const material = new OpenWaterMaterial();

    expect(material.waterAbsorption).toEqual([0.3, 0.06, 0.02]);
  });

  it("should pack waterAbsorption into u_matParam0 and keep it in sync", () => {
    const material = new OpenWaterMaterial({ waterAbsorption: [0.5, 0.1, 0.01] });

    let manifest = material.getRenderManifest();
    expect((manifest.properties["u_matParam0"] as number[])[0]).toBe(0.5);
    expect((manifest.properties["u_matParam0"] as number[])[1]).toBe(0.1);
    expect((manifest.properties["u_matParam0"] as number[])[2]).toBe(0.01);

    material.waterAbsorption = [1.0, 1.0, 1.0];
    manifest = material.getRenderManifest();
    expect((manifest.properties["u_matParam0"] as number[])[0]).toBe(1.0);
    expect((manifest.properties["u_matParam0"] as number[])[1]).toBe(1.0);
    expect((manifest.properties["u_matParam0"] as number[])[2]).toBe(1.0);
  });

  it("should default foam options", () => {
    const material = new OpenWaterMaterial();

    expect(material.foamColor).toEqual(new Color(1.0, 1.0, 1.0));
    expect(material.foamCutoff).toBe(0.6);
    expect(material.foamNoiseScale).toBe(3.0);
    expect(material.foamNoiseSpeed).toBe(0.5);
  });

  it("should pack foam options into u_matParam1 and u_matParam2 and keep them in sync", () => {
    const material = new OpenWaterMaterial({
      foamColor: new Color(0.2, 0.4, 0.6),
      foamCutoff: 0.5,
      foamNoiseScale: 4.0,
      foamNoiseSpeed: 1.5,
      foamDistance: 1.2,
    });

    let manifest = material.getRenderManifest();
    const mp1 = manifest.properties["u_matParam1"] as number[];
    expect(mp1[0]).toBeCloseTo(0.2, 5);
    expect(mp1[1]).toBeCloseTo(0.4, 5);
    expect(mp1[2]).toBeCloseTo(0.6, 5);
    expect(mp1[3]).toBe(1.2);

    const mp2 = manifest.properties["u_matParam2"] as number[];
    expect(mp2[0]).toBe(0.5);
    expect(mp2[1]).toBe(4.0);
    expect(mp2[2]).toBe(1.5);

    material.foamCutoff = 0.9;
    manifest = material.getRenderManifest();
    expect((manifest.properties["u_matParam2"] as number[])[0]).toBe(0.9);
  });

  it("should expose u_opaqueMap for screen-space refraction, alongside the existing u_opaqueDepthMap", () => {
    const material = new OpenWaterMaterial();
    const manifest = material.getRenderManifest();

    expect(Object.keys(manifest.textures)).toContain("u_opaqueMap");
    expect(Object.keys(manifest.textures)).toContain("u_opaqueDepthMap");
    expect(manifest.textures["u_opaqueMap"]).toBeUndefined();
  });

  it("should pack refractionStrength into u_matParam0.w and keep it in sync across calls", () => {
    const material = new OpenWaterMaterial({ refractionStrength: 0.05 });

    let manifest = material.getRenderManifest();
    expect((manifest.properties["u_matParam0"] as number[])[3]).toBe(0.05);

    material.refractionStrength = 0.2;
    manifest = material.getRenderManifest();
    expect((manifest.properties["u_matParam0"] as number[])[3]).toBe(0.2);
  });

  it("should declare u_opaqueMap in the WebGPU layout textures", () => {
    const material = new OpenWaterMaterial();
    const shaderDef = material.getShaderDefinition();

    expect(shaderDef.layout.textures["u_opaqueMap"]).toEqual({ type: "texture" });
    expect(shaderDef.layout.textures["u_opaqueDepthMap"]).toEqual({ type: "texture" });
  });

  it("should still expose the pre-existing color/wave options unaffected by refraction wiring", () => {
    const material = new OpenWaterMaterial({
      waterColor: new Color(0.1, 0.2, 0.3),
      deepWaterColor: new Color(0.0, 0.0, 0.1),
    });

    expect(material.color).toEqual(new Color(0.1, 0.2, 0.3));
    expect(material.deepWaterColor).toEqual(new Color(0.0, 0.0, 0.1));
  });

  it("should pack reflectionRoughness into u_matParam9.z", () => {
    const material = new OpenWaterMaterial({
      reflectionStrength: 0.9,
      reflectionDistortion: 0.15,
      reflectionRoughness: 0.45,
    });

    let manifest = material.getRenderManifest();
    let mp9 = manifest.properties["u_matParam9"] as number[];
    expect(mp9[1]).toBeCloseTo(0.15);
    expect(mp9[2]).toBeCloseTo(0.45);

    material.reflectionRoughness = 0.8;
    manifest = material.getRenderManifest();
    mp9 = manifest.properties["u_matParam9"] as number[];
    expect(mp9[2]).toBeCloseTo(0.8);
  });
});
