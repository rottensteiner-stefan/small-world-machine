import { RetroScreenMaterial } from "../../src/core/materials/RetroScreenMaterial.js";
import { MaterialType } from "../../src/enums/index.js";

describe("RetroScreenMaterial", () => {
  it("should properly map properties to RenderManifest", () => {
    const material = new RetroScreenMaterial({
      mode: "film19th",
      intensity: 0.7,
      speed: 1.5,
      param1: 2.0,
      param2: 20.0,
      param3: 1.2,
      param4: 0.8,
    });
    material.time = 42.0;

    const manifest = material.getRenderManifest();

    // E9-A (ADR 0027/0039): RetroScreen migrated from u_extraParams/u_liquidParams to the typed
    // lanes -- u_matParam0 = [intensity, time, speed, modeFlag], u_matParam1 = [param1..4].
    const control = manifest.properties["u_matParam0"] as number[];
    expect(control[0]).toBeCloseTo(0.7, 5);
    expect(control[1]).toBeCloseTo(42.0, 5);
    expect(control[2]).toBeCloseTo(1.5, 5);
    expect(control[3]).toBe(1.0); // film19th mode is 1.0

    const params = manifest.properties["u_matParam1"] as number[];
    expect(params[0]).toBeCloseTo(2.0, 5);
    expect(params[1]).toBeCloseTo(20.0, 5);
    expect(params[2]).toBeCloseTo(1.2, 5);
    expect(params[3]).toBeCloseTo(0.8, 5);
  });

  it("should return valid shader definition", () => {
    const material = new RetroScreenMaterial();
    const shaderDef = material.getShaderDefinition();

    expect(shaderDef.id).toBe(MaterialType.RETRO_SCREEN);
    expect(shaderDef.sources.glsl300?.fs).toBeDefined();
    expect(shaderDef.sources.glsl100?.fs).toBeDefined();
    expect(shaderDef.sources.wgsl).toBeDefined();
    expect(shaderDef.layout.textures["u_diffuseMap"]).toEqual({
      type: "texture",
    });
  });
});
