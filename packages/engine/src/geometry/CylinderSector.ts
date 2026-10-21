import type { CylinderOptions } from "./Cylinder.js";
import { Cylinder } from "./Cylinder.js";
import { MathUtils } from "../math/index.js";

/**
 * Configuration options for cylinder sector geometry.
 * @deprecated Use {@link CylinderOptions}; `thetaLength` is part of it.
 */
export interface CylinderSectorOptions extends CylinderOptions {
  /** The central angle of the sector in radians. Defaults to 2 * PI. */
  thetaLength?: number;
}

/**
 * A cylinder sector geometry (pie slice of a cylinder).
 *
 * @deprecated Kept as a compatibility shim for the removed class. {@link Cylinder}
 * already supports `thetaStart` / `thetaLength`; construct a `Cylinder` directly.
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
