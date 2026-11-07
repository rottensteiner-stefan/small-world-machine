import type { ParticleArrays } from "../Particle.js";
import { BatchedAffector } from "./BatchedAffector.js";

export interface BouncePlaneOptions {
  /** The coordinate on the axis where the bounce plane is located. Defaults to 0.0. */
  planePosition?: number;
  /** Axis normal of the plane ("x", "y", "z"). Defaults to "y". */
  axis?: "x" | "y" | "z";
  /** Restitution / elasticity of the bounce (0 = dead stop, 1 = perfect elastic bounce). Defaults to 0.6. */
  restitution?: number;
  /** Surface friction applied to tangential velocity on bounce. Defaults to 0.8. */
  friction?: number;
}

/**
 * Reflects particle velocity when hitting a geometric collision plane (sparks, rain, debris bouncing).
 */
export class BouncePlaneAffector extends BatchedAffector {
  public planePosition: number;
  public axis: "x" | "y" | "z";
  public restitution: number;
  public friction: number;

  constructor(options: BouncePlaneOptions = {}) {
    super();
    this.planePosition = options.planePosition ?? 0.0;
    this.axis = options.axis ?? "y";
    this.restitution = options.restitution ?? 0.6;
    this.friction = options.friction ?? 0.8;
  }

  public apply(arrays: ParticleArrays, index: number, _dt: number): void {
    const o = index * 3;

    if (this.axis === "y") {
      if (arrays.positions[o + 1]! <= this.planePosition && arrays.velocities[o + 1]! < 0) {
        arrays.positions[o + 1] = this.planePosition;
        arrays.velocities[o + 1] = -arrays.velocities[o + 1]! * this.restitution;
        arrays.velocities[o]! *= this.friction;
        arrays.velocities[o + 2]! *= this.friction;
      }
    } else if (this.axis === "x") {
      if (arrays.positions[o]! <= this.planePosition && arrays.velocities[o]! < 0) {
        arrays.positions[o] = this.planePosition;
        arrays.velocities[o] = -arrays.velocities[o]! * this.restitution;
        arrays.velocities[o + 1]! *= this.friction;
        arrays.velocities[o + 2]! *= this.friction;
      }
    } else if (this.axis === "z") {
      if (arrays.positions[o + 2]! <= this.planePosition && arrays.velocities[o + 2]! < 0) {
        arrays.positions[o + 2] = this.planePosition;
        arrays.velocities[o + 2] = -arrays.velocities[o + 2]! * this.restitution;
        arrays.velocities[o]! *= this.friction;
        arrays.velocities[o + 1]! *= this.friction;
      }
    }
  }
}
