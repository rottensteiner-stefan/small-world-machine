import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// J02: the LINEAR fog divisor `(fogFar - fogNear)` divides by exactly zero when the two limits
// coincide (`fogNear == fogFar`), producing NaN mix factors and NaN pixels in every shader that
// reads these chunks. The fix clamps the divisor to a small epsilon in both tiers. This test pins
// the guard in the shared fog chunks so a future edit cannot silently return to the NaN divisor.

const ROOT = join(__dirname, "..", "..", "..", "..");
const FOG_WGSL = join(
  ROOT,
  "packages/engine/src/renderers/shaders/source/web_gpu/chunks/fog_calc.wgsl",
);
const FOG_GLSL = join(ROOT, "packages/engine/src/core/materials/shaders/chunks/fog_calc.glsl");

describe("J02: LINEAR fog divisor is guarded against zero", () => {
  it("fog_calc.wgsl clamps the LINEAR divisor", () => {
    const src = readFileSync(FOG_WGSL, "utf8");
    expect(src).toMatch(
      /fogFactor = \(global\.fogFar - fogDist\) \/ max\(global\.fogFar - global\.fogNear, 1e-4\);/,
    );
    // No unguarded divisor may return anywhere in the file.
    expect(src).not.toMatch(/\) \/ \(global\.fogFar - global\.fogNear\);/);
  });

  it("fog_calc.glsl clamps the LINEAR divisor", () => {
    const src = readFileSync(FOG_GLSL, "utf8");
    expect(src).toMatch(/fogFactor = \(u_fogFar - fogDist\) \/ max\(u_fogFar - u_fogNear, 1e-4\);/);
    expect(src).not.toMatch(/\) \/ \(u_fogFar - u_fogNear\);/);
  });
});
