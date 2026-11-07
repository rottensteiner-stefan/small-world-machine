import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";

// A01: every render-target capture sample (`u_opaqueMap` / `u_reflectionMap`) must cancel the
// forward-pass exposure the capture carries when post-processing is OFF, mirroring the
// FluidSurface pattern: `targetToLinear(texture(...).rgb) / max(<exposure>, 0.001)`. With post ON
// the renderer forces exposure to 1.0 (so the divide is identity and must not break the display
// chain); with post OFF it is the exact inverse of the capture, so a later `* exposure` does not
// double-apply. glsl100 is exempt -- the documented tier limitation: its forward shaders encode
// exposure/gamma themselves and the GL1 post pass treats the target as display-referred (A03).

const ROOT = path.resolve(__dirname, "../../../..");

function read(relative: string): string {
  return fs.readFileSync(path.join(ROOT, relative), "utf-8");
}

/** Source with comments removed: a mention in a comment must neither satisfy nor break a guard. */
function code(relative: string): string {
  return read(relative)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
}

/** Whole statements (from the previous `;`/brace to the next `;`) that sample a render-target input. */
function targetSampleStatements(source: string): string[] {
  const sample =
    /\b(?:textureSampleLevel|textureSample|textureLod|texture2D|texture)\s*\(\s*(?:u_opaqueMap|u_reflectionMap)\b/g;
  const out: string[] = [];
  for (const m of source.matchAll(sample)) {
    const at = m.index;
    const begin = Math.max(
      source.lastIndexOf(";", at),
      source.lastIndexOf("{", at),
      source.lastIndexOf("}", at),
    );
    const end = source.indexOf(";", at);
    out.push(source.slice(begin + 1, end === -1 ? undefined : end));
  }
  return out;
}

// Every A01 site. Liquid/gas extras (OilPuddle/RainPuddle/liquid-extras) are intentionally not
// listed: OilPuddle already follows the pattern, RainPuddle documents its own mirror convention,
// both live in another claim's path scope.
const A01_FILES = [
  "packages/engine/src/renderers/shaders/source/web_gl2/chunks/light_calc_pbr.frag.glsl",
  "packages/engine/src/renderers/shaders/source/web_gpu/chunks/lighting_pbr.wgsl",
  "packages/engine/src/core/materials/surface/shaders/Standard.frag.wgsl",
  "packages/engine/src/core/materials/glass/shaders/Glass.frag.glsl",
  "packages/engine/src/core/materials/glass/shaders/Glass.frag.wgsl",
  "packages/engine/src/core/materials/glass/shaders/Frostglass.frag.glsl",
  "packages/engine/src/core/materials/glass/shaders/Frostglass.frag.wgsl",
  "packages/engine/src/core/materials/liquid/shaders/OpenWater.frag.glsl",
  "packages/engine/src/core/materials/liquid/shaders/OpenWater.frag.wgsl",
  "packages/engine/src/core/materials/liquid/shaders/StylizedWater.frag.glsl",
  "packages/engine/src/core/materials/liquid/shaders/StylizedWater.frag.wgsl",
];

describe("opaque/reflection capture exposure cancellation (A01)", () => {
  for (const file of A01_FILES) {
    it(`${path.basename(file)}: every render-target sample cancels the capture exposure`, () => {
      const statements = targetSampleStatements(code(file));
      expect(statements.length).toBeGreaterThan(0);
      // glsl300 sources use `u_exposure`, WGSL uses `global.exposure`.
      const exposure = file.endsWith(".wgsl") ? "global.exposure" : "u_exposure";
      const cancellation = new RegExp(`/ max\\(${exposure.replace(".", "\\.")}, 0\\.001\\)`);
      for (const statement of statements) {
        expect(statement, statement).toMatch(cancellation);
      }
    });
  }
});
