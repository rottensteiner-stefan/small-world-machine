import { describe, expect, it } from "vitest";
import * as fc from "fast-check";

/**
 * @invariant PBR-ENERGY-CONSERVATION: Das PBR-Materialmodell erhält Energie (White-Furnace-
 *   Relation). Gespiegelt exakt aus der SHIPPED Shader-Mathematik (`pbr_math.wgsl` F_Schlick +
 *   `lighting_pbr.wgsl` kS/kD-Zerlegung): kS = F, kD = (1−kS)·(1−metallic), F0 =
 *   clamp(mix(f0_dielectric, albedo, metallic), 0, 1). Pro Kanal gilt kS + kD ≤ 1 (einfallende
 *   Energie wird nie überschritten) und der implizite Rest (Transmission/Absorption =
 *   1 − kS − kD = metallic·(1−kS)) ist nicht-negativ. Seed-gepinntes PBT (ADR-0047-D11 / E5).
 */

const FRESNEL5 = (x: number): number => {
  const t = Math.min(Math.max(1 - x, 0), 1); // clamp(1 - cosTheta, 0, 1)
  const t2 = t * t;
  return t2 * t2 * t; // (1-cos)^5
};

/** Exakt die Engine-Formel: kS bzw. F pro Kanal. */
const engine_kS = (cosTheta: number, F0: number): number => F0 + (1 - F0) * FRESNEL5(cosTheta);

/** Exakt die Engine-Formel: kD pro Kanal. */
const engine_kD = (kS: number, metallic: number): number => (1 - kS) * (1 - metallic);

/** Exakt die Engine-Formel: F0 (f0_dielectric gemischt mit Albedo über Metallic, geclampt). */
const engine_F0 = (ior: number, albedo: number, metallic: number): number => {
  const f0Dielectric = Math.pow((ior - 1) / (ior + 1), 2);
  const blended = f0Dielectric * (1 - metallic) + albedo * metallic; // mix(f0, albedo, metallic)
  return Math.min(Math.max(blended, 0), 1);
};

const ENERGY_TOL = 1.0001;

describe("PBR-ENERGY-CONSERVATION (mirror of shipped kS/kD math, seed-pinned PBT)", () => {
  const params = fc.record({
    metallic: fc.integer({ min: 0, max: 1000 }).map((v) => v / 1000),
    ior: fc.integer({ min: 1000, max: 2500 }).map((v) => v / 1000),
    cosTheta: fc.integer({ min: 0, max: 1000 }).map((v) => v / 1000),
    // Albedo darf > 1 (Textur × Tint, Schader-Kommentar erlaubt Werte > 1) — F0 wird geclampt.
    albedoR: fc.integer({ min: 0, max: 2000 }).map((v) => v / 1000),
    albedoG: fc.integer({ min: 0, max: 2000 }).map((v) => v / 1000),
    albedoB: fc.integer({ min: 0, max: 2000 }).map((v) => v / 1000),
  });

  const property = fc.property(params, (p) => {
    const F0 = {
      r: engine_F0(p.ior, p.albedoR, p.metallic),
      g: engine_F0(p.ior, p.albedoG, p.metallic),
      b: engine_F0(p.ior, p.albedoB, p.metallic),
    };
    for (const f0 of [F0.r, F0.g, F0.b]) {
      const kS = engine_kS(p.cosTheta, f0);
      const kD = engine_kD(kS, p.metallic);
      // White-Furnace: reflektiert + diffuse überschreitet nie die einfallende Energie.
      expect(kS + kD).toBeLessThanOrEqual(ENERGY_TOL);
      // Einzelanteile bleiben im physikalischen Bereich.
      expect(kS).toBeGreaterThanOrEqual(0);
      expect(kS).toBeLessThanOrEqual(1 + 1e-9);
      expect(kD).toBeGreaterThanOrEqual(-1e-9);
      // Impliziter Rest (Transmission/Absorption = metallic·(1−kS)) ist nicht-negativ:
      expect(1 - kS - kD).toBeGreaterThanOrEqual(-1e-9);
    }
  });

  it("never exceeds the incident energy (kS+kD <= 1.0001) over the metallic/ior/θ parameter space", () => {
    fc.assert(property, { numRuns: 300, seed: 0xb16b00b5 });
  });

  it("conserves energy exactly in the analytic limits (metallic = 0 / 1)", () => {
    // Metallic 0 (reines Dielektrikum): kS + kD == 1 exakt? Nein — kD=(1-kS)*(1-0)=1-kS -> Summe=1.
    for (let i = 0; i <= 20; i++) {
      const cosTheta = i / 20;
      const F0 = 0.04; // klassische f0_dielectric@1.5
      const kS = engine_kS(cosTheta, F0);
      const kD = engine_kD(kS, 0);
      expect(kS + kD).toBeCloseTo(1, 12);
    }
    // Metallic 1 (reines Metall): diffuse entfällt, nur kS bleibt; Summe == kS <= 1.
    for (let i = 0; i <= 20; i++) {
      const cosTheta = i / 20;
      const F0 = 0.9;
      const kS = engine_kS(cosTheta, F0);
      expect(engine_kD(kS, 1)).toBe(0);
      expect(kS + 0).toBeLessThanOrEqual(1.0001);
    }
  });
});
