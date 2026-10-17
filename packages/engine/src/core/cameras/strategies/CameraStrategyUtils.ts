import type { CameraConstraints } from "../../../interfaces/index.js";
import type { Vector3D } from "../../../math/index.js";

/**
 * Clamps a vector in-place against optional min/max constraints.
 * Shared by the camera strategies to avoid duplicating the same
 * min/max branching in each of them.
 */
export function clampVector(vector: Vector3D, constraints: CameraConstraints | undefined): void {
  if (undefined === constraints) return;

  if (undefined !== constraints.min && undefined !== constraints.max) {
    vector.clamp(constraints.min, constraints.max);
  } else if (undefined !== constraints.min) {
    vector.x = Math.max(constraints.min.x, vector.x);
    vector.y = Math.max(constraints.min.y, vector.y);
    vector.z = Math.max(constraints.min.z, vector.z);
  } else if (undefined !== constraints.max) {
    vector.x = Math.min(constraints.max.x, vector.x);
    vector.y = Math.min(constraints.max.y, vector.y);
    vector.z = Math.min(constraints.max.z, vector.z);
  }
}
