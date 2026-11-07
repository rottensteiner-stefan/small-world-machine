import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

// Forward tone curve contract: every forward tail that writes the final image calls the shared
// `forwardToneMap` (quality.toneMapping, ToneMappingMode lane) between exposure and the sRGB
// encode; nothing hand-rolls Reinhard any more. With post-processing the gamma lane is 1.0 (and
// the mode lane NONE), so the forward curve is a pass-through and the post pass tone-maps.
// Source guards -- vitest has no shader compiler.

const ROOT = path.resolve(__dirname, "../../../..");
const MATERIALS = "packages/engine/src/core/materials";
const CHUNKS = "packages/engine/src/renderers/shaders/source";

const SHADERS = [
  { name: "FluidSurface", dir: "liquid/shaders" },
  { name: "Glass", dir: "glass/shaders" },
  { name: "Frostglass", dir: "glass/shaders" },
  { name: "Terrain", dir: "shaders" },
  { name: "StylizedLava", dir: "liquid/shaders" },
  { name: "Decal", dir: "surface/shaders" },
  { name: "Standard", dir: "surface/shaders" },
];

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf-8");
}

const CHUNK_DEFS = [
  { file: `${CHUNKS}/web_gl2/chunks/lights.frag.glsl`, guard: /u_gamma == 1\.0/ },
  { file: `${CHUNKS}/web_gpu/chunks/structs.wgsl`, guard: /global\.gamma == 1\.0/ },
  { file: `${CHUNKS}/web_gl1/chunks/lights.frag.glsl`, guard: undefined },
];

describe("forward tone curve: one shared operator on every API tier", () => {
  for (const { name, dir } of SHADERS) {
    it(`${name}: WebGPU and WebGL2 tone-map through forwardToneMap before the sRGB encode`, () => {
      for (const ext of ["wgsl", "glsl"]) {
        const src = read(`${MATERIALS}/${dir}/${name}.frag.${ext}`);
        const call = src.search(/\w+ = forwardToneMap\(\w+\);/);
        expect(call, `${name}.${ext}`).toBeGreaterThanOrEqual(0);
        expect(src.indexOf("linearToSRGB(", call), `${name}.${ext}`).toBeGreaterThan(call);
      }
    });
  }

  it("no forward shader hand-rolls Reinhard (post shaders own their operators)", () => {
    const hits = execSync(
      "git grep -n -E '\\+ vec3f?\\(1\\.0\\)\\)' -- 'packages/*.glsl' 'packages/*.glsl100' 'packages/*.wgsl' || true",
      { cwd: ROOT, encoding: "utf-8" },
    )
      .split("\n")
      // The three forwardToneMap definitions are the only allowed Reinhard sites.
      .filter((l) => l && !l.includes("/post/") && !l.includes("return c / (c + vec3"));
    expect(hits).toEqual([]);
  });

  for (const { file, guard } of CHUNK_DEFS) {
    it(`${path.basename(path.dirname(path.dirname(file)))}: forwardToneMap matches the post operators`, () => {
      const src = read(file);
      expect(src).toMatch(/forwardToneMap\(/);
      if (guard) expect(src).toMatch(guard);
      // Reinhard, Cineon (Hejl/Burgess-Dawson, decoded back to linear), ACES (Narkowicz).
      expect(src).toMatch(/return c \/ \(c \+ vec3f?\(1\.0\)\);/);
      expect(src).toMatch(
        /6\.2 \* m \+ 0\.5\)\) \/ \(m \* \(6\.2 \* m \+ 1\.7\) \+ 0\.06\), vec3f?\(2\.2\)\)/,
      );
      expect(src).toMatch(/2\.51 \* c \+ 0\.03\)\) \/ \(c \* \(2\.43 \* c \+ 0\.59\) \+ 0\.14\)/);
    });
  }

  it("post Cineon returns linear (no double display encode)", () => {
    for (const ext of ["glsl", "wgsl"]) {
      const src = read(`packages/engine/src/renderers/post/shaders/PostProcess.frag.${ext}`);
      expect(src, ext).toMatch(/return pow\(\(mapped \* \(6\.2 \* mapped/);
    }
  });
});
