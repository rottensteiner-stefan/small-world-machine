import { describe, expect, it } from "vitest";
import injectWGSL from "../../src/renderers/shaders/source/web_gpu/compute/froxel_inject.wgsl?raw";
import fogGLSL from "../../src/renderers/post/shaders/VolumetricFog.frag.glsl?raw";

// The fog's ambient inject scatters isotropically, so it needs the sphere-mean of the IBL irradiance, not the
// zenith value: both backends must sample the irradiance cube along all six axis directions.
const AXES = [
  "1.0, 0.0, 0.0",
  "-1.0, 0.0, 0.0",
  "0.0, 1.0, 0.0",
  "0.0, -1.0, 0.0",
  "0.0, 0.0, 1.0",
  "0.0, 0.0, -1.0",
];

/** Directions passed to every irradiance-cube sample in a shader source, in textual order. */
function sampledDirections(source: string, pattern: RegExp): string[] {
  return [...source.matchAll(pattern)].map((m) => m[1]!.replace(/\s+/g, " "));
}

describe("volumetric fog IBL ambient samples the sphere mean", () => {
  it("WGSL samples the six axes exactly once in total, not once per froxel cell", () => {
    const dirs = sampledDirections(
      injectWGSL,
      /textureSampleLevel\(u_irradianceMap, globalSampler, vec3f\(([^)]*)\), 0\.0\)/g,
    );
    expect([...dirs].sort()).toEqual([...AXES].sort());
  });

  it("WGSL computes the mean once per workgroup (thread 0) and shares it behind a barrier", () => {
    expect(injectWGSL).toMatch(/var<workgroup> ambientSky: vec3f;/);
    expect(injectWGSL).toMatch(
      /if \(lid == 0u\)[\s\S]*?ambientSky = \([\s\S]*?\* \(1\.0 \/ 6\.0\);/,
    );
    // The barrier sits before the per-thread bounds early-out (uniform control flow).
    expect(injectWGSL.indexOf("workgroupBarrier();")).toBeGreaterThan(0);
    expect(injectWGSL.indexOf("workgroupBarrier();")).toBeLessThan(
      injectWGSL.indexOf("let volDims"),
    );
    expect(injectWGSL).toMatch(/ambientSky \* global\.envIntensity/);
  });

  it("GLSL reads the irradiance cube along +-X, +-Y and +-Z", () => {
    const dirs = sampledDirections(fogGLSL, /texture\(u_irradianceMap, vec3\(([^)]*)\)\)/g);
    for (const axis of AXES) expect(dirs).toContain(axis);
  });
});
