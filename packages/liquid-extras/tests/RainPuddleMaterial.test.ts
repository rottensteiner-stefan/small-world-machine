import type { DropSurfaceParams } from "../src/drops/DropSurfaceParams.js";
import { describe, it, expect } from "vitest";
import { Vector2D } from "@small-world-machine/engine";
import {
  RAIN_PUDDLE_MAX_BASINS,
  RainPuddleMaterial,
} from "../src/materials/RainPuddle/RainPuddleMaterial.js";

describe("RainPuddleMaterial", () => {
  it("is a transparent overlay that does not write depth", () => {
    const mat = new RainPuddleMaterial();
    expect(mat.type).toBe("RainPuddleMaterial");
    expect(mat.transparent).toBe(true);
    expect(mat.depthWrite).toBe(false);
  });
  it("injects the shared physics into all three backends and leaves no template token behind", () => {
    const sources = new RainPuddleMaterial().getShaderDefinition().sources;
    for (const src of [sources.glsl300?.fs, sources.glsl100?.fs, sources.wgsl]) {
      expect(src).toContain("rpLocalWavenumber");
      expect(src).toContain("rpFresnelDielectric");
      expect(src).not.toContain("[RAIN_PUDDLE_COMMON]");
    }
  });

  it("packs parameters and basins into the matParam lanes", () => {
    const mat = new RainPuddleMaterial({
      asphaltTilePeriod: new Vector2D(1.6, -1.5),
      basins: [{ x: 1, z: 2, radiusX: 0.5, radiusZ: 0.7 }],
      rainIntensity: 0.3,
      dripIntensity: 0.2,
    });
    mat.time = 4;
    const props = mat.getRenderManifest().properties as Record<string, unknown>;
    expect((props["u_matParam0"] as number[])[0]).toBe(4);
    expect((props["u_matParam0"] as number[]).slice(2)).toEqual([0.3, 0.2]);
    expect((props["u_matParam1"] as number[]).slice(0, 2)).toEqual([1.6, -1.5]);
    expect((props["u_matParam2"] as number[])[0]).toBeCloseTo(1.333);
    expect(props["u_matParam4"]).toEqual([1, 2, 0.5, 0.7]);
    // Unused basin lanes must not create water anywhere near a scene's origin.
    const unused = props["u_matParam5"] as number[];
    expect(Math.abs(unused[0]!)).toBeGreaterThan(1000);
  });

  it("packs the default water + rain liquid into lanes 8..13", () => {
    const props = new RainPuddleMaterial().getRenderManifest().properties as Record<
      string,
      unknown
    >;
    expect(props["u_matParam8"]).toEqual([7.2e-5, 1.0e-6, 0, 0.3]);
    expect(props["u_matParam9"]).toEqual([0.0004, 0.00007, 0.00002, 0]);
    expect(props["u_matParam10"]).toEqual([0, 0, 0, 0]);
    expect(props["u_matParam11"]).toEqual([0.0005, 0.0013, 0.09, 0]);
    expect(props["u_matParam12"]).toEqual([0.0022, 0.0045, 0.22, 0.6]);
    expect(props["u_matParam13"]).toEqual([0.2, 0.05, 0.6, 0.15]);
  });

  it("copies DropSurfaceParams and packs a custom liquid", () => {
    const params: DropSurfaceParams = {
      sigmaOverRho: 5.0e-5,
      kinematicViscosity: 3.0e-6,
      ior: 1.4,
      absorptionPerMm: [0.1, 0.9, 0.9],
      scatterAlbedo: [0.5, 0.02, 0.02],
      scatteringPerMm: 2,
      bubbleLifetime: 0.8,
      rain: {
        diameterMin: 0.001,
        diameterMax: 0.002,
        slopeScale: 0.1,
        daughterProbability: 0.1,
        crownStrength: 0.3,
        bubbleProbability: 0.4,
      },
      drips: {
        diameterMin: 0.003,
        diameterMax: 0.005,
        slopeScale: 0.2,
        daughterProbability: 0.2,
        crownStrength: 0.5,
        bubbleProbability: 0.6,
      },
    };
    const mat = new RainPuddleMaterial();
    mat.setDropSurfaceParams(params);
    params.sigmaOverRho = 1;
    params.absorptionPerMm[0] = 99;
    params.rain.slopeScale = 99;
    const props = mat.getRenderManifest().properties as Record<string, unknown>;
    expect(props["u_matParam8"]).toEqual([5.0e-5, 3.0e-6, 2, 0.8]);
    expect(props["u_matParam9"]).toEqual([0.1, 0.9, 0.9, 0]);
    expect(props["u_matParam10"]).toEqual([0.5, 0.02, 0.02, 0]);
    expect(props["u_matParam11"]).toEqual([0.001, 0.002, 0.1, 0.1]);
    expect(props["u_matParam12"]).toEqual([0.003, 0.005, 0.2, 0.2]);
    expect(props["u_matParam13"]).toEqual([0.3, 0.4, 0.5, 0.6]);
    expect((props["u_matParam2"] as number[])[0]).toBeCloseTo(1.4);
  });

  it("has no hard-wired liquid constants left in any shader dialect", () => {
    const sources = new RainPuddleMaterial().getShaderDefinition().sources;
    for (const src of [sources.glsl300?.fs, sources.glsl100?.fs, sources.wgsl]) {
      expect(src).not.toMatch(/RP_SIGMA_RHO|RP_NU\b|RP_CG_MIN|RP_K_MIN|WATER_IOR/);
      expect(src).not.toMatch(/\[RAIN_PUDDLE_COMMON\]/);
    }
    expect(sources.glsl300?.fs).toContain("#define RP_BUBBLES");
    expect(sources.glsl100?.fs).not.toContain("#define RP_BUBBLES");
  });

  it("keeps at most the shader's basin count", () => {
    const basins = Array.from({ length: RAIN_PUDDLE_MAX_BASINS + 2 }, (_, i) => ({
      x: i,
      z: 0,
      radiusX: 1,
      radiusZ: 1,
    }));
    expect(new RainPuddleMaterial({ basins }).basins).toHaveLength(RAIN_PUDDLE_MAX_BASINS);
  });

  it("derives the per-pixel view angle from FOV and viewport height", () => {
    const mat = new RainPuddleMaterial();
    mat.setCameraFootprint(Math.PI / 2, 1000);
    expect(mat.pixelAngle).toBeCloseTo(0.002, 6);
  });
});
