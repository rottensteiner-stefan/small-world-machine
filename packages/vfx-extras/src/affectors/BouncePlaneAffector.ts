import type { Particle } from "../Particle.js";
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

  public apply(particle: Particle, _dt: number): void {
    if (this.axis === "y") {
      if (particle.position.y <= this.planePosition && particle.velocity.y < 0) {
        particle.position.y = this.planePosition;
        particle.velocity.y = -particle.velocity.y * this.restitution;
        particle.velocity.x *= this.friction;
        particle.velocity.z *= this.friction;
      }
    } else if (this.axis === "x") {
      if (particle.position.x <= this.planePosition && particle.velocity.x < 0) {
        particle.position.x = this.planePosition;
        particle.velocity.x = -particle.velocity.x * this.restitution;
        particle.velocity.y *= this.friction;
        particle.velocity.z *= this.friction;
      }
    } else if (this.axis === "z") {
      if (particle.position.z <= this.planePosition && particle.velocity.z < 0) {
        particle.position.z = this.planePosition;
        particle.velocity.z = -particle.velocity.z * this.restitution;
        particle.velocity.x *= this.friction;
        particle.velocity.y *= this.friction;
      }
    }
  }

  public applyBatch(particles: readonly Particle[], count: number, _dt: number): void {
    const axis = this.axis;
    const planePosition = this.planePosition;
    const restitution = this.restitution;
    const friction = this.friction;

    for (let i = 0; i < count; i++) {
      const particle = particles[i]!;
      if (particle.dead) {
        continue;
      }

      if (axis === "y") {
        if (particle.position.y <= planePosition && particle.velocity.y < 0) {
          particle.position.y = planePosition;
          particle.velocity.y = -particle.velocity.y * restitution;
          particle.velocity.x *= friction;
          particle.velocity.z *= friction;
        }
      } else if (axis === "x") {
        if (particle.position.x <= planePosition && particle.velocity.x < 0) {
          particle.position.x = planePosition;
          particle.velocity.x = -particle.velocity.x * restitution;
          particle.velocity.y *= friction;
          particle.velocity.z *= friction;
        }
      } else if (axis === "z") {
        if (particle.position.z <= planePosition && particle.velocity.z < 0) {
          particle.position.z = planePosition;
          particle.velocity.z = -particle.velocity.z * restitution;
          particle.velocity.x *= friction;
          particle.velocity.y *= friction;
        }
      }
    }
  }
}
