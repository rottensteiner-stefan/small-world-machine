import { describe, it, expect } from "vitest";
import { Ray2D, Vector2D } from "../../src/index.js";

describe("Ray2D.intersectSegment", () => {
  it("finds the intersection point of a ray crossing a segment", () => {
    const ray = new Ray2D(new Vector2D(-2, 0), new Vector2D(1, 0));
    const hit = ray.intersectSegment(new Vector2D(0, -1), new Vector2D(0, 1));
    expect(hit).toBeDefined();
    expect(hit!.x).toBeCloseTo(0, 5);
    expect(hit!.y).toBeCloseTo(0, 5);
  });

  it("returns undefined when the ray is parallel to the segment", () => {
    const ray = new Ray2D(new Vector2D(0, 0), new Vector2D(1, 0));
    const hit = ray.intersectSegment(new Vector2D(-1, 1), new Vector2D(1, 1));
    expect(hit).toBeUndefined();
  });

  it("returns undefined when the segment lies behind the ray's origin", () => {
    const ray = new Ray2D(new Vector2D(0, 0), new Vector2D(1, 0));
    const hit = ray.intersectSegment(new Vector2D(-2, -1), new Vector2D(-2, 1));
    expect(hit).toBeUndefined();
  });

  it("returns undefined when the ray's line crosses outside the segment's endpoints", () => {
    const ray = new Ray2D(new Vector2D(0, 5), new Vector2D(1, 0));
    const hit = ray.intersectSegment(new Vector2D(2, -1), new Vector2D(2, 1));
    expect(hit).toBeUndefined();
  });

  it("finds the intersection with a diagonal segment", () => {
    const ray = new Ray2D(new Vector2D(0, 0), new Vector2D(0, 1));
    const hit = ray.intersectSegment(new Vector2D(-1, 2), new Vector2D(1, 2));
    expect(hit).toBeDefined();
    expect(hit!.x).toBeCloseTo(0, 5);
    expect(hit!.y).toBeCloseTo(2, 5);
  });

  it("populates and returns the optional target Vector2D when provided", () => {
    const ray = new Ray2D(new Vector2D(-2, 0), new Vector2D(1, 0));
    const target = new Vector2D(99, 99);
    const hit = ray.intersectSegment(new Vector2D(0, -1), new Vector2D(0, 1), target);
    expect(hit).toBe(target);
    expect(target.x).toBeCloseTo(0, 5);
    expect(target.y).toBeCloseTo(0, 5);
  });
});
