import { Curve3D } from "./Curve3D.js";
import { MathUtils } from "./MathUtils.js";
import { Vector3D } from "./Vector3D.js";

/**
 * Evaluates a smooth Catmull-Rom spline passing directly through a set of 3D points.
 */
export class CatmullRomSpline extends Curve3D {
  public points: Vector3D[];
  public closed: boolean;
  /**
   * Knot parameterization exponent (`0` = uniform, `0.5` = centripetal, `1.0` = chordal).
   * Centripetal (`0.5`) eliminates self-intersections and cusps when control points are unevenly spaced.
   */
  public alpha: number;

  constructor(points: Vector3D[] = [], closed: boolean = false, alpha: number = 0) {
    super();
    this.points = points;
    this.closed = closed;
    this.alpha = alpha;
  }

  public override getPoint(t: number, out?: Vector3D): Vector3D {
    const result = out || new Vector3D();

    if (this.points.length === 0) return result.set(0, 0, 0);
    if (this.points.length === 1) return result.copyFrom(this.points[0]!);

    const clampedT = this.closed ? t : MathUtils.clamp(t, 0, 1);
    const p = (this.points.length - (this.closed ? 0 : 1)) * clampedT;
    let intPoint = Math.floor(p);
    let weight = p - intPoint;

    if (this.closed) {
      intPoint +=
        intPoint > 0
          ? 0
          : (Math.floor(Math.abs(intPoint) / this.points.length) + 1) * this.points.length;
    } else if (weight === 0 && intPoint === this.points.length - 1) {
      intPoint = this.points.length - 2;
      weight = 1;
    }

    let p0: Vector3D;
    let p1: Vector3D;
    let p2: Vector3D;
    let p3: Vector3D;

    if (this.closed) {
      p0 = this.points[(intPoint - 1 + this.points.length) % this.points.length]!;
      p1 = this.points[intPoint % this.points.length]!;
      p2 = this.points[(intPoint + 1) % this.points.length]!;
      p3 = this.points[(intPoint + 2) % this.points.length]!;
    } else {
      p0 = this.points[intPoint === 0 ? intPoint : intPoint - 1]!;
      p1 = this.points[intPoint]!;
      p2 = this.points[intPoint > this.points.length - 2 ? this.points.length - 1 : intPoint + 1]!;
      p3 = this.points[intPoint > this.points.length - 3 ? this.points.length - 1 : intPoint + 2]!;
    }

    if (this.alpha > 0) {
      return this._evaluateNonUniform(p0, p1, p2, p3, weight, result);
    }

    const t2 = weight * weight;
    const t3 = t2 * weight;

    result.x =
      0.5 *
      (2 * p1.x +
        (-p0.x + p2.x) * weight +
        (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
        (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);

    result.y =
      0.5 *
      (2 * p1.y +
        (-p0.y + p2.y) * weight +
        (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
        (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);

    result.z =
      0.5 *
      (2 * p1.z +
        (-p0.z + p2.z) * weight +
        (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 +
        (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t3);

    return result;
  }

  private _evaluateNonUniform(
    p0: Vector3D,
    p1: Vector3D,
    p2: Vector3D,
    p3: Vector3D,
    weight: number,
    out: Vector3D,
  ): Vector3D {
    const halfAlpha = this.alpha * 0.5;
    let dt0 = Math.pow(p0.distanceToSq(p1), halfAlpha);
    const dt1 = Math.pow(p1.distanceToSq(p2), halfAlpha);
    let dt2 = Math.pow(p2.distanceToSq(p3), halfAlpha);

    if (dt1 < 1e-6) {
      return out.copyFrom(p1);
    }
    if (dt0 < 1e-6) dt0 = dt1;
    if (dt2 < 1e-6) dt2 = dt1;

    const invDt0 = 1 / dt0;
    const invDt01 = 1 / (dt0 + dt1);
    const invDt1 = 1 / dt1;
    const invDt12 = 1 / (dt1 + dt2);
    const invDt2 = 1 / dt2;

    const m1x = ((p1.x - p0.x) * invDt0 - (p2.x - p0.x) * invDt01 + (p2.x - p1.x) * invDt1) * dt1;
    const m1y = ((p1.y - p0.y) * invDt0 - (p2.y - p0.y) * invDt01 + (p2.y - p1.y) * invDt1) * dt1;
    const m1z = ((p1.z - p0.z) * invDt0 - (p2.z - p0.z) * invDt01 + (p2.z - p1.z) * invDt1) * dt1;

    const m2x = ((p2.x - p1.x) * invDt1 - (p3.x - p1.x) * invDt12 + (p3.x - p2.x) * invDt2) * dt1;
    const m2y = ((p2.y - p1.y) * invDt1 - (p3.y - p1.y) * invDt12 + (p3.y - p2.y) * invDt2) * dt1;
    const m2z = ((p2.z - p1.z) * invDt1 - (p3.z - p1.z) * invDt12 + (p3.z - p2.z) * invDt2) * dt1;

    const t2 = weight * weight;
    const t3 = t2 * weight;
    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + weight;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = t3 - t2;

    out.x = h00 * p1.x + h10 * m1x + h01 * p2.x + h11 * m2x;
    out.y = h00 * p1.y + h10 * m1y + h01 * p2.y + h11 * m2y;
    out.z = h00 * p1.z + h10 * m1z + h01 * p2.z + h11 * m2z;
    return out;
  }
}

