import { describe, it, expect } from "vitest";
import skyboxVertGLSL from "../../../src/core/materials/shaders/Skybox.vert.glsl?raw";
import skyboxVertGLSL100 from "../../../src/core/materials/shaders/Skybox.vert.glsl100?raw";
import skyboxVertWGSL from "../../../src/renderers/shaders/source/web_gpu/skybox.vert.wgsl?raw";

// The skybox cube must never be clipped by the camera far plane (a showcase with far = 500 and a
// 1000-unit cube showed a black rectangle on WebGL only): every backend pins the sky depth to the
// far plane in the vertex shader.
describe("skybox vertex shaders pin depth to the far plane", () => {
  it("WGSL uses .xyww", () => {
    expect(skyboxVertWGSL).toMatch(/\.xyww/);
  });

  it.each([
    ["GLSL ES 3.00", skyboxVertGLSL],
    ["GLSL ES 1.00", skyboxVertGLSL100],
  ])("%s writes z just below w", (_name, source) => {
    expect(source).toMatch(
      /gl_Position\s*=\s*vec4\(clip\.xy,\s*clip\.w\s*\*\s*0\.99999,\s*clip\.w\)/,
    );
  });
});
