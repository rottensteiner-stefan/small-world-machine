import { describe, expect, it } from "vitest";
import {
  AUTO_INSTANCING_MIN_RUN,
  partitionInstanceRuns,
} from "../../src/renderers/AutoInstancing.js";
import { Object3D } from "../../src/core/Object3D.js";
import { Cube } from "../../src/geometry/Cube.js";
import { SkinnedMesh } from "../../src/core/animation/SkinnedMesh.js";
import { InstancedMesh } from "../../src/core/InstancedMesh.js";
import { BasicMaterial } from "../../src/core/materials/surface/BasicMaterial.js";
import type { GeometryDataInterface } from "../../src/interfaces/index.js";

function objs(geo: GeometryDataInterface, n: number): Object3D[] {
  return Array.from({ length: n }, (_, i) => {
    const o = new Object3D(`o${i}`);
    o.geometry = geo;
    return o;
  });
}

function split(objects: Object3D[]): { runObjects: Object3D[]; runs: number[]; rest: Object3D[] } {
  const out = { runObjects: [] as Object3D[], runs: [] as number[], rest: [] as Object3D[] };
  partitionInstanceRuns(objects, out.runObjects, out.runs, out.rest);
  return out;
}

describe("partitionInstanceRuns", () => {
  const a = new Cube().getGeometryData();
  const b = new Cube({ size: 2 }).getGeometryData();

  it("turns a long same-geometry stretch into one run", () => {
    const list = objs(a, 10);
    const { runObjects, runs, rest } = split(list);
    expect(runs).toEqual([0, 10]);
    expect(runObjects).toEqual(list);
    expect(rest).toEqual([]);
  });

  it(`keeps stretches shorter than ${AUTO_INSTANCING_MIN_RUN} on the per-object path`, () => {
    const short = objs(a, AUTO_INSTANCING_MIN_RUN - 1);
    const long = objs(b, AUTO_INSTANCING_MIN_RUN);
    const { runs, rest, runObjects } = split([...short, ...long]);
    expect(rest).toEqual(short);
    expect(runs).toEqual([0, AUTO_INSTANCING_MIN_RUN]);
    expect(runObjects).toEqual(long);
  });

  it("splits runs at a geometry change and leaves skinned or geometry-less objects out", () => {
    const first = objs(a, 4);
    const second = objs(b, 5);
    const skinned = objs(a, 1)[0]!;
    Object.setPrototypeOf(skinned, SkinnedMesh.prototype);
    const empty = new Object3D("empty");
    const { runs, rest } = split([...first, skinned, empty, ...second]);
    expect(runs).toEqual([0, 4, 4, 9]);
    expect(rest).toEqual([skinned, empty]);
  });

  it("never puts an InstancedMesh into a run, and drops non-casters when casters are required", () => {
    const list = objs(a, 6);
    list[1] = new InstancedMesh("inst", a, new BasicMaterial(), 3);
    list.forEach((o, i) => (o.castShadow = i !== 4));
    const { runs, rest } = split(list);
    expect(runs).toEqual([0, 4]); // objects 2..5 (index 1 is the InstancedMesh)
    expect(rest).toEqual([list[0], list[1]]);

    const out = { runObjects: [] as Object3D[], runs: [] as number[], rest: [] as Object3D[] };
    partitionInstanceRuns(list, out.runObjects, out.runs, out.rest, true);
    expect(out.runs).toEqual([]); // the non-caster at index 4 breaks the stretch
  });
});
