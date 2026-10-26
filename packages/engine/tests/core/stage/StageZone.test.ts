import { describe, it, expect } from "vitest";
import { StageZone } from "../../../src/core/stage/StageZone.js";

describe("StageZone", () => {
  const zone = new StageZone({
    id: "test_square",
    name: "Test Square",
    points: [
      { u: 0, v: 0 },
      { u: 1, v: 0 },
      { u: 1, v: 1 },
      { u: 0, v: 1 },
    ],
  });

  it("should correctly identify points inside the convex quad", () => {
    expect(zone.containsPoint(0.5, 0.5)).toBe(true);
    expect(zone.containsPoint(0.1, 0.1)).toBe(true);
    expect(zone.containsPoint(0.9, 0.9)).toBe(true);
  });

  it("should correctly identify points outside the convex quad", () => {
    expect(zone.containsPoint(-0.1, 0.5)).toBe(false);
    expect(zone.containsPoint(1.1, 0.5)).toBe(false);
    expect(zone.containsPoint(0.5, -0.1)).toBe(false);
    expect(zone.containsPoint(0.5, 1.1)).toBe(false);
  });

  it("should accept an edge tolerance for seamless zone transitions", () => {
    expect(zone.containsPoint(1.05, 0.5)).toBe(false);
    expect(zone.containsPoint(1.05, 0.5, 0.1)).toBe(true);
  });

  it("should default corner scale to 1.0 when unspecified", () => {
    expect(zone.getScaleAt(0.5, 0.5)).toBeCloseTo(1.0, 5);
  });

  it("should interpolate scale correctly using barycentric interpolation", () => {
    const scaleZone = new StageZone({
      id: "test_perspective",
      name: "Test Perspective",
      points: [
        { u: 0, v: 0, scale: 1.0 },
        { u: 1, v: 0, scale: 1.0 },
        { u: 1, v: 1, scale: 0.2 },
        { u: 0, v: 1, scale: 0.2 },
      ],
    });

    expect(scaleZone.getScaleAt(0.5, 0)).toBeCloseTo(1.0, 1);
    expect(scaleZone.getScaleAt(0.5, 0.5)).toBeCloseTo(0.6, 1);
    expect(scaleZone.getScaleAt(0.5, 1)).toBeCloseTo(0.2, 1);
  });

  it("should derive image-axis-aligned local axes for an axis-aligned zone", () => {
    const axes = zone.getLocalAxes(0.5, 0.5);
    expect(axes.right.u).toBeCloseTo(1.0, 5);
    expect(axes.right.v).toBeCloseTo(0.0, 5);
    expect(axes.forward.u).toBeCloseTo(0.0, 5);
    expect(axes.forward.v).toBeCloseTo(1.0, 5);
  });

  it("should derive diagonal local axes for a zone traced at an angle onto perspective art", () => {
    // A square rotated 45° (a diamond) -- diagonal in (u, v), but still a real rectangle.
    const diagonalZone = new StageZone({
      id: "test_diagonal",
      name: "Test Diagonal",
      points: [
        { u: 0.7, v: 0.5 },
        { u: 0.5, v: 0.7 },
        { u: 0.3, v: 0.5 },
        { u: 0.5, v: 0.3 },
      ],
    });

    const axes = diagonalZone.getLocalAxes(0.5, 0.5);
    // Right and forward should be roughly perpendicular for this near-square quad.
    const dot = axes.right.u * axes.forward.u + axes.right.v * axes.forward.v;
    expect(Math.abs(dot)).toBeLessThan(0.1);
  });

  it("should clamp an inside point to itself", () => {
    expect(zone.clampToPolygon(0.5, 0.5)).toEqual({ u: 0.5, v: 0.5 });
  });

  it("should clamp an outside point onto the nearest edge of the polygon", () => {
    const clamped = zone.clampToPolygon(1.2, 0.5);
    expect(clamped.u).toBeCloseTo(1.0, 5);
    expect(clamped.v).toBeCloseTo(0.5, 5);
  });

  it("should fall back to image axes when a zone collapses to a single point", () => {
    const degenerateZone = new StageZone({
      id: "test_degenerate",
      name: "Test Degenerate",
      points: [
        { u: 0.5, v: 0.5 },
        { u: 0.5, v: 0.5 },
        { u: 0.5, v: 0.5 },
        { u: 0.5, v: 0.5 },
      ],
    });

    const axes = degenerateZone.getLocalAxes(0.5, 0.5);
    expect(axes.right).toEqual({ u: 1, v: 0 });
    expect(axes.forward).toEqual({ u: 0, v: -1 });
  });

  it("should reject fewer than 3 points", () => {
    expect(
      () =>
        new StageZone({
          id: "test_invalid",
          name: "Test Invalid",
          points: [
            { u: 0, v: 0 },
            { u: 1, v: 0 },
          ],
        }),
    ).toThrow();
  });

  it("should support an arbitrary polygon (hexagon) for containment and scale", () => {
    const hexagon = new StageZone({
      id: "test_hexagon",
      name: "Test Hexagon",
      points: [
        { u: 0.2, v: 0 },
        { u: 0.8, v: 0 },
        { u: 1, v: 0.5 },
        { u: 0.8, v: 1 },
        { u: 0.2, v: 1 },
        { u: 0, v: 0.5 },
      ],
    });

    expect(hexagon.containsPoint(0.5, 0.5)).toBe(true);
    expect(hexagon.containsPoint(0.5, -0.5)).toBe(false);
    expect(hexagon.getScaleAt(0.5, 0.5)).toBeCloseTo(1.0, 5);
  });

  it("should derive a gradient-based forward direction for a non-quad polygon", () => {
    // A single fan triangle (n=3): scale falls linearly from 1 at v=0 to 0 at v=1, with no u
    // component -- the gradient (direction of steepest increase) is (0, -1), so
    // "forward" (steepest decrease) is (0, 1) [pointing down on screen].
    // In screen space (+u right, +v down), a 90° clockwise rotation of forward (0, 1) is (-1, 0)
    // [character's right hand side when facing downwards].
    const triangle = new StageZone({
      id: "test_triangle_gradient",
      name: "Test Triangle Gradient",
      points: [
        { u: 0, v: 0, scale: 1.0 },
        { u: 1, v: 0, scale: 1.0 },
        { u: 0, v: 1, scale: 0.0 },
      ],
    });

    const axes = triangle.getLocalAxes(0.3, 0.3);
    expect(axes.forward.u).toBeCloseTo(0, 5);
    expect(axes.forward.v).toBeCloseTo(1, 5);
    expect(axes.right.u).toBeCloseTo(-1, 5);
    expect(axes.right.v).toBeCloseTo(0, 5);
  });

  it("should derive forward=(0, -1) and right=(1, 0) for a corridor receding into the background", () => {
    // Realistic 2.5D perspective: scale is 1.0 at v=1 (foreground), shrinking to 0.2 at v=0 (horizon).
    const triangle = new StageZone({
      id: "test_perspective_triangle",
      name: "Test Perspective Triangle",
      points: [
        { u: 0, v: 1, scale: 1.0 },
        { u: 1, v: 1, scale: 1.0 },
        { u: 0.5, v: 0, scale: 0.2 },
      ],
    });

    const axes = triangle.getLocalAxes(0.5, 0.5);
    // Forward (steepest scale decrease) points toward v=0 (up on screen)
    expect(axes.forward.u).toBeCloseTo(0, 5);
    expect(axes.forward.v).toBeCloseTo(-1, 5);
    // Right (90° clockwise rotation in screen space) points to +u (right on screen)
    expect(axes.right.u).toBeCloseTo(1, 5);
    expect(axes.right.v).toBeCloseTo(0, 5);
  });

  it("should correctly triangulate and handle a concave L-shaped polygon via ear-clipping", () => {
    // Concave L-shaped polygon (6 vertices):
    // (0,0) ---- (2,0)
    // |            |
    // |       (1,1)|
    // |         |
    // (0,2) -- (1,2)
    // Scaled to 0..1 normalized space:
    const lZone = new StageZone({
      id: "test_concave_l",
      name: "Test Concave L",
      points: [
        { u: 0.1, v: 0.1, scale: 1.0 }, // 0: top-left
        { u: 0.9, v: 0.1, scale: 1.0 }, // 1: top-right
        { u: 0.9, v: 0.5, scale: 0.8 }, // 2: inner notch corner 1
        { u: 0.5, v: 0.5, scale: 0.6 }, // 3: reflex inner corner
        { u: 0.5, v: 0.9, scale: 0.4 }, // 4: bottom-right
        { u: 0.1, v: 0.9, scale: 0.4 }, // 5: bottom-left
      ],
    });

    // An ear-clipping triangulation of an n=6 polygon produces exactly n-2 = 4 triangles
    expect(lZone.triangles.length).toBe(4);
    expect(lZone.triangulationIndices.length).toBe(12);

    // Points inside the L-shape legs
    expect(lZone.containsPoint(0.2, 0.2)).toBe(true); // top-left leg
    expect(lZone.containsPoint(0.7, 0.3)).toBe(true); // top-right horizontal bar
    expect(lZone.containsPoint(0.3, 0.7)).toBe(true); // bottom vertical bar

    // Point in the concave notch (outside the polygon!)
    expect(lZone.containsPoint(0.7, 0.7)).toBe(false);

    // Scale inside each leg should interpolate smoothly
    expect(lZone.getScaleAt(0.2, 0.2)).toBeGreaterThan(0.8);
    expect(lZone.getScaleAt(0.3, 0.7)).toBeLessThan(0.6);

    // Clamping an outside point in the notch lands on an edge of the L shape
    const clamped = lZone.clampToPolygon(0.7, 0.7);
    expect(lZone.containsPoint(clamped.u, clamped.v, 1e-4)).toBe(true);
  });

  describe("Continuous Gradient Scaling Field", () => {
    it("should compute linear directional scale gradient across arbitrary polygons", () => {
      const gradientZone = new StageZone({
        id: "test_linear_gradient",
        name: "Test Linear Gradient",
        points: [
          { u: 0.1, v: 0.1 },
          { u: 0.9, v: 0.1 },
          { u: 0.8, v: 0.9 },
          { u: 0.2, v: 0.9 },
        ],
        scaleGradient: {
          mode: "linear",
          start: { u: 0.5, v: 0.9, scale: 1.0 }, // near / bottom
          end: { u: 0.5, v: 0.1, scale: 0.2 }, // far / top
        },
      });

      // Point scale evaluation
      expect(gradientZone.getScaleAt(0.5, 0.9)).toBeCloseTo(1.0, 4);
      expect(gradientZone.getScaleAt(0.5, 0.5)).toBeCloseTo(0.6, 4);
      expect(gradientZone.getScaleAt(0.5, 0.1)).toBeCloseTo(0.2, 4);

      // Local axes: moving deeper into the scene (decreasing scale) is toward end (up: u=0, v=-1)
      const axes = gradientZone.getLocalAxes(0.5, 0.5);
      expect(axes.forward.u).toBeCloseTo(0, 5);
      expect(axes.forward.v).toBeCloseTo(-1, 5);
      expect(axes.right.u).toBeCloseTo(1, 5);
      expect(axes.right.v).toBeCloseTo(0, 5);
    });

    it("should auto-initialize vertex scales from scaleGradient when scale is omitted", () => {
      const zone = new StageZone({
        id: "test_auto_scale",
        name: "Test Auto Scale",
        points: [
          { u: 0.0, v: 1.0 }, // bottom
          { u: 1.0, v: 1.0 }, // bottom
          { u: 1.0, v: 0.0 }, // top
          { u: 0.0, v: 0.0 }, // top
        ],
        scaleGradient: {
          start: { u: 0.5, v: 1.0, scale: 1.0 },
          end: { u: 0.5, v: 0.0, scale: 0.2 },
        },
      });

      expect(zone.points[0]!.scale).toBeCloseTo(1.0, 4);
      expect(zone.points[1]!.scale).toBeCloseTo(1.0, 4);
      expect(zone.points[2]!.scale).toBeCloseTo(0.2, 4);
      expect(zone.points[3]!.scale).toBeCloseTo(0.2, 4);
    });

    it("should compute vanishing-point perspective scale and radiating forward vectors", () => {
      const vpZone = new StageZone({
        id: "test_vp_gradient",
        name: "Test VP Gradient",
        points: [
          { u: 0.1, v: 0.8 },
          { u: 0.9, v: 0.8 },
          { u: 0.7, v: 0.5 },
          { u: 0.3, v: 0.5 },
        ],
        scaleGradient: {
          mode: "vanishing-point",
          vanishingPoint: { u: 0.5, v: 0.3 },
          reference: { u: 0.5, v: 0.8, scale: 1.0 },
          vanishingScale: 0.0,
        },
      });

      // At reference position (v=0.8, dist=0.5), scale should be 1.0
      expect(vpZone.getScaleAt(0.5, 0.8)).toBeCloseTo(1.0, 3);
      // Halfway to vanishing point (v=0.55, dist=0.25), scale should be 0.5
      expect(vpZone.getScaleAt(0.5, 0.55)).toBeCloseTo(0.5, 3);

      // On the left side of the room (u=0.2, v=0.7), forward vector should point towards (0.5, 0.3)
      const leftAxes = vpZone.getLocalAxes(0.2, 0.7);
      // Direction to VP: du = 0.5 - 0.2 = 0.3, dv = 0.3 - 0.7 = -0.4
      // Length = 0.5, normalized: (0.6, -0.8)
      expect(leftAxes.forward.u).toBeCloseTo(0.6, 3);
      expect(leftAxes.forward.v).toBeCloseTo(-0.8, 3);
      // Right is 90° clockwise: (-(-0.8), 0.6) = (0.8, 0.6)
      expect(leftAxes.right.u).toBeCloseTo(0.8, 3);
      expect(leftAxes.right.v).toBeCloseTo(0.6, 3);
    });

    it("supports useScaleGradient: true on 4-point quads to override legacy basis", () => {
      const quadWithGradient = new StageZone({
        id: "test_quad_override",
        name: "Test Quad Override",
        points: [
          { u: 0, v: 1, scale: 1.0 },
          { u: 1, v: 1, scale: 1.0 },
          { u: 1, v: 0, scale: 0.2 },
          { u: 0, v: 0, scale: 0.2 },
        ],
        useScaleGradient: true,
      });

      const axes = quadWithGradient.getLocalAxes(0.5, 0.5);
      expect(axes.forward.u).toBeCloseTo(0, 4);
      expect(axes.forward.v).toBeCloseTo(-1, 4);
      expect(axes.right.u).toBeCloseTo(1, 4);
      expect(axes.right.v).toBeCloseTo(0, 4);
    });
  });
});
