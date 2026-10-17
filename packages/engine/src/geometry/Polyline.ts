import { AbstractGeometry } from "./AbstractGeometry.js";
import type { Vector3D } from "../math/index.js";

/**
 * Configuration options for polyline geometry.
 */
export interface PolylineOptions {
  /** Points in order, tracing the line. */
  points: Vector3D[];
  /** Whether an extra segment connects the last point back to the first (default: false). */
  closed?: boolean;
}

/**
 * A line strip connecting an arbitrary number of points -- generalization of `Line` (always
 * exactly 2 points) used for outlining Maker helper shapes with more than one segment, e.g.
 * `StageZoneGizmoManager`'s zone outlines.
 */
export class Polyline extends AbstractGeometry {
  public points: Vector3D[];
  public closed: boolean;

  constructor(options: PolylineOptions) {
    super();
    this.points = options.points;
    this.closed = options.closed ?? false;
    this._isLineGeometry = true;
    this.generateGeometryData();
  }

  /** @inheritdoc */
  protected override generateGeometryData(): void {
    const v: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    const n = this.points.length;

    for (let i = 0; i < n; i++) {
      const p = this.points[i]!;
      v.push(p.x, p.y, p.z);
      uv.push(1 < n ? i / (n - 1) : 0, 0);
    }

    const segmentCount = this.closed ? n : Math.max(0, n - 1);
    for (let i = 0; i < segmentCount; i++) {
      idx.push(i, (i + 1) % n);
    }

    this._vertices = new Float32Array(v);
    this._uvs = new Float32Array(uv);
    this._indices = this._createIndexArray(idx.length);
    this._indices.set(idx);
  }

  /**
   * Computes the wireframe indices (line-segments) specifically for Polyline.
   */
  public override computeWireframeIndices(): void {
    if (this._indices) {
      this._wireframeIndices = this._indices;
    }
  }
}
