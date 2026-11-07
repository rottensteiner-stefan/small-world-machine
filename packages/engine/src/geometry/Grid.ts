import { AbstractGeometry } from "./AbstractGeometry.js";

/**
 * Configuration options for grid geometry.
 */
export interface GridOptions {
  /** The total size of the grid edges. Defaults to 20. */
  size?: number;
  /** The number of divisions along each axis. Defaults to 20. */
  divisions?: number;
}

/**
 * A helper geometry representing a flat grid of lines on the XZ plane.
 */
export class Grid extends AbstractGeometry {
  /** The total size of the grid. */
  public size: number;
  /** The number of divisions. */
  public divisions: number;

  /**
   * Creates a new Grid geometry.
   * @param options The configuration options.
   */
  constructor(options: GridOptions = {}) {
    super();
    const { size = 20, divisions = 20 } = options;
    this.size = size;
    this.divisions = divisions;
    this._isLineGeometry = true;
    this.generateGeometryData();
  }

  /** @inheritdoc */
  protected override generateGeometryData(): void {
    const v: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    const step: number = this.size / this.divisions;
    const half: number = this.size / 2.0;
    let index: number = 0;

    for (let j: number = 0; j <= this.divisions; j++) {
      const pos: number = j * step - half;
      const ratio: number = j / this.divisions;

      // Vertical line
      v.push(pos, 0, -half, pos, 0, half);
      uv.push(ratio, 0, ratio, 1);
      idx.push(index, index + 1);
      index += 2;

      // Horizontal line
      v.push(-half, 0, pos, half, 0, pos);
      uv.push(0, ratio, 1, ratio);
      idx.push(index, index + 1);
      index += 2;
    }

    this._vertices = new Float32Array(v);
    this._uvs = new Float32Array(uv);
    this._indices = this._createIndexArray(idx.length);
    this._indices.set(idx);
  }

  /**
   * Computes the wireframe indices (line-segments) specifically for Grid.
   */
  public override computeWireframeIndices(): void {
    if (this._indices) {
      this._wireframeIndices = this._indices;
    }
  }
}
