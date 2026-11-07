import { AbstractGeometry } from "./AbstractGeometry.js";
import { MathUtils } from "../math/index.js";

/**
 * Configuration options for capsule geometry.
 */
export interface CapsuleOptions {
  /** The radius of the capsule. Defaults to 0.5. */
  radius?: number;
  /** The length of the cylinder part. Defaults to 1. */
  length?: number;
  /** The number of radial segments. Defaults to 16. */
  radialSegments?: number;
  /** The number of height segments for each cap. Defaults to 8. */
  capSegments?: number;
}

/**
 * A capsule geometry consisting of a cylinder with hemispherical caps.
 * Also known as a spherocylinder (Sphärozylinder).
 *
 * Mathematical formulas:
 * - Sphere radius: $r$
 * - Cylinder length: $h$
 * - Total capsule length: $l = h + 2r$
 * - Surface area: $A = 2\pi r(2r + h) = 4\pi r^2 + 2\pi r h$
 * - Volume: $V = \pi r^2 (\frac{4}{3}r + h) = \frac{4}{3}\pi r^3 + \pi r^2 h$
 * - Surface-to-volume ratio: $A / V$
 *
 * @see https://rechneronline.de/pi/kapsel.php
 */
export class Capsule extends AbstractGeometry {
  /** The radius of the capsule. */
  public radius: number;
  /** The length of the cylinder part. */
  public length: number;
  /** The number of radial segments. */
  public radialSegments: number;
  /** The number of segments for the caps. */
  public capSegments: number;

  /**
   * Creates a new Capsule geometry.
   * @param options The configuration options.
   */
  constructor(options: CapsuleOptions = {}) {
    super();
    const { radius = 0.5, length = 1, radialSegments = 16, capSegments = 8 } = options;
    this.radius = Math.max(0, radius);
    this.length = Math.max(0, length);
    this.radialSegments = Math.max(3, Math.floor(radialSegments));
    this.capSegments = Math.max(1, Math.floor(capSegments));
    this.generateGeometryData();
  }

  /**
   * Calculates the total tip-to-tip length $l = h + 2r$.
   */
  public getTotalLength(): number {
    return this.length + 2 * this.radius;
  }

  /**
   * Calculates the cylinder body lateral area $A_{\text{cyl}} = 2\pi r h$.
   */
  public getCylinderLateralArea(): number {
    return 2 * Math.PI * this.radius * this.length;
  }

  /**
   * Calculates the surface area of both hemispherical caps combined $A_{\text{caps}} = 4\pi r^2$.
   */
  public getHemisphereArea(): number {
    return 4 * Math.PI * this.radius * this.radius;
  }

  /**
   * Calculates the total surface area $A = 2\pi r (2r + h) = 4\pi r^2 + 2\pi r h$.
   */
  public getTotalSurfaceArea(): number {
    return 2 * Math.PI * this.radius * (2 * this.radius + this.length);
  }

  /**
   * Calculates the total volume $V = \pi r^2 (\frac{4}{3}r + h) = \frac{4}{3}\pi r^3 + \pi r^2 h$.
   */
  public getVolume(): number {
    return Math.PI * this.radius * this.radius * ((4 / 3) * this.radius + this.length);
  }

  /**
   * Calculates the surface-to-volume ratio $A / V$.
   */
  public getSurfaceToVolumeRatio(): number {
    const vol = this.getVolume();
    if (vol <= 0) return 0;
    return this.getTotalSurfaceArea() / vol;
  }

  /** @inheritdoc */
  protected override generateGeometryData(): void {
    const v: number[] = [];
    const n: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    const wireframeLines: number[] = [];

    const halfLength: number = this.length / 2.0;

    // --- Generate Vertices and Normals ---
    // From top cap to bottom cap
    for (let y: number = 0; y <= this.capSegments * 2 + 1; y++) {
      let radius: number;
      let yPos: number;
      let vCoord: number;

      // Top cap
      if (y <= this.capSegments) {
        const phi: number = (y / this.capSegments) * MathUtils.HALF_PI - MathUtils.HALF_PI;
        radius = this.radius * Math.cos(phi);
        yPos = halfLength - this.radius * Math.sin(phi);
        vCoord = (y / (this.capSegments * 2 + 1)) * 0.5;
      }
      // Bottom cap
      else {
        const phi: number = ((y - 1) / this.capSegments) * MathUtils.HALF_PI - MathUtils.HALF_PI;
        radius = this.radius * Math.cos(phi);
        yPos = -halfLength - this.radius * Math.sin(phi);
        vCoord = y / (this.capSegments * 2 + 1);
      }

      for (let x: number = 0; x <= this.radialSegments; x++) {
        const uCoord: number = x / this.radialSegments;
        const theta: number = uCoord * MathUtils.TWO_PI;

        const vx: number = radius * Math.sin(theta);
        const vz: number = radius * Math.cos(theta);

        v.push(vx, yPos, vz);

        // Normals: From center of the caps or outwards from cylinder axis
        const nx: number = vx;
        const ny: number = y <= this.capSegments ? yPos - halfLength : yPos + halfLength;
        const nz: number = vz;
        const nLen: number = Math.sqrt(nx * nx + ny * ny + nz * nz);
        if (0 < nLen) {
          n.push(nx / nLen, ny / nLen, nz / nLen);
        } else {
          n.push(0, 1, 0);
        }

        uv.push(uCoord, 1.0 - vCoord);
      }
    }

    // --- Generate Indices ---
    for (let y: number = 0; y < this.capSegments * 2 + 1; y++) {
      for (let x: number = 0; x < this.radialSegments; x++) {
        const first: number = y * (this.radialSegments + 1) + x;
        const second: number = first + this.radialSegments + 1;
        idx.push(first, second, first + 1);
        idx.push(second, second + 1, first + 1);
        wireframeLines.push(first, first + 1);
        wireframeLines.push(first, second);
      }
      const last = y * (this.radialSegments + 1) + this.radialSegments;
      const belowLast = (y + 1) * (this.radialSegments + 1) + this.radialSegments;
      wireframeLines.push(last, belowLast);
    }
    const bottomRow = (this.capSegments * 2 + 1) * (this.radialSegments + 1);
    for (let x: number = 0; x < this.radialSegments; x++) {
      wireframeLines.push(bottomRow + x, bottomRow + x + 1);
    }

    this._vertices = new Float32Array(v);
    this._normals = new Float32Array(n);
    this._uvs = new Float32Array(uv);
    this._indices = this._createIndexArray(idx.length);
    this._indices.set(idx);

    this._wireframeIndices = this._createIndexArray(wireframeLines.length);
    this._wireframeIndices.set(wireframeLines);
  }
}
