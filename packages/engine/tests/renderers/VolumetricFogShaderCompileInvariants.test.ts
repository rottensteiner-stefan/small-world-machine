import { describe, it, expect } from "vitest";
import fogFragGLSL from "../../src/renderers/post/shaders/VolumetricFog.frag.glsl?raw";

// GLSL ES 3.00 fails to compile on SwiftShader/ANGLE (and is illegal by spec) when a sampler
// array is indexed with a non-constant expression, and sampler types without an explicit
// precision are rejected. Both slipped through the mock-GL unit tests, so these source-level
// invariants pin the WebGL2 density-mask path to compilable ES 3.00.
describe("WebGL2 volumetric fog shader compiles under GLSL ES 3.00", () => {
  it("declares a highp precision for sampler3D", () => {
    expect(fogFragGLSL).toMatch(/precision\s+highp\s+sampler3D;/);
  });

  it("never indexes a sampler array with a non-constant expression", () => {
    expect(fogFragGLSL).not.toMatch(/u_fogVolumeMasks\[\s*(?!\d\])/);
  });

  it("samples each per-volume mask slot with a constant-index if-chain", () => {
    const [first, last] = ["u_fogVolumeMasks[0]", "u_fogVolumeMasks[7]"];
    expect(fogFragGLSL).toContain(first);
    expect(fogFragGLSL).toContain(last);
    expect(fogFragGLSL).toMatch(/maskIdx\s*==\s*0[\s\S]*else/);
  });
});
