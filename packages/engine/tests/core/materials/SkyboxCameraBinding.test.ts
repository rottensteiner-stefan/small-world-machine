import { describe, it, expect } from "vitest";
import skyboxFragWGSL from "../../../src/core/materials/shaders/Skybox.frag.wgsl?raw";
import skyboxVertWGSL from "../../../src/renderers/shaders/source/web_gpu/skybox.vert.wgsl?raw";
import skyboxVertGLSL from "../../../src/core/materials/shaders/Skybox.vert.glsl?raw";
import skyboxVertGLSL100 from "../../../src/core/materials/shaders/Skybox.vert.glsl100?raw";

// The skybox must be bound to the camera (centered on the viewer) so a moving camera can never
// walk out of the sky, instead of relying on a static scene-positioned cube that only happens to
// enclose the camera. Every backend adds the camera view position after the model transform,
// which the view transform neutralizes (camera maps to the origin), keeping the cube around the
// viewer at all times.
describe("skybox vertex shaders bind the cube to the camera", () => {
  it("real WGSL vertex uses global.viewPos to re-center on the camera", () => {
    expect(skyboxFragWGSL).toMatch(/global\.viewPos\.xyz/);
  });

  it("WGSL reference shader uses global.viewPos to re-center on the camera", () => {
    expect(skyboxVertWGSL).toMatch(/global\.viewPos\.xyz/);
  });

  it.each([
    ["GLSL ES 3.00", skyboxVertGLSL],
    ["GLSL ES 1.00", skyboxVertGLSL100],
  ])(
    "%s drops the model translation (w = 0) and re-centres on the camera (w = 1)",
    (_name, source) => {
      // A skybox object placed away from the origin must not be shifted relative to the camera;
      // identical to skybox.vert.wgsl.
      expect(source).toMatch(
        /u_model\s*\*\s*vec4\(a_position,\s*0\.0\)\s*\+\s*vec4\(u_viewPos,\s*1\.0\)/,
      );
    },
  );

  it("GLSL ES 1.00 declares the u_viewPos uniform (WebGL1 uploads it when present)", () => {
    expect(skyboxVertGLSL100).toMatch(/uniform\s+vec3\s+u_viewPos;/);
  });
});
