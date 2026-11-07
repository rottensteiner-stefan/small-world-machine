import { AbstractGeometry } from "./AbstractGeometry.js";
import type { Vector3D } from "../math/index.js";

/**
 * A simple line geometry connecting two points.
 */
export class Line extends AbstractGeometry {
  /**
   * Creates a new Line geometry.
   * @param start The start position of the line.
   * @param end The end position of the line.
   */
  constructor(
    public start: Vector3D,
    public end: Vector3D,
  ) {
    super();
    this._isLineGeometry = true;
    this.generateGeometryData();
  }

  /** @inheritdoc */
  protected override generateGeometryData(): void {
    this._vertices = new Float32Array([
      this.start.x,
      this.start.y,
      this.start.z,
      this.end.x,
      this.end.y,
      this.end.z,
    ]);
    this._uvs = new Float32Array([0, 0, 1, 1]);
    this._indices = this._createIndexArray(2);
    this._indices.set([0, 1]);
  }
}
