import type { ParticleArrays } from "../Particle.js";
import type { ParticleAffector } from "../ParticleAffector.js";

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
export class BouncePlaneAffector implements ParticleAffector {
  public planePosition: number;
  public axis: "x" | "y" | "z";
  public restitution: number;
  public friction: number;

  constructor(options: BouncePlaneOptions = {}) {
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

  public applyBatch(arrays: ParticleArrays, count: number, _dt: number): void {
    const axis = this.axis;
    const planePosition = this.planePosition;
    const restitution = this.restitution;
    const friction = this.friction;

    for (let i = 0; i < count; i++) {
      if (arrays.aliveFlags[i] === 0) {
        continue;
      }

      const o = i * 3;

      if (axis === "y") {
        if (arrays.positions[o + 1]! <= planePosition && arrays.velocities[o + 1]! < 0) {
          arrays.positions[o + 1] = planePosition;
          arrays.velocities[o + 1] = -arrays.velocities[o + 1]! * restitution;
          arrays.velocities[o]! *= friction;
          arrays.velocities[o + 2]! *= friction;
        }
      } else if (axis === "x") {
        if (arrays.positions[o]! <= planePosition && arrays.velocities[o]! < 0) {
          arrays.positions[o] = planePosition;
          arrays.velocities[o] = -arrays.velocities[o]! * restitution;
          arrays.velocities[o + 1]! *= friction;
          arrays.velocities[o + 2]! *= friction;
        }
      } else if (axis === "z") {
        if (arrays.positions[o + 2]! <= planePosition && arrays.velocities[o + 2]! < 0) {
          arrays.positions[o + 2] = planePosition;
          arrays.velocities[o + 2] = -arrays.velocities[o + 2]! * restitution;
          arrays.velocities[o]! *= friction;
          arrays.velocities[o + 1]! *= friction;
        }
      }
    }
  }
}
