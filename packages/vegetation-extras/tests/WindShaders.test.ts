import { validate, formatDiagnostic, LIMITS } from "@moreplease/glslang";
import { describe, expect, it } from "vitest";
import { WgslReflect } from "wgsl_reflect/wgsl_reflect.module.js";
import { WIND_FIELD_GLSL, WIND_FIELD_WGSL } from "../src/wind/windShaders.js";

const FUNCTIONS = ["swmWindHash", "swmWindNoise", "swmWindGust", "swmWindLean", "swmWindBend"];

const WGSL_HARNESS = `${WIND_FIELD_WGSL}
@group(0) @binding(0) var<uniform> u_wind: SwmWind;
@vertex fn main(@location(0) pos: vec3f, @location(1) root: vec3f) -> @builtin(position) vec4f {
  let lean = swmWindLean(u_wind, root.xz, 1.5, 0.2);
  return vec4f(root + swmWindBend(pos - root, lean, 1.5), 1.0);
}`;

const glslHarness = (version: "100" | "300"): string => {
  const header =
    version === "300"
      ? "#version 300 es\nprecision highp float;\nin vec3 a_pos;\nin vec3 a_root;\n"
      : "precision highp float;\nattribute vec3 a_pos;\nattribute vec3 a_root;\n";
  return `${header}${WIND_FIELD_GLSL}
uniform SwmWind u_wind;
void main() {
  vec2 lean = swmWindLean(u_wind, a_root.xz, 1.5, 0.2);
  gl_Position = vec4(a_root + swmWindBend(a_pos - a_root, lean, 1.5), 1.0);
}`;
};

const constants = (source: string): string[] =>
  [...source.matchAll(/SWM_WIND_[A-Z_]+\s*(?::\s*f32)?\s*=\s*([0-9.]+)/g)].map((m) => m[1]!);

describe("wind field shader chunks", () => {
  it("parses as WGSL inside a vertex harness", () => {
    const reflect = new WgslReflect(WGSL_HARNESS);
    expect(reflect.entry.vertex).toHaveLength(1);
    expect(reflect.uniforms.map((u) => u.name)).toContain("u_wind");
  });

  for (const version of ["100", "300"] as const) {
    it(`compiles as GLSL ES ${version} vertex shader`, async () => {
      const res = await validate(
        [{ name: `wind.${version}.vert`, source: glslHarness(version), stage: "vertex" }],
        {
          target: version === "300" ? "webgl2" : "webgl1",
          limits: version === "300" ? LIMITS.webgl2 : LIMITS.webgl1,
        },
      );
      expect(res.ok, res.diagnostics.map(formatDiagnostic).join("\n")).toBe(true);
    });
  }

  it("keeps function names and constants identical across dialects", () => {
    for (const name of FUNCTIONS) {
      expect(WIND_FIELD_WGSL).toContain(`fn ${name}(`);
      expect(WIND_FIELD_GLSL).toMatch(new RegExp(`\\b(float|vec2|vec3) ${name}\\(`));
    }
    expect(constants(WIND_FIELD_GLSL)).toEqual(constants(WIND_FIELD_WGSL));
  });
});
