import { describe, expect, it } from "vitest";
import {
  buildLineShadowRibbon,
  LINE_SHADOW_RIBBON_VERTICES_PER_EDGE,
} from "../../src/renderers/LineShadowRibbon.js";
import { WireframeMode } from "../../src/enums/index.js";
import type { GeometryDataInterface } from "../../src/interfaces/index.js";

function geo(
  vertices: number[],
  indices?: number[],
  wireframeIndices?: number[],
): GeometryDataInterface {
  return {
    vertices: new Float32Array(vertices),
    indices: indices ? new Uint16Array(indices) : undefined,
    wireframeIndices: wireframeIndices ? new Uint16Array(wireframeIndices) : undefined,
  } as GeometryDataInterface;
}

// Triangle (0,0,0) (1,0,0) (0,1,0): triangle indices + one structural edge 0-1.
const TRI = [0, 0, 0, 1, 0, 0, 0, 1, 0];

describe("buildLineShadowRibbon", () => {
  it("expands each structural edge into 6 vertices carrying both endpoints", () => {
    const r = buildLineShadowRibbon(geo(TRI, [0, 1, 2], [0, 1]), WireframeMode.STRUCTURAL);
    expect(r.vertexCount).toBe(LINE_SHADOW_RIBBON_VERTICES_PER_EDGE);
    expect(r.positions.length).toBe(18);
    expect(r.others.length).toBe(18);
    expect(r.sides.length).toBe(12);

    for (let c = 0; c < r.vertexCount; c++) {
      const self = Array.from(r.positions.subarray(c * 3, c * 3 + 3));
      const other = Array.from(r.others.subarray(c * 3, c * 3 + 3));
      const atA = r.sides[c * 2 + 1] === 1;
      expect(self).toEqual(atA ? [0, 0, 0] : [1, 0, 0]);
      expect(other).toEqual(atA ? [1, 0, 0] : [0, 0, 0]);
      // (other - self) * y points A->B at both ends.
      expect((other[0]! - self[0]!) * r.sides[c * 2 + 1]!).toBe(1);
    }
  });

  it("covers both sides of the edge with two triangles", () => {
    const r = buildLineShadowRibbon(geo(TRI, undefined, [0, 1]), WireframeMode.STRUCTURAL);
    const sides = Array.from({ length: r.vertexCount }, (_, c) => r.sides[c * 2]);
    expect(sides.filter((s) => s === 1).length).toBe(3);
    expect(sides.filter((s) => s === -1).length).toBe(3);
  });

  it("uses `indices` in TRIANGLES mode and consecutive vertex pairs without any index list", () => {
    expect(
      buildLineShadowRibbon(geo(TRI, [0, 1, 1, 2], [0, 1]), WireframeMode.TRIANGLES).vertexCount,
    ).toBe(2 * LINE_SHADOW_RIBBON_VERTICES_PER_EDGE);
    expect(buildLineShadowRibbon(geo([...TRI, 1, 1, 0])).vertexCount).toBe(
      2 * LINE_SHADOW_RIBBON_VERTICES_PER_EDGE,
    );
  });

  it("returns an empty ribbon for an empty geometry", () => {
    const r = buildLineShadowRibbon(geo([]));
    expect(r.vertexCount).toBe(0);
    expect(r.positions.length).toBe(0);
  });
});
