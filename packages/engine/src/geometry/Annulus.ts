import { AbstractGeometry } from "./AbstractGeometry.js";
import { MathUtils } from "../math/index.js";

/**
 * Configuration options for annulus geometry (Kreisring / flat circular ring).
 */
export interface AnnulusOptions {
  /** Inner radius of the annulus (r). Defaults to 0.5. */
  innerRadius?: number;
  /** Outer radius of the annulus (R). Defaults to 1. */
  outerRadius?: number;
  /** Number of radial subdivisions around circumference. Defaults to 32. */
  thetaSegments?: number;
  /** Number of concentric subdivisions along width between inner and outer radius. Defaults to 1. */
  phiSegments?: number;
  /** Start angle in radians. Defaults to 0. */
  thetaStart?: number;
  /** Central angle in radians (2π for full ring). Defaults to 2π. */
  thetaLength?: number;
}

/**
 * A planar annulus geometry (Kreisring / 2D flat circular ring).
 *
 * A flat 2D ring lying in the X-Z plane with normal $(0, 1, 0)$, bounded by an inner
 * radius $r$ and an outer radius $R$.
 *
 * Mathematical formulas:
 * - Ring width: $b = R - r$
 * - Middle / median radius: $r_{\text{med}} = \frac{R + r}{2}$
 * - Tangent chord length: $l = 2\sqrt{R^2 - r^2}$
 * - Perimeter: $U = 2\pi(R + r)$
 * - Area: $A = \pi(R^2 - r^2) = \pi b(2r + b) = 2\pi b r_{\text{med}}$
 *
 * @see https://rechneronline.de/pi/kreisring.php
 */
export class Annulus extends AbstractGeometry {
  /** Inner radius (r). */
  public innerRadius: number;
  /** Outer radius (R). */
  public outerRadius: number;
  /** Number of radial subdivisions around circumference. */
  public thetaSegments: number;
  /** Number of concentric subdivisions across ring width. */
  public phiSegments: number;
  /** Start angle in radians. */
  public thetaStart: number;
  /** Central angle in radians. */
  public thetaLength: number;

  /**
   * Creates a new Annulus geometry.
   * @param options Configuration options.
   */
  constructor(options: AnnulusOptions = {}) {
    super();
    const {
      innerRadius = 0.5,
      outerRadius = 1,
      thetaSegments = 32,
      phiSegments = 1,
      thetaStart = 0,
      thetaLength = MathUtils.TWO_PI,
    } = options;

    const r1 = Math.max(0, Math.min(innerRadius, outerRadius));
    const r2 = Math.max(r1 + 0.0001, Math.max(innerRadius, outerRadius));

    this.innerRadius = r1;
    this.outerRadius = r2;
    this.thetaSegments = Math.max(3, Math.floor(thetaSegments));
    this.phiSegments = Math.max(1, Math.floor(phiSegments));
    this.thetaStart = thetaStart;
    this.thetaLength = Math.max(0, Math.min(MathUtils.TWO_PI, thetaLength));

    this.generateGeometryData();
  }

  /**
   * Calculates the ring width / wall thickness $b = R - r$.
   */
  public getWallThickness(): number {
    return this.outerRadius - this.innerRadius;
  }

  /**
   * Calculates the median radius $r_{\text{med}} = \frac{R + r}{2}$.
   */
  public getMedianRadius(): number {
    return (this.outerRadius + this.innerRadius) / 2;
  }

  /**
   * Calculates the tangent chord length $l = 2\sqrt{R^2 - r^2}$.
   */
  public getTangentChordLength(): number {
    return 2 * Math.sqrt(Math.max(0, this.outerRadius ** 2 - this.innerRadius ** 2));
  }

  /**
   * Calculates the total perimeter $U = \frac{\theta_{\text{len}}}{2\pi} \cdot 2\pi (R + r)$ (plus side radial edges if sector).
   */
  public getPerimeter(): number {
    const fraction = this.thetaLength / MathUtils.TWO_PI;
    let perimeter = fraction * 2 * Math.PI * (this.outerRadius + this.innerRadius);
    if (this.thetaLength < MathUtils.TWO_PI) {
      // Two radial cut edges of length (R - r)
      perimeter += 2 * this.getWallThickness();
    }
    return perimeter;
  }

  /**
   * Calculates the surface area $A = \frac{\theta_{\text{len}}}{2\pi} \cdot \pi (R^2 - r^2)$.
   */
  public getArea(): number {
    const fraction = this.thetaLength / MathUtils.TWO_PI;
    return fraction * Math.PI * (this.outerRadius ** 2 - this.innerRadius ** 2);
  }

  /** @inheritdoc */
  protected override generateGeometryData(): void {
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    const wireIndices: number[] = [];

    const r = this.innerRadius;
    const R = this.outerRadius;
    const tSegs = this.thetaSegments;
    const pSegs = this.phiSegments;

    let vertexOffset = 0;
    const grid: number[][] = [];

    for (let p = 0; p <= pSegs; p++) {
      const row: number[] = [];
      const vRatio = p / pSegs;
      const currentRadius = r + vRatio * (R - r);

      for (let t = 0; t <= tSegs; t++) {
        const uRatio = t / tSegs;
        const theta = this.thetaStart + uRatio * this.thetaLength;
        const cosTheta = Math.cos(theta);
        const sinTheta = Math.sin(theta);

        const px = currentRadius * cosTheta;
        const py = 0;
        const pz = currentRadius * sinTheta;

        positions.push(px, py, pz);
        normals.push(0, 1, 0);

        // UV mapped nicely in concentric 2D circle space normalized to outer radius
        uvs.push(
          0.5 + 0.5 * (currentRadius / R) * cosTheta,
          0.5 + 0.5 * (currentRadius / R) * sinTheta,
        );
        row.push(vertexOffset++);
      }
      grid.push(row);
    }

    for (let p = 0; p < pSegs; p++) {
      for (let t = 0; t < tSegs; t++) {
        const a = grid[p]![t]!;
        const b = grid[p + 1]![t]!;
        const c = grid[p + 1]![t + 1]!;
        const d = grid[p]![t + 1]!;

        indices.push(a, d, b);
        indices.push(b, d, c);

        wireIndices.push(a, b, a, d);
        if (t === tSegs - 1) wireIndices.push(d, c);
        if (p === pSegs - 1) wireIndices.push(b, c);
      }
    }

    this._vertices = new Float32Array(positions);
    this._normals = new Float32Array(normals);
    this._uvs = new Float32Array(uvs);
    this._indices = this._createIndexArray(indices.length);
    this._indices.set(indices);
    this._wireframeIndices = this._createIndexArray(wireIndices.length);
    this._wireframeIndices.set(wireIndices);
  }
}
