import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";

// G04: the ambient diffuse energy split must be identical per tier. The GL2/WGPU ambient removes
// the Fresnel share from the diffuse response -- `(1 - F_Schlick90) * (1 - metallic)` (GL2 no-IBL
// fallback, the direct-lighting kD uses the same form). GL1 applied only `(1 - metallic)`, leaving
// dielectric ambient diffuse up to 1/(1-F) brighter than the upper tiers for the same
// u_ambientColor. The specular envMap branch must keep using the SAME Fresnel term so the split
// stays energy-consistent (specular = env * F, diffuse = env * (1 - F) * (1 - metallic)).

const ROOT = path.resolve(__dirname, "../../../..");

function read(relative: string): string {
  return fs.readFileSync(path.join(ROOT, relative), "utf-8");
}

/** Code with comments removed -- a mention in a comment must neither satisfy nor break a guard. */
function code(relative: string): string {
  return read(relative)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
}

const GL1_PBR =
  "packages/engine/src/renderers/shaders/source/web_gl1/chunks/light_calc_pbr.frag.glsl";
const GL2_PBR =
  "packages/engine/src/renderers/shaders/source/web_gl2/chunks/light_calc_pbr.frag.glsl";

describe("ambient energy split parity (G04)", () => {
  it("GL1 splits the ambient diffuse with the Fresnel term like GL2", () => {
    const src = code(GL1_PBR);
    expect(src).toContain("vec3 kD_ambient = (vec3(1.0) - ambientFresnel) * (1.0 - metallic);");
    // The specular envMap branch reuses the same Fresnel term (energy-consistent split).
    // G01 extends it with the split-sum scale/bias: kS * scale + bias (analytic Karis fit on GL1).
    expect(src).toContain("specularAmbient = envColor * (ambientFresnel * envBRDF.x + envBRDF.y);");
    // The old Fresnel-less formula is gone.
    expect(src).not.toContain("diffuseAmbient * (1.0 - metallic)");
  });

  it("the GL2 reference path uses the same (1 - F) * (1 - metallic) split", () => {
    const src = code(GL2_PBR);
    expect(src).toContain("kD_fallback = (1.0 - f_fallback) * (1.0 - metallic);");
  });
});
