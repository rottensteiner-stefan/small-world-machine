import { Vector3D } from "@small-world-machine/engine";
import type { ParticleArrays } from "../Particle.js";
import type { ParticleAffector } from "../ParticleAffector.js";

export interface VortexOptions {
  /** The rotation center. Defaults to (0, 0, 0). */
  center?: Vector3D;
  /** The axis of rotation. Defaults to Y axis (0, 1, 0). */
  axis?: "x" | "y" | "z";
  /** Swirl tangential strength (speed multiplier). Defaults to 1.0. */
  strength?: number;
  /** Inward suction speed towards the vortex core. Defaults to 0.0. */
  inwardSuction?: number;
}

/**
 * Applies a swirling vortex / tangential force field around a central axis.
 */
export class VortexAffector implements ParticleAffector {
  public center: Vector3D;
  public axis: "x" | "y" | "z";
  public strength: number;
  public inwardSuction: number;

  constructor(options: VortexOptions = {}) {
    this.center = options.center?.clone() ?? new Vector3D(0, 0, 0);
    this.axis = options.axis ?? "y";
    this.strength = options.strength ?? 1.0;
    this.inwardSuction = options.inwardSuction ?? 0.0;
  }

  public apply(arrays: ParticleArrays, index: number, _dt: number): void {
    const o = index * 3;
    const mass = arrays.masses[index]!;

    if (this.axis === "x") {
      const dy = arrays.positions[o + 1]! - this.center.y;
      const dz = arrays.positions[o + 2]! - this.center.z;
      const r = Math.sqrt(dy * dy + dz * dz) || 0.001;

      // Tangential direction around X: (-z, 0, y) mapped to (0, -z, y)
      const tangY = -dz / r;
      const tangZ = dy / r;

      // Centripetal inward suction direction: (-y, 0, -z)
      const inY = -dy / r;
      const inZ = -dz / r;

      arrays.accelerations[o + 1]! += (tangY * this.strength + inY * this.inwardSuction) / mass;
      arrays.accelerations[o + 2]! += (tangZ * this.strength + inZ * this.inwardSuction) / mass;
      return;
    }

    if (this.axis === "z") {
      const dx = arrays.positions[o]! - this.center.x;
      const dy = arrays.positions[o + 1]! - this.center.y;
      const r = Math.sqrt(dx * dx + dy * dy) || 0.001;

      // Tangential direction around Z: (x, -y, 0) mapped to (-y, x, 0)
      const tangX = -dy / r;
      const tangY = dx / r;

      // Centripetal inward suction direction: (-x, -y, 0)
      const inX = -dx / r;
      const inY = -dy / r;

      arrays.accelerations[o]! += (tangX * this.strength + inX * this.inwardSuction) / mass;
      arrays.accelerations[o + 1]! += (tangY * this.strength + inY * this.inwardSuction) / mass;
      return;
    }

    {
      const dx = arrays.positions[o]! - this.center.x;
      const dz = arrays.positions[o + 2]! - this.center.z;
      const r = Math.sqrt(dx * dx + dz * dz) || 0.001;

      // Tangential direction: (-z, 0, x)
      const tangX = -dz / r;
      const tangZ = dx / r;

      // Centripetal inward suction direction: (-x, 0, -z)
      const inX = -dx / r;
      const inZ = -dz / r;

      arrays.accelerations[o]! += (tangX * this.strength + inX * this.inwardSuction) / mass;
      arrays.accelerations[o + 2]! += (tangZ * this.strength + inZ * this.inwardSuction) / mass;
    }
  }

  public applyBatch(arrays: ParticleArrays, count: number, _dt: number): void {
    const centerX = this.center.x;
    const centerY = this.center.y;
    const centerZ = this.center.z;
    const axis = this.axis;
    const strength = this.strength;
    const inwardSuction = this.inwardSuction;

    for (let i = 0; i < count; i++) {
      if (arrays.aliveFlags[i] === 0) {
        continue;
      }

      const o = i * 3;
      const mass = arrays.masses[i]!;

      if (axis === "x") {
        const dy = arrays.positions[o + 1]! - centerY;
        const dz = arrays.positions[o + 2]! - centerZ;
        const r = Math.sqrt(dy * dy + dz * dz) || 0.001;

        const tangY = -dz / r;
        const tangZ = dy / r;

        const inY = -dy / r;
        const inZ = -dz / r;

        arrays.accelerations[o + 1]! += (tangY * strength + inY * inwardSuction) / mass;
        arrays.accelerations[o + 2]! += (tangZ * strength + inZ * inwardSuction) / mass;
        continue;
      }

      if (axis === "z") {
        const dx = arrays.positions[o]! - centerX;
        const dy = arrays.positions[o + 1]! - centerY;
        const r = Math.sqrt(dx * dx + dy * dy) || 0.001;

        const tangX = -dy / r;
        const tangY = dx / r;

        const inX = -dx / r;
        const inY = -dy / r;

        arrays.accelerations[o]! += (tangX * strength + inX * inwardSuction) / mass;
        arrays.accelerations[o + 1]! += (tangY * strength + inY * inwardSuction) / mass;
        continue;
      }

      {
        const dx = arrays.positions[o]! - centerX;
        const dz = arrays.positions[o + 2]! - centerZ;
        const r = Math.sqrt(dx * dx + dz * dz) || 0.001;

        const tangX = -dz / r;
        const tangZ = dx / r;

        const inX = -dx / r;
        const inZ = -dz / r;

        arrays.accelerations[o]! += (tangX * strength + inX * inwardSuction) / mass;
        arrays.accelerations[o + 2]! += (tangZ * strength + inZ * inwardSuction) / mass;
      }
    }
  }
}
