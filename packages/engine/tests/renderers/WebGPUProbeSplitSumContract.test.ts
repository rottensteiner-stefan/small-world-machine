import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";

// G01: the WebGPU probe/environment reflection path must integrate specular energy through the
// split-sum BRDF LUT (`envBRDF.x`/`envBRDF.y`) and scale the decoded environment by
// `global.envIntensity`, exactly like the WebGL2 probe path (light_calc_pbr.frag.glsl). Before the
// fix, WebGPU used `specularAmbient = envColor * F_Schlick90(...)` -- rough dielectrics were
// overbright and rough metals nearly black because the `kS * envBRDF.x + envBRDF.y` energy split
// was dropped. web_gl1 is exempt: it has no `u_envIntensity`/`u_brdfLUT` (documented no-IBL tier
// limitation).

const ROOT = path.resolve(__dirname, "../../../..");

const FILE = "packages/engine/src/renderers/shaders/source/web_gpu/chunks/lighting_pbr.wgsl";

describe("WebGPU probe split-sum BRDF integration (G01)", () => {
  it("applies the split-sum LUT and envIntensity to the probe reflection path", () => {
    const src = fs.readFileSync(path.join(ROOT, FILE), "utf-8");
    // Probe path (obj.useEnvMap > 0.5): decoded environment scaled by the global intensity ...
    expect(src).toContain("* global.envIntensity");
    // ... and specular integrated through the BRDF LUT's split-sum terms -- not plain Fresnel.
    expect(src).toContain("let envBRDF = textureSampleLevel(u_brdfLUT");
    expect(src).toContain("specularAmbient = envColor * (kS_ambient * envBRDF.x + envBRDF.y)");
    // The pre-fix F_Schlick-only shortcut is gone from the specular path.
    expect(src).not.toContain("specularAmbient = envColor * F_Schlick90");
  });
});
