/** A plain 3D point, used instead of `Vector3D` to avoid per-sample allocation churn. */
export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}
