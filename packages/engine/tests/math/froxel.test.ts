import { describe, it, expect } from "vitest";
import { sliceCenterViewDepth } from "../../src/math/froxel.js";
import { zSliceFromViewDepth } from "../../src/math/ClusterGrid.js";

// Invariants of the volumetric froxel grid math (Option R: the volume reuses the clustered
// light grid's log-staggered depth slicing -- see docs/adr/0031-volumetric-froxel-fog.md).
describe("froxel grid math", () => {
  const near = 0.1;
  const far = 1000;
  const slices = 24;

  describe("sliceCenterViewDepth", () => {
    it("is the inverse of the cluster grid's zSliceFromViewDepth for every slice", () => {
      for (let s = 0; s < slices; s++) {
        const centre = sliceCenterViewDepth(s, near, far, slices);
        expect(zSliceFromViewDepth(centre, near, far, slices)).toBe(s);
      }
    });

    it("is strictly increasing across slices and stays inside the frustum depth range", () => {
      let prev = 0;
      for (let s = 0; s < slices; s++) {
        const centre = sliceCenterViewDepth(s, near, far, slices);
        expect(centre).toBeGreaterThan(prev);
        expect(centre).toBeGreaterThan(near);
        expect(centre).toBeLessThan(far);
        prev = centre;
      }
    });

    it("clamps out-of-range slice indices into [0, slices-1]", () => {
      expect(sliceCenterViewDepth(-5, near, far, slices)).toBe(
        sliceCenterViewDepth(0, near, far, slices),
      );
      expect(sliceCenterViewDepth(999, near, far, slices)).toBe(
        sliceCenterViewDepth(slices - 1, near, far, slices),
      );
    });

    it("handles a near plane of 0 without producing NaN/Infinity", () => {
      const centre = sliceCenterViewDepth(0, 0, 100, 8);
      expect(Number.isFinite(centre)).toBe(true);
      expect(centre).toBeGreaterThan(0);
    });

    it("handles a far plane at or below near without producing NaN/Infinity", () => {
      expect(Number.isFinite(sliceCenterViewDepth(0, 1, 0.5, 8))).toBe(true);
      expect(Number.isFinite(sliceCenterViewDepth(0, 1, 1, 8))).toBe(true);
    });
  });

  describe("depth slice spacing", () => {
    it("preserves exponential depth slice ratio across consecutive slices", () => {
      const ratio = Math.pow(far / near, 1 / slices);
      for (let s = 1; s < slices - 1; s++) {
        const c0 = sliceCenterViewDepth(s, near, far, slices);
        const c1 = sliceCenterViewDepth(s + 1, near, far, slices);
        expect(c1 / c0).toBeCloseTo(ratio, 4);
      }
    });
  });
});
