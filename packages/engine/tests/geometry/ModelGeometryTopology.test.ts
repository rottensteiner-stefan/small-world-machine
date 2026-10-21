import { describe, expect, it } from "vitest";
import { ModelGeometry } from "../../src/geometry/ModelGeometry.js";
import { Topology } from "../../src/enums/index.js";

const POSITIONS = new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0]);

describe("ModelGeometry topology", () => {
  it("defaults to a triangle list with computed normals", () => {
    const data = new ModelGeometry(POSITIONS, [], [], new Uint16Array([0, 1, 2])).getGeometryData();
    expect(data.topology).toBe(Topology.TRIANGLE_LIST);
    expect(data.normals![2]).toBeCloseTo(1, 6); // +Z face normal of the CCW triangle
  });

  it("builds a line list: LINE_LIST topology, up normals, no tangents", () => {
    // 6 indices on purpose: a multiple of 3 must not be mistaken for two triangles.
    const data = new ModelGeometry(POSITIONS, [], [], new Uint16Array([0, 1, 1, 2, 2, 0]), {
      topology: Topology.LINE_LIST,
    }).getGeometryData();
    expect(data.topology).toBe(Topology.LINE_LIST);
    expect(Array.from(data.normals!)).toEqual([0, 1, 0, 0, 1, 0, 0, 1, 0]);
    expect(data.tangents ?? []).toHaveLength(0);
    expect(Array.from(data.wireframeIndices!)).toEqual([0, 1, 1, 2, 2, 0]);
  });

  it("rejects topologies the model path cannot render", () => {
    expect(
      () =>
        new ModelGeometry(POSITIONS, [], [], new Uint16Array([0, 1, 2]), {
          topology: Topology.POINT_LIST,
        }),
    ).toThrow(/Unsupported topology/);
  });
});
