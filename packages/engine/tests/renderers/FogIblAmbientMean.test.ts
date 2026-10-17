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

describe("volumetric fog IBL ambient samples the sphere mean", () => {
  it.each([
    [
      "WGSL",
      injectWGSL,
      (a: string): string => `textureSampleLevel(u_irradianceMap, globalSampler, vec3f(${a}), 0.0)`,
    ],
    ["GLSL", fogGLSL, (a: string): string => `texture(u_irradianceMap, vec3(${a}))`],
  ])("%s reads the irradiance cube along +-X, +-Y and +-Z", (_name, source, call) => {
    for (const axis of AXES) {
      expect(source).toContain((call as (a: string) => string)(axis));
    }
  });
});
