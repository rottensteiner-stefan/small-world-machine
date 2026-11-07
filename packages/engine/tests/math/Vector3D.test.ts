import { describe, it, expect } from "vitest";
import { Vector3D } from "../../src/index.js";

describe("Vector3D", () => {
  it("should initialize with default values", () => {
    const v = new Vector3D();
    expect(v.x).toBe(0);
    expect(v.y).toBe(0);
    expect(v.z).toBe(0);
  });

  it("should initialize with provided values", () => {
    const v = new Vector3D(1, 2, 3);
    expect(v.x).toBe(1);
    expect(v.y).toBe(2);
    expect(v.z).toBe(3);
  });

  it("should add vectors correctly", () => {
    const v1 = new Vector3D(1, 2, 3);
    const v2 = new Vector3D(4, 5, 6);
    v1.add(v2);
    expect(v1.x).toBe(5);
    expect(v1.y).toBe(7);
    expect(v1.z).toBe(9);
  });

  it("should subtract vectors correctly", () => {
    const v1 = new Vector3D(5, 7, 9);
    const v2 = new Vector3D(1, 2, 3);
    v1.sub(v2);
    expect(v1.x).toBe(4);
    expect(v1.y).toBe(5);
    expect(v1.z).toBe(6);
  });

  it("should normalize vectors correctly", () => {
    const v = new Vector3D(10, 0, 0);
    v.normalize();
    expect(v.x).toBe(1);
    expect(v.y).toBe(0);
    expect(v.z).toBe(0);
    expect(v.length()).toBe(1);
  });

  it("should handle normalization of zero vector", () => {
    const v = new Vector3D(0, 0, 0);
    v.normalize();
    expect(v.x).toBe(0);
    expect(v.y).toBe(0);
    expect(v.z).toBe(0);
    expect(v.length()).toBe(0);
  });

  it("should calculate distance correctly", () => {
    const v1 = new Vector3D(0, 0, 0);
    const v2 = new Vector3D(0, 10, 0);
    expect(v1.distanceTo(v2)).toBe(10);
  });

  it("should copy from another vector", () => {
    const v1 = new Vector3D(1, 2, 3);
    const v2 = new Vector3D();
    v2.copyFrom(v1);
    expect(v2.x).toBe(1);
    expect(v2.y).toBe(2);
    expect(v2.z).toBe(3);
  });

  it("should lerp toward the target vector by the given factor", () => {
    const v1 = new Vector3D(0, 0, 0);
    const v2 = new Vector3D(10, 20, 30);
    v1.lerp(v2, 0.5);
    expect(v1.x).toBe(5);
    expect(v1.y).toBe(10);
    expect(v1.z).toBe(15);
  });

  it("should leave the vector unchanged when lerp factor is 0", () => {
    const v1 = new Vector3D(1, 2, 3);
    v1.lerp(new Vector3D(10, 20, 30), 0);
    expect(v1.x).toBe(1);
    expect(v1.y).toBe(2);
    expect(v1.z).toBe(3);
  });

  it("should fully reach the target vector when lerp factor is 1", () => {
    const v1 = new Vector3D(1, 2, 3);
    v1.lerp(new Vector3D(10, 20, 30), 1);
    expect(v1.x).toBe(10);
    expect(v1.y).toBe(20);
    expect(v1.z).toBe(30);
  });

  it("should rotate correctly when applyQuaternion is called", () => {
    const v = new Vector3D(1, 0, 0);
    // Rotate 90 deg around Y axis: (0, sin(45 deg), 0, cos(45 deg))
    const halfAngle = Math.PI / 4;
    const q = { x: 0, y: Math.sin(halfAngle), z: 0, w: Math.cos(halfAngle) };
    v.applyQuaternion(q);
    expect(v.x).toBeCloseTo(0);
    expect(v.y).toBeCloseTo(0);
    expect(v.z).toBeCloseTo(-1);
  });

  it("should rotate 180 deg around X axis with applyQuaternion", () => {
    const v = new Vector3D(0, 1, 0);
    const q = { x: 1, y: 0, z: 0, w: 0 };
    v.applyQuaternion(q);
    expect(v.x).toBeCloseTo(0);
    expect(v.y).toBeCloseTo(-1);
    expect(v.z).toBeCloseTo(0);
  });
});
