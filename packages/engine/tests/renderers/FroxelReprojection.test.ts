import { describe, it, expect } from "vitest";
import { Matrix4 } from "../../src/math/index.js";

// Slicing math matching froxel.ts and WGSL compute shaders (single source of truth)
function sliceDepth(slice: number, near: number, far: number, slices: number): number {
  const n = Math.max(near, 1e-6);
  const f = Math.max(far, n + 1e-6);
  const low = Math.pow(f / n, slice / slices) * n;
  const high = Math.pow(f / n, (slice + 1.0) / slices) * n;
  return Math.max(n * 1.001, Math.sqrt(low * high));
}

function depthToNormalizedSlice(viewZ: number, near: number, far: number): number {
  const n = Math.max(near, 1e-6);
  const f = Math.max(far, n + 1e-6);
  const clampedZ = Math.min(Math.max(viewZ, n), f);
  return Math.log(clampedZ / n) / Math.max(Math.log(f / n), 1e-6);
}

function computeClipZ(zMid: number, near: number, far: number): number {
  return ((far + near) * zMid - 2.0 * near * far) / Math.max(zMid * (far - near), 1e-6);
}

describe("Froxel Reprojection & Temporal Filtering Math", () => {
  const near = 0.1;
  const far = 100.0;
  const slices = 64;

  describe("Logarithmic Slice Slicing & Inversion", () => {
    it("preserves near and far boundaries monotonically", () => {
      const z0 = sliceDepth(0, near, far, slices);
      const zLast = sliceDepth(slices - 1, near, far, slices);

      expect(z0).toBeGreaterThanOrEqual(near);
      expect(zLast).toBeLessThanOrEqual(far);
      expect(zLast).toBeGreaterThan(z0);
    });

    it("inverts depth to normalized slice coordinate accurately", () => {
      for (let s = 0; s < slices; s += 8) {
        const z = sliceDepth(s, near, far, slices);
        const normSlice = depthToNormalizedSlice(z, near, far);
        const reconstructedSlice = normSlice * slices;

        // Texel centers correspond to slice + 0.5 in normalized space
        expect(reconstructedSlice).toBeCloseTo(s + 0.5, 1);
      }
    });
  });

  describe("NDC ClipZ Unprojection", () => {
    it("reconstructs exact view-space depth through invViewProj without distortion", () => {
      const proj = new Matrix4();
      Matrix4.perspective(Math.PI / 3, 16 / 9, near, far, proj);

      const invProj = new Matrix4();
      expect(Matrix4.invert(proj, invProj)).toBe(true);

      const testDepths = [0.5, 2.0, 10.0, 50.0, 95.0];
      for (const zTest of testDepths) {
        const clipZ = computeClipZ(zTest, near, far);

        // clipZ is in OpenGL NDC [-1, 1]: at near clipZ=-1, at far clipZ=1
        expect(clipZ).toBeGreaterThanOrEqual(-1.001);
        expect(clipZ).toBeLessThanOrEqual(1.001);

        // Unproject point (0, 0, clipZ, 1) using invProj
        const m = invProj.data;
        const zViewH = m[2]! * 0 + m[6]! * 0 + m[10]! * clipZ + m[14]! * 1.0;
        const wViewH = m[3]! * 0 + m[7]! * 0 + m[11]! * clipZ + m[15]! * 1.0;
        const reconstructedZ = zViewH / wViewH;

        // In right-handed coordinates, camera looks along -Z, so reconstructedZ is -zTest
        expect(reconstructedZ).toBeCloseTo(-zTest, 2);
      }
    });
  });

  describe("3D AABB 7-Tap Variance Clamping", () => {
    it("clamps divergent history samples to the neighborhood bounds with padding", () => {
      const center = [0.2, 0.2, 0.2, 0.05];
      const neighbors = [
        [0.21, 0.19, 0.2, 0.05],
        [0.19, 0.21, 0.2, 0.05],
        [0.2, 0.22, 0.19, 0.048],
        [0.2, 0.18, 0.21, 0.052],
        [0.2, 0.2, 0.22, 0.051],
        [0.2, 0.2, 0.18, 0.049],
      ];

      const boxMin = [...center];
      const boxMax = [...center];
      for (const n of neighbors) {
        for (let c = 0; c < 4; c++) {
          boxMin[c] = Math.min(boxMin[c]!, n[c]!);
          boxMax[c] = Math.max(boxMax[c]!, n[c]!);
        }
      }

      // Add 5% padding + epsilon
      for (let c = 0; c < 4; c++) {
        const pad = 0.05 * (boxMax[c]! - boxMin[c]!) + 1e-4;
        boxMin[c] = boxMin[c]! - pad;
        boxMax[c] = boxMax[c]! + pad;
      }

      // Outlier history sample (e.g. from an old bright explosion that vanished)
      const rogueHistory = [0.95, 0.95, 0.95, 0.8];
      const clampedHistory = rogueHistory.map((val, idx) =>
        Math.min(Math.max(val, boxMin[idx]!), boxMax[idx]!),
      );

      // Must be tightly clamped to current local neighborhood
      expect(clampedHistory[0]).toBeLessThanOrEqual(boxMax[0]!);
      expect(clampedHistory[0]).toBeCloseTo(boxMax[0]!, 4);
      expect(clampedHistory[3]).toBeLessThanOrEqual(boxMax[3]!);
    });

    it("blends exponentially when history is within valid bounds", () => {
      const current = 0.2;
      const history = 0.22;
      const alpha = 0.9; // 90% history, 10% new sample

      const blended = current * (1.0 - alpha) + history * alpha;
      expect(blended).toBeCloseTo(0.218, 4);
    });

    it("resets history on first frame (alpha = 0)", () => {
      const current = 0.5;
      const history = 10.0; // Stale or uninitialized
      const alpha = 0.0;

      const blended = current * (1.0 - alpha) + history * alpha;
      expect(blended).toBe(0.5);
    });
  });

  describe("Sub-Voxel Jittering Synchronization", () => {
    it("generates zero-centered offsets bounded by element.jitter", () => {
      function ign(x: number, y: number, frame: number): number {
        const magic =
          52.9829189 * (((0.06711056 * x + 0.00583715 * y + 0.00583715 * frame) % 1.0) + 1.0);
        return magic - Math.floor(magic);
      }

      const jitterScale = 0.8;
      for (let frame = 1; frame <= 10; frame++) {
        const jx = (ign(0, 1, frame) - 0.5) * jitterScale;
        const jy = (ign(2, 3, frame) - 0.5) * jitterScale;
        const jz = (ign(4, 5, frame) - 0.5) * jitterScale;

        expect(Math.abs(jx)).toBeLessThanOrEqual(0.5 * jitterScale);
        expect(Math.abs(jy)).toBeLessThanOrEqual(0.5 * jitterScale);
        expect(Math.abs(jz)).toBeLessThanOrEqual(0.5 * jitterScale);
      }
    });
  });
});
