import { AbstractGeometry } from "./AbstractGeometry.js";
import { MathUtils } from "../math/index.js";

/**
 * Configuration options for disk geometry.
 */
export interface DiskOptions {
  /** The radius of the disk. Defaults to 1. */
  radius?: number;
  /** The number of radial segments. Defaults to 32. */
  segments?: number;
  /** The number of concentric rings. Defaults to 1. */
  rings?: number;
}

/**
 * A disk geometry with concentric rings, providing better tessellation for displacement than a simple Circle.
 */
export class Disk extends AbstractGeometry {
  /** The radius of the disk. */
  public radius: number;
  /** The number of segments. */
  public segments: number;
  /** The number of rings. */
  public rings: number;

  /**
   * Creates a new Disk geometry.
   * @param options The configuration options.
   */
  constructor(options: DiskOptions = {}) {
    super();
    const { radius = 1, segments = 32, rings = 8 } = options;
    this.radius = Math.max(0, radius);
    this.segments = Math.max(3, Math.floor(segments));
    this.rings = Math.max(1, Math.floor(rings));
    this.generateGeometryData();
  }

  /** @inheritdoc */
  protected override generateGeometryData(): void {
    const v: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];

    // Center vertex
    v.push(0, 0, 0);
    uv.push(0.5, 0.5);

    // Vertices for each ring
    for (let r = 1; r <= this.rings; r++) {
      const ringRadius = (r / this.rings) * this.radius;
      for (let s = 0; s <= this.segments; s++) {
        const segmentAngle = (s / this.segments) * MathUtils.TWO_PI;
        const cos = Math.cos(segmentAngle);
        const sin = Math.sin(segmentAngle);
        v.push(cos * ringRadius, 0, sin * ringRadius);
        uv.push(0.5 + cos * 0.5 * (r / this.rings), 0.5 + sin * 0.5 * (r / this.rings));
      }
    }

    // Indices
    // Center to first ring
    for (let s = 0; s < this.segments; s++) {
      idx.push(0, s + 2, s + 1);
    }

    // Subsequent rings
    for (let r = 1; r < this.rings; r++) {
      const offset = 1 + (r - 1) * (this.segments + 1);
      const nextOffset = 1 + r * (this.segments + 1);
      for (let s = 0; s < this.segments; s++) {
        const a = offset + s;
        const b = offset + s + 1;
        const c = nextOffset + s + 1;
        const d = nextOffset + s;
        idx.push(a, b, d);
        idx.push(b, c, d);
      }
    }

    this._vertices = new Float32Array(v);
    this._uvs = new Float32Array(uv);
    this._indices = this._createIndexArray(idx.length);
    this._indices.set(idx);
    this.computeNormals();
  }
}
