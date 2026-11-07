import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";

// Forward shaders that are the final pass without post-processing clamp HDR with Reinhard only
// when the gamma lane says so (`gamma != 1.0`); with post-processing the post pass tone-maps.
// The WebGL2 variants of fluid, glass and terrain used to clamp unconditionally or not at all, so
// they differed from WebGPU. Source guards -- vitest has no shader compiler.

const ROOT = path.resolve(__dirname, "../../../..");
const MATERIALS = "packages/engine/src/core/materials";

const SHADERS = [
  { name: "FluidSurface", dir: "liquid/shaders" },
  { name: "Glass", dir: "glass/shaders" },
  { name: "Frostglass", dir: "glass/shaders" },
  { name: "Terrain", dir: "shaders" },
];

function read(dir: string, file: string): string {
  return fs.readFileSync(path.join(ROOT, MATERIALS, dir, file), "utf-8");
}

describe("Reinhard clamp follows the gamma lane on every API tier", () => {
  for (const { name, dir } of SHADERS) {
    it(`${name}: WebGPU and WebGL2 both guard Reinhard with the lane`, () => {
      const wgsl = read(dir, `${name}.frag.wgsl`);
      const glsl = read(dir, `${name}.frag.glsl`);
      expect(wgsl).toMatch(
        /if \(global\.gamma != 1\.0\) \{\s*\n\s*\w+ = \w+ \/ \(\w+ \+ vec3f\(1\.0\)\);/,
      );
      expect(glsl).toMatch(
        /if \(u_gamma != 1\.0\) \{\s*\n\s*\w+ = \w+ \/ \(\w+ \+ vec3\(1\.0\)\);/,
      );
    });
  }
});
