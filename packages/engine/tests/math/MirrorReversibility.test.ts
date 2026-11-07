import { describe, expect, it } from "vitest";
import * as fc from "fast-check";
import { Matrix4, Vector3D } from "../../src/math/index.js";

/**
 * @invariant TRANSFORM-REVERSIBILITY: Die inverse Transformationsmatrix kehrt eine Komposition
 *   (Translation ∘ Rotation ∘ Skalierung) exakt um: `M⁻¹(M(v)) ≈ v` und `M·M⁻¹ ≈ I` unter
 *   Toleranz. Loop über beliebig zusammengesetzte invertierbare Matrizen (seed-gepinntes PBT,
 *   ADR-0047-D11 / E5). Fängt Degeneration/Nahtlosigkeitsfehler der Inversen ab, bevor sie in
 *   Screen/Bounds-Pfade durchschlagen.
 */

const RTOL = 1e-3; // relative Toleranz für Positions-Round-Trip (Float-Propagation durch invert)

const invertibleTransform = fc.record({
  // Ganzzahl-Ratio-Generatoren: immer endlich und f32-exakt genug, keine NaN/Infinity-Ströme.
  tx: fc.integer({ min: -1000, max: 1000 }).map((v) => v / 100),
  ty: fc.integer({ min: -1000, max: 1000 }).map((v) => v / 100),
  tz: fc.integer({ min: -1000, max: 1000 }).map((v) => v / 100),
  rx: fc.integer({ min: -31416, max: 31416 }).map((v) => v / 10000),
  ry: fc.integer({ min: -31416, max: 31416 }).map((v) => v / 10000),
  rz: fc.integer({ min: -31416, max: 31416 }).map((v) => v / 10000),
  // Skalierung nie 0 (invertierbar); negativ erlaubt (Spiegelung), aber von 0 entfernt.
  sx: fc
    .integer({ min: -300, max: 300 })
    .map((v) => v / 100)
    .filter((v) => Math.abs(v) > 0.15),
  sy: fc
    .integer({ min: -300, max: 300 })
    .map((v) => v / 100)
    .filter((v) => Math.abs(v) > 0.15),
  sz: fc
    .integer({ min: -300, max: 300 })
    .map((v) => v / 100)
    .filter((v) => Math.abs(v) > 0.15),
  vx: fc.integer({ min: -800, max: 800 }).map((v) => v / 100),
  vy: fc.integer({ min: -800, max: 800 }).map((v) => v / 100),
  vz: fc.integer({ min: -800, max: 800 }).map((v) => v / 100),
});

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

const idealRoundTrip = (): [Matrix4, Matrix4, Vector3D] => {
  const m = new Matrix4();
  m.compose(new Vector3D(0, 0, 0), new Vector3D(0, 0, 0), new Vector3D(1, 1, 1));
  const inv = new Matrix4();
  Matrix4.invert(m, inv);
  return [m, inv, new Vector3D(0, 0, 0)];
};

describe("TRANSFORM-REVERSIBILITY (M⁻¹∘M ≈ id, seed-pinned PBT)", () => {
  it("round-trips a transformed point back to the original (M⁻¹(M(v)) ≈ v)", () => {
    const property = fc.property(invertibleTransform, (p) => {
      const m = new Matrix4();
      m.compose(
        new Vector3D(p.tx, p.ty, p.tz),
        new Vector3D(p.rx, p.ry, p.rz),
        new Vector3D(p.sx, p.sy, p.sz),
      );
      const inv = new Matrix4();
      expect(Matrix4.invert(m, inv)).toBe(true);

      const v = new Vector3D(p.vx, p.vy, p.vz);
      m.transformVector(v);
      inv.transformVector(v);

      const scaleMag = Math.max(Math.abs(p.sx), Math.abs(p.sy), Math.abs(p.sz), 1);
      expect(Math.abs(v.x - p.vx)).toBeLessThanOrEqual(
        RTOL * Math.max(Math.abs(p.vx), 1) * scaleMag,
      );
      expect(Math.abs(v.y - p.vy)).toBeLessThanOrEqual(
        RTOL * Math.max(Math.abs(p.vy), 1) * scaleMag,
      );
      expect(Math.abs(v.z - p.vz)).toBeLessThanOrEqual(
        RTOL * Math.max(Math.abs(p.vz), 1) * scaleMag,
      );
    });
    fc.assert(property, { numRuns: 200, seed: 0x0f0f00aa });
  });

  it("yields an identity product (M · M⁻¹ ≈ I) for an invertible composition", () => {
    const property = fc.property(invertibleTransform, (p) => {
      const tf = new Matrix4();
      tf.compose(
        new Vector3D(p.tx, p.ty, p.tz),
        new Vector3D(p.rx, p.ry, p.rz),
        new Vector3D(p.sx, p.sy, p.sz),
      );
      const inv = new Matrix4();
      expect(Matrix4.invert(tf, inv)).toBe(true);
      const product = new Matrix4();
      Matrix4.multiply(tf, inv, product);

      for (let i = 0; i < 16; i++) {
        expect(Math.abs(product.data[i]! - IDENTITY[i]!)).toBeLessThanOrEqual(1e-3);
      }
    });
    fc.assert(property, { numRuns: 200, seed: 0x0f0f00ab });
  });

  it("trivial identity composition round-trips exactly", () => {
    const [m, inv, v] = idealRoundTrip();
    const out = new Vector3D(v.x, v.y, v.z);
    m.transformVector(out);
    inv.transformVector(out);
    expect(out.x).toBeCloseTo(v.x, 9);
    expect(out.y).toBeCloseTo(v.y, 9);
    expect(out.z).toBeCloseTo(v.z, 9);
  });
});
