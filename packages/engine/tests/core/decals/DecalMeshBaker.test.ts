import { afterEach, describe, expect, it, vi } from "vitest";
import { Object3D } from "../../../src/core/Object3D.js";
import { Decal } from "../../../src/core/objects/Decal.js";
import {
  bakeDecalMesh,
  bakeSceneDecals,
  clipPolygonToUnitBox,
  clipTrianglesToDecalBox,
} from "../../../src/core/decals/DecalMeshBaker.js";
import {
  BasicMaterial,
  DecalMaterial,
  StandardMaterial,
} from "../../../src/core/materials/index.js";
import { Color } from "../../../src/core/colors/index.js";
import { ModelGeometry } from "../../../src/geometry/index.js";
import { CullMode } from "../../../src/enums/index.js";
import type { Matrix4 } from "../../../src/math/index.js";

/** World matrix of a translated/rotated/scaled node. */
function worldOf(
  position: [number, number, number] = [0, 0, 0],
  rotation: [number, number, number] = [0, 0, 0],
  scale: [number, number, number] = [1, 1, 1],
): Matrix4 {
  const node = new Object3D("n");
  node
    .setPosition(...position)
    .setRotation(...rotation)
    .setScale(...scale);
  node.updateMatrixWorld(true);
  return node.worldMatrix;
}

/** Counter-clockwise seen from +Y (normal up) when written as (x, z) pairs in this order. */
const UP_TRIANGLE = [-0.2, 0, 0.2, 0.2, 0, 0.2, 0, 0, -0.2];

function receiver(
  positions: number[],
  world: Matrix4 = worldOf(),
  indices?: number[],
): { positions: number[]; indices?: number[]; world: Matrix4 } {
  return indices ? { positions, indices, world } : { positions, world };
}

const DECAL_WORLD = worldOf();

function vertexAt(
  baked: { positions: Float32Array; uvs: Float32Array },
  x: number,
  z: number,
): number {
  for (let i = 0; i < baked.positions.length / 3; i++) {
    if (
      Math.abs(baked.positions[i * 3]! - x) < 1e-4 &&
      Math.abs(baked.positions[i * 3 + 2]! - z) < 1e-4
    ) {
      return i;
    }
  }
  return -1;
}

describe("clipPolygonToUnitBox", () => {
  it("keeps a polygon fully inside", () => {
    expect(
      clipPolygonToUnitBox([
        [0, 0, 0],
        [0.2, 0, 0],
        [0, 0, 0.2],
      ]),
    ).toHaveLength(3);
  });

  it("drops a polygon fully outside", () => {
    expect(
      clipPolygonToUnitBox([
        [3, 0, 0],
        [4, 0, 0],
        [3, 0, 1],
      ]),
    ).toHaveLength(0);
  });

  it("turns a triangle crossing one plane into a quad", () => {
    const poly = clipPolygonToUnitBox([
      [0.3, 0, 0.2],
      [0.8, 0, 0.2],
      [0.3, 0, -0.2],
    ]);
    expect(poly).toHaveLength(4);
    for (const p of poly) expect(p[0]).toBeLessThanOrEqual(0.5 + 1e-6);
  });

  it("turns a triangle cutting a corner into a pentagon", () => {
    const poly = clipPolygonToUnitBox([
      [-0.2, 0, -0.2],
      [-0.2, 0, 1],
      [1, 0, -0.2],
    ]);
    expect(poly).toHaveLength(5);
  });
});

describe("clipTrianglesToDecalBox", () => {
  it("emits one triangle with flat up normals for a triangle fully inside", () => {
    const baked = clipTrianglesToDecalBox(DECAL_WORLD, [receiver(UP_TRIANGLE)], 85)!;
    expect(baked.indices).toHaveLength(3);
    expect(baked.positions).toHaveLength(9);
    for (let i = 0; i < 3; i++) {
      expect(baked.normals[i * 3 + 1]).toBeCloseTo(1, 5);
    }
  });

  it("returns undefined for a triangle outside the box or in the wrong height", () => {
    const far = receiver(UP_TRIANGLE, worldOf([5, 0, 0]));
    const high = receiver(UP_TRIANGLE, worldOf([0, 2, 0]));
    expect(clipTrianglesToDecalBox(DECAL_WORLD, [far, high], 85)).toBeUndefined();
  });

  it("fans a clipped corner polygon into three triangles", () => {
    const corner = receiver([-0.2, 0, -0.2, -0.2, 0, 1, 1, 0, -0.2]);
    const baked = clipTrianglesToDecalBox(DECAL_WORLD, [corner], 85)!;
    expect(baked.positions.length / 3).toBe(5);
    expect(baked.indices).toHaveLength(9);
  });

  it("maps a floor quad onto UV (0,0)..(1,1) with the box corners at the right places", () => {
    const decal = worldOf([0, 0, 0], [0, 0, 0], [2, 1, 2]);
    const quad = receiver([-5, 0, 5, 5, 0, 5, 5, 0, -5, -5, 0, -5], worldOf(), [0, 1, 2, 0, 2, 3]);
    const baked = clipTrianglesToDecalBox(decal, [quad], 85)!;
    const uvMin = [Math.min(...baked.uvs.filter((_, i) => i % 2 === 0))];
    const uvMax = [Math.max(...baked.uvs.filter((_, i) => i % 2 === 0))];
    expect(uvMin[0]).toBeCloseTo(0, 5);
    expect(uvMax[0]).toBeCloseTo(1, 5);
    // box (x=-0.5, z=-0.5) is world (-1, -1): uv (0, 0); box (0.5, 0.5) is world (1, 1): uv (1, 1)
    const a = vertexAt(baked, -1, -1);
    const b = vertexAt(baked, 1, 1);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(b).toBeGreaterThanOrEqual(0);
    expect([baked.uvs[a * 2], baked.uvs[a * 2 + 1]]).toEqual([
      expect.closeTo(0, 5),
      expect.closeTo(0, 5),
    ]);
    expect([baked.uvs[b * 2], baked.uvs[b * 2 + 1]]).toEqual([
      expect.closeTo(1, 5),
      expect.closeTo(1, 5),
    ]);
  });

  it("drops back-facing triangles", () => {
    const down = receiver([-0.2, 0, 0.2, 0, 0, -0.2, 0.2, 0, 0.2]);
    expect(clipTrianglesToDecalBox(DECAL_WORLD, [down], 85)).toBeUndefined();
  });

  it("cuts triangles steeper than angleFadeEnd and keeps shallower ones", () => {
    const tilted = receiver(UP_TRIANGLE, worldOf([0, 0, 0], [(80 * Math.PI) / 180, 0, 0]));
    expect(clipTrianglesToDecalBox(DECAL_WORLD, [tilted], 70)).toBeUndefined();
    expect(clipTrianglesToDecalBox(DECAL_WORLD, [tilted], 85)).toBeDefined();
  });

  it("lifts the surface along the receiver normal by the offset", () => {
    const def = clipTrianglesToDecalBox(DECAL_WORLD, [receiver(UP_TRIANGLE)], 85)!;
    expect(def.positions[1]).toBeCloseTo(0.002, 6);
    const custom = clipTrianglesToDecalBox(DECAL_WORLD, [receiver(UP_TRIANGLE)], 85, 0.05)!;
    expect(custom.positions[1]).toBeCloseTo(0.05, 6);
  });

  it("handles a rotated and scaled decal over a translated receiver", () => {
    const decal = worldOf([10, 2, 3], [0, Math.PI / 2, 0], [2, 1, 4]);
    const quad = receiver(
      [-20, 0, 20, 20, 0, 20, 20, 0, -20, -20, 0, -20],
      worldOf([10, 2, 3]),
      [0, 1, 2, 0, 2, 3],
    );
    const baked = clipTrianglesToDecalBox(decal, [quad], 85)!;
    const xs = baked.positions.filter((_, i) => i % 3 === 0);
    const zs = baked.positions.filter((_, i) => i % 3 === 2);
    // local x (scale 2) runs along world z, local z (scale 4) along world x after the 90 degree yaw
    expect(Math.min(...xs)).toBeCloseTo(10 - 2, 4);
    expect(Math.max(...xs)).toBeCloseTo(10 + 2, 4);
    expect(Math.min(...zs)).toBeCloseTo(3 - 1, 4);
    expect(Math.max(...zs)).toBeCloseTo(3 + 1, 4);
    expect(baked.positions[1]).toBeCloseTo(2.002, 5);
  });

  it("keeps front faces front for a mirrored receiver", () => {
    const mirrored = receiver(UP_TRIANGLE, worldOf([0, 0, 0], [0, 0, 0], [-1, 1, 1]));
    const baked = clipTrianglesToDecalBox(DECAL_WORLD, [mirrored], 85)!;
    expect(baked.normals[1]).toBeCloseTo(1, 5);
  });

  it("rejects a receiver via its local bounds without touching triangles", () => {
    const far = {
      ...receiver(UP_TRIANGLE),
      localBounds: { min: [4, -1, 4], max: [5, 1, 5] },
    };
    expect(clipTrianglesToDecalBox(DECAL_WORLD, [far], 85)).toBeUndefined();
  });
});

function floorMesh(name: string = "Floor"): Object3D {
  const floor = new Object3D(name);
  floor.geometry = new ModelGeometry(
    [-5, 0, 5, 5, 0, 5, 5, 0, -5, -5, 0, -5],
    [0, 0, 1, 0, 1, 1, 0, 1],
    [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0],
    [0, 1, 2, 0, 2, 3],
  ).getGeometryData();
  floor.material = new StandardMaterial();
  return floor;
}

function makeDecal(material: DecalMaterial = new DecalMaterial()): Decal {
  const decal = new Decal(material, "Stain");
  decal.setPosition(1, 0, 1).setScale(2, 1, 2);
  decal.updateMatrixWorld(true);
  return decal;
}

afterEach(() => vi.restoreAllMocks());

describe("bakeDecalMesh", () => {
  it("builds a transparent, non-depth-writing mesh in world space with the decal opacity", () => {
    const floor = floorMesh();
    floor.updateMatrixWorld(true);
    const decal = makeDecal(new DecalMaterial({ color: new Color(1, 1, 1, 0.4) }));
    const mesh = bakeDecalMesh(decal, [floor])!;
    expect(mesh).toBeDefined();
    const material = mesh.material as StandardMaterial;
    expect(material).toBeInstanceOf(StandardMaterial);
    expect(material.transparent).toBe(true);
    expect(material.depthWrite).toBe(false);
    expect(material.cullMode).toBe(CullMode.NONE);
    expect(material.color.a).toBeCloseTo(0.4, 5);
    expect(mesh.position.x).toBeCloseTo(1, 5);
    expect(mesh.geometry!.vertices.length).toBeGreaterThanOrEqual(12);
    expect(mesh.geometry!.uvs!.length / 2).toBe(mesh.geometry!.vertices.length / 3);
  });

  it("uses an unlit material for unlit decals", () => {
    const floor = floorMesh();
    floor.updateMatrixWorld(true);
    const mesh = bakeDecalMesh(makeDecal(new DecalMaterial({ unlit: true })), [floor])!;
    expect(mesh.material).toBeInstanceOf(BasicMaterial);
  });

  it("returns undefined when nothing is hit", () => {
    const floor = floorMesh().setPosition(0, 10, 0);
    floor.updateMatrixWorld(true);
    expect(bakeDecalMesh(makeDecal(), [floor])).toBeUndefined();
  });

  it("skips skinned receivers with a warning and still bakes the others", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const skinned = floorMesh("Skinned");
    skinned.geometry!.joints = new Uint16Array(16);
    skinned.geometry!.weights = new Float32Array(16);
    const floor = floorMesh();
    skinned.updateMatrixWorld(true);
    floor.updateMatrixWorld(true);

    expect(bakeDecalMesh(makeDecal(), [skinned])).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Skinned"));
    expect(bakeDecalMesh(makeDecal(), [skinned, floor])).toBeDefined();
  });

  it("skips receivers without geometry data with a warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const empty = new Object3D("Empty");
    empty.geometry = {
      vertices: new Float32Array(0),
      getBoundingVolume: floorMesh().geometry!.getBoundingVolume,
    };
    expect(bakeDecalMesh(makeDecal(), [empty])).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("no geometry"));
  });
});

describe("bakeSceneDecals", () => {
  it("bakes each decal against the scene meshes, adds the result to the root and hides the box", () => {
    const root = new Object3D("Root");
    const floor = floorMesh();
    const decal = makeDecal();
    root.add(floor, decal);
    const baked = bakeSceneDecals(root);
    expect(baked).toHaveLength(1);
    expect(root.children).toContain(baked[0]);
    expect(decal.isVisible).toBe(false);
  });

  it("keeps the box when hideBakedDecals is false and ignores decals that hit nothing", () => {
    const root = new Object3D("Root");
    const decal = makeDecal();
    root.add(floorMesh().setPosition(0, 10, 0), decal);
    expect(bakeSceneDecals(root, { hideBakedDecals: false })).toHaveLength(0);
    expect(decal.isVisible).toBe(true);
  });
});
