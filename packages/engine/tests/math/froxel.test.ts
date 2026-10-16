import { describe, it, expect } from "vitest";
import {
  sliceCenterViewDepth,
  froxelDepthSlices,
  clampFroxelMaxDistance,
  froxelSliceFromViewDepth,
} from "../../src/math/froxel.js";
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

  describe("froxelDepthSlices", () => {
    it("derives a whole z slice count from the cluster grid's z dimension", () => {
      expect(froxelDepthSlices(24)).toBe(24);
      expect(froxelDepthSlices(24.7)).toBe(24);
    });

    it("never returns fewer than one slice", () => {
      expect(froxelDepthSlices(0)).toBe(1);
      expect(froxelDepthSlices(-3)).toBe(1);
    });
  });

  describe("clampFroxelMaxDistance", () => {
    it("clamps against the scene far plane", () => {
      expect(clampFroxelMaxDistance(80, 1000)).toBe(80);
      expect(clampFroxelMaxDistance(5000, 1000)).toBe(1000);
    });

    it("never returns a distance below 1.0 m", () => {
      expect(clampFroxelMaxDistance(0.5, 1000)).toBe(1);
      expect(clampFroxelMaxDistance(0, 1000)).toBe(1);
    });

    it("degrades to the 1.0 m floor when the far plane is degenerate", () => {
      expect(clampFroxelMaxDistance(80, 0.5)).toBe(1);
      expect(clampFroxelMaxDistance(80, 0)).toBe(1);
      expect(clampFroxelMaxDistance(80, -5)).toBe(1);
    });
  });

  describe("froxelSliceFromViewDepth", () => {
    it("delegates to the cluster grid's zSliceFromViewDepth (single source of truth)", () => {
      for (const depth of [0.5, 1, 8, 42, 900, 2000]) {
        expect(froxelSliceFromViewDepth(depth, near, far, slices)).toBe(
          zSliceFromViewDepth(depth, near, far, slices),
        );
      }
    });
  });

  describe("volumetric integration and reprojection invariants", () => {
    it("preserves exponential depth slice ratio across consecutive slices", () => {
      const ratio = Math.pow(far / near, 1 / slices);
      for (let s = 1; s < slices - 1; s++) {
        const c0 = sliceCenterViewDepth(s, near, far, slices);
        const c1 = sliceCenterViewDepth(s + 1, near, far, slices);
        expect(c1 / c0).toBeCloseTo(ratio, 4);
      }
    });

    it("Beer-Lambert transmittance satisfies multiplicative composition tau(a+b) == tau(a)*tau(b)", () => {
      const extinction = 0.05;
      const stepA = 2.5;
      const stepB = 4.0;
      const tauA = Math.exp(-extinction * stepA);
      const tauB = Math.exp(-extinction * stepB);
      const tauCombined = Math.exp(-extinction * (stepA + stepB));
      expect(tauA * tauB).toBeCloseTo(tauCombined, 6);
    });

    it("AABB variance clamp restricts history color within neighbourhood min/max envelope", () => {
      const neighbours = [
        [0.2, 0.2, 0.2],
        [0.25, 0.22, 0.21],
        [0.3, 0.28, 0.25],
        [0.18, 0.19, 0.2],
      ];
      const minVal = [
        Math.min(...neighbours.map((n) => n[0]!)),
        Math.min(...neighbours.map((n) => n[1]!)),
        Math.min(...neighbours.map((n) => n[2]!)),
      ];
      const maxVal = [
        Math.max(...neighbours.map((n) => n[0]!)),
        Math.max(...neighbours.map((n) => n[1]!)),
        Math.max(...neighbours.map((n) => n[2]!)),
      ];

      const outlierHistory = [0.9, -0.1, 0.5];
      const clamped = [
        Math.max(minVal[0]!, Math.min(maxVal[0]!, outlierHistory[0]!)),
        Math.max(minVal[1]!, Math.min(maxVal[1]!, outlierHistory[1]!)),
        Math.max(minVal[2]!, Math.min(maxVal[2]!, outlierHistory[2]!)),
      ];

      expect(clamped[0]).toBe(maxVal[0]);
      expect(clamped[1]).toBe(minVal[1]);
      expect(clamped[2]).toBe(maxVal[2]);
    });
  });
});
