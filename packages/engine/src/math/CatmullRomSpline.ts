import { Curve3D } from "./Curve3D.js";
import { Vector3D } from "./Vector3D.js";

/**
 * Evaluates a smooth Catmull-Rom spline passing directly through a set of 3D points.
 */
export class CatmullRomSpline extends Curve3D {
  public points: Vector3D[];
  public closed: boolean;

  constructor(points: Vector3D[] = [], closed: boolean = false) {
    super();
    this.points = points;
    this.closed = closed;
  }

  public override getPoint(t: number, out?: Vector3D): Vector3D {
    const result = out || new Vector3D();

    if (this.points.length === 0) return result.set(0, 0, 0);
    if (this.points.length === 1) return result.copyFrom(this.points[0]!);

    const p = (this.points.length - (this.closed ? 0 : 1)) * t;
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
}
