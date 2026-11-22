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
    expect(fs).not.toContain("out vec2 v_uv;");
    expect(fs.match(/\buniform\s+GlobalUniforms\b/g)?.length).toBe(1);
  });

  it("GlobalUniforms matches the engine UBO member-for-member (no WebGL2/ANGLE VS/FS link mismatch)", () => {
    const lights = readFileSync(
      join(__dirname, "../../../src/renderers/shaders/source/web_gl2/chunks/lights.frag.glsl"),
      "utf8",
    );
    const baseVert = readFileSync(
      join(
        __dirname,
        "../../../src/renderers/shaders/source/web_gl2/chunks/base_vertex_header.vert.glsl",
      ),
      "utf8",
    );
    const extractBlock = (src: string): string => {
      const start = src.indexOf("layout(std140) uniform GlobalUniforms");
      const open = src.indexOf("{", start);
      const close = src.indexOf("}", open);
      return src.slice(open + 1, close);
    };
    const members = (blockBody: string): string[] =>
      blockBody
        .replace(/\/\/[^\n]*/g, "")
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
    const extractStruct = (src: string, name: string): string[] => {
      const m = src.match(new RegExp(`struct\\s+${name}\\s*\\{([\\s\\S]*?)\\};`));
      return m ? members(m[1]!) : [];
    };

    const extractInstanceName = (src: string): string => {
      const start = src.indexOf("layout(std140) uniform GlobalUniforms");
      const open = src.indexOf("{", start);
      const close = src.indexOf("}", open);
      const semi = src.indexOf(";", close);
      return src.slice(close + 1, semi).trim();
    };

    const mine = members(extractBlock(SHADERTOY_GAMMA_DEFS));
    const engineFrag = members(extractBlock(lights));
    const engineVert = members(extractBlock(baseVert));

    expect(mine.length).toBeGreaterThan(15);
    expect(mine).toEqual(engineFrag);
    expect(mine).toEqual(engineVert);
    expect(extractInstanceName(SHADERTOY_GAMMA_DEFS)).toBe("");
    expect(extractInstanceName(SHADERTOY_GAMMA_DEFS)).toBe(extractInstanceName(lights));
    expect(extractInstanceName(SHADERTOY_GAMMA_DEFS)).toBe(extractInstanceName(baseVert));

    for (const structName of ["PointLight", "SpotLight", "AreaLight"]) {
      const mineStruct = extractStruct(SHADERTOY_GAMMA_DEFS, structName);
      expect(mineStruct.length).toBeGreaterThan(0);
      expect(mineStruct).toEqual(extractStruct(lights, structName));
      expect(mineStruct).toEqual(extractStruct(baseVert, structName));
    }
  });
});
