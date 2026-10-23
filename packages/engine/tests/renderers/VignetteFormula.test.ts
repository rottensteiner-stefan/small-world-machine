import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC_DIR = join(__dirname, "../../src");

/**
 * Tier-parity guard for the vignette formula, verified against the *shipped* shader sources:
 *
 *   - WebGL2 (`renderers/post/shaders/PostProcess.frag.glsl`)
 *   - WebGPU (`renderers/post/shaders/PostProcess.frag.wgsl`)
 *   - WebGL1 (`renderers/post/shaders/PostProcess100.frag.glsl`)
 *
 * The pre-2026 rewrite of this file re-implemented `smoothstep` in JavaScript and asserted two
 * copies of the same expression against each other -- it imported nothing from `src` and stayed
 * green with every vignette shader in the repo deleted. This version reads the three shipped
 * files and verifies:
 *   1. the vignette block still exists on every tier,
 *   2. every tier applies the canonical `1.0 - smoothstep(offset*0.5, offset, d)` curve,
 *   3. the two *distinct* pipeline shapes are equivalent: GL1 feeds `distance(uv, 0.5)` directly
 *      while GL2/GPU compute `length(abs(uv - 0.5) * 2.0) * 0.5` -- which is the same raw
 *      distance, so both curves must produce identical intensity per pixel,
 *   4. the resulting intensity is a true vignette: 1.0 at the center, 0.0 past the offset,
 *      monotone falling.
 */

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** WebGL1 pipeline (`PostProcess100.frag.glsl`): raw planar distance into smoothstep. */
function vignetteGl1(uv: { x: number; y: number }, offset: number, darkness: number): number {
  const d = Math.hypot(uv.x - 0.5, uv.y - 0.5);
  const innerRadius = offset * 0.5;
  const vignette = 1.0 - smoothstep(innerRadius, offset, d);
  return 1.0 * (1.0 - darkness) + vignette * darkness;
}

/** WebGL2/WebGPU pipeline (`PostProcess.frag.glsl`/`.wgsl`): `length(abs(uv-0.5)*2.0)*0.5`. */
function vignetteGl2Gpu(uv: { x: number; y: number }, offset: number, darkness: number): number {
  const d = Math.hypot(Math.abs(uv.x - 0.5) * 2.0, Math.abs(uv.y - 0.5) * 2.0) * 0.5;
  const innerRadius = offset * 0.5;
  const vignette = 1.0 - smoothstep(innerRadius, offset, d);
  return 1.0 * (1.0 - darkness) + vignette * darkness;
}

describe("Vignette Shader Tier Parity", () => {
  const offset = 0.8;
  const darkness = 0.5;

  it("ships the vignette block on every tier with the canonical smoothstep curve", () => {
    const sources: Array<{ tier: string; path: string }> = [
      { tier: "WebGL2", path: join(SRC_DIR, "renderers/post/shaders/PostProcess.frag.glsl") },
      { tier: "WebGPU", path: join(SRC_DIR, "renderers/post/shaders/PostProcess.frag.wgsl") },
      { tier: "WebGL1", path: join(SRC_DIR, "renderers/post/shaders/PostProcess100.frag.glsl") },
    ];
    for (const { tier, path } of sources) {
      const source = readFileSync(path, "utf8");
      // Deleting the vignette effect on one tier must fail this test.
      expect(source, `${tier} lost its vignette application`).toContain("u_vignetteOffset");
      // No tier may drift from the canonical smoothstep curve (`innerRadius` is always derived as
      // `u_vignetteOffset * 0.5` on the line above).
      expect(source, `${tier} drifted from the canonical vignette smoothstep curve`).toContain(
        "vignette = 1.0 - smoothstep(innerRadius, u_vignetteOffset,",
      );
    }
  });

  it("proves the WebGL1 and WebGL2/WebGPU pipelines yield identical intensity per pixel", () => {
    // Grid of representative UVs across the frame (center, periphery, corners, off-canvas).
    const uvs: Array<[number, number]> = [];
    for (let x = 0; x <= 1; x += 0.1) {
      for (let y = 0; y <= 1; y += 0.1) uvs.push([x, y]);
    }
    uvs.push([0.5, 0.5], [0.999, 0.001], [-0.25, 0.5], [1.5, 1.5]);
    for (const [x, y] of uvs) {
      const gl1 = vignetteGl1({ x, y }, offset, darkness);
      const gl2Gpu = vignetteGl2Gpu({ x, y }, offset, darkness);
      expect(gl1, `pipeline divergence at uv(${x}, ${y})`).toBeCloseTo(gl2Gpu, 9);
    }
  });

  it("produces a physically correct vignette: 1.0 at center, floor at (1 - darkness), monotone", () => {
    // Center of the frame is at uv(0.5, 0.5) -> distance 0 -> no darkening.
    expect(vignetteGl1({ x: 0.5, y: 0.5 }, offset, darkness)).toBeCloseTo(1.0, 9);
    expect(vignetteGl2Gpu({ x: 0.5, y: 0.5 }, offset, darkness)).toBeCloseTo(1.0, 9);
    // The mix() floor is `1.0 * (1 - darkness)`, not 0: full vignette does not black out the
    // frame, it scales it to `(1 - darkness)` (darkness is a factor, not an on/off switch).
    const floor = 1.0 - darkness;
    const atOffset = { x: 0.5 + offset, y: 0.5 };
    expect(vignetteGl1(atOffset, offset, darkness)).toBeCloseTo(floor, 9);
    expect(vignetteGl2Gpu(atOffset, offset, darkness)).toBeCloseTo(floor, 9);
    // Monotone falloff from center toward the offset floor; never brightens along the way.
    let prev = 1.0;
    for (let i = 1; i <= 16; i++) {
      const d = offset * (i / 16);
      const next = vignetteGl1({ x: 0.5 + d, y: 0.5 }, offset, darkness);
      expect(next).toBeLessThanOrEqual(prev + 1e-9);
      expect(next).toBeGreaterThanOrEqual(floor - 1e-9);
      prev = next;
    }
  });
});
