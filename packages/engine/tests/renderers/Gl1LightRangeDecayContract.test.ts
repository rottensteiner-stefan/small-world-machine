import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";

// G06: the WebGL1 spot/area paths used a fixed `1/(1+0.1d+0.01d^2)` attenuation that ignored the
// authored `maxDist` and `decay` entirely -- lights kept glowing beyond their range and decay was
// dead on the tier (the upload already carried range+decay in `u_spotLightParams.z/w`; area lights
// got a new `u_areaLightParams` uniform). All GL1 paths must use the same windowed law as the GL2
// opaque PBR spot/area loops (`pow(clamp(1 - dist/maxDist, 0, 1), decay)` with a range gate);
// AreaLight.distance defaults to 0 = infinite, which keeps the legacy inverse fallback (GL2 parity).

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

const GL1_LIGHT_DEFS =
  "packages/engine/src/renderers/shaders/source/web_gl1/chunks/lights.frag.glsl";
const GL1_PHONG =
  "packages/engine/src/renderers/shaders/source/web_gl1/chunks/light_calc.frag.glsl";
const GL1_PBR =
  "packages/engine/src/renderers/shaders/source/web_gl1/chunks/light_calc_pbr.frag.glsl";
const PROG_CACHE = "packages/engine/src/renderers/gl/managers/WebGLProgramCache.ts";
const GL1_RENDERER = "packages/engine/src/renderers/WebGL1/WebGL1Renderer.ts";

describe("WebGL1 light range/decay windowing (G06)", () => {
  it("declares the area range/decay uniform next to the other area uniforms", () => {
    expect(code(GL1_LIGHT_DEFS)).toContain("uniform vec2 u_areaLightParams[4];");
  });

  it("windows the Phong spot path with the GL2 range gate + decay law", () => {
    const src = code(GL1_PHONG);
    // Range gate: a spot is fully dead beyond its authored maxDist (the old `theta > cosOuter`
    // gate alone let the fixed falloff glow forever).
    expect(src).toContain("dist < maxDist");
    // GL2-parity windowed law -- pow(..., decay) with decay = 0 meaning constant until the edge.
    expect(src).toContain(
      "float distanceAttenuation = pow(clamp(1.0 - dist / maxDist, 0.0, 1.0), decay);",
    );
    // The fixed falloff is gone from the spot path.
    expect(src).not.toContain("1.0 / (1.0 + 0.1 * dist + 0.01 * dist * dist) * spotEffect");
  });

  it("windows BOTH area paths (Phong + PBR) with the GL2 range gate + inverse fallback", () => {
    for (const file of [GL1_PHONG, GL1_PBR]) {
      const src = code(file);
      expect(src).toContain("if (aMaxDist > 0.0 && dist >= aMaxDist) continue;");
      expect(src).toContain(
        "pow(clamp(1.0 - dist / aMaxDist, 0.0, 1.0), aDecay) : (1.0 / (1.0 + 0.1 * dist + 0.01 * dist * dist))",
      );
    }
  });

  it("wires the new uniform through the program cache and the WebGL1 renderer upload", () => {
    expect(code(PROG_CACHE)).toContain("u_areaLightParams[${i}]");
    expect(code(GL1_RENDERER)).toContain(
      "if (loc?.params) this.gl.uniform2f(loc.params, al.distance, al.decay);",
    );
  });
});
