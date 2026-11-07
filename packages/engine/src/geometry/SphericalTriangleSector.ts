import { AbstractGeometry } from "./AbstractGeometry.js";
import { MathUtils } from "../math/index.js";

/**
 * Configuration options for spherical triangle sector geometry (Kugeldreieck-Sektor).
 */
export interface SphericalTriangleSectorOptions {
  /** Radius of the sphere (r). Defaults to 1. */
  radius?: number;
  /** Central angle (alpha) along the equator in radians. Defaults to π/2 (90 degrees). */
  angle?: number;
  /** Number of radial / azimuth subdivisions along the equator arc. Defaults to 32. */
  widthSegments?: number;
  /** Number of height / polar subdivisions from north pole to equator. Defaults to 16. */
  heightSegments?: number;
  /** Whether the planar bounding faces (side planes and equator base) are open. Defaults to false. */
  openEnded?: boolean;
}

/**
 * A spherical triangle sector geometry (Kugeldreieck-Sektor / spherical triangle pyramid sector).
 *
 * A wedge-shaped sector cut from a sphere extending from the north pole $(0, r, 0)$
 * down to the equator $(y=0)$, bounded by two meridian planes intersecting at central angle $\alpha$.
 *
 * Mathematical formulas:
 * - Base arc length: $a = \alpha \cdot r$
 * - Spherical triangle curved area: $S = \alpha \cdot r^2$
 * - Planar boundary area: $A_{\text{planar}} = \frac{\pi + \alpha}{2} r^2$
 * - Total surface area: $A = S + A_{\text{planar}} = \frac{3\alpha + \pi}{2} r^2$
 * - Volume: $V = \frac{\alpha \cdot r^3}{3}$
 *
 * @see https://rechneronline.de/pi/kugeldreiecksektor.php
 */
export class SphericalTriangleSector extends AbstractGeometry {
  /** The sphere radius (r). */
  public radius: number;
  /** The central angle (alpha) in radians. */
  public angle: number;
  /** Number of azimuth segments along equator. */
  public widthSegments: number;
  /** Number of polar segments from pole to equator. */
  public heightSegments: number;
  /** Whether planar faces are omitted. */
  public openEnded: boolean;

  /**
   * Creates a new SphericalTriangleSector geometry.
   * @param options Configuration options.
   */
  constructor(options: SphericalTriangleSectorOptions = {}) {
    super();
    const {
      radius = 1,
      angle = MathUtils.HALF_PI,
      widthSegments = 32,
      heightSegments = 16,
      openEnded = false,
    } = options;

    this.radius = Math.max(0, radius);
    this.angle = Math.max(0, Math.min(MathUtils.TWO_PI, angle));
    this.widthSegments = Math.max(3, Math.floor(widthSegments));
    this.heightSegments = Math.max(2, Math.floor(heightSegments));
    this.openEnded = openEnded;

    this.generateGeometryData();
  }

  /**
   * Calculates the equatorial base arc length $a = \alpha \cdot r$.
   */
  public getArcLength(): number {
    return this.angle * this.radius;
  }

  /**
   * Calculates the curved spherical triangle surface area $S = \alpha \cdot r^2$.
   */
  public getSphericalTriangleArea(): number {
    return this.angle * this.radius ** 2;
  }

  /**
   * Calculates the sum of all flat planar bounding areas (two meridian quarter circles + equator sector).
   * $A_{\text{planar}} = \frac{\pi + \alpha}{2} r^2$.
   */
  public getPlanarArea(): number {
    return 0.5 * (Math.PI + this.angle) * this.radius ** 2;
  }

  /**
   * Calculates the total surface area $A = \frac{3\alpha + \pi}{2} r^2$.
   */
  public getTotalSurfaceArea(): number {
    if (this.openEnded) {
      return this.getSphericalTriangleArea();
    }
    return this.getSphericalTriangleArea() + this.getPlanarArea();
  }

  /**
   * Calculates the enclosed volume $V = \frac{\alpha \cdot r^3}{3}$.
   */
  public getVolume(): number {
    return (this.angle * this.radius ** 3) / 3;
  }

  /** @inheritdoc */
  protected override generateGeometryData(): void {
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    const wireIndices: number[] = [];

    const r = this.radius;
    const wSegs = this.widthSegments;
    const hSegs = this.heightSegments;
    const alpha = this.angle;

    let vertexOffset = 0;

    // 1. Curved Spherical Triangle Surface
    const grid: number[][] = [];

    for (let y = 0; y <= hSegs; y++) {
      const row: number[] = [];
      const vRatio = y / hSegs;
      // phi from 0 (North pole +Y) to PI/2 (Equator y=0)
      const phi = vRatio * MathUtils.HALF_PI;
      const sinPhi = Math.sin(phi);
      const cosPhi = Math.cos(phi);

      for (let x = 0; x <= wSegs; x++) {
        const uRatio = x / wSegs;
        const theta = uRatio * alpha;
        const cosTheta = Math.cos(theta);
        const sinTheta = Math.sin(theta);

        const px = r * sinPhi * cosTheta;
        const py = r * cosPhi;
        const pz = r * sinPhi * sinTheta;

        positions.push(px, py, pz);
        if (r > 0) {
          normals.push(px / r, py / r, pz / r);
        } else {
          normals.push(0, 1, 0);
        }
        uvs.push(uRatio, 1 - vRatio);
        row.push(vertexOffset++);
      }
      grid.push(row);
    }

    for (let y = 0; y < hSegs; y++) {
      for (let x = 0; x < wSegs; x++) {
        const a = grid[y]![x]!;
        const b = grid[y + 1]![x]!;
        const c = grid[y + 1]![x + 1]!;
        const d = grid[y]![x + 1]!;

        if (y !== 0) {
          indices.push(a, d, b);
        }
        indices.push(b, d, c);

        wireIndices.push(a, b, a, d);
        if (x === wSegs - 1) wireIndices.push(d, c);
        if (y === hSegs - 1) wireIndices.push(b, c);
      }
    }

    // 2. Planar Boundary Faces
    if (!this.openEnded && r > 0) {
      // 2a. Side Face 1 at theta = 0 (in XY plane, Z=0)
      const origin1 = vertexOffset++;
      positions.push(0, 0, 0);
      normals.push(0, 0, -1);
      uvs.push(0, 0);

      const side1Start = vertexOffset;
      for (let y = 0; y <= hSegs; y++) {
        const phi = (y / hSegs) * MathUtils.HALF_PI;
        const px = r * Math.sin(phi);
        const py = r * Math.cos(phi);
        positions.push(px, py, 0);
        normals.push(0, 0, -1);
        uvs.push(px / r, py / r);
        vertexOffset++;
      }

      for (let y = 0; y < hSegs; y++) {
        const p1 = side1Start + y;
        const p2 = side1Start + y + 1;
        indices.push(origin1, p1, p2);
        wireIndices.push(origin1, p1, p1, p2);
      }

      // 2b. Side Face 2 at theta = alpha
      const n2x = -Math.sin(alpha);
      const n2z = Math.cos(alpha);
      const origin2 = vertexOffset++;
      positions.push(0, 0, 0);
      normals.push(n2x, 0, n2z);
      uvs.push(0, 0);

      const side2Start = vertexOffset;
      for (let y = 0; y <= hSegs; y++) {
        const phi = (y / hSegs) * MathUtils.HALF_PI;
        const px = r * Math.sin(phi) * Math.cos(alpha);
        const py = r * Math.cos(phi);
        const pz = r * Math.sin(phi) * Math.sin(alpha);
        positions.push(px, py, pz);
        normals.push(n2x, 0, n2z);
        uvs.push((px * Math.cos(alpha) + pz * Math.sin(alpha)) / r, py / r);
        vertexOffset++;
      }

      for (let y = 0; y < hSegs; y++) {
        const p1 = side2Start + y;
        const p2 = side2Start + y + 1;
        indices.push(origin2, p2, p1);
        wireIndices.push(origin2, p1, p1, p2);
      }

      // 2c. Equator Bottom Face (Y = 0 plane, normal [0, -1, 0])
      const origin3 = vertexOffset++;
      positions.push(0, 0, 0);
      normals.push(0, -1, 0);
      uvs.push(0.5, 0.5);

      const eqStart = vertexOffset;
      for (let x = 0; x <= wSegs; x++) {
        const theta = (x / wSegs) * alpha;
        const px = r * Math.cos(theta);
        const pz = r * Math.sin(theta);
        positions.push(px, 0, pz);
        normals.push(0, -1, 0);
        uvs.push(0.5 + 0.5 * Math.cos(theta), 0.5 + 0.5 * Math.sin(theta));
        vertexOffset++;
      }

      for (let x = 0; x < wSegs; x++) {
        const p1 = eqStart + x;
        const p2 = eqStart + x + 1;
        indices.push(origin3, p1, p2);
        wireIndices.push(origin3, p1, p1, p2);
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
