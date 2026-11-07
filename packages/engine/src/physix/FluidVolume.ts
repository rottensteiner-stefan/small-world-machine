import type { BoundingBox } from "./BoundingBox.js";
import { Vector3D } from "../math/Vector3D.js";

/**
 * Represents a volume of fluid in the physics simulation.
 * Objects entering this volume will experience buoyancy (upward force) and drag (velocity damping).
 */
export class FluidVolume {
  /** The AABB defining the boundaries of the fluid. */
  public bounds: BoundingBox;
  /** The density of the fluid. Higher density = more buoyancy. (1.0 = normal water) */
  public density: number;
  /** How much the fluid slows down objects moving through it (linear and angular damping). Lower value = more drag. */
  public drag: number;
  /** The velocity of the fluid flow, which pushes objects inside it. */
  public currentVelocity: Vector3D;
  /**
   * World-space surface height at a horizontal position (x, z). When set, this overrides the
   * flat `bounds.max.y` fallback used by the buoyancy solver, letting bodies ride the real
   * wave surface instead of the AABB's upper bound. A non-finite return value falls back to `bounds.max.y`.
   */
  public surfaceHeightAt?: (x: number, z: number) => number;

  constructor(
    bounds: BoundingBox,
    density: number = 1.0,
    drag: number = 0.95,
    currentVelocity: Vector3D = new Vector3D(0, 0, 0),
  ) {
    this.bounds = bounds;
    this.density = density;
    this.drag = drag;
    this.currentVelocity = currentVelocity.clone();
  }
}
