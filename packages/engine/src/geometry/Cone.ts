import type { CylinderOptions } from "./Cylinder.js";
import { Cylinder } from "./Cylinder.js";

/**
 * Configuration options for cone geometry.
 */
export interface ConeOptions extends Omit<CylinderOptions, "radiusTop" | "radiusBottom"> {
  /** The radius of the base of the cone. Defaults to 1. */
  radius?: number;
}

/**
 * A cone geometry.
 * Specialized case of a cylinder where the top radius is zero.
 *
 * Mathematical formulas:
 * - Base radius $r$, Height $h$
 * - Slant height (Mantellinie): $m = \sqrt{h^2 + r^2}$
 * - Lateral area (Mantelfläche): $M = \frac{\theta_{\text{len}}}{2\pi} \cdot \pi r m$
 * - Base area: $A_{\text{base}} = \frac{\theta_{\text{len}}}{2\pi} \cdot \pi r^2$
 * - Total surface area: $A = M + A_{\text{base}}$
 * - Volume: $V = \frac{\theta_{\text{len}}}{2\pi} \cdot \frac{1}{3} \pi r^2 h$
 * - Apex angle (Öffnungswinkel): $\alpha = 2 \arcsin(r / m)$
 * - Base angle (Basiswinkel): $\beta = \frac{\pi - \alpha}{2} = \arctan(h / r)$
 *
 * @see https://rechneronline.de/pi/kegel.php
 */
export class Cone extends Cylinder {
  /**
   * Creates a new Cone geometry.
   * @param options The configuration options.
   */
  constructor(options: ConeOptions = {}) {
    const { radius = 1, ...rest } = options;
    super({
      ...rest,
      radiusTop: 0,
      radiusBottom: radius,
    });
  }

  /**
   * Calculates the slant height (Mantellinie) $m = \sqrt{h^2 + r^2}$.
   */
  public getSlantHeight(): number {
    const r = this.radiusBottom;
    const h = this.height;
    return Math.sqrt(h * h + r * r);
  }

  /**
   * Calculates the lateral / mantle surface area $M = \frac{\theta_{\text{len}}}{2\pi} \cdot \pi r m$.
   */
  public getLateralArea(): number {
    const fraction = this.thetaLength / (2 * Math.PI);
    return fraction * Math.PI * this.radiusBottom * this.getSlantHeight();
  }

  /**
   * Calculates the circular base area $A_{\text{base}} = \frac{\theta_{\text{len}}}{2\pi} \cdot \pi r^2$.
   */
  public getBaseArea(): number {
    const fraction = this.thetaLength / (2 * Math.PI);
    return fraction * Math.PI * this.radiusBottom * this.radiusBottom;
  }

  /**
   * Calculates the total surface area $A = M + A_{\text{base}}$.
   */
  public getTotalSurfaceArea(): number {
    const lateral = this.getLateralArea();
    const base = this.openEnded ? 0 : this.getBaseArea();
    let sideCaps = 0;
    if (this.thetaLength < 2 * Math.PI - 0.00001) {
      sideCaps = 2 * 0.5 * this.radiusBottom * this.height;
    }
    return lateral + base + sideCaps;
  }

  /**
   * Calculates the volume $V = \frac{\theta_{\text{len}}}{2\pi} \cdot \frac{1}{3} \pi r^2 h$.
   */
  public getVolume(): number {
    const fraction = this.thetaLength / (2 * Math.PI);
    return fraction * (Math.PI / 3) * this.radiusBottom * this.radiusBottom * this.height;
  }

  /**
   * Calculates the apex angle (Öffnungswinkel) $\alpha = 2 \arcsin(r / m)$ in radians.
   */
  public getApexAngle(): number {
    const m = this.getSlantHeight();
    if (m <= 0) return 0;
    return 2 * Math.asin(this.radiusBottom / m);
  }

  /**
   * Calculates the base angle (Basiswinkel) $\beta = \frac{\pi - \alpha}{2} = \arctan(h / r)$ in radians.
   */
  public getBaseAngle(): number {
    return Math.atan2(this.height, this.radiusBottom);
  }

  /**
   * Calculates the surface-to-volume ratio $A / V$.
   */
  public getSurfaceToVolumeRatio(): number {
    const vol = this.getVolume();
    if (vol <= 0) return 0;
    return this.getTotalSurfaceArea() / vol;
  }
}
