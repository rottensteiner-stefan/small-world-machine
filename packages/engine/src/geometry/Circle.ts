import { AbstractGeometry } from "./AbstractGeometry.js";
import { MathUtils } from "../math/index.js";

/**
 * Configuration options for circle geometry.
 */
export interface CircleOptions {
  /** The radius of the circle. Defaults to 1. */
  radius?: number;
  /** The number of radial segments. Defaults to 32. */
  segments?: number;
  /** The start angle of the circle segment in radians. Defaults to 0. */
  thetaStart?: number;
  /** The central angle of the circle segment in radians. Defaults to 2 * PI. */
  thetaLength?: number;
}

/**
 * A simple circle geometry, optionally as a segment or sector.
 */
export class Circle extends AbstractGeometry {
  /** The radius of the circle. */
  public radius: number;
  /** The number of segments. */
  public segments: number;
  /** The start angle in radians. */
  public thetaStart: number;
  /** The central angle in radians. */
  public thetaLength: number;

  /**
   * Creates a new Circle geometry.
   * @param options The configuration options.
   */
  constructor(options: CircleOptions = {}) {
    super();
    const { radius = 1, segments = 32, thetaStart = 0, thetaLength = MathUtils.TWO_PI } = options;
    this.radius = Math.max(0, radius);
    this.segments = Math.max(3, Math.floor(segments));
    this.thetaStart = thetaStart;
    this.thetaLength = thetaLength;
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
    const centerIndex: number = 0;

    // Vertices on the circumference
    for (let n: number = 0; n <= this.segments; n++) {
      const segmentAngle: number = this.thetaStart + (n / this.segments) * this.thetaLength;
      const cos: number = Math.cos(segmentAngle);
      const sin: number = Math.sin(segmentAngle);
      v.push(cos * this.radius, 0, sin * this.radius);
      uv.push(0.5 + cos * 0.5, 0.5 + sin * 0.5);
    }

    // Indices for triangles (fan from center)
    for (let n: number = 0; n < this.segments; n++) {
      idx.push(centerIndex, n + 2, n + 1);
    }

    this._vertices = new Float32Array(v);
    this._uvs = new Float32Array(uv);
    this._indices = this._createIndexArray(idx.length);
    this._indices.set(idx);
    this.computeNormals();
  }
}
