import type { CylinderOptions } from "./Cylinder.js";
import { Cylinder } from "./Cylinder.js";
import { MathUtils } from "../math/index.js";

/**
 * Configuration options for cylinder sector geometry.
 */
export interface CylinderSectorOptions extends CylinderOptions {
  /** The central angle of the sector in radians. Defaults to 2 * PI. */
  thetaLength?: number;
}

/**
 * A cylinder sector geometry (pie slice of a cylinder).
 */
export class CylinderSector extends Cylinder {
  /**
   * Creates a new CylinderSector geometry.
   * @param options The configuration options.
   */
  constructor(options: CylinderSectorOptions = {}) {
    const { thetaLength = MathUtils.TWO_PI, ...rest } = options;
    super({
      ...rest,
      thetaLength,
    });
  }
}
