import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SkyMaterial } from "../voxel/environment/SkyMaterial.js";

const read = (name: string): string =>
  readFileSync(new URL(`../voxel/environment/shaders/${name}`, import.meta.url), "utf8");
const frag = read("SkyMaterial.frag.glsl");
const wgsl = read("SkyMaterial.wgsl");

describe("SkyMaterial", () => {
  it("packs sun, gradient and clock into the three lanes in place", () => {
    const material = new SkyMaterial();
    const props = material.getRenderManifest().properties as Record<string, number[]>;
    const [sun, horizon, zenith] = [
      props["u_matParam0"]!,
      props["u_matParam1"]!,
      props["u_matParam2"]!,
    ];

    material.setSun([0, -0.9, 0.4], 0.8);
    material.setGradient({ r: 0.1, g: 0.2, b: 0.3 }, { r: 0.4, g: 0.5, b: 0.6 });
    material.setTime(12.5);

    const next = material.getRenderManifest().properties as Record<string, number[]>;
    expect(next["u_matParam0"]).toBe(sun);
    expect(sun).toEqual([0, -0.9, 0.4, 0.8]);
    expect(horizon).toEqual([0.1, 0.2, 0.3, 12.5]);
    expect(zenith.slice(0, 3)).toEqual([0.4, 0.5, 0.6]);
  });

  it("does not write depth and is visible from inside the cube", () => {
    const manifest = new SkyMaterial().getRenderManifest();
    expect(manifest.state?.depthWrite).toBe(false);
    expect(manifest.state?.culling).toBeDefined();
  });

  it("GLSL and WGSL share the sky look constants", () => {
    for (const name of ["SUN_RADIUS", "MOON_RADIUS", "STAR_GRID", "STAR_DENSITY"]) {
      const value = (source: string): string | undefined =>
        new RegExp(`${name}(?::\\s*f32)?\\s*=\\s*([\\d.]+)`).exec(source)?.[1];
      expect(value(wgsl)).toBeDefined();
      expect(value(wgsl)).toBe(value(frag));
    }
  });

  it("pins the sky to the far plane so every terrain pixel wins the depth test", () => {
    expect(read("SkyMaterial.vert.glsl")).toContain("clip.w * 0.99999");
    expect(wgsl).toContain("clip.w * 0.99999");
  });
});
