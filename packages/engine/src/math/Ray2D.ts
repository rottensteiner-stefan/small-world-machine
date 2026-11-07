import { Vector2D } from "./Vector2D.js";

/**
 * A 2D ray, for planar/cross-section geometry (top-down gameplay logic, sightlines, or a
 * horizontal/vertical slice through a 3D scene -- e.g. tracing a light ray through a prism's
 * triangular cross-section, as `apps/showcases/28` does). For raycasting against full 3D scene
 * geometry, see `src/physix/Ray.ts` instead.
 */
export class Ray2D {
  constructor(
    public origin: Vector2D,
    public direction: Vector2D,
  ) {}

  /**
   * First forward intersection of this ray with segment `a`-`b`, or `undefined` if the ray misses
   * the segment or the segment lies behind the ray's origin.
   * @param a Start point of segment.
   * @param b End point of segment.
   * @param target Optional Vector2D to store the result in, avoiding allocation.
   * @returns Intersection point as Vector2D, or undefined.
   */
  public intersectSegment(a: Vector2D, b: Vector2D, target?: Vector2D): Vector2D | undefined {
    const segX = b.x - a.x;
    const segY = b.y - a.y;
    const denom = this.direction.x * segY - this.direction.y * segX;
    if (Math.abs(denom) < 1e-9) return undefined; // parallel
    const diffX = a.x - this.origin.x;
    const diffY = a.y - this.origin.y;
    const t = (diffX * segY - diffY * segX) / denom;
    const u = (diffX * this.direction.y - diffY * this.direction.x) / denom;
    if (t <= 1e-6 || u < 0 || u > 1) return undefined;
    const x = this.origin.x + this.direction.x * t;
    const y = this.origin.y + this.direction.y * t;
    if (target) {
      target.x = x;
      target.y = y;
      return target;
    }
    return new Vector2D(x, y);
  }
}
