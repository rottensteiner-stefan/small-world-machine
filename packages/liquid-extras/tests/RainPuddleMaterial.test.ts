import { describe, it, expect } from "vitest";
import { BlendingMode, Vector2D } from "@small-world-machine/engine";
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

  it("requests alpha blending explicitly, which WebGPU pipelines are built from", () => {
    const state = new RainPuddleMaterial().getRenderManifest().state;
    expect(state?.blending).toBe(BlendingMode.ALPHA);
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
