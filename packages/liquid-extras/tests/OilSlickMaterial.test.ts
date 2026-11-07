import { describe, it, expect } from "vitest";
import { OilSlickMaterial } from "../src/materials/OilSlick/OilSlickMaterial.js";

describe("OilSlickMaterial Hook-Based Extension", () => {
  it("instantiates cleanly with petroleum pitch palette and custom type", () => {
    const mat = new OilSlickMaterial();
    expect(mat.type).toBe("OilSlickMaterial");
    expect(mat.styleId).toBe(3.0);
    expect(mat.transparent).toBe(true);
    expect(mat.depthWrite).toBe(false);

    const manifest = mat.getRenderManifest();
    expect(manifest.properties["u_styleB"]).toBeDefined();
    const styleB = manifest.properties["u_styleB"] as number[];
    expect(styleB[3]).toBe(3.0); // styleId
  });

  it("injects flow-noise sheen hooks into all three backends", () => {
    const mat = new OilSlickMaterial();
    const shaderDef = mat.getShaderDefinition();
    expect(shaderDef).toBeDefined();

    for (const src of [
      shaderDef.sources.glsl300?.fs,
      shaderDef.sources.glsl100?.fs,
      shaderDef.sources.wgsl,
    ]) {
      expect(src).toContain("oilFilmThinFilm");
      expect(src).toContain("oilFlowNoise");
    }
  });

  it("transports iridescenceStrength through the u_styleA.w lane", () => {
    expect(new OilSlickMaterial().iridescenceStrength).toBe(0.6);
    const mat = new OilSlickMaterial({ iridescenceStrength: 0.3 });
    expect((mat.getRenderManifest().properties["u_styleA"] as number[])[3]).toBeCloseTo(0.3);
    mat.iridescenceStrength = 0;
    expect((mat.getRenderManifest().properties["u_styleA"] as number[])[3]).toBe(0);
  });

  it("clamps iridescenceStrength to 0..1", () => {
    expect(new OilSlickMaterial({ iridescenceStrength: 5 }).iridescenceStrength).toBe(1);
    expect(new OilSlickMaterial({ iridescenceStrength: -1 }).iridescenceStrength).toBe(0);
  });

  it("clamps specularStrength so the toon highlight cannot flood the film", () => {
    expect(new OilSlickMaterial({ specularStrength: 2.5 }).specularStrength).toBeLessThanOrEqual(
      0.5,
    );
    expect(new OilSlickMaterial().specularStrength).toBeLessThanOrEqual(0.5);
  });

  it("disables ripple lines and glitter lanes", () => {
    const manifest = new OilSlickMaterial({
      lineDensity: 1,
      glitterStrength: 1,
    }).getRenderManifest();
    expect((manifest.properties["u_styleA"] as number[])[2]).toBe(0);
    expect((manifest.properties["u_styleB"] as number[])[2]).toBe(0);
  });
});
