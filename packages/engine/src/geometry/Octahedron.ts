import { AbstractGeometry } from "./AbstractGeometry.js";

/**
 * Configuration options for octahedron geometry.
 */
export interface OctahedronOptions {
  /** The circumradius of the octahedron (distance from center to vertices). Defaults to 1. */
  radius?: number;
}

/**
 * An eight-sided polyhedron (octahedron) geometry.
 */
export class Octahedron extends AbstractGeometry {
  /** The circumradius of the octahedron. */
  public radius: number;

  /**
   * Creates a new Octahedron geometry.
   * @param options The configuration options.
   */
  constructor(options: OctahedronOptions = {}) {
    super();
    this.radius = Math.max(0, options.radius ?? 1.0);
    this.generateGeometryData();
  }

  /** @inheritdoc */
  protected override generateGeometryData(): void {
    const vertices: number[] = [];
    const indices: number[] = [];
    const uvs: number[] = [];

    const r = this.radius;

    // To get flat shading, we define unique vertices per face.
    // Faces are defined in counter-clockwise winding order from the outside.

    // Top 4 faces (Y is positive)
    // Face 1: +X, -Z
    this._addFace(vertices, indices, uvs, [r, 0, 0], [0, 0, -r], [0, r, 0]);
    // Face 2: -Z, -X
    this._addFace(vertices, indices, uvs, [0, 0, -r], [-r, 0, 0], [0, r, 0]);
    // Face 3: -X, +Z
    this._addFace(vertices, indices, uvs, [-r, 0, 0], [0, 0, r], [0, r, 0]);
    // Face 4: +Z, +X
    this._addFace(vertices, indices, uvs, [0, 0, r], [r, 0, 0], [0, r, 0]);

    // Bottom 4 faces (Y is negative)
    // Face 5: +X, +Z
    this._addFace(vertices, indices, uvs, [r, 0, 0], [0, 0, r], [0, -r, 0]);
    // Face 6: +Z, -X
    this._addFace(vertices, indices, uvs, [0, 0, r], [-r, 0, 0], [0, -r, 0]);
    // Face 7: -X, -Z
    this._addFace(vertices, indices, uvs, [-r, 0, 0], [0, 0, -r], [0, -r, 0]);
    // Face 8: -Z, +X
    this._addFace(vertices, indices, uvs, [0, 0, -r], [r, 0, 0], [0, -r, 0]);

    this._vertices = new Float32Array(vertices);
    this._uvs = new Float32Array(uvs);
    this._indices = this._createIndexArray(indices.length);
    this._indices.set(indices);

    this.computeNormals();
  }

  private _addFace(
    vertices: number[],
    indices: number[],
    uvs: number[],
    v0: [number, number, number],
    v1: [number, number, number],
    v2: [number, number, number],
  ): void {
    const idx = vertices.length / 3;

    vertices.push(...v0);
    vertices.push(...v1);
    vertices.push(...v2);

    // Simple UV mapping for each triangle
    uvs.push(0, 0);
    uvs.push(1, 0);
    uvs.push(0.5, 1);

    indices.push(idx, idx + 1, idx + 2);
  }
}
