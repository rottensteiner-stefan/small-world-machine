import type { Object3D } from "../../core/Object3D.js";
import type { Vector3D } from "../../math/index.js";
import { BoundingType } from "../../enums/index.js";
import type { BoundingBox } from "../BoundingBox.js";
import type { BoundingSphere } from "../BoundingSphere.js";
import type { FluidVolume } from "../FluidVolume.js";

export interface FluidForcesResult {
  linearDrag: number;
  angularDrag: number;
}

/**
 * Computes buoyancy, fluid currents, and drag forces for dynamic bodies submerged in fluid volumes.
 */
export class BuoyancySolver {
  /**
   * Applies hydrostatic buoyancy, fluid flow forces, and computes damping multipliers.
   * @param obj The Object3D to test and apply forces to.
   * @param fluidVolumes Active fluid volumes in the scene.
   * @param gravity Global gravity vector.
   * @returns Drag multipliers for linear and angular motion.
   */
  private static readonly _result: FluidForcesResult = {
    linearDrag: 1.0,
    angularDrag: 1.0,
  };

  /**
   * Applies hydrostatic buoyancy, fluid flow forces, and computes damping multipliers.
   * @param obj The Object3D to test and apply forces to.
   * @param fluidVolumes Active fluid volumes in the scene.
   * @param gravity Global gravity vector.
   * @returns Drag multipliers for linear and angular motion.
   */
  public static applyFluidForces(
    obj: Object3D,
    fluidVolumes: readonly FluidVolume[],
    gravity: Vector3D,
  ): FluidForcesResult {
    const result = BuoyancySolver._result;
    result.linearDrag = 1.0;
    result.angularDrag = 1.0;

    if (!obj.bounds || fluidVolumes.length === 0 || !obj.rigidBody) {
      return result;
    }

    const rb = obj.rigidBody;
    const boundsA = obj.bounds;
    let submergedRatioTotal = 0;
    let maxDensity = 0;
    let maxDrag = 1.0;
    let flowX = 0;
    let flowY = 0;
    let flowZ = 0;

    for (let i = 0; i < fluidVolumes.length; i++) {
      const fv = fluidVolumes[i]!;
      if (fv.bounds.intersectsVolume(boundsA)) {
        let aabbMinY: number;
        let aabbMaxY: number;

        if (boundsA.type === BoundingType.BOX) {
          aabbMinY = (boundsA as BoundingBox).min.y;
          aabbMaxY = (boundsA as BoundingBox).max.y;
        } else if (boundsA.type === BoundingType.SPHERE) {
          aabbMinY = boundsA.center.y - (boundsA as BoundingSphere).radius;
          aabbMaxY = boundsA.center.y + (boundsA as BoundingSphere).radius;
        } else {
          const br = boundsA.getBroadRadius();
          aabbMinY = boundsA.center.y - br;
          aabbMaxY = boundsA.center.y + br;
        }

        let waterTop = fv.bounds.max.y;
        if (fv.surfaceHeightAt) {
          const probed = fv.surfaceHeightAt(boundsA.center.x, boundsA.center.z);
          // A NaN/Infinity probe result (singular solve, bad lane data) must not poison the forces.
          waterTop = Number.isFinite(probed) ? probed : fv.bounds.max.y;
        }
        if (aabbMinY < waterTop) {
          const objectHeight = Math.max(0.001, aabbMaxY - aabbMinY);
          const submergedDepth = Math.max(0, waterTop - aabbMinY);
          const ratio = Math.min(1.0, submergedDepth / objectHeight);

          if (ratio > submergedRatioTotal) {
            submergedRatioTotal = ratio;
            maxDensity = fv.density;
            maxDrag = fv.drag;
            flowX = fv.currentVelocity.x;
            flowY = fv.currentVelocity.y;
            flowZ = fv.currentVelocity.z;
          }
        }
      }
    }

    if (submergedRatioTotal > 0 && rb.inverseMass > 0) {
      let volume: number;
      if (boundsA.type === BoundingType.BOX) {
        const box = boundsA as BoundingBox;
        volume = Math.max(
          0.0001,
          (box.max.x - box.min.x) * (box.max.y - box.min.y) * (box.max.z - box.min.z),
        );
      } else if (boundsA.type === BoundingType.SPHERE) {
        const r = (boundsA as BoundingSphere).radius;
        volume = (4.0 / 3.0) * Math.PI * r * r * r;
      } else {
        const r = boundsA.getBroadRadius();
        volume = (4.0 / 3.0) * Math.PI * r * r * r;
      }

      const mass = 1.0 / rb.inverseMass;
      // Archimedes' Principle: F_buoy = rho_fluid * V_submerged * g
      const displacedVolume = volume * submergedRatioTotal;
      const buoyForceY = -gravity.y * maxDensity * displacedVolume;
      rb.forces.y += buoyForceY;

      if (flowX !== 0 || flowY !== 0 || flowZ !== 0) {
        const flowForceFactor = submergedRatioTotal * 5.0 * mass;
        rb.forces.x += (flowX - rb.velocity.x) * flowForceFactor;
        rb.forces.y += (flowY - rb.velocity.y) * flowForceFactor;
        rb.forces.z += (flowZ - rb.velocity.z) * flowForceFactor;
      }

      result.linearDrag = 1.0 - (1.0 - maxDrag) * submergedRatioTotal;
      result.angularDrag = result.linearDrag;
    }

    return result;
  }
}
