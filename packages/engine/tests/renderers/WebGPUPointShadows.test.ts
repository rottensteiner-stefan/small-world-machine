import "../../src/index.js";
import { describe, expect, it } from "vitest";
import { cubeFaceForDirection } from "../../src/core/lights/PointLightShadow.js";
import PBR_MATH_WGSL from "../../src/renderers/shaders/source/web_gpu/chunks/pbr_math.wgsl?raw";
import LIGHTING_WGSL from "../../src/renderers/shaders/source/web_gpu/chunks/lighting.wgsl?raw";
import LIGHTING_PBR_WGSL from "../../src/renderers/shaders/source/web_gpu/chunks/lighting_pbr.wgsl?raw";
import GLASS_LOOPS_WGSL from "../../src/renderers/shaders/source/web_gpu/chunks/glass_pbr_loops.wgsl?raw";

/** Source of the point-light loop of a lighting chunk (up to the spot-light loop). */
function pointLoop(source: string): string {
  const start = source.indexOf("pointClusterGrid[clusterCellIndex]");
  const end = source.indexOf("spotClusterGrid[clusterCellIndex]");
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("WGSL point-light shadow lookup", () => {
  it.each([
    ["lighting.wgsl", LIGHTING_WGSL],
    ["lighting_pbr.wgsl", LIGHTING_PBR_WGSL],
    ["glass_pbr_loops.wgsl", GLASS_LOOPS_WGSL],
  ])("%s multiplies the point shadow into every point light", (_name, source) => {
    const loop = pointLoop(source);
    expect(loop).toMatch(/let pShadow = getPointShadow\(u_spotShadowMap, shadowSampler, j,/);
    expect(loop).toMatch(/\* pShadow/);
  });

  it("samples layer 4 + slot * 6 + face with the slot's face matrix", () => {
    expect(PBR_MATH_WGSL).toMatch(/global\.pointShadowMatrices\[m\]/);
    expect(PBR_MATH_WGSL).toMatch(/4u \+ m/);
    expect(PBR_MATH_WGSL).toMatch(/slot \* 6u \+ pointShadowFace\(/);
  });

  it("pointShadowFace matches cubeFaceForDirection, ties included", () => {
    const match = /fn pointShadowFace\(d: vec3f\) -> u32 \{([\s\S]*?)\n\}/.exec(PBR_MATH_WGSL);
    expect(match).not.toBeNull();
    // Tiny WGSL -> JS transliteration of this one function; any rewrite of it must stay readable
    // by these rules or this test needs the same update.
    const js = match![1]!
      .replace(
        "let a = abs(d);",
        "const a = { x: Math.abs(d.x), y: Math.abs(d.y), z: Math.abs(d.z) };",
      )
      .replace(/select\(([^,]+), ([^,]+), ([^)]+)\)/g, "(($3) ? $2 : $1)")
      .replace(/(\d)u\b/g, "$1");
    const face = new Function("d", js) as (d: { x: number; y: number; z: number }) => number;

    const values = [-1, -0.5, 0, 0.5, 1];
    for (const x of values) {
      for (const y of values) {
        for (const z of values) {
          expect(face({ x, y, z }), `(${x}, ${y}, ${z})`).toBe(cubeFaceForDirection(x, y, z));
        }
      }
    }
    for (let i = 0; i < 200; i++) {
      const d = { x: Math.sin(i * 1.7), y: Math.cos(i * 2.3), z: Math.sin(i * 0.9 + 1) };
      expect(face(d)).toBe(cubeFaceForDirection(d.x, d.y, d.z));
    }
  });
});
