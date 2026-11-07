import { AbstractGeometry } from "./AbstractGeometry.js";
import { MathUtils, Vector3D } from "../math/index.js";
import { BoundingSphere } from "../physix/BoundingSphere.js";
import type { BoundingVolume } from "../interfaces/index.js";

/**
 * Configuration options for sphere geometry.
 */
export interface SphereOptions {
  /** The radius of the sphere. Defaults to 1. */
  radius?: number;
  /** The number of horizontal segments. Defaults to 16. */
  widthSegments?: number;
  /** The number of vertical segments. Defaults to 12. */
  heightSegments?: number;
}

/**
 * A spherical geometry based on UV mapping (latitude-longitude).
 */
export class Sphere extends AbstractGeometry {
  /** The radius of the sphere. */
  public radius: number;
  /** The number of horizontal segments. */
  public widthSegments: number;
  /** The number of vertical segments. */
  public heightSegments: number;

  /**
   * Creates a new Sphere geometry.
   * @param options The configuration options.
   */
  constructor(options: SphereOptions = {}) {
    super();
    const { radius = 1, widthSegments = 16, heightSegments = 12 } = options;
    this.radius = Math.max(0, radius);
    this.widthSegments = Math.max(3, Math.floor(widthSegments));
    this.heightSegments = Math.max(2, Math.floor(heightSegments));
    this.generateGeometryData();
  }

  /** @inheritdoc */
  protected override generateGeometryData(): void {
    const v: number[] = [];
    const n: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];

    const invRadius = this.radius > 0.000001 ? 1.0 / this.radius : 0;

    for (let y: number = 0; y <= this.heightSegments; y++) {
      const vRatio: number = y / this.heightSegments;
      const phi: number = vRatio * Math.PI;

      for (let x: number = 0; x <= this.widthSegments; x++) {
        const uRatio: number = x / this.widthSegments;
        // Exact 0 at start, and exact TWO_PI at end to avoid precision issues
        const theta: number = this.widthSegments === x ? 0 : uRatio * MathUtils.TWO_PI;

        let px: number, py: number, pz: number;
        if (0 === y) {
          px = 0;
          py = this.radius;
          pz = 0;
        } else if (this.heightSegments === y) {
          px = 0;
          py = -this.radius;
          pz = 0;
        } else {
          px = -(this.radius * Math.sin(phi) * Math.cos(theta));
          py = this.radius * Math.cos(phi);
          pz = this.radius * Math.sin(phi) * Math.sin(theta);
        }

        v.push(px, py, pz);

        if (invRadius > 0) {
          n.push(px * invRadius, py * invRadius, pz * invRadius);
        } else {
          n.push(0, 1, 0);
        }

        uv.push(uRatio, vRatio);
      }
    }

    for (let y: number = 0; y < this.heightSegments; y++) {
      for (let x: number = 0; x < this.widthSegments; x++) {
        const first: number = y * (this.widthSegments + 1) + x;
        const second: number = first + this.widthSegments + 1;
        idx.push(first, second, first + 1);
        idx.push(second, second + 1, first + 1);
      }
    }

    this._vertices = new Float32Array(v);
    this._normals = new Float32Array(n);
    this._uvs = new Float32Array(uv);
    this._indices = this._createIndexArray(idx.length);
    this._indices.set(idx);
  }

  /** @inheritdoc */
  public override getBoundingVolume(): BoundingVolume {
    if (!this._cachedBoundingVolume) {
      this._cachedBoundingVolume = new BoundingSphere(new Vector3D(0, 0, 0), this.radius);
    }
    return this._cachedBoundingVolume;
  }

  /**
   * Computes the wireframe indices (line-segments) specifically for a Sphere to
   * avoid rendering diagonal quad lines.
   */
  public override computeWireframeIndices(): void {
    const lines: number[] = [];

    // Latitude lines (horizontal circles)
    for (let y = 1; y < this.heightSegments; y++) {
      for (let x = 0; x < this.widthSegments; x++) {
        const current = y * (this.widthSegments + 1) + x;
        const next = current + 1;
        lines.push(current, next);
      }
    }

    // Longitude lines (vertical semi-circles)
    for (let x = 0; x < this.widthSegments; x++) {
      for (let y = 0; y < this.heightSegments; y++) {
        const current = y * (this.widthSegments + 1) + x;
        const below = (y + 1) * (this.widthSegments + 1) + x;
        lines.push(current, below);
      }
    }

    this._wireframeIndices = this._createIndexArray(lines.length);
    this._wireframeIndices.set(lines);
  }
}
