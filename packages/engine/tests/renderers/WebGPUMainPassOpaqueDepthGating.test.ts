import { describe, expect, it } from "vitest";
import skyboxVertWGSL from "../../src/renderers/shaders/source/web_gpu/skybox.vert.wgsl?raw";

describe("skybox.vert.wgsl (A15)", () => {
  it("applies only the model's linear part so a translated skybox object is not shifted", () => {
    expect(skyboxVertWGSL).toMatch(/obj\.model\s*\*\s*vec4f\(pos,\s*0\.0\)/);
    expect(skyboxVertWGSL).not.toMatch(/obj\.model\s*\*\s*vec4f\(pos,\s*1\.0\)/);
  });
});
