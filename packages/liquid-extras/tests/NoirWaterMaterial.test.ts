import { describe, it, expect } from "vitest";
import { NoirWaterMaterial } from "../src/materials/NoirWater/NoirWaterMaterial.js";

describe("NoirWaterMaterial Hook-Based Extension", () => {
  it("instantiates cleanly with noir palette and custom type", () => {
    const mat = new NoirWaterMaterial();
    expect(mat.type).toBe("NoirWaterMaterial");
    expect(mat.styleId).toBe(3.0);
    expect(mat.transparent).toBe(true);
    expect(mat.depthWrite).toBe(false);

    const manifest = mat.getRenderManifest();
    expect(manifest.properties["u_styleB"]).toBeDefined();
    const styleB = manifest.properties["u_styleB"] as number[];
    expect(styleB[3]).toBe(3.0); // styleId
  });

  it("injects ink, concentric shockwaves and posterize hooks into all three backends", () => {
    const mat = new NoirWaterMaterial();
    const shaderDef = mat.getShaderDefinition();
    expect(shaderDef).toBeDefined();

    expect(shaderDef.sources.glsl300?.fs).toContain("ripStroke");
    expect(shaderDef.sources.glsl100?.fs).toContain("ripStroke");
    expect(shaderDef.sources.wgsl).toContain("ripStroke");
    // posterize steps and ripple center are read from the lanes
    expect(shaderDef.sources.glsl300?.fs).toContain("u_styleA.w");
    expect(shaderDef.sources.wgsl).toContain("obj.styleA.w");
  });

  it("transports posterizeSteps and rippleCenter through the u_styleA lanes", () => {
    const mat = new NoirWaterMaterial({ posterizeSteps: 6, rippleCenter: [-2.0, 3.5] });
    expect(mat.posterizeSteps).toBe(6);
    expect(mat.rippleCenter).toEqual([-2.0, 3.5]);
    const styleA = mat.getRenderManifest().properties["u_styleA"] as number[];
    expect(styleA[0]).toBe(-2.0);
    expect(styleA[1]).toBe(3.5);
    expect(styleA[3]).toBe(6);

    mat.posterizeSteps = 3;
    mat.rippleCenter = [1.2, -0.8];
    const styleAUpdated = mat.getRenderManifest().properties["u_styleA"] as number[];
    expect(styleAUpdated[0]).toBe(1.2);
    expect(styleAUpdated[1]).toBe(-0.8);
    expect(styleAUpdated[3]).toBe(3);
  });

  it("clamps posterizeSteps to 2..8 and defaults to 4", () => {
    expect(new NoirWaterMaterial().posterizeSteps).toBe(4);
    expect(new NoirWaterMaterial({ posterizeSteps: 0 }).posterizeSteps).toBe(2);
    expect(new NoirWaterMaterial({ posterizeSteps: 99 }).posterizeSteps).toBe(8);
  });

  it("transports multi-object ripple centers through u_styleA and u_styleB lanes", () => {
    const mat = new NoirWaterMaterial({
      posterizeSteps: 5,
      rippleCenter: [-1.5, 2.0],
      rippleCenter2: [3.0, -4.5],
      rippleCenter3: [0.5, 1.2],
    });
    expect(mat.posterizeSteps).toBe(5);
    expect(mat.rippleCenter).toEqual([-1.5, 2.0]);
    expect(mat.rippleCenter2).toEqual([3.0, -4.5]);
    expect(mat.rippleCenter3).toEqual([0.5, 1.2]);

    const manifest = mat.getRenderManifest();
    const styleA = manifest.properties["u_styleA"] as number[];
    const styleB = manifest.properties["u_styleB"] as number[];
    expect(styleA[0]).toBe(-1.5);
    expect(styleA[1]).toBe(2.0);
    expect(styleA[2]).toBe(3.0);
    expect(styleA[3]).toBe(5);

    expect(styleB[0]).toBe(-4.5);
    expect(styleB[1]).toBe(0.5);
    expect(styleB[2]).toBe(1.2);
    expect(styleB[3]).toBe(3.0); // styleId
  });

  it("uses low caustics by default", () => {
    const mat = new NoirWaterMaterial();
    expect(mat.causticStrength).toBeLessThanOrEqual(0.2);
  });

  it("mirrors the +0.5 top-bucket rounding on the real default posterize mat", () => {
    // Art-bucket audit against the exact shader rule (T3): floor(v*inkSteps+0.5)/inkSteps
    // with inkSteps = max(posterizeSteps - 1, 1). The default is 4, i.e. 3 ink steps, 4 levels.
    const mat = new NoirWaterMaterial();
    expect(mat.posterizeSteps).toBe(4);
    const inkSteps = Math.max(mat.posterizeSteps - 1, 1);
    expect(inkSteps).toBe(3);
    for (let i = 0; i <= 4096; i++) {
      const v = i / 4096;
      const out = Math.floor(v * inkSteps + 0.5) / inkSteps;
      expect(out).toBeGreaterThanOrEqual(0);
      expect(out).toBeLessThanOrEqual(1);
    }
    expect(Math.floor(1 * inkSteps + 0.5) / inkSteps).toBe(1);
  });
});
