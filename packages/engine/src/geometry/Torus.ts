import { AbstractGeometry } from "./AbstractGeometry.js";
import { MathUtils } from "../math/index.js";

/**
 * Configuration options for torus geometry.
 */
export interface TorusOptions {
  /** The radius of the torus tube center. Defaults to 1. */
  radius?: number;
  /** The radius of the tube itself. Defaults to 0.4. */
  tube?: number;
  /** The number of radial segments. Defaults to 16. */
  radialSegments?: number;
  /** The number of tubular segments. Defaults to 32. */
  tubularSegments?: number;
}

/**
 * A torus (donut-shaped) geometry.
 */
export class Torus extends AbstractGeometry {
  /** The radius of the torus ring. */
  public radius: number;
  /** The radius of the tube. */
  public tube: number;
  /** The number of radial segments. */
  public radialSegments: number;
  /** The number of tubular segments. */
  public tubularSegments: number;

  /**
   * Creates a new Torus geometry.
   * @param options The configuration options.
   */
  constructor(options: TorusOptions = {}) {
    super();
    const { radius = 1, tube = 0.4, radialSegments = 16, tubularSegments = 32 } = options;
    this.radius = Math.max(0, radius);
    this.tube = Math.max(0, tube);
    this.radialSegments = Math.max(3, Math.floor(radialSegments));
    this.tubularSegments = Math.max(3, Math.floor(tubularSegments));
    this.generateGeometryData();
  }

  /** @inheritdoc */
  protected override generateGeometryData(): void {
    const v: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];

    for (let j: number = 0; j <= this.radialSegments; j++) {
      const vRatio: number = j / this.radialSegments;
      const vArg: number = vRatio * MathUtils.TWO_PI;
      const cosV: number = Math.cos(vArg);
      const sinV: number = Math.sin(vArg);

      for (let i: number = 0; i <= this.tubularSegments; i++) {
        const uRatio: number = i / this.tubularSegments;
        const uArg: number = uRatio * MathUtils.TWO_PI;
        const cosU: number = Math.cos(uArg);
        const sinU: number = Math.sin(uArg);

        v.push(
          (this.radius + this.tube * cosV) * cosU,
          this.tube * sinV,
          (this.radius + this.tube * cosV) * sinU,
        );
        uv.push(uRatio, vRatio);
      }
    }

    for (let j: number = 1; j <= this.radialSegments; j++) {
      for (let i: number = 1; i <= this.tubularSegments; i++) {
        const a: number = (this.tubularSegments + 1) * j + i - 1;
        const b: number = (this.tubularSegments + 1) * (j - 1) + i - 1;
        const c: number = (this.tubularSegments + 1) * (j - 1) + i;
        const d: number = (this.tubularSegments + 1) * j + i;

        idx.push(a, d, b);
        idx.push(b, d, c);
      }
    }

    this._vertices = new Float32Array(v);
    this._uvs = new Float32Array(uv);
    this._indices = this._createIndexArray(idx.length);
    this._indices.set(idx);
    this.computeNormals();
  }

  /**
   * Computes the wireframe indices (line-segments) specifically for Torus.
   */
  public override computeWireframeIndices(): void {
    const lines: number[] = [];
    for (let j = 0; j <= this.radialSegments; j++) {
      for (let i = 0; i < this.tubularSegments; i++) {
        const row = j * (this.tubularSegments + 1);
        lines.push(row + i, row + i + 1);
      }
    }
    for (let i = 0; i <= this.tubularSegments; i++) {
      for (let j = 0; j < this.radialSegments; j++) {
        const current = j * (this.tubularSegments + 1) + i;
        const below = (j + 1) * (this.tubularSegments + 1) + i;
        lines.push(current, below);
      }
    }
    this._wireframeIndices = this._createIndexArray(lines.length);
    this._wireframeIndices.set(lines);
  }
}
