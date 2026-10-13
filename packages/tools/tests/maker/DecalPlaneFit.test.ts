import { describe, it, expect } from "vitest";
import { Vector3D } from "@small-world-machine/engine";
import { fitDecalPlane } from "../../src/maker/DecalPlaneFit.js";
import type { DecalStampHit } from "../../src/maker/DecalStampTool.js";

const hit = (x: number, y: number, z: number, n: [number, number, number]): DecalStampHit => ({
  point: new Vector3D(x, y, z),
  normal: new Vector3D(...n).normalize(),
});

/** Corner hits of a 2 x 2 footprint on the plane through the origin with normal (0, 1, 0), lifted by `dy` per corner. */
const floorCorners = (dy: number[] = [0, 0, 0, 0]): DecalStampHit[] => [
  hit(-1, dy[0]!, -1, [0, 1, 0]),
  hit(1, dy[1]!, -1, [0, 1, 0]),
  hit(1, dy[2]!, 1, [0, 1, 0]),
  hit(-1, dy[3]!, 1, [0, 1, 0]),
];

describe("fitDecalPlane", () => {
  const reference = hit(0, 0, 0, [0, 1, 0]);

  it("returns the plane of a flat floor with no spread and the pointer hit as the point", () => {
    const fit = fitDecalPlane(reference, floorCorners())!;
    expect(fit.normal.y).toBeCloseTo(1);
    expect(fit.spread).toBeCloseTo(0);
    expect(fit.point.x).toBeCloseTo(0);
    expect(fit.point.y).toBeCloseTo(0);
  });

  it("recovers the normal of a slope even when the pointer hit's own normal is slightly off", () => {
    // Plane y = 0.5 z: normal (0, 1, -0.5) normalised.
    const n: [number, number, number] = [0, 1, -0.5];
    const corners = [
      hit(-1, -0.5, -1, n),
      hit(1, -0.5, -1, n),
      hit(1, 0.5, 1, n),
      hit(-1, 0.5, 1, n),
    ];
    const fit = fitDecalPlane(hit(0, 0, 0, [0.1, 1, -0.4]), corners)!;
    const expected = new Vector3D(...n).normalize();
    expect(fit.normal.x).toBeCloseTo(expected.x);
    expect(fit.normal.y).toBeCloseTo(expected.y);
    expect(fit.normal.z).toBeCloseTo(expected.z);
  });

  it("reports the height spread of an uneven patch", () => {
    const fit = fitDecalPlane(reference, floorCorners([0.04, 0, 0.04, 0]))!;
    expect(fit.spread).toBeCloseTo(0.02, 5);
  });

  it("projects the pointer hit onto the fitted plane", () => {
    const lifted = hit(0, 0.3, 0, [0, 1, 0]);
    const fit = fitDecalPlane(lifted, floorCorners())!;
    expect(fit.point.y).toBeCloseTo(0);
  });

  it("fits a plane through three corners when one ray missed", () => {
    const corners: (DecalStampHit | undefined)[] = floorCorners();
    corners[2] = undefined;
    expect(fitDecalPlane(reference, corners)!.normal.y).toBeCloseTo(1);
  });

  it("gives up with fewer than three corner hits", () => {
    const corners: (DecalStampHit | undefined)[] = floorCorners();
    corners[0] = undefined;
    corners[1] = undefined;
    expect(fitDecalPlane(reference, corners)).toBeUndefined();
  });

  it("flips a fitted normal that points away from the viewer-facing reference", () => {
    const reversed = [...floorCorners()].reverse();
    expect(fitDecalPlane(reference, reversed)!.normal.y).toBeCloseTo(1);
  });

  it("gives up when the footprint straddles a corner of a wall and a floor", () => {
    const corners = [
      hit(-1, 0, 1, [0, 1, 0]),
      hit(1, 0, 1, [0, 1, 0]),
      hit(1, 1, 0, [0, 0, 1]),
      hit(-1, 1, 0, [0, 0, 1]),
    ];
    expect(fitDecalPlane(hit(0, 0, 0.5, [0, 1, 0]), corners)).toBeUndefined();
  });

  it("gives up on collinear hits", () => {
    const line = [hit(0, 0, 0, [0, 1, 0]), hit(1, 0, 0, [0, 1, 0]), hit(2, 0, 0, [0, 1, 0])];
    expect(fitDecalPlane(reference, line)).toBeUndefined();
  });
});
