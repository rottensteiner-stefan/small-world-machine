import { describe, it, expect } from "vitest";
import { FogVolume } from "../../src/core/objects/FogVolume.js";
import { Vector3D } from "../../src/math/index.js";

describe("FogVolume", () => {
  describe("Inverse World Transformation", () => {
    it("transforms world coordinates to local volume space", () => {
      const vol = new FogVolume({ size: new Vector3D(5, 5, 5) });
      vol.position.set(10, 20, 30);
      vol.updateMatrixWorld(true);

      const inv = vol.getInverseWorldMatrix();
      // Transforming a point at (10, 20, 30) should yield (0, 0, 0) in local space
      const px = 10;
      const py = 20;
      const pz = 30;
      const pw = 1;
      const d = inv.data;
      const pLocalX = d[0]! * px + d[4]! * py + d[8]! * pz + d[12]! * pw;
      const pLocalY = d[1]! * px + d[5]! * py + d[9]! * pz + d[13]! * pw;
      const pLocalZ = d[2]! * px + d[6]! * py + d[10]! * pz + d[14]! * pw;

      expect(pLocalX).toBeCloseTo(0, 4);
      expect(pLocalY).toBeCloseTo(0, 4);
      expect(pLocalZ).toBeCloseTo(0, 4);
    });
  });

  it("getInverseWorldMatrix falls back to identity for a zero-scale volume", () => {
    const fog = new FogVolume();
    fog.setScale(0, 0, 0);
    fog.updateMatrixWorld(true);
    const inv = fog.getInverseWorldMatrix();
    expect(Array.from(inv.data)).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  });
});
