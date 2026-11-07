import { AbstractGeometry } from "./AbstractGeometry.js";

/**
 * Configuration for the Plane geometry.
 */
export interface PlaneOptions {
  /** Width of the plane (along the X axis). Defaults to 1. */
  width?: number;
  /** Height of the plane (along the Y axis). Defaults to 1. */
  height?: number;
  /** Number of segments along the width. Defaults to 1. */
  widthSegments?: number;
  /** Number of segments along the height. Defaults to 1. */
  heightSegments?: number;
}

/**
 * A vertical flat plane geometry on the X-Y plane, facing +Z.
 * Useful for UI, Sprites, Billboards, and walls.
 */
export class Plane extends AbstractGeometry {
  /** The width of the plane. */
  public width: number;
  /** The height of the plane. */
  public height: number;
  /** The number of segments along the width. */
  public widthSegments: number;
  /** The number of segments along the height. */
  public heightSegments: number;

  /**
   * Creates a new Plane geometry.
   * @param options The configuration options.
   */
  constructor(options: PlaneOptions = {}) {
    super();
    const { width = 1, height = 1, widthSegments = 1, heightSegments = 1 } = options;
    this.width = width;
    this.height = height;
    this.widthSegments = Math.max(1, Math.floor(widthSegments));
    this.heightSegments = Math.max(1, Math.floor(heightSegments));
    this.generateGeometryData();
  }

  /** @inheritdoc */
  protected override generateGeometryData(): void {
    const v: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    const hW: number = this.width / 2.0;
    const hH: number = this.height / 2.0;

    for (let y: number = 0; y <= this.heightSegments; y++) {
      const vRatio: number = y / this.heightSegments;
      for (let x: number = 0; x <= this.widthSegments; x++) {
        const uRatio: number = x / this.widthSegments;

        // Vertices: centered at origin.
        // x goes from -hW to +hW
        // y goes from +hH to -hH (so top-left is first)
        v.push(uRatio * this.width - hW, hH - vRatio * this.height, 0);

        // UVs: U goes 0 to 1 (left to right), V goes 1 to 0 (top to bottom)
        uv.push(uRatio, 1.0 - vRatio);
      }
    }

    // Indices
    for (let y: number = 0; y < this.heightSegments; y++) {
      for (let x: number = 0; x < this.widthSegments; x++) {
        const row1 = y * (this.widthSegments + 1);
        const row2 = (y + 1) * (this.widthSegments + 1);
        const i1 = row1 + x;
        const i2 = row1 + x + 1;
        const i3 = row2 + x;
        const i4 = row2 + x + 1;

        idx.push(i1, i3, i2);
        idx.push(i2, i3, i4);
      }
    }

    this._vertices = new Float32Array(v);
    this._uvs = new Float32Array(uv);
    this._indices = this._createIndexArray(idx.length);
    this._indices.set(idx);
    this.computeNormals();
  }

  /**
   * Computes the wireframe indices (line-segments) specifically for Plane.
   */
  public override computeWireframeIndices(): void {
    const lines: number[] = [];
    for (let y = 0; y <= this.heightSegments; y++) {
      for (let x = 0; x < this.widthSegments; x++) {
        const row = y * (this.widthSegments + 1);
        lines.push(row + x, row + x + 1);
      }
    }
    for (let x = 0; x <= this.widthSegments; x++) {
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
