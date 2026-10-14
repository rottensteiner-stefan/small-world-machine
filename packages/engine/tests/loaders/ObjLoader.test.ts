import { describe, it, expect } from "vitest";
import { ObjLoader } from "../../src/loaders/ObjLoader.js";

describe("ObjLoader", () => {
  it("supports positive 1-based indices", async () => {
    const objText = `
v 0 0 0
v 1 0 0
v 0 1 0
f 1 2 3
`;
    const loader = new ObjLoader();
    const parse = (
      loader as unknown as { _parse: (text: string, path: string) => Promise<unknown> }
    )._parse.bind(loader);
    const root = (await parse(objText, "")) as {
      children: { geometry: { vertices: Float32Array; indices: Uint16Array } }[];
    };

    expect(root.children).toHaveLength(1);
    const geo = root.children[0]!.geometry;
    expect(geo.vertices).toHaveLength(9);
    expect(Array.from(geo.indices)).toEqual([0, 1, 2]);
  });

  it("supports negative relative vertex indices (e.g. -1 referencing the last defined vertex)", async () => {
    const objText = `
v 0 0 0
v 1 0 0
v 0 1 0
f -3 -2 -1
`;
    const loader = new ObjLoader();
    const parse = (
      loader as unknown as { _parse: (text: string, path: string) => Promise<unknown> }
    )._parse.bind(loader);
    const root = (await parse(objText, "")) as {
      children: { geometry: { vertices: Float32Array; indices: Uint16Array } }[];
    };

    expect(root.children).toHaveLength(1);
    const geo = root.children[0]!.geometry;
    expect(geo.vertices).toHaveLength(9);
    expect(Array.from(geo.vertices)).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    expect(Array.from(geo.indices)).toEqual([0, 1, 2]);
  });

  it("supports negative relative vt and vn indices", async () => {
    const objText = `
v 0 0 0
vt 0.1 0.2
vn 0 0 1
v 1 0 0
vt 0.3 0.4
vn 0 0 1
v 0 1 0
vt 0.5 0.6
vn 0 0 1
f -3/-3/-3 -2/-2/-2 -1/-1/-1
`;
    const loader = new ObjLoader();
    const parse = (
      loader as unknown as { _parse: (text: string, path: string) => Promise<unknown> }
    )._parse.bind(loader);
    const root = (await parse(objText, "")) as {
      children: {
        geometry: {
          vertices: Float32Array;
          uvs: Float32Array;
          normals: Float32Array;
          indices: Uint16Array;
        };
      }[];
    };

    expect(root.children).toHaveLength(1);
    const geo = root.children[0]!.geometry;
    expect(geo.uvs).toHaveLength(6);
    expect(geo.uvs[0]).toBeCloseTo(0.1);
    expect(geo.uvs[1]).toBeCloseTo(0.2);
    expect(geo.uvs[2]).toBeCloseTo(0.3);
    expect(geo.uvs[3]).toBeCloseTo(0.4);
    expect(geo.uvs[4]).toBeCloseTo(0.5);
    expect(geo.uvs[5]).toBeCloseTo(0.6);
  });

  it("does not collide cache keys when negative relative index -1 refers to different vertices at different times", async () => {
    // Two triangles defined sequentially using relative indices:
    // First triangle uses vertices 1, 2, 3 (via -3, -2, -1)
    // Second triangle defines vertices 4, 5, 6 and uses them (via -3, -2, -1)
    const objText = `
v 0 0 0
v 1 0 0
v 0 1 0
f -3 -2 -1
v 2 2 2
v 3 2 2
v 2 3 2
f -3 -2 -1
`;
    const loader = new ObjLoader();
    const parse = (
      loader as unknown as { _parse: (text: string, path: string) => Promise<unknown> }
    )._parse.bind(loader);
    const root = (await parse(objText, "")) as {
      children: { geometry: { vertices: Float32Array; indices: Uint16Array } }[];
    };

    expect(root.children).toHaveLength(1);
    const geo = root.children[0]!.geometry;
    // Total 6 distinct vertices (18 coordinates)
    expect(geo.vertices).toHaveLength(18);
    // 6 indices: 0, 1, 2, 3, 4, 5
    expect(Array.from(geo.indices)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(Array.from(geo.vertices.slice(0, 9))).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    expect(Array.from(geo.vertices.slice(9, 18))).toEqual([2, 2, 2, 3, 2, 2, 2, 3, 2]);
  });
});
