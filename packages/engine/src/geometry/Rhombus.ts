import { AbstractGeometry } from "./AbstractGeometry.js";

/**
 * Configuration options for Rhombus geometry (Raute / Gleichseitiges Viereck / Diamond).
 */
export interface RhombusOptions {
  /** Side length of the rhombus (a). Defaults to 2. */
  side?: number;
  /** Acute angle in radians (alpha). Defaults to PI / 3 (60 degrees). */
  angle?: number;
  /** Explicit diagonal length along X (e). If provided along with diagonalB, overrides side & angle. */
  diagonalA?: number;
  /** Explicit diagonal length along Z (f). If provided along with diagonalA, overrides side & angle. */
  diagonalB?: number;
  /** Extrusion depth along Y (t). Defaults to 0 (planar 2D in X-Z plane). */
  depth?: number;
}

/**
 * A Rhombus (Raute / Gleichseitiges Viereck / Diamond) geometry.
 *
 * An equilateral quadrilateral with 4 equal sides of length $a$ and opposite equal angles.
 * Formed in the X-Z plane with diagonal $e$ oriented along the X-axis and diagonal $f$ along the Z-axis.
 *
 * Can be rendered as a 2D planar polygon in the X-Z plane (when depth = 0) with normal (0, 1, 0),
 * or as a solid 3D extruded prism (when depth > 0).
 *
 * Mathematical formulas:
 * - Side length: $a$
 * - Acute angle: $\alpha$
 * - Diagonals: $e = 2a \cos(\alpha / 2)$, $f = 2a \sin(\alpha / 2)$
 * - Incircle radius: $r_i = \frac{a \sin \alpha}{2} = \frac{e f}{4a}$
 * - Height: $h = a \sin \alpha = \frac{e f}{2a}$
 * - Perimeter: $u = 4a = 2\sqrt{e^2 + f^2}$
 * - Area: $A = a^2 \sin \alpha = \frac{e \cdot f}{2} = a \cdot h$
 * - Volume (3D): $V = A \cdot t$
 * - Total surface area (3D): $A_{\text{total}} = 2A + u \cdot t$
 *
 * @see https://rechneronline.de/pi/raute.php
 */
export class Rhombus extends AbstractGeometry {
  /** Side length (a). */
  public side: number;
  /** Acute angle in radians (alpha). */
  public angle: number;
  /** Diagonal length along X (e). */
  public diagonalA: number;
  /** Diagonal length along Z (f). */
  public diagonalB: number;
  /** Extrusion depth (t). */
  public depth: number;

  /**
   * Creates a new Rhombus geometry.
   * @param options Configuration options.
   */
  constructor(options: RhombusOptions = {}) {
    super();
    const {
      side = 2,
      angle = Math.PI / 3, // 60 degrees
      diagonalA,
      diagonalB,
      depth = 0,
    } = options;

    if (diagonalA !== undefined && diagonalB !== undefined && 0 < diagonalA && 0 < diagonalB) {
      this.diagonalA = Math.max(0.001, diagonalA);
      this.diagonalB = Math.max(0.001, diagonalB);
      this.side = Math.sqrt((this.diagonalA / 2) ** 2 + (this.diagonalB / 2) ** 2);
      this.angle = 2 * Math.atan2(this.diagonalB, this.diagonalA);
    } else {
      this.side = Math.max(0.01, side);
      this.angle = Math.max(0.001, Math.min(Math.PI - 0.001, angle));
      this.diagonalA = 2 * this.side * Math.cos(this.angle / 2);
      this.diagonalB = 2 * this.side * Math.sin(this.angle / 2);
    }

    this.depth = Math.max(0, depth);
    this.generateGeometryData();
  }

  /**
   * Calculates the incircle radius (Inkreisradius) $r_i = \frac{a \sin \alpha}{2} = \frac{e f}{4a}$.
   */
  public getIncircleRadius(): number {
    return (this.diagonalA * this.diagonalB) / (4 * this.side);
  }

  /**
   * Calculates the height $h = a \sin \alpha = \frac{e f}{2a}$.
   */
  public getHeight(): number {
    return (this.diagonalA * this.diagonalB) / (2 * this.side);
  }

  /**
   * Calculates the perimeter $u = 4a$.
   */
  public getPerimeter(): number {
    return 4 * this.side;
  }

  /**
   * Calculates the 2D surface area $A = \frac{e \cdot f}{2} = a^2 \sin \alpha$.
   */
  public getArea(): number {
    return (this.diagonalA * this.diagonalB) / 2;
  }

  /**
   * Calculates the 3D volume $V = A \cdot t$.
   */
  public getVolume(): number {
    return this.getArea() * this.depth;
  }

  /**
   * Calculates the total surface area (2D area if depth = 0, or $2A + u \cdot t$ if depth > 0).
   */
  public getTotalSurfaceArea(): number {
    const area2D = this.getArea();
    if (this.depth <= 0) {
      return area2D;
    }
    return 2 * area2D + this.getPerimeter() * this.depth;
  }

  /** @inheritdoc */
  protected override generateGeometryData(): void {
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    const wireIndices: number[] = [];

    const e = this.diagonalA;
    const f = this.diagonalB;
    const d = this.depth;

    const halfE = e / 2;
    const halfF = f / 2;
    const halfD = d / 2;

    let vertexOffset = 0;

    const addQuad = (
      p0: [number, number, number],
      p1: [number, number, number],
      p2: [number, number, number],
      p3: [number, number, number],
      norm: [number, number, number],
      uv0: [number, number],
      uv1: [number, number],
      uv2: [number, number],
      uv3: [number, number],
    ): void => {
      const idx0 = vertexOffset++;
      const idx1 = vertexOffset++;
      const idx2 = vertexOffset++;
      const idx3 = vertexOffset++;

      positions.push(...p0, ...p1, ...p2, ...p3);
      normals.push(...norm, ...norm, ...norm, ...norm);
      uvs.push(...uv0, ...uv1, ...uv2, ...uv3);

      const e1x = p1[0] - p0[0],
        e1y = p1[1] - p0[1],
        e1z = p1[2] - p0[2];
      const e2x = p2[0] - p0[0],
        e2y = p2[1] - p0[1],
        e2z = p2[2] - p0[2];
      const fnx = e1y * e2z - e1z * e2y;
      const fny = e1z * e2x - e1x * e2z;
      const fnz = e1x * e2y - e1y * e2x;
      const dot = fnx * norm[0] + fny * norm[1] + fnz * norm[2];

      if (dot >= 0) {
        indices.push(idx0, idx1, idx2, idx0, idx2, idx3);
      } else {
        indices.push(idx0, idx2, idx1, idx0, idx3, idx2);
      }
      wireIndices.push(idx0, idx1, idx1, idx2, idx2, idx3, idx3, idx0);
    };

    const calcUV = (x: number, z: number): [number, number] => {
      return [(x + halfE) / e, (z + halfF) / f];
    };

    // 4 Diamond Vertices in X-Z plane:
    // P0: (0, -halfF) [Top/Back]
    // P1: (halfE, 0) [Right]
    // P2: (0, halfF) [Bottom/Front]
    // P3: (-halfE, 0) [Left]

    if (d <= 0.00001) {
      // --- 2D Planar Mesh in X-Z Plane (Y = 0, Normal = [0, 1, 0]) ---
      const norm: [number, number, number] = [0, 1, 0];

      // Two CCW triangles: (P0, P3, P2) and (P0, P2, P1)
      const idx0 = vertexOffset++;
      const idx1 = vertexOffset++;
      const idx2 = vertexOffset++;
      const idx3 = vertexOffset++;

      positions.push(0, 0, -halfF);
      positions.push(halfE, 0, 0);
      positions.push(0, 0, halfF);
      positions.push(-halfE, 0, 0);

      normals.push(...norm, ...norm, ...norm, ...norm);
      uvs.push(
        ...calcUV(0, -halfF),
        ...calcUV(halfE, 0),
        ...calcUV(0, halfF),
        ...calcUV(-halfE, 0),
      );

      indices.push(idx0, idx3, idx2);
      indices.push(idx0, idx2, idx1);

      wireIndices.push(idx0, idx1, idx1, idx2, idx2, idx3, idx3, idx0);
    } else {
      // --- 3D Extruded Diamond Solid ---
      // 1. Top Face (+Y, y = +halfD, Normal = [0, 1, 0])
      const topNorm: [number, number, number] = [0, 1, 0];
      const t0 = vertexOffset++;
      const t1 = vertexOffset++;
      const t2 = vertexOffset++;
      const t3 = vertexOffset++;

      positions.push(0, halfD, -halfF);
      positions.push(halfE, halfD, 0);
      positions.push(0, halfD, halfF);
      positions.push(-halfE, halfD, 0);

      normals.push(...topNorm, ...topNorm, ...topNorm, ...topNorm);
      uvs.push(
        ...calcUV(0, -halfF),
        ...calcUV(halfE, 0),
        ...calcUV(0, halfF),
        ...calcUV(-halfE, 0),
      );

      indices.push(t0, t3, t2);
      indices.push(t0, t2, t1);
      wireIndices.push(t0, t1, t1, t2, t2, t3, t3, t0);

      // 2. Bottom Face (-Y, y = -halfD, Normal = [0, -1, 0])
      const btmNorm: [number, number, number] = [0, -1, 0];
      const b0 = vertexOffset++;
      const b1 = vertexOffset++;
      const b2 = vertexOffset++;
      const b3 = vertexOffset++;

      positions.push(0, -halfD, -halfF);
      positions.push(halfE, -halfD, 0);
      positions.push(0, -halfD, halfF);
      positions.push(-halfE, -halfD, 0);

      normals.push(...btmNorm, ...btmNorm, ...btmNorm, ...btmNorm);
      uvs.push(
        ...calcUV(0, -halfF),
        ...calcUV(halfE, 0),
        ...calcUV(0, halfF),
        ...calcUV(-halfE, 0),
      );

      indices.push(b0, b1, b2);
      indices.push(b0, b2, b3);
      wireIndices.push(b0, b1, b1, b2, b2, b3, b3, b0);

      // 3. Side Walls (4 quads with outward facing normals)
      const sideNorm = (dx: number, dz: number): [number, number, number] => {
        // Normal pointing outward perpendicular to (dx, 0, dz) in CCW winding
        const nx = dz;
        const nz = -dx;
        const len = Math.sqrt(nx * nx + nz * nz) || 1;
        return [nx / len, 0, nz / len];
      };

      // Side 1: P0 -> P1 ( (0, -halfF) to (halfE, 0) )
      const n01 = sideNorm(halfE, halfF);
      addQuad(
        [0, halfD, -halfF],
        [halfE, halfD, 0],
        [halfE, -halfD, 0],
        [0, -halfD, -halfF],
        n01,
        [0, 1],
        [1, 1],
        [1, 0],
        [0, 0],
      );

      // Side 2: P1 -> P2 ( (halfE, 0) to (0, halfF) )
      const n12 = sideNorm(-halfE, halfF);
      addQuad(
        [halfE, halfD, 0],
        [0, halfD, halfF],
        [0, -halfD, halfF],
        [halfE, -halfD, 0],
        n12,
        [0, 1],
        [1, 1],
        [1, 0],
        [0, 0],
      );

      // Side 3: P2 -> P3 ( (0, halfF) to (-halfE, 0) )
      const n23 = sideNorm(-halfE, -halfF);
      addQuad(
        [0, halfD, halfF],
        [-halfE, halfD, 0],
        [-halfE, -halfD, 0],
        [0, -halfD, halfF],
        n23,
        [0, 1],
        [1, 1],
        [1, 0],
        [0, 0],
      );

      // Side 4: P3 -> P0 ( (-halfE, 0) to (0, -halfF) )
      const n30 = sideNorm(halfE, -halfF);
      addQuad(
        [-halfE, halfD, 0],
        [0, halfD, -halfF],
        [0, -halfD, -halfF],
        [-halfE, -halfD, 0],
        n30,
        [0, 1],
        [1, 1],
        [1, 0],
        [0, 0],
      );
    }

    this._vertices = new Float32Array(positions);
    this._normals = new Float32Array(normals);
    this._uvs = new Float32Array(uvs);
    this._indices = this._createIndexArray(indices.length);
    this._indices.set(indices);
    this._wireframeIndices = this._createIndexArray(wireIndices.length);
    this._wireframeIndices.set(wireIndices);
  }
}
