import { AbstractGeometry } from "./AbstractGeometry.js";

/**
 * Configuration for the Ground geometry.
 */
export interface GroundOptions {
  /** Width of the ground (along the X axis). Defaults to 1. */
  width?: number;
  /** Depth of the ground (along the Z axis). Defaults to 1. */
  depth?: number;
  /** Number of segments along the width. Defaults to 1. */
  widthSegments?: number;
  /** Number of segments along the depth. Defaults to 1. */
  depthSegments?: number;
}

/**
 * A horizontal Ground geometry on the X-Z plane.
 * Useful for terrains, floors, and basic rectangular flat surfaces.
 */
export class Ground extends AbstractGeometry {
  /** The width of the plane. */
  public width: number;
  /** The depth of the plane. */
  public depth: number;
  /** The number of segments along the width. */
  public widthSegments: number;
  /** The number of segments along the depth. */
  public depthSegments: number;

  /**
   * Creates a new Plane geometry.
   * @param options The configuration options.
   */
  constructor(options: GroundOptions = {}) {
    super();
    const { width = 1, depth = 1, widthSegments = 1, depthSegments = 1 } = options;
    this.width = width;
    this.depth = depth;
    this.widthSegments = Math.max(1, Math.floor(widthSegments));
    this.depthSegments = Math.max(1, Math.floor(depthSegments));
    this.generateGeometryData();
  }

  /** @inheritdoc */
  protected override generateGeometryData(): void {
    const v: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    const hW: number = this.width / 2.0;
    const hD: number = this.depth / 2.0;

    for (let z: number = 0; z <= this.depthSegments; z++) {
      const vRatio: number = z / this.depthSegments;
      for (let x: number = 0; x <= this.widthSegments; x++) {
        const uRatio: number = x / this.widthSegments;
        v.push(uRatio * this.width - hW, 0, vRatio * this.depth - hD);
        uv.push(uRatio, 1.0 - vRatio);
      }
    }

    for (let z: number = 0; z < this.depthSegments; z++) {
      for (let x: number = 0; x < this.widthSegments; x++) {
        const a: number = x + (this.widthSegments + 1) * z;
        const b: number = x + (this.widthSegments + 1) * (z + 1);
        const c: number = x + 1 + (this.widthSegments + 1) * (z + 1);
        const d: number = x + 1 + (this.widthSegments + 1) * z;

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

  /**
   * Computes the wireframe indices (line-segments) specifically for Ground.
   */
  public override computeWireframeIndices(): void {
    const lines: number[] = [];
    for (let z = 0; z <= this.depthSegments; z++) {
      for (let x = 0; x < this.widthSegments; x++) {
        const row = z * (this.widthSegments + 1);
        lines.push(row + x, row + x + 1);
      }
    }
    for (let x = 0; x <= this.widthSegments; x++) {
      for (let z = 0; z < this.depthSegments; z++) {
        const current = z * (this.widthSegments + 1) + x;
        const below = (z + 1) * (this.widthSegments + 1) + x;
        lines.push(current, below);
      }
    }
    this._wireframeIndices = this._createIndexArray(lines.length);
    this._wireframeIndices.set(lines);
  }
}
