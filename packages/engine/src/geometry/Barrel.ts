import { AbstractGeometry } from "./AbstractGeometry.js";
import { MathUtils } from "../math/index.js";

/**
 * Configuration options for barrel geometry (Fass / prolated spheroid with truncated ends).
 */
export interface BarrelOptions {
  /** The belly/middle radius (R) at the equator (y = 0). Defaults to 1.3. */
  radiusMiddle?: number;
  /** The default end radius (r) for top and bottom if not explicitly specified. Defaults to 1.0. */
  radiusEnds?: number;
  /** The top radius (r_top) at y = +height/2. Defaults to radiusEnds. */
  radiusTop?: number;
  /** The bottom radius (r_bottom) at y = -height/2. Defaults to radiusEnds. */
  radiusBottom?: number;
  /** The total height (h) of the barrel. Defaults to 2.5. */
  height?: number;
  /** The number of radial subdivisions around the circumference. Defaults to 32. */
  radialSegments?: number;
  /** The number of height subdivisions along the vertical axis. Defaults to 16. */
  heightSegments?: number;
  /** The start angle of the sector in radians. Defaults to 0. */
  thetaStart?: number;
  /** The central angle of the sector in radians (2π for full barrel). Defaults to 2π. */
  thetaLength?: number;
  /** Whether the barrel ends are open (no top and bottom circular caps). Defaults to false. */
  openEnded?: boolean;
}

/**
 * A barrel geometry (Fass / wooden barrel / storage cask).
 *
 * Mathematically, a barrel is a body of revolution with a bulging profile (often modelled
 * as a parabolic arc or prolate spheroid truncated at both ends by planar circular caps).
 *
 * Mathematical formulas:
 * - Kepler's Barrel Volume Formula (1615):
 *   $V \approx \pi \cdot h \cdot \frac{2 R^2 + r^2}{3}$
 * - Space Diagonal:
 *   $d = \sqrt{h^2 + (2r)^2} = \sqrt{h^2 + 4r^2}$
 * - Parabolic Profile Radius at height $y \in [-h/2, +h/2]$:
 *   $r(y) = R - (R - r) \cdot \left(\frac{2y}{h}\right)^2$
 *
 * @see https://rechneronline.de/pi/fass.php
 */
export class Barrel extends AbstractGeometry {
  /** The middle radius (R) at equator y = 0. */
  public radiusMiddle: number;
  /** The top radius (r_top) at y = +height/2. */
  public radiusTop: number;
  /** The bottom radius (r_bottom) at y = -height/2. */
  public radiusBottom: number;
  /** The total height (h). */
  public height: number;
  /** The number of radial subdivisions. */
  public radialSegments: number;
  /** The number of height subdivisions. */
  public heightSegments: number;
  /** The start angle in radians. */
  public thetaStart: number;
  /** The central angle in radians. */
  public thetaLength: number;
  /** Whether the barrel ends are open (no caps). */
  public openEnded: boolean;

  /**
   * Creates a new Barrel geometry.
   * @param options Configuration options.
   */
  constructor(options: BarrelOptions = {}) {
    super();
    const {
      radiusMiddle = 1.3,
      radiusEnds = 1.0,
      radiusTop = radiusEnds,
      radiusBottom = radiusEnds,
      height = 2.5,
      radialSegments = 32,
      heightSegments = 16,
      thetaStart = 0,
      thetaLength = MathUtils.TWO_PI,
      openEnded = false,
    } = options;

    this.radiusMiddle = Math.max(0, radiusMiddle);
    this.radiusTop = Math.max(0, radiusTop);
    this.radiusBottom = Math.max(0, radiusBottom);
    this.height = Math.max(0, height);
    this.radialSegments = Math.max(3, Math.floor(radialSegments));
    this.heightSegments = Math.max(2, Math.floor(heightSegments));
    this.thetaStart = thetaStart;
    this.thetaLength = Math.max(0, Math.min(MathUtils.TWO_PI, thetaLength));
    this.openEnded = openEnded;

    this.generateGeometryData();
  }

  /**
   * Gets the average end radius $r = (r_{\text{top}} + r_{\text{bottom}}) / 2$.
   */
  public get radiusEnds(): number {
    return (this.radiusTop + this.radiusBottom) / 2;
  }

  /**
   * Calculates the barrel volume using Kepler's Barrel Formula (Keplersche Fassregel).
   * $V \approx \frac{\theta_{\text{len}}}{2\pi} \cdot \frac{\pi \cdot h}{3} \left(2 R^2 + \frac{r_{\text{top}}^2 + r_{\text{bottom}}^2}{2}\right)$.
   */
  public getVolume(): number {
    const fraction = this.thetaLength / MathUtils.TWO_PI;
    const avgEndRadiusSq = (this.radiusTop ** 2 + this.radiusBottom ** 2) / 2;
    return fraction * ((Math.PI * this.height) / 3) * (2 * this.radiusMiddle ** 2 + avgEndRadiusSq);
  }

  /**
   * Calculates the space diagonal $d = \sqrt{h^2 + 4 r^2}$ between opposing rim edges.
   */
  public getDiagonal(): number {
    const avgEndRadius = this.radiusEnds;
    return Math.sqrt(this.height ** 2 + 4 * avgEndRadius ** 2);
  }

  /**
   * Evaluates the radius $r(y)$ of the parabolic barrel profile at height $y \in [-h/2, +h/2]$.
   * @param y Vertical height coordinate.
   */
  public getRadiusAt(y: number): number {
    const hh = this.height / 2;
    if (hh <= 0) return this.radiusMiddle;
    const clampedY = Math.max(-hh, Math.min(hh, y));
    const t = clampedY / hh; // [-1, 1]
    const endR = 0 <= clampedY ? this.radiusTop : this.radiusBottom;
    return this.radiusMiddle - (this.radiusMiddle - endR) * (t * t);
  }

  /** @inheritdoc */
  protected override generateGeometryData(): void {
    const v: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    const wireframeLines: number[] = [];
    const hh: number = this.height / 2.0;
    const isSector: boolean = this.thetaLength < MathUtils.TWO_PI - 0.00001;

    // --- 1. Curved Barrel Mantle Surface ---
    const mantleOffset = v.length / 3;

    for (let y = 0; y <= this.heightSegments; y++) {
      const vCoord = y / this.heightSegments;
      const yPos = vCoord * this.height - hh;
      const t = hh > 0 ? yPos / hh : 0; // [-1, 1]
      const endR = 0 <= yPos ? this.radiusTop : this.radiusBottom;
      const radius = this.radiusMiddle - (this.radiusMiddle - endR) * (t * t);

      for (let x = 0; x <= this.radialSegments; x++) {
        const uCoord = x / this.radialSegments;
        const theta = this.thetaStart + uCoord * this.thetaLength;
        v.push(radius * Math.sin(theta), yPos, radius * Math.cos(theta));
        uv.push(uCoord, 1.0 - vCoord);
      }
    }

    for (let y = 0; y < this.heightSegments; y++) {
      for (let x = 0; x < this.radialSegments; x++) {
        const first = mantleOffset + y * (this.radialSegments + 1) + x;
        const second = first + this.radialSegments + 1;
        idx.push(first, first + 1, second);
        idx.push(first + 1, second + 1, second);

        wireframeLines.push(first, first + 1);
        wireframeLines.push(first, second);
      }
      const last = mantleOffset + y * (this.radialSegments + 1) + this.radialSegments;
      const belowLast = mantleOffset + (y + 1) * (this.radialSegments + 1) + this.radialSegments;
      wireframeLines.push(last, belowLast);
    }
    const mantleBottomRow = mantleOffset + this.heightSegments * (this.radialSegments + 1);
    for (let x = 0; x < this.radialSegments; x++) {
      wireframeLines.push(mantleBottomRow + x, mantleBottomRow + x + 1);
    }

    // --- 2. Top Circular Cap (at +hh, Normal +Y) ---
    if (!this.openEnded && 0 < this.radiusTop) {
      const topOffset = v.length / 3;
      v.push(0, hh, 0); // Center point
      uv.push(0.5, 0.5);

      for (let x = 0; x <= this.radialSegments; x++) {
        const uCoord = x / this.radialSegments;
        const theta = this.thetaStart + uCoord * this.thetaLength;
        v.push(this.radiusTop * Math.sin(theta), hh, this.radiusTop * Math.cos(theta));
        uv.push(0.5 + Math.sin(theta) * 0.5, 0.5 + Math.cos(theta) * 0.5);
      }

      for (let x = 0; x < this.radialSegments; x++) {
        idx.push(topOffset, topOffset + x + 1, topOffset + x + 2);
        wireframeLines.push(topOffset, topOffset + x + 1);
        wireframeLines.push(topOffset + x + 1, topOffset + x + 2);
      }
      wireframeLines.push(topOffset, topOffset + this.radialSegments + 1);
    }

    // --- 3. Bottom Circular Cap (at -hh, Normal -Y) ---
    if (!this.openEnded && 0 < this.radiusBottom) {
      const bottomOffset = v.length / 3;
      v.push(0, -hh, 0); // Center point
      uv.push(0.5, 0.5);

      for (let x = 0; x <= this.radialSegments; x++) {
        const uCoord = x / this.radialSegments;
        const theta = this.thetaStart + uCoord * this.thetaLength;
        v.push(this.radiusBottom * Math.sin(theta), -hh, this.radiusBottom * Math.cos(theta));
        uv.push(0.5 + Math.sin(theta) * 0.5, 0.5 - Math.cos(theta) * 0.5);
      }

      for (let x = 0; x < this.radialSegments; x++) {
        idx.push(bottomOffset, bottomOffset + x + 2, bottomOffset + x + 1);
        wireframeLines.push(bottomOffset, bottomOffset + x + 1);
        wireframeLines.push(bottomOffset + x + 1, bottomOffset + x + 2);
      }
      wireframeLines.push(bottomOffset, bottomOffset + this.radialSegments + 1);
    }

    // --- 4. Side Cut Plane Caps (for partial sectors) ---
    if (isSector) {
      const buildSideCap = (angle: number, isStart: boolean): void => {
        const sin = Math.sin(angle);
        const cos = Math.cos(angle);
        const sideOffset = v.length / 3;

        for (let y = 0; y <= this.heightSegments; y++) {
          const vCoord = y / this.heightSegments;
          const yPos = vCoord * this.height - hh;
          const t = hh > 0 ? yPos / hh : 0;
          const endR = 0 <= yPos ? this.radiusTop : this.radiusBottom;
          const radius = this.radiusMiddle - (this.radiusMiddle - endR) * (t * t);

          v.push(0, yPos, 0); // Center axis point
          uv.push(0, vCoord);
          v.push(radius * sin, yPos, radius * cos); // Profile perimeter point
          uv.push(1, vCoord);
        }

        for (let y = 0; y < this.heightSegments; y++) {
          const c1 = sideOffset + y * 2;
          const r1 = c1 + 1;
          const c2 = sideOffset + (y + 1) * 2;
          const r2 = c2 + 1;

          if (isStart) {
            idx.push(c1, r1, c2);
            idx.push(r1, r2, c2);
          } else {
            idx.push(c1, c2, r1);
            idx.push(r1, c2, r2);
          }

          wireframeLines.push(c1, r1);
          wireframeLines.push(c1, c2);
          wireframeLines.push(r1, r2);
        }
        const lastRow = sideOffset + this.heightSegments * 2;
        wireframeLines.push(lastRow, lastRow + 1);
      };

      buildSideCap(this.thetaStart, true);
      buildSideCap(this.thetaStart + this.thetaLength, false);
    }

    this._vertices = new Float32Array(v);
    this._uvs = new Float32Array(uv);
    this._indices = this._createIndexArray(idx.length);
    this._indices.set(idx);

    this._wireframeIndices = this._createIndexArray(wireframeLines.length);
    this._wireframeIndices.set(wireframeLines);

    this.computeNormals();
  }
}
