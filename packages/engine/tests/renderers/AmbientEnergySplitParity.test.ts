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
const WGPU_PBR = "packages/engine/src/renderers/shaders/source/web_gpu/chunks/lighting_pbr.wgsl";

describe("ambient energy split parity (G04)", () => {
  it("GL1 splits the ambient diffuse with the Fresnel term like GL2", () => {
    const src = code(GL1_PBR);
    expect(src).toMatch(
      /vec3 irradiance = mix\(u_ambientGround, u_ambientColor, clamp\(N\.y \* 0\.5 \+ 0\.5, 0\.0, 1\.0\)\) \* \(1\.0 \/ 3\.14159265359\);/,
    );
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

  it("WebGPU and WebGL2 add PI-normalized hemisphere ambient to IBL irradiance without dropping it or double-multiplying kD", () => {
    const gl2 = code(GL2_PBR);
    expect(gl2).toMatch(
      /vec3 hemiAmbient = mix\(u_ambientGround, u_ambientColor, clamp\(N\.y \* 0\.5 \+ 0\.5, 0\.0, 1\.0\)\) \* \(1\.0 \/ 3\.14159265359\);/,
    );
    expect(gl2).toMatch(
      /vec3 iblIrradiance = sRGBToLinear\(texture\(u_irradianceMap, N\)\.rgb\) \* u_envIntensity;/,
    );
    expect(gl2).toMatch(/vec3 irradiance = iblIrradiance \+ hemiAmbient;/);
    expect(gl2).toMatch(/vec3 FssEss = kS_ambient \* envBRDF\.x \+ F90 \* envBRDF\.y;/);

    const wgpu = code(WGPU_PBR);
    expect(wgpu).toMatch(
      /let hemiAmbient = mix\(global\.ambientGround\.rgb, global\.ambientColor\.rgb, clamp\(N\.y \* 0\.5 \+ 0\.5, 0\.0, 1\.0\)\) \* \(1\.0 \/ 3\.14159265359\);/,
    );
    expect(wgpu).toMatch(
      /let iblIrradiance = sRGBToLinear\(textureSampleLevel\(u_irradianceMap, globalSampler, N, 0\.0\)\.rgb\) \* global\.envIntensity;/,
    );
    expect(wgpu).toMatch(/let irradiance = iblIrradiance \+ hemiAmbient;/);
    expect(wgpu).toContain("let diffuseAmbient = irradiance * diffuseAlbedo;");
    expect(wgpu).not.toContain("diffuseAmbient = kD_ambient * irradiance * diffuseAlbedo;");
    expect(wgpu).toMatch(/let FssEss = kS_ambient \* envBRDF\.x \+ F90 \* envBRDF\.y;/);
  });
});
