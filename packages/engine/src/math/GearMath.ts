import type { Vector3D } from "./Vector3D.js";
import { MathUtils } from "./MathUtils.js";

/**
 * Standard parameters for gear generation based on the Module system.
 */
export interface GearParameters {
  /** The module of the gear. */
  module: number;
  /** The number of teeth. */
  teeth: number;
  /** The calculated inner radius (root radius) for the Gear geometry. */
  innerRadius: number;
  /** The calculated tooth height for the Gear geometry. */
  toothHeight: number;
  /** The pitch radius (Teilkreisradius). Useful for placement. */
  pitchRadius: number;
  /** The outer radius (Kopfkreisradius). */
  outerRadius: number;
}

/**
 * Utility class for mechanical gear calculations based on DIN 780 (Module system).
 * Ensures gears perfectly mesh with each other.
 */
export class GearMath {
  /**
   * Calculates all necessary physical parameters for a gear.
   * @param module The module (size of the teeth). Must be the same for all meshing gears.
   * @param teeth The number of teeth on the gear.
   * @returns GearParameters object containing values to feed into the Gear geometry.
   */
  public static getGearParams(module: number, teeth: number): GearParameters {
    // Pitch radius (Teilkreisradius)
    const pitchRadius = (module * teeth) / 2.0;
    // Addendum (Kopfhöhe)
    const addendum = module;
    // Dedendum (Fußhöhe)
    const dedendum = 1.25 * module;

    return {
      module: module,
      teeth: teeth,
      pitchRadius: pitchRadius,
      outerRadius: pitchRadius + addendum,
      innerRadius: pitchRadius - dedendum,
      toothHeight: addendum + dedendum,
    };
  }

  /**
   * Calculates the exact distance required between the centers of two meshing gears.
   * @param module The module of both gears.
   * @param teeth1 Number of teeth of the first gear.
   * @param teeth2 Number of teeth of the second gear.
   * @returns The exact distance between their centers.
   */
  public static getCenterDistance(module: number, teeth1: number, teeth2: number): number {
    return (module * (teeth1 + teeth2)) / 2.0;
  }

  /**
   * Calculates the relative rotation speed (gear ratio) for a driven gear.
   * @param speed1 The rotation speed of the driving gear.
   * @param teeth1 The number of teeth of the driving gear.
   * @param teeth2 The number of teeth of the driven gear.
   * @param internal Set to true if gear2 is an internal ring gear (rotation direction stays the same).
   * @returns The rotation speed of the driven gear.
   */
  public static getDrivenSpeed(
    speed1: number,
    teeth1: number,
    teeth2: number,
    internal: boolean = false,
  ): number {
    const ratio = teeth1 / teeth2;
    return internal ? speed1 * ratio : -speed1 * ratio;
  }

  /**
   * Calculates the exact Z-rotation required for gear2 to perfectly interlock with gear1.
   * Assumes both gears lie on the same XY plane and rotate around the Z axis.
   *
   * @param pos1 The position of the first gear.
   * @param rotZ1 The current Z-rotation of the first gear (in radians).
   * @param params1 The parameters of the first gear.
   * @param pos2 The position of the second gear.
   * @param params2 The parameters of the second gear.
   * @returns The required Z-rotation for gear2 (in radians).
   */
  public static getMeshingRotation(
    pos1: Vector3D,
    rotZ1: number,
    params1: GearParameters,
    pos2: Vector3D,
    params2: GearParameters,
  ): number {
    // 1. Find the angle of the line connecting gear1 to gear2
    const dx = pos2.x - pos1.x;
    const dy = pos2.y - pos1.y;
    // We use atan2 to find the absolute angle of the connection line
    const connectionAngle = Math.atan2(dy, dx);

    // 2. Determine where the teeth of gear1 are relative to the connection line

    // 3. For perfect meshing, when gear 1 has a tooth pointing at gear 2,
    // gear 2 must have a gap pointing at gear 1. A gap is exactly at a half-integer phase.
    const toothAngle2 = MathUtils.TWO_PI / params2.teeth;

    // The opposite angle for gear 2 looking back at gear 1
    const oppositeAngle = connectionAngle + Math.PI;

    // We want the phase of gear 2 at the opposite angle to match the phase of gear 1 + 0.5 (for the gap)
    // Plus we must reverse the rotation direction because they roll on each other.
    // Instead of complex phase math, the simple roll formula is:
    // rotZ2 = oppositeAngle - (rotZ1 - connectionAngle) * (teeth1 / teeth2) + gap_offset

    const rollAngle = (rotZ1 - connectionAngle) * (params1.teeth / params2.teeth);

    // To align tooth with gap, we add half a tooth step of gear 2
    const gapOffset = toothAngle2 / 2.0;
    return oppositeAngle - rollAngle + gapOffset;
  }
}
