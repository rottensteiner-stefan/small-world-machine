import { Collision } from "./Collision.js";
import type { Ray } from "./Ray.js";
import { BoundingBox } from "./BoundingBox.js";
import type { BoundingVolume, BoundingVolumeShape, FrustumInterface } from "../interfaces/index.js";
import type { Matrix4 } from "../math/index.js";
import { Vector3D } from "../math/index.js";
import { BoundingType } from "../enums/index.js";

/**
 * Represents a bounding sphere in 3D space.
 */
export class BoundingSphere implements BoundingVolumeShape {
  /** @inheritdoc */
  public readonly type: typeof BoundingType.SPHERE = BoundingType.SPHERE;

  /**
   * Creates a new BoundingSphere.
   * @param center The center position of the sphere.
   * @param radius The radius of the sphere.
   */
  constructor(
    public center: Vector3D,
    public radius: number,
  ) {}

  /** @inheritdoc */
  public getBroadRadius(): number {
    return this.radius;
  }

  /** @inheritdoc */
  public intersectsFrustum(frustum: FrustumInterface): boolean {
    const c: Vector3D = this.center;
    const r: number = this.radius;
    const p: Float32Array = frustum.planes;

    for (let i: number = 0; 6 > i; i++) {
      const idx: number = i * 4;
      const dist: number = p[idx]! * c.x + p[idx + 1]! * c.y + p[idx + 2]! * c.z + p[idx + 3]!;
      if (-r > dist) {
        return false;
      }
    }
    return true;
  }

  /** @inheritdoc */
  public intersectsVolume(other: BoundingVolume): boolean {
    return Collision.test(this, other);
  }

  /** @inheritdoc */
  public containsVolume(other: BoundingVolume): boolean {
    if (BoundingType.SPHERE === other.type) {
      const d = this.center.distanceTo(other.center);
      return d + other.radius <= this.radius;
    }
    if (BoundingType.BOX === other.type) {
      // All 8 corners of the box must be inside the sphere
      // This is quite expensive, but rarely used for sphere parents.
      // For now, let's use a simpler check: dist(center, box.center) + box.radius <= sphere.radius
      const d = this.center.distanceTo(other.center);
      return d + other.getBroadRadius() <= this.radius;
    }
    return false;
  }

  /** @inheritdoc */
  public transform(matrix: Matrix4): void {
    matrix.transformVector(this.center);
    // Approximate new radius by taking the max scale
    const me = matrix.data;
    const sX = Math.sqrt(me[0]! * me[0]! + me[1]! * me[1]! + me[2]! * me[2]!);
    const sY = Math.sqrt(me[4]! * me[4]! + me[5]! * me[5]! + me[6]! * me[6]!);
    const sZ = Math.sqrt(me[8]! * me[8]! + me[9]! * me[9]! + me[10]! * me[10]!);
    this.radius *= Math.max(sX, sY, sZ);
  }

  /** @inheritdoc */
  public getAabb(): BoundingBox {
    return new BoundingBox(
      new Vector3D(
        this.center.x - this.radius,
        this.center.y - this.radius,
        this.center.z - this.radius,
      ),
      new Vector3D(
        this.center.x + this.radius,
        this.center.y + this.radius,
        this.center.z + this.radius,
      ),
    );
  }

  /** @inheritdoc */
  public translate(v: Vector3D): void {
    this.center.add(v);
  }

  /** @inheritdoc */
  public intersectsRay(ray: Ray): boolean {
    return 0 <= ray.intersectsSphere(this);
  }

  /** @inheritdoc */
  public surfaceNormalAt(point: Vector3D): Vector3D {
    const d = point.clone().sub(this.center);
    const len = d.length();
    if (len < 1e-9) return new Vector3D(1, 0, 0);
    return d.scale(1 / len);
  }

  /** @inheritdoc */
  public volume(): number {
    return (4 / 3) * Math.PI * this.radius ** 3;
  }

  /** @inheritdoc */
  public closestPoint(point: Vector3D): Vector3D {
    const offset = point.clone().sub(this.center);
    const len = offset.length();
    if (len < 1e-9) return new Vector3D(this.center.x + this.radius, this.center.y, this.center.z);
    const scale = Math.min(this.radius / len, 1);
    return this.center.clone().add(offset.scale(scale));
  }

  /** @inheritdoc */
  public cloneEmpty(): BoundingVolume {
    return new BoundingSphere(new Vector3D(), 0);
  }

  /** @inheritdoc */
  public setFromLocal(center: Vector3D, halfExtents: Vector3D): void {
    this.center.copyFrom(center);
    this.radius = halfExtents.length();
  }
}
