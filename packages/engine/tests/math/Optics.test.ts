import { describe, it, expect } from "vitest";
import { Optics, CauchyMaterials, Vector2D } from "../../src/index.js";

describe("Optics.refract", () => {
  it("passes straight through at normal incidence (no bend), unaffected by n1/n2", () => {
    const incident = new Vector2D(1, 0);
    const normal = new Vector2D(-1, 0); // pointing back against the incident ray
    const result = Optics.refract(incident, normal, 1.0, 1.5);
    expect(result).toBeDefined();
    expect(result!.x).toBeCloseTo(1, 5);
    expect(result!.y).toBeCloseTo(0, 5);
  });

  it("bends toward the normal when entering a denser medium (Snell's law)", () => {
    // 45 degree incidence from air (n=1) into glass (n=1.5): a ray angled down-right hitting a
    // horizontal surface whose normal points straight up (0, -1) into the incoming ray.
    const incident = new Vector2D(Math.SQRT1_2, Math.SQRT1_2);
    const normal = new Vector2D(0, -1);
    const result = Optics.refract(incident, normal, 1.0, 1.5);
    expect(result).toBeDefined();
    // Refraction angle: asin(sin(45deg) / 1.5) ~= 28.13 degrees, smaller than the 45 degree
    // incidence -- the ray bends closer to the normal, not farther from it.
    const refractionAngle = Math.acos(-(result!.x * normal.x + result!.y * normal.y));
    expect(refractionAngle).toBeLessThan(Math.PI / 4);
    expect(refractionAngle).toBeCloseTo(Math.asin(Math.sin(Math.PI / 4) / 1.5), 5);
  });

  it("returns undefined on total internal reflection", () => {
    // Steep 80 degree incidence going from dense glass (n=1.65) back out to air (n=1.0) --
    // exceeds the critical angle (asin(1/1.65) ~= 37.3 degrees), so no real refracted ray exists.
    const angle = (80 * Math.PI) / 180;
    const incident = new Vector2D(Math.sin(angle), -Math.cos(angle));
    const normal = new Vector2D(0, 1);
    const result = Optics.refract(incident, normal, 1.65, 1.0);
    expect(result).toBeUndefined();
  });

  it("returns a unit-length direction for a valid refraction", () => {
    const incident = new Vector2D(Math.SQRT1_2, Math.SQRT1_2);
    const normal = new Vector2D(0, -1);
    const result = Optics.refract(incident, normal, 1.0, 1.5)!;
    expect(Math.hypot(result.x, result.y)).toBeCloseTo(1, 5);
  });

  it("populates and returns the optional target Vector2D when provided", () => {
    const incident = new Vector2D(Math.SQRT1_2, Math.SQRT1_2);
    const normal = new Vector2D(0, -1);
    const target = new Vector2D(99, 99);
    const result = Optics.refract(incident, normal, 1.0, 1.5, target);
    expect(result).toBe(target);
    expect(Math.hypot(target.x, target.y)).toBeCloseTo(1, 5);
  });
});

describe("Optics.cauchyIndex", () => {
  it("gives a higher refractive index for shorter wavelengths (normal dispersion)", () => {
    const nRed = Optics.cauchyIndex(700, CauchyMaterials.FLINT_GLASS);
    const nViolet = Optics.cauchyIndex(400, CauchyMaterials.FLINT_GLASS);
    expect(nViolet).toBeGreaterThan(nRed);
  });

  it("gives dense flint glass a noticeably wider spread than fluorite (low dispersion)", () => {
    const flintSpread =
      Optics.cauchyIndex(400, CauchyMaterials.FLINT_GLASS) -
      Optics.cauchyIndex(700, CauchyMaterials.FLINT_GLASS);
    const fluoriteSpread =
      Optics.cauchyIndex(400, CauchyMaterials.FLUORITE) -
      Optics.cauchyIndex(700, CauchyMaterials.FLUORITE);
    expect(flintSpread).toBeGreaterThan(fluoriteSpread);
  });

  it("matches a = coefficients.a in the limit of very long wavelengths", () => {
    const n = Optics.cauchyIndex(100_000, CauchyMaterials.CROWN_GLASS);
    expect(n).toBeCloseTo(CauchyMaterials.CROWN_GLASS.a, 3);
  });
});
