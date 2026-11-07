import type { Matrix4 } from "./Matrix4.js";
import type { BoundingVolume } from "../interfaces/index.js";
import type { BoundingBox } from "../physix/index.js";

/**
 * A class representing a camera frustum defined by 6 planes.
 * Used for frustum culling.
 */
export class Frustum {
  /**
   * The planes of the frustum (6 planes * 4 components = 24 floats).
   * Format: Ax + By + Cz + D = 0.
   */
  public planes: Float32Array = new Float32Array(24);

  /**
   * Sets the frustum planes from a projection matrix.
   * @param m The matrix to set from (usually View-Projection).
   */
  public setFromMatrix(m: Matrix4): void {
    const me: Float32Array = m.data;
    if (16 > me.length) {
      return;
    }
    const p: Float32Array = this.planes;

    // Right plane
    p[0] = me[3]! - me[0]!;
    p[1] = me[7]! - me[4]!;
    p[2] = me[11]! - me[8]!;
    p[3] = me[15]! - me[12]!;

    // Left plane
    p[4] = me[3]! + me[0]!;
    p[5] = me[7]! + me[4]!;
    p[6] = me[11]! + me[8]!;
    p[7] = me[15]! + me[12]!;

    // Bottom plane
    p[8] = me[3]! + me[1]!;
    p[9] = me[7]! + me[5]!;
    p[10] = me[11]! + me[9]!;
    p[11] = me[15]! + me[13]!;

    // Top plane
    p[12] = me[3]! - me[1]!;
    p[13] = me[7]! - me[5]!;
    p[14] = me[11]! - me[9]!;
    p[15] = me[15]! - me[13]!;

    // Near plane
    p[16] = me[3]! + me[2]!;
    p[17] = me[7]! + me[6]!;
    p[18] = me[11]! + me[10]!;
    p[19] = me[15]! + me[14]!;

    // Far plane
    p[20] = me[3]! - me[2]!;
    p[21] = me[7]! - me[6]!;
    p[22] = me[11]! - me[10]!;
    p[23] = me[15]! - me[14]!;

    for (let i: number = 0; 6 > i; i++) {
      const idx: number = i * 4;
      const p0 = p[idx]!;
      const p1 = p[idx + 1]!;
      const p2 = p[idx + 2]!;
      const d: number = Math.sqrt(p0 * p0 + p1 * p1 + p2 * p2);
      if (0 < d) {
        const f: number = 1.0 / d;
        p[idx] = p[idx]! * f;
        p[idx + 1] = p[idx + 1]! * f;
        p[idx + 2] = p[idx + 2]! * f;
        p[idx + 3] = p[idx + 3]! * f;
      }
    }
  }

  /**
   * Checks if a bounding volume intersects with the frustum.
   * @param volume The bounding volume to check.
   * @returns True if the volume is inside or intersecting the frustum.
   */
  public intersectsVolume(volume: BoundingVolume): boolean {
    return volume.intersectsFrustum(this);
  }

  /**
   * Checks if a bounding box intersects with the frustum.
   * @param box The bounding box to check.
   * @returns True if the box is inside or intersecting the frustum.
   */
  public intersectsBox(box: BoundingBox): boolean {
    const p: Float32Array = this.planes;

    for (let i: number = 0; 6 > i; i++) {
      const idx: number = i * 4;
      const p0 = p[idx]!;
      const p1 = p[idx + 1]!;
      const p2 = p[idx + 2]!;
      const p3 = p[idx + 3]!;

      const px: number = 0 <= p0 ? box.max.x : box.min.x;
      const py: number = 0 <= p1 ? box.max.y : box.min.y;
      const pz: number = 0 <= p2 ? box.max.z : box.min.z;

      const dist: number = p0 * px + p1 * py + p2 * pz + p3;

      if (0 > dist) {
        return false;
      }
    }

    return true;
  }
}
