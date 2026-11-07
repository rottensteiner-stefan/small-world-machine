import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ShadertoyImporter,
  SHADERTOY_GAMMA_DEFS,
} from "../../../src/core/materials/importers/ShadertoyImporter.js";
import { CoreShaderChunks } from "../../../src/renderers/shaders/CoreShaderChunks.js";
import { ShaderRegistry } from "../../../src/renderers/shaders/ShaderRegistry.js";

// The wrapper must not inject [LIGHT_DEFS] above user code: it drags linearToSRGB / sRGBToLinear /
// targetToLinear / displayToTarget into the Shadertoy's scope and Shadertoys define their own.
const USER = `
vec3 sRGBToLinear(vec3 c) { return pow(c, vec3(2.2)); }
vec3 linearToSRGB(vec3 c) { return pow(c, vec3(1.0 / 2.2)); }
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  fragColor = vec4(linearToSRGB(sRGBToLinear(vec3(fragCoord / iResolution.xy, 0.5))), 1.0);
}`;

function assembledFs(): string {
  const registry = new ShaderRegistry();
  CoreShaderChunks.init(registry);
  const fs = new ShadertoyImporter().parse(USER).sources?.glsl300?.fs ?? "";
  return registry.assemble(fs, "glsl300");
}

function countDefs(src: string, name: string): number {
  const stripped = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  return (stripped.match(new RegExp(`\\bvec3\\s+${name}\\s*\\(\\s*vec3`, "g")) ?? []).length;
}

describe("ShadertoyImporter GLSL300 scope", () => {
  it("user-defined sRGBToLinear / linearToSRGB are defined exactly once in the assembled source", () => {
    const fs = assembledFs();
    expect(countDefs(fs, "sRGBToLinear")).toBe(1);
    expect(countDefs(fs, "linearToSRGB")).toBe(1);
    expect(countDefs(fs, "targetToLinear")).toBe(0);
    expect(countDefs(fs, "displayToTarget")).toBe(0);
  });

  it("still converts the output with the wrapper-private lane function after the user code", () => {
    const fs = assembledFs();
    expect(fs).toContain("swm_displayToTarget(color.rgb)");
    expect(fs.indexOf("SHADERTOY SOURCE END")).toBeLessThan(
      fs.indexOf("swm_displayToTarget(color.rgb)"),
    );
  });

  it("GlobalUniforms prefix stays byte-identical to the engine UBO up to u_gamma (std140 drift pin)", () => {
    const lights = readFileSync(
      join(__dirname, "../../../src/renderers/shaders/source/web_gl2/chunks/lights.frag.glsl"),
      "utf8",
    );
    const members = (src: string): string[] =>
      src
        .replace(/\/\/[^\n]*/g, "")
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => /^(mat4|vec3|int|float)\s+\w+;$/.test(l));
    const engine = members(lights.slice(lights.indexOf("uniform GlobalUniforms")));
    const mine = members(
      SHADERTOY_GAMMA_DEFS.slice(0, SHADERTOY_GAMMA_DEFS.indexOf("} swm_global")),
    );
    expect(mine.length).toBeGreaterThan(5);
    expect(mine).toEqual(engine.slice(0, mine.length));
    expect(mine[mine.length - 1]).toBe("float u_gamma;");
  });
});
