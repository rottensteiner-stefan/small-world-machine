import { AbstractGeometry } from "./AbstractGeometry.js";
import { MathUtils } from "../math/index.js";

/**
 * Configuration options for cut cylinder geometry (Zylinderabschnitt / truncated cylinder with oblique top).
 */
export interface CutCylinderOptions {
  /** Radius of the cylinder base (r). Defaults to 1. */
  radius?: number;
  /** Minimum height along the lowest point of the cut top (h1). Defaults to 1. */
  heightMin?: number;
  /** Maximum height along the highest point of the cut top (h2). Defaults to 3. */
  heightMax?: number;
  /** Number of radial subdivisions around circumference. Defaults to 32. */
  radialSegments?: number;
  /** Number of height subdivisions along vertical axis. Defaults to 1. */
  heightSegments?: number;
  /** Start angle in radians. Defaults to 0. */
  thetaStart?: number;
  /** Central angle in radians (2π for full cylinder). Defaults to 2π. */
  thetaLength?: number;
  /** Whether the cylinder ends are open (no bottom and top caps). Defaults to false. */
  openEnded?: boolean;
}

/**
 * A cut cylinder geometry (Zylinderabschnitt / obliquely cut cylinder / cylindrical ungula).
 *
 * A cylinder sliced obliquely by a plane at an angle, creating an elliptical top face
 * with minimum height $h_1$ and maximum height $h_2$.
 *
 * Mathematical formulas:
 * - Semi-major axis of the elliptical top: $a = \sqrt{r^2 + \left(\frac{h_2 - h_1}{2}\right)^2}$
 * - Volume: $V = \pi r^2 \frac{h_1 + h_2}{2}$
 * - Lateral area (Mantelfläche): $M = \pi r (h_1 + h_2)$
 * - Total surface area: $A = \pi r (r + a + h_1 + h_2)$ (Base circle + Top ellipse + Mantle)
 *
 * @see https://rechneronline.de/pi/zylinderabschnitt.php
 */
export class CutCylinder extends AbstractGeometry {
  /** The cylinder radius (r). */
  public radius: number;
  /** The minimum height (h1). */
  public heightMin: number;
  /** The maximum height (h2). */
  public heightMax: number;
  /** The number of radial subdivisions. */
  public radialSegments: number;
  /** The number of height subdivisions. */
  public heightSegments: number;
  /** The start angle in radians. */
  public thetaStart: number;
  /** The central angle in radians. */
  public thetaLength: number;
  /** Whether the cylinder ends are open (no caps). */
  public openEnded: boolean;

  /**
   * Creates a new CutCylinder geometry.
   * @param options Configuration options.
   */
  constructor(options: CutCylinderOptions = {}) {
    super();
    const {
      radius = 1,
      heightMin = 1,
      heightMax = 3,
      radialSegments = 32,
      heightSegments = 1,
      thetaStart = 0,
      thetaLength = MathUtils.TWO_PI,
      openEnded = false,
    } = options;

    this.radius = Math.max(0, radius);
    const h1 = Math.max(0, Math.min(heightMin, heightMax));
    const h2 = Math.max(0, Math.max(heightMin, heightMax));
    this.heightMin = h1;
    this.heightMax = h2;
    this.radialSegments = Math.max(3, Math.floor(radialSegments));
    this.heightSegments = Math.max(1, Math.floor(heightSegments));
    this.thetaStart = thetaStart;
    this.thetaLength = Math.max(0, Math.min(MathUtils.TWO_PI, thetaLength));
    this.openEnded = openEnded;

    this.generateGeometryData();
  }

  /**
   * Calculates the semi-major axis $a = \sqrt{r^2 + \left(\frac{h_2 - h_1}{2}\right)^2}$ of the elliptical cut top.
   */
  public getSemiMajorAxis(): number {
    return Math.sqrt(this.radius ** 2 + ((this.heightMax - this.heightMin) / 2) ** 2);
  }

  /**
   * Calculates the cut angle $\alpha = \arctan\left(\frac{h_2 - h_1}{2r}\right)$ of the top face in radians.
   */
  public getCutAngle(): number {
    if (this.radius <= 0) return 0;
    return Math.atan((this.heightMax - this.heightMin) / (2 * this.radius));
  }

  /**
   * Calculates the lateral / mantle surface area $M = \frac{\theta_{\text{len}}}{2\pi} \cdot \pi r (h_1 + h_2)$.
   */
  public getLateralArea(): number {
    const fraction = this.thetaLength / MathUtils.TWO_PI;
    return fraction * Math.PI * this.radius * (this.heightMin + this.heightMax);
  }

  /**
   * Calculates the volume $V = \frac{\theta_{\text{len}}}{2\pi} \cdot \pi r^2 \frac{h_1 + h_2}{2}$.
   */
  public getVolume(): number {
    const fraction = this.thetaLength / MathUtils.TWO_PI;
    return fraction * Math.PI * this.radius ** 2 * ((this.heightMin + this.heightMax) / 2);
  }

  /**
   * Calculates the total surface area $A$.
   */
  public getTotalSurfaceArea(): number {
    const fraction = this.thetaLength / MathUtils.TWO_PI;
    const lateral = this.getLateralArea();
    const bottomCap = this.openEnded ? 0 : fraction * Math.PI * this.radius ** 2;
    const topCap = this.openEnded ? 0 : fraction * Math.PI * this.radius * this.getSemiMajorAxis();
    const avgH = (this.heightMin + this.heightMax) / 2;
    const sideCaps =
      this.thetaLength < MathUtils.TWO_PI
        ? 0.5 *
          this.radius *
          (2 * avgH +
            this.getHeightAt(this.thetaStart) +
            this.getHeightAt(this.thetaStart + this.thetaLength))
        : 0;
    return lateral + bottomCap + topCap + sideCaps;
  }

  /**
   * Gets the top surface height at a given circumference angle $\theta$.
   * @param theta Circumference angle in radians.
   */
  public getHeightAt(theta: number): number {
    const midH = (this.heightMin + this.heightMax) / 2;
    const deltaH = (this.heightMax - this.heightMin) / 2;
    return midH + deltaH * Math.cos(theta);
  }

  /** @inheritdoc */
  protected override generateGeometryData(): void {
    const v: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    const wireframeLines: number[] = [];
    const isSector = this.thetaLength < MathUtils.TWO_PI - 0.00001;
    const avgH = (this.heightMin + this.heightMax) / 2;
    const yCenterOffset = avgH / 2; // Center the cylinder vertically around origin

    // --- 1. Cylindrical Mantle Surface ---
    for (let y = 0; y <= this.heightSegments; y++) {
      const vCoord = y / this.heightSegments;

      for (let x = 0; x <= this.radialSegments; x++) {
        const uCoord = x / this.radialSegments;
        const theta = this.thetaStart + uCoord * this.thetaLength;
        const topH = this.getHeightAt(theta);
        const yPos = vCoord * topH - yCenterOffset;

        v.push(this.radius * Math.sin(theta), yPos, this.radius * Math.cos(theta));
        uv.push(uCoord, 1.0 - vCoord);
      }
    }

    const cols = this.radialSegments + 1;
    const rows = this.heightSegments + 1;
    idx.push(...this.gridIndices(rows, cols, false));
    wireframeLines.push(...this.gridWireframe(rows, cols));

    // --- 2. Top Oblique Elliptical Cap ---
    if (!this.openEnded && 0 < this.radius) {
      const topOffset = v.length / 3;
      // Center point on cut plane
      v.push(0, avgH - yCenterOffset, 0);
      uv.push(0.5, 0.5);

      for (let x = 0; x <= this.radialSegments; x++) {
        const uCoord = x / this.radialSegments;
        const theta = this.thetaStart + uCoord * this.thetaLength;
        const topH = this.getHeightAt(theta);
        v.push(this.radius * Math.sin(theta), topH - yCenterOffset, this.radius * Math.cos(theta));
        uv.push(0.5 + Math.sin(theta) * 0.5, 0.5 + Math.cos(theta) * 0.5);
      }

      for (let x = 0; x < this.radialSegments; x++) {
        idx.push(topOffset, topOffset + x + 1, topOffset + x + 2);
        wireframeLines.push(topOffset, topOffset + x + 1);
        wireframeLines.push(topOffset + x + 1, topOffset + x + 2);
      }
      wireframeLines.push(topOffset, topOffset + this.radialSegments + 1);
    }

    // --- 3. Bottom Circular Cap (y = -yCenterOffset, Normal -Y) ---
    if (!this.openEnded && 0 < this.radius) {
      const bottomOffset = v.length / 3;
      v.push(0, -yCenterOffset, 0);
      uv.push(0.5, 0.5);

      for (let x = 0; x <= this.radialSegments; x++) {
        const uCoord = x / this.radialSegments;
        const theta = this.thetaStart + uCoord * this.thetaLength;
        v.push(this.radius * Math.sin(theta), -yCenterOffset, this.radius * Math.cos(theta));
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
        const topH = this.getHeightAt(angle);
        const sideOffset = v.length / 3;

        for (let y = 0; y <= this.heightSegments; y++) {
          const vCoord = y / this.heightSegments;
          const yPosAxis = vCoord * avgH - yCenterOffset;
          const yPosPerimeter = vCoord * topH - yCenterOffset;

          v.push(0, yPosAxis, 0); // Axis point matching lid center
          uv.push(0, vCoord);
          v.push(this.radius * sin, yPosPerimeter, this.radius * cos); // Perimeter point matching lid perimeter
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

    this.setBuffers({
      vertices: v,
      uvs: uv,
      indices: idx,
      wireframeIndices: wireframeLines,
    });
    this.computeNormals();
  }
}
