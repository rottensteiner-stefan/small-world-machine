import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";

// ADR 0048: the baked 8-bit IBL cubes (irradiance, prefilter) are sRGB-encoded like u_envMap, so
// every sample of them is decoded with sRGBToLinear before it is scaled by the env intensity. The
// irradiance used to be read raw on both tiers while u_envMap was decoded. Source guards, because
// vitest has no shader compiler: every sampling line of the two cubes must carry the decode.

function read(relative: string): string {
  return fs.readFileSync(
    path.resolve(__dirname, "../../src/renderers/shaders/source", relative),
    "utf-8",
  );
}

function samplingLines(source: string, sampler: string): string[] {
  return source
    .split("\n")
    .filter((line) => line.includes(`(${sampler},`) && !line.trim().startsWith("//"));
}

const CHUNKS = [
  { tier: "WebGPU", source: read("web_gpu/chunks/lighting_pbr.wgsl") },
  { tier: "WebGL2", source: read("web_gl2/chunks/light_calc_pbr.frag.glsl") },
];

describe("IBL colorspace contract (ADR 0048)", () => {
  for (const { tier, source } of CHUNKS) {
    for (const sampler of ["u_irradianceMap", "u_prefilterMap"]) {
      it(`${tier}: every ${sampler} sample is decoded with sRGBToLinear`, () => {
        const lines = samplingLines(source, sampler);
        expect(lines.length).toBeGreaterThan(0);
        for (const line of lines) expect(line).toContain(`sRGBToLinear(`);
      });
    }
  }
});
