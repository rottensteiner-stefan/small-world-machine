import { describe, it, expect } from "vitest";

describe("Light Shafts Shader Mathematics & Algorithms", () => {
  describe("Schlick phase function vs Henyey-Greenstein approximation", () => {
    // Schlick (1993) phase function:
    // k ~ 1.55 * g - 0.55 * g^3
    // p(cosTheta, k) = (1 - k^2) / (4 * PI * (1 + k * cosTheta)^2)
    function schlickK(g: number): number {
      return 1.55 * g - 0.55 * Math.pow(g, 3);
    }

    function schlickPhase(cosTheta: number, k: number): number {
      const denom = 1.0 - k * cosTheta;
      return (1.0 - k * k) / (4.0 * Math.PI * denom * denom);
    }

    function henyeyGreenstein(cosTheta: number, g: number): number {
      const denom = 1.0 + g * g - 2.0 * g * cosTheta;
      return (1.0 - g * g) / (4.0 * Math.PI * Math.pow(denom, 1.5));
    }

    it("approximates forward scattering peak accurately for atmospheric g in [0.6, 0.8]", () => {
      const g = 0.7;
      const k = schlickK(g);

      // Peak forward direction: cosTheta = 1.0 (looking directly into the sun)
      const pSchlickPeak = schlickPhase(1.0, k);
      const pHGPeak = henyeyGreenstein(1.0, g);

      // Schlick peak matches Henyey-Greenstein forward peak within ~10% without expensive pow(x, 1.5)
      expect(Math.abs(pSchlickPeak - pHGPeak) / pHGPeak).toBeLessThan(0.12);

      // Both must be strictly positive everywhere
      expect(pSchlickPeak).toBeGreaterThan(0);
      expect(pHGPeak).toBeGreaterThan(0);
    });

    it("evaluates to isotropic 1 / (4 * PI) when asymmetry g = 0", () => {
      const g = 0.0;
      const k = schlickK(g);
      expect(k).toBeCloseTo(0.0);

      const p0 = schlickPhase(0.0, k);
      const p1 = schlickPhase(1.0, k);
      const pNeg1 = schlickPhase(-1.0, k);

      const expectedIsotropic = 1.0 / (4.0 * Math.PI);
      expect(p0).toBeCloseTo(expectedIsotropic);
      expect(p1).toBeCloseTo(expectedIsotropic);
      expect(pNeg1).toBeCloseTo(expectedIsotropic);
    });

    it("exhibits strong forward lobe when looking towards light (cosTheta > 0) vs backscattering", () => {
      const g = 0.75;
      const k = schlickK(g);

      const forwardScatter = schlickPhase(0.9, k);
      const backwardScatter = schlickPhase(-0.9, k);

      expect(forwardScatter).toBeGreaterThan(backwardScatter * 20.0);
    });
  });

  describe("Interleaved Gradient Noise (IGN)", () => {
    // Jimenez (2014) Next Generation Post Processing in Call of Duty: Advanced Warfare
    function ign(x: number, y: number): number {
      const f1 = (0.06711056 * x + 0.00583715 * y) % 1.0;
      const f2 = (52.9829189 * f1) % 1.0;
      return f2 < 0 ? f2 + 1.0 : f2;
    }

    it("produces values strictly bounded in [0, 1)", () => {
      for (let x = 0; x < 50; x++) {
        for (let y = 0; y < 50; y++) {
          const val = ign(x, y);
          expect(val).toBeGreaterThanOrEqual(0);
          expect(val).toBeLessThan(1.0);
        }
      }
    });

    it("distributes energy uniformly across neighboring pixels to break banding", () => {
      let sum = 0;
      const N = 100;
      for (let x = 0; x < N; x++) {
        for (let y = 0; y < N; y++) {
          sum += ign(x, y);
        }
      }
      const mean = sum / (N * N);
      // Expected uniform distribution mean is 0.5
      expect(mean).toBeCloseTo(0.5, 1);
    });
  });

  describe("2x2 Depth-Aware Cross-Bilateral Weights", () => {
    function bilateralWeight(fullDepth: number, tapDepth: number, threshold: number): number {
      const depthDiff = Math.abs(fullDepth - tapDepth);
      return Math.exp(-depthDiff / Math.max(threshold, 0.0001));
    }

    it("assigns weight near 1.0 on smooth planar surfaces where depths match", () => {
      const fullDepth = 0.5;
      const tapDepth = 0.5001;
      const threshold = 0.05;

      const w = bilateralWeight(fullDepth, tapDepth, threshold);
      expect(w).toBeGreaterThan(0.99);
    });

    it("drastically penalizes samples across sharp silhouette edges", () => {
      const foregroundDepth = 0.1;
      const backgroundDepth = 0.9;
      const threshold = 0.05;

      const w = bilateralWeight(foregroundDepth, backgroundDepth, threshold);
      // exp(-0.8 / 0.05) = exp(-16) ~ 1.1e-7
      expect(w).toBeLessThan(0.0001);
    });

    it("correctly identifies silhouette boundary when all taps disagree with full-res depth", () => {
      const fullDepth = 0.1;
      const tapDepths = [0.9, 0.88, 0.92, 0.91];
      const threshold = 0.05;

      const weights = tapDepths.map((td) => bilateralWeight(fullDepth, td, threshold));
      const totalWeight = weights.reduce((acc, v) => acc + v, 0);

      // Total weight is below 0.001, triggering nearest depth tap fallback in shader
      expect(totalWeight).toBeLessThan(0.001);
    });
  });

  describe("Screen-Space Behind-the-Camera Inversion Guard (WebGL1 Tier 1)", () => {
    function computeSunCameraFade(clipW: number): number {
      // clipW > 0 means the sun point is in front of the camera
      // If behind (clipW <= 0), fade to zero smoothly to prevent 180-degree reflection artifacts
      return clipW > 0.0 ? 1.0 : 0.0;
    }

    it("allows light shafts when sun is in front of camera plane", () => {
      expect(computeSunCameraFade(15.0)).toBe(1.0);
      expect(computeSunCameraFade(0.1)).toBe(1.0);
    });

    it("suppresses light shafts when sun is behind camera plane", () => {
      expect(computeSunCameraFade(-0.1)).toBe(0.0);
      expect(computeSunCameraFade(-100.0)).toBe(0.0);
    });
  });
});
