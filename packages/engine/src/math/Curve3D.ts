import { Vector3D } from "./Vector3D.js";

/**
 * Base class for mathematical 3D curves.
 */
export abstract class Curve3D {
  private static _p1: Vector3D = new Vector3D();
  private static _p2: Vector3D = new Vector3D();

  /**
   * Evaluates the point on the curve at parameter t (0.0 to 1.0).
   * @param t Interpolation factor.
   * @param out Optional target vector to prevent allocation.
   */
  public abstract getPoint(t: number, out?: Vector3D): Vector3D;

  /**
   * Approximates the tangent (derivative) vector at parameter t.
   * @param t Interpolation factor.
   * @param out Optional target vector to prevent allocation.
   */
  public getTangent(t: number, out?: Vector3D): Vector3D {
    const delta = 0.0001;
    let t1 = t - delta;
    let t2 = t + delta;

    if (t1 < 0) t1 = 0;
    if (t2 > 1) t2 = 1;

    this.getPoint(t1, Curve3D._p1);
    this.getPoint(t2, Curve3D._p2);

    const tangent = out || new Vector3D();
    tangent.copyFrom(Curve3D._p2).sub(Curve3D._p1).normalize();

    return tangent;
  }
}
