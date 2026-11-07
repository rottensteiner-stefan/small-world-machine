import { describe, expect, it } from "vitest";
import { ObliqueProjection } from "../../src/math/projections/ObliqueProjection.js";
import { ProjectionType } from "../../src/enums/index.js";

describe("ObliqueProjection", () => {
  it("should initialize with default oblique parameters", () => {
    const proj = new ObliqueProjection();
    expect(proj.type).toBe(ProjectionType.OBLIQUE);
    expect(proj.left).toBe(-1);
    expect(proj.right).toBe(1);
    expect(proj.bottom).toBe(-1);
    expect(proj.top).toBe(1);
    expect(proj.near).toBe(0.1);
    expect(proj.far).toBe(1000);
    expect(proj.shearAngle).toBeCloseTo(Math.PI / 4);
    expect(proj.shearScale).toBe(0.5);

    const m = proj.getMatrix().data;
    // Ortho elements:
    // d[0] = 2 / (right - left) = 2 / 2 = 1
    // d[5] = 2 / (top - bottom) = 2 / 2 = 1
    expect(m[0]).toBeCloseTo(1);
    expect(m[5]).toBeCloseTo(1);
    // Closed-form shear elements:
    // d[8] = -d[0] * cos(shearAngle) * shearScale = -1 * (sqrt(2)/2) * 0.5
    // d[9] = -d[5] * sin(shearAngle) * shearScale = -1 * (sqrt(2)/2) * 0.5
    expect(m[8]).toBeCloseTo(-Math.cos(Math.PI / 4) * 0.5);
    expect(m[9]).toBeCloseTo(-Math.sin(Math.PI / 4) * 0.5);
  });

  it("should create from engine config options", () => {
    const proj = ObliqueProjection.fromConfig(
      {
        orthoSize: 5,
        near: 1,
        far: 500,
      },
      2,
    );

    expect(proj.left).toBe(-10);
    expect(proj.right).toBe(10);
    expect(proj.bottom).toBe(-5);
    expect(proj.top).toBe(5);
    expect(proj.near).toBe(1);
    expect(proj.far).toBe(500);
  });

  it("should adjust aspect ratio correctly", () => {
    const proj = new ObliqueProjection({
      left: -5,
      right: 5,
      bottom: -5,
      top: 5,
    });
    proj.setAspect(2);
    expect(proj.top - proj.bottom).toBe(10);
    expect(proj.right - proj.left).toBe(20);
    expect(proj.left).toBe(-10);
    expect(proj.right).toBe(10);
  });

  it("should zoom correctly", () => {
    const proj = new ObliqueProjection({
      left: -10,
      right: 10,
      bottom: -5,
      top: 5,
    });
    proj.zoom(0.1);
    expect(proj.left).toBeCloseTo(-11);
    expect(proj.right).toBeCloseTo(11);
    expect(proj.bottom).toBeCloseTo(-5.5);
    expect(proj.top).toBeCloseTo(5.5);
  });
});
