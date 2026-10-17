import { MathPool, Matrix4, Vector3D } from "../math/index.js";
import { BoundingBox } from "../physix/index.js";
import type { GeometryDataInterface, Geometry, BoundingVolume } from "../interfaces/index.js";
import { Topology } from "../enums/index.js";
/**
 * Base class for all geometry types.
 * Manages vertex, index, normal, and UV data.
 * Designed to be extended by specific shapes.
 */
export abstract class AbstractGeometry implements Geometry {
  /** The vertices of the geometry (x, y, z). */
  protected _vertices: Float32Array = new Float32Array();
  /** The indices of the geometry for indexed rendering. */
  protected _indices: Uint16Array | Uint32Array | undefined = undefined;
  /** The indices for wireframe rendering. */
  protected _wireframeIndices: Uint16Array | Uint32Array | undefined = undefined;
  /** The normals of the geometry (nx, ny, nz). */
  protected _normals: Float32Array = new Float32Array();
  /** The tangents of the geometry (tx, ty, tz). */
  protected _tangents: Float32Array = new Float32Array();
  /** The UV coordinates of the geometry (u, v). */
  protected _uvs: Float32Array = new Float32Array();
  /** Optional per-vertex color data (r, g, b, a). */
  protected _colors?: Float32Array | undefined = undefined;
  /** Optional skinning joints (4 IDs per vertex). */
  protected _joints?: Float32Array | Uint16Array | undefined = undefined;
  /** Optional skinning weights (4 weights per vertex). */
  protected _weights?: Float32Array | undefined = undefined;
  /** Whether the geometry is purely line-based. */
  protected _isLineGeometry: boolean = false;
  /** Cached bounding volume to prevent re-allocation */
  protected _cachedBoundingVolume: BoundingVolume | undefined = undefined;

  /**
   * Generates the raw geometry data. Must be implemented by subclasses.
   */
  protected abstract generateGeometryData(): void;

  /** @inheritdoc */
  public getGeometryData(): GeometryDataInterface {
    if (0 === this._normals.length && 0 < this._vertices.length) {
      this.computeNormals();
    }
    // Fallback for UVs if they are missing
    if (0 === this._uvs.length && 0 < this._vertices.length) {
      this._uvs = new Float32Array((this._vertices.length / 3) * 2);
    }

    if (0 === this._tangents.length && 0 < this._vertices.length && !this._isLineGeometry) {
      this.computeTangents();
    }

    if (undefined === this._wireframeIndices && 0 < this._vertices.length) {
      if (this._isLineGeometry && this._indices) {
        this._wireframeIndices = this._indices;
      } else {
        this.computeWireframeIndices();
      }
    }

    return {
      vertices: this._vertices,
      indices: this._indices,
      wireframeIndices: this._wireframeIndices,
      normals: this._normals,
      tangents: this._tangents,
      uvs: this._uvs,
      colors: this._colors,
      joints: this._joints,
      weights: this._weights,
      topology: this._isLineGeometry ? Topology.LINE_LIST : Topology.TRIANGLE_LIST,
      getBoundingVolume: () => this.getBoundingVolume(),
    };
  }

  /** @inheritdoc */
  public getBoundingVolume(): BoundingVolume {
    if (!this._cachedBoundingVolume) {
      this._cachedBoundingVolume = BoundingBox.fromVertices(this._vertices);
    }
    return this._cachedBoundingVolume;
  }

  /**
   * Computes the tangents of the geometry based on normals and UVs.
   * Required for normal mapping.
   */
  public computeTangents(): void {
    if (0 === this._vertices.length || 0 === this._uvs.length || this._isLineGeometry) return;

    this._tangents = new Float32Array(this._vertices.length);

    if (undefined === this._indices || 0 !== this._indices.length % 3) {
      return;
    }

    const tan1: Float32Array = new Float32Array(this._vertices.length);
    const tan2: Float32Array = new Float32Array(this._vertices.length);

    for (let i: number = 0; i < this._indices.length; i += 3) {
      const i1: number = this._indices[i]!;
      const i2: number = this._indices[i + 1]!;
      const i3: number = this._indices[i + 2]!;

      const v1x: number = this._vertices[i1 * 3]!;
      const v1y: number = this._vertices[i1 * 3 + 1]!;
      const v1z: number = this._vertices[i1 * 3 + 2]!;
      const v2x: number = this._vertices[i2 * 3]!;
      const v2y: number = this._vertices[i2 * 3 + 1]!;
      const v2z: number = this._vertices[i2 * 3 + 2]!;
      const v3x: number = this._vertices[i3 * 3]!;
      const v3y: number = this._vertices[i3 * 3 + 1]!;
      const v3z: number = this._vertices[i3 * 3 + 2]!;

      const w1u: number = this._uvs[i1 * 2]!;
      const w1v: number = this._uvs[i1 * 2 + 1]!;
      const w2u: number = this._uvs[i2 * 2]!;
      const w2v: number = this._uvs[i2 * 2 + 1]!;
      const w3u: number = this._uvs[i3 * 2]!;
      const w3v: number = this._uvs[i3 * 2 + 1]!;

      const x1: number = v2x - v1x;
      const x2: number = v3x - v1x;
      const y1: number = v2y - v1y;
      const y2: number = v3y - v1y;
      const z1: number = v2z - v1z;
      const z2: number = v3z - v1z;

      const s1: number = w2u - w1u;
      const s2: number = w3u - w1u;
      const t1: number = w2v - w1v;
      const t2: number = w3v - w1v;

      const div: number = s1 * t2 - s2 * t1;
      const r: number = 0 === div ? 0 : 1.0 / div;
      const tx: number = (t2 * x1 - t1 * x2) * r;
      const ty: number = (t2 * y1 - t1 * y2) * r;
      const tz: number = (t2 * z1 - t1 * z2) * r;
      const bx: number = (s1 * x2 - s2 * x1) * r;
      const by: number = (s1 * y2 - s2 * y1) * r;
      const bz: number = (s1 * z2 - s2 * z1) * r;

      tan1[i1 * 3]! += tx;
      tan1[i1 * 3 + 1]! += ty;
      tan1[i1 * 3 + 2]! += tz;
      tan1[i2 * 3]! += tx;
      tan1[i2 * 3 + 1]! += ty;
      tan1[i2 * 3 + 2]! += tz;
      tan1[i3 * 3]! += tx;
      tan1[i3 * 3 + 1]! += ty;
      tan1[i3 * 3 + 2]! += tz;

      tan2[i1 * 3]! += bx;
      tan2[i1 * 3 + 1]! += by;
      tan2[i1 * 3 + 2]! += bz;
      tan2[i2 * 3]! += bx;
      tan2[i2 * 3 + 1]! += by;
      tan2[i2 * 3 + 2]! += bz;
      tan2[i3 * 3]! += bx;
      tan2[i3 * 3 + 1]! += by;
      tan2[i3 * 3 + 2]! += bz;
    }

    for (let i: number = 0; i < this._vertices.length / 3; i++) {
      const nx: number = this._normals[i * 3]!;
      const ny: number = this._normals[i * 3 + 1]!;
      const nz: number = this._normals[i * 3 + 2]!;
      const tx: number = tan1[i * 3]!;
      const ty: number = tan1[i * 3 + 1]!;
      const tz: number = tan1[i * 3 + 2]!;

      // Gram-Schmidt orthogonalize
      const dot: number = nx * tx + ny * ty + nz * tz;
      const otx: number = tx - nx * dot;
      const oty: number = ty - ny * dot;
      const otz: number = tz - nz * dot;
      const len: number = Math.sqrt(otx * otx + oty * oty + otz * otz);

      if (len > 0.00001) {
        this._tangents[i * 3] = otx / len;
        this._tangents[i * 3 + 1] = oty / len;
        this._tangents[i * 3 + 2] = otz / len;
      } else {
        const absNy = Math.abs(ny);
        if (absNy < 0.999) {
          const px = -nz;
          const pz = nx;
          const pLen = Math.sqrt(px * px + pz * pz);
          this._tangents[i * 3] = px / pLen;
          this._tangents[i * 3 + 1] = 0;
          this._tangents[i * 3 + 2] = pz / pLen;
        } else {
          const py = nz;
          const pz = -ny;
          const pLen = Math.sqrt(py * py + pz * pz);
          this._tangents[i * 3] = 0;
          this._tangents[i * 3 + 1] = py / pLen;
          this._tangents[i * 3 + 2] = pz / pLen;
        }
      }
    }
  }

  /**
   * Computes the wireframe indices (line-segments) from the current triangle topology.
   */
  public computeWireframeIndices(): void {
    if (this._indices) {
      const triangleCount = Math.floor(this._indices.length / 3);
      const lineCount = triangleCount * 6;
      const lines = this._createIndexArray(lineCount);
      let ptr = 0;
      for (let i = 0; i < triangleCount * 3; i += 3) {
        const a = this._indices[i]!;
        const b = this._indices[i + 1]!;
        const c = this._indices[i + 2]!;
        lines[ptr++] = a;
        lines[ptr++] = b;
        lines[ptr++] = b;
        lines[ptr++] = c;
        lines[ptr++] = c;
        lines[ptr++] = a;
      }
      this._wireframeIndices = lines;
    } else {
      const vertexCount = this._vertices.length / 3;
      const triangleCount = Math.floor(vertexCount / 3);
      const lineCount = triangleCount * 6;
      const lines = this._createIndexArray(lineCount);
      let ptr = 0;
      for (let i = 0; i < triangleCount * 3; i += 3) {
        lines[ptr++] = i;
        lines[ptr++] = i + 1;
        lines[ptr++] = i + 1;
        lines[ptr++] = i + 2;
        lines[ptr++] = i + 2;
        lines[ptr++] = i;
      }
      this._wireframeIndices = lines;
    }
  }

  /**
   * Helper method to create an appropriately sized index array.
   * Automatically chooses between 16-bit and 32-bit indices based on vertex count.
   * @param indexCount The number of indices needed.
   * @returns A Uint16Array or Uint32Array.
   */
  protected _createIndexArray(indexCount: number): Uint16Array | Uint32Array {
    const vertexCount: number = this._vertices.length / 3;
    if (vertexCount > 65535) {
      return new Uint32Array(indexCount);
    }
    return new Uint16Array(indexCount);
  }

  /**
   * Computes the normals of the geometry using the current vertices and indices.
   * Averages normals for shared vertices.
   */
  public computeNormals(): void {
    if (0 === this._vertices.length) return;

    this._normals = new Float32Array(this._vertices.length);

    // If no indices, we can't easily compute averaged normals for shared vertices
    if (!this._indices || 0 !== this._indices.length % 3) {
      // Default to up-normals if calculation is impossible
      for (let i: number = 0; i < this._normals.length; i += 3) {
        this._normals[i] = 0;
        this._normals[i + 1] = 1;
        this._normals[i + 2] = 0;
      }
      return;
    }

    for (let i: number = 0; i < this._indices.length; i += 3) {
      const iA: number = (this._indices[i] ?? 0) * 3;
      const iB: number = (this._indices[i + 1] ?? 0) * 3;
      const iC: number = (this._indices[i + 2] ?? 0) * 3;

      const ax: number = this._vertices[iA] ?? 0;
      const ay: number = this._vertices[iA + 1] ?? 0;
      const az: number = this._vertices[iA + 2] ?? 0;

      const bx: number = this._vertices[iB] ?? 0;
      const by: number = this._vertices[iB + 1] ?? 0;
      const bz: number = this._vertices[iB + 2] ?? 0;

      const cx: number = this._vertices[iC] ?? 0;
      const cy: number = this._vertices[iC + 1] ?? 0;
      const cz: number = this._vertices[iC + 2] ?? 0;

      const ux: number = bx - ax;
      const uy: number = by - ay;
      const uz: number = bz - az;

      const vx: number = cx - ax;
      const vy: number = cy - ay;
      const vz: number = cz - az;

      const nx: number = uy * vz - uz * vy;
      const ny: number = uz * vx - ux * vz;
      const nz: number = ux * vy - uy * vx;

      this._normals[iA] = (this._normals[iA] ?? 0) + nx;
      this._normals[iA + 1] = (this._normals[iA + 1] ?? 0) + ny;
      this._normals[iA + 2] = (this._normals[iA + 2] ?? 0) + nz;

      this._normals[iB] = (this._normals[iB] ?? 0) + nx;
      this._normals[iB + 1] = (this._normals[iB + 1] ?? 0) + ny;
      this._normals[iB + 2] = (this._normals[iB + 2] ?? 0) + nz;

      this._normals[iC] = (this._normals[iC] ?? 0) + nx;
      this._normals[iC + 1] = (this._normals[iC + 1] ?? 0) + ny;
      this._normals[iC + 2] = (this._normals[iC + 2] ?? 0) + nz;
    }

    for (let i: number = 0; i < this._normals.length; i += 3) {
      const nx: number = this._normals[i] ?? 0;
      const ny: number = this._normals[i + 1] ?? 0;
      const nz: number = this._normals[i + 2] ?? 0;
      const len: number = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (0.00001 < len) {
        this._normals[i] = nx / len;
        this._normals[i + 1] = ny / len;
        this._normals[i + 2] = nz / len;
      } else {
        this._normals[i] = 0;
        this._normals[i + 1] = 1;
        this._normals[i + 2] = 0;
      }
    }
  }

  /**
   * Applies a Matrix4 transformation to all geometry vertices in-place.
   * @param matrix The transformation matrix.
   * @returns this
   */
  public applyMatrix4(matrix: Matrix4): this {
    const v: Vector3D = new Vector3D();
    for (let i: number = 0; i < this._vertices.length; i += 3) {
      v.x = this._vertices[i] ?? 0;
      v.y = this._vertices[i + 1] ?? 0;
      v.z = this._vertices[i + 2] ?? 0;
      matrix.transformVector(v);
      this._vertices[i] = v.x;
      this._vertices[i + 1] = v.y;
      this._vertices[i + 2] = v.z;
    }
    this.computeNormals();
    return this;
  }

  /**
   * Scales the geometry vertices in-place.
   * @param f The scale factor.
   * @returns this
   */
  public scale(f: number): this {
    const m: Matrix4 = MathPool.acquireMatrix();
    Matrix4.scale(f, m);
    this.applyMatrix4(m);
    MathPool.releaseMatrix(m);
    return this;
  }

  /**
   * Rotates the geometry vertices around the X-axis in-place.
   * @param a The rotation angle in radians.
   * @returns this
   */
  public rotateX(a: number): this {
    const m: Matrix4 = MathPool.acquireMatrix();
    Matrix4.rotateX(a, m);
    this.applyMatrix4(m);
    MathPool.releaseMatrix(m);
    return this;
  }

  /**
   * Rotates the geometry vertices around the Y-axis in-place.
   * @param a The rotation angle in radians.
   * @returns this
   */
  public rotateY(a: number): this {
    const m: Matrix4 = MathPool.acquireMatrix();
    Matrix4.rotateY(a, m);
    this.applyMatrix4(m);
    MathPool.releaseMatrix(m);
    return this;
  }

  /**
   * Rotates the geometry vertices around the Z-axis in-place.
   * @param a The rotation angle in radians.
   * @returns this
   */
  public rotateZ(a: number): this {
    const m: Matrix4 = MathPool.acquireMatrix();
    Matrix4.rotateZ(a, m);
    this.applyMatrix4(m);
    MathPool.releaseMatrix(m);
    return this;
  }

  /** Gets the optional per-vertex colors array. */
  public get colors(): Float32Array | undefined {
    return this._colors;
  }

  /** Sets the per-vertex colors array. */
  public set colors(val: Float32Array | undefined) {
    this._colors = val;
  }
}
