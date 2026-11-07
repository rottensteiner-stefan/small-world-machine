import { describe, expect, it } from "vitest";
import { compileScalarAssignment, readSource } from "../math/_shaderScalar.js";

// G08: the directional-cascade seam blend must behave IDENTICALLY on every tier carrying CSM
// shadows. The real `blendBand` / `blendToNext` expressions are extracted from each shader and
// executed (no text pinning): they must match one reference law and satisfy the seam invariants.

const SITES = [
  "packages/engine/src/renderers/shaders/source/web_gl2/chunks/light_calc_pbr.frag.glsl",
  "packages/engine/src/renderers/shaders/source/web_gl2/chunks/light_calc.frag.glsl",
  "packages/engine/src/renderers/shaders/source/web_gpu/compute/froxel_integrate.wgsl",
  "packages/engine/src/renderers/shaders/source/web_gpu/chunks/lighting_pbr.wgsl",
  "packages/engine/src/renderers/shaders/source/web_gpu/chunks/lighting.wgsl",
  "packages/engine/src/renderers/shaders/source/web_gpu/chunks/glass_pbr_loops.wgsl",
];

/** Canonical law: linear ramp over the last 10% of the cascade split distance. */
function referenceBlend(splitFar: number, d: number): number {
  const band = Math.max(splitFar * 0.1, 0.0001);
  return 1 - Math.min(Math.max((splitFar - d) / band, 0), 1);
}

const SPLITS = [0.5, 4, 25, 120, 1000];

function loadBlend(file: string): (splitFar: number, d: number) => number {
  const src = readSource(file);
  const band = compileScalarAssignment(src, "blendBand", ["splitFar"]);
  const blend = compileScalarAssignment(
    src,
    "blendToNext",
    ["splitFar", "depth", "viewDist", "blendBand"],
    "blendBand",
  );
  return (splitFar, d) => blend(splitFar, d, d, band(splitFar));
}

describe("cascade blend parity across all CSM tiers (G08)", () => {
  for (const file of SITES) {
    describe(file.split("/").pop() as string, () => {
      const blend = loadBlend(file);

      it("matches the reference law over a depth sweep", () => {
        for (const s of SPLITS) {
          for (let i = 0; i <= 200; i++) {
            const d = (s * 1.2 * i) / 200;
            expect(blend(s, d)).toBeCloseTo(referenceBlend(s, d), 9);
          }
        }
      });

      it("is 0 before the band, 1 at the split, C0-continuous and monotone", () => {
        for (const s of SPLITS) {
          expect(blend(s, 0)).toBe(0);
          expect(blend(s, s * 0.9 - 1e-6)).toBe(0);
          expect(blend(s, s)).toBe(1);
          let prev = -1;
          for (let i = 0; i <= 400; i++) {
            const v = blend(s, (s * i) / 400);
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThanOrEqual(1);
            expect(v).toBeGreaterThanOrEqual(prev - 1e-12);
            prev = v;
          }
        }
      });
    });
  }
});
