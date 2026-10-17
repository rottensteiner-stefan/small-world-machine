import { AbstractGeometry } from "./AbstractGeometry.js";
import type { Vector3D } from "../math/index.js";

/**
 * Configuration options for polygon-fan geometry.
 */
export interface PolygonFanOptions {
  /** Points in order, tracing the polygon's perimeter. Minimum 3 to produce any triangles. */
  points: Vector3D[];
}

/**
 * A filled polygon of arbitrary point count, triangulated as a fan from the first point --
 * `(points[0], points[i], points[i+1])` for `i = 1..length-2`, the exact same triangulation
 * `StageZone.getScaleAt` uses internally. Used by Maker's `StageZoneGizmoManager` as a real,
 * triangle-based pick target for zone selection (a thin outline alone gives false-positive
 * bounding-box hits on concave shapes).
 */
export class PolygonFan extends AbstractGeometry {
  public points: Vector3D[];

  constructor(options: PolygonFanOptions) {
    super();
    this.points = options.points;
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
      uv.push(0, 0);
    }

    for (let i = 1; i < n - 1; i++) {
      idx.push(0, i, i + 1);
    }

    this._vertices = new Float32Array(v);
    this._uvs = new Float32Array(uv);
    this._indices = this._createIndexArray(idx.length);
    this._indices.set(idx);
  }
}
