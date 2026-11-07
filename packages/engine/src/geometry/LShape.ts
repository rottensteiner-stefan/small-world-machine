import { AbstractGeometry } from "./AbstractGeometry.js";

/**
 * Configuration options for LShape geometry (L-Form / Winkelprofil / Angle Profile).
 */
export interface LShapeOptions {
  /** Outer width along X (a). Defaults to 2. */
  width?: number;
  /** Outer height along Z (b). Defaults to 2. */
  height?: number;
  /** Wall/leg thickness (c). Defaults to 0.5. */
  thickness?: number;
  /** Extrusion depth along Y (t). Defaults to 0 (planar 2D in X-Z plane). */
  depth?: number;
}

/**
 * An LShape (L-Form / Winkelprofil / Angle Profile) geometry.
 *
 * An L-shaped polygonal profile formed by an outer boundary of width $a$, height $b$,
 * and uniform leg thickness $c$.
 *
 * Can be rendered as a 2D planar polygon in the X-Z plane (when depth = 0) with normal (0, 1, 0),
 * or as a solid 3D extruded angle profile prism (when depth > 0).
 *
 * Mathematical formulas:
 * - Outer sides $a, b$, thickness $c$
 * - Inner sides: $a' = a - c$, $b' = b - c$
 * - Perimeter: $u = 2(a + b)$
 * - Cross-sectional area: $A = c(a + b - c) = ac + b'c$
 * - Volume (3D): $V = A \cdot t$
 * - Total surface area (3D): $A_{\text{total}} = 2A + u \cdot t$
 *
 * @see https://rechneronline.de/pi/L-form.php
 */
export class LShape extends AbstractGeometry {
  /** Outer width (a). */
  public width: number;
  /** Outer height (b). */
  public height: number;
  /** Wall/leg thickness (c). */
  public thickness: number;
  /** Extrusion depth (t). */
  public depth: number;

  /**
   * Creates a new LShape geometry.
   * @param options Configuration options.
   */
  constructor(options: LShapeOptions = {}) {
    super();
    const { width = 2, height = 2, thickness = 0.5, depth = 0 } = options;

    this.width = Math.max(0.01, width);
    this.height = Math.max(0.01, height);
    // Thickness must be less than width and height
    const maxThickness = Math.min(this.width - 0.001, this.height - 0.001);
    this.thickness = Math.max(0.001, Math.min(Math.max(0.001, maxThickness), thickness));
    this.depth = Math.max(0, depth);

    this.generateGeometryData();
  }

  /**
   * Calculates the inner width $a' = a - c$.
   */
  public getInnerWidth(): number {
    return this.width - this.thickness;
  }

  /**
   * Calculates the inner height $b' = b - c$.
   */
  public getInnerHeight(): number {
    return this.height - this.thickness;
  }

  /**
   * Calculates the perimeter $u = 2(a + b)$.
   */
  public getPerimeter(): number {
    return 2 * (this.width + this.height);
  }

  /**
   * Calculates the 2D cross-sectional area $A = c(a + b - c)$.
   */
  public getArea(): number {
    const a = this.width;
    const b = this.height;
    const c = this.thickness;
    return c * (a + b - c);
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

    const a = this.width;
    const b = this.height;
    const c = this.thickness;
    const d = this.depth;

    const halfA = a / 2;
    const halfB = b / 2;
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
      return [(x + halfA) / a, (z + halfB) / b];
    };

    if (d <= 0.00001) {
      // --- 2D Planar Mesh in X-Z Plane (Y = 0, Normal = [0, 1, 0]) ---
      const norm: [number, number, number] = [0, 1, 0];

      // Horizontal arm: x from -halfA to halfA, z from -halfB to -halfB + c
      addQuad(
        [-halfA, 0, -halfB],
        [halfA, 0, -halfB],
        [halfA, 0, -halfB + c],
        [-halfA, 0, -halfB + c],
        norm,
        calcUV(-halfA, -halfB),
        calcUV(halfA, -halfB),
        calcUV(halfA, -halfB + c),
        calcUV(-halfA, -halfB + c),
      );

      // Vertical arm: x from -halfA to -halfA + c, z from -halfB + c to halfB
      addQuad(
        [-halfA, 0, -halfB + c],
        [-halfA + c, 0, -halfB + c],
        [-halfA + c, 0, halfB],
        [-halfA, 0, halfB],
        norm,
        calcUV(-halfA, -halfB + c),
        calcUV(-halfA + c, -halfB + c),
        calcUV(-halfA + c, halfB),
        calcUV(-halfA, halfB),
      );
    } else {
      // --- 3D Extruded L-Profile Solid ---
      // 1. Top Face (+Y, y = +halfD, Normal = [0, 1, 0])
      const topNorm: [number, number, number] = [0, 1, 0];
      // Top Horizontal arm
      addQuad(
        [-halfA, halfD, -halfB],
        [halfA, halfD, -halfB],
        [halfA, halfD, -halfB + c],
        [-halfA, halfD, -halfB + c],
        topNorm,
        calcUV(-halfA, -halfB),
        calcUV(halfA, -halfB),
        calcUV(halfA, -halfB + c),
        calcUV(-halfA, -halfB + c),
      );
      // Top Vertical arm
      addQuad(
        [-halfA, halfD, -halfB + c],
        [-halfA + c, halfD, -halfB + c],
        [-halfA + c, halfD, halfB],
        [-halfA, halfD, halfB],
        topNorm,
        calcUV(-halfA, -halfB + c),
        calcUV(-halfA + c, -halfB + c),
        calcUV(-halfA + c, halfB),
        calcUV(-halfA, halfB),
      );

      // 2. Bottom Face (-Y, y = -halfD, Normal = [0, -1, 0])
      const btmNorm: [number, number, number] = [0, -1, 0];
      // Bottom Horizontal arm (reversed winding)
      addQuad(
        [-halfA, -halfD, -halfB + c],
        [halfA, -halfD, -halfB + c],
        [halfA, -halfD, -halfB],
        [-halfA, -halfD, -halfB],
        btmNorm,
        calcUV(-halfA, -halfB + c),
        calcUV(halfA, -halfB + c),
        calcUV(halfA, -halfB),
        calcUV(-halfA, -halfB),
      );
      // Bottom Vertical arm (reversed winding)
      addQuad(
        [-halfA, -halfD, halfB],
        [-halfA + c, -halfD, halfB],
        [-halfA + c, -halfD, -halfB + c],
        [-halfA, -halfD, -halfB + c],
        btmNorm,
        calcUV(-halfA, halfB),
        calcUV(-halfA + c, halfB),
        calcUV(-halfA + c, -halfB + c),
        calcUV(-halfA, -halfB + c),
      );

      // 3. Side Walls (6 quads)
      // Wall 1: Outer Bottom (-Z, z = -halfB, Normal = [0, 0, -1])
      addQuad(
        [-halfA, halfD, -halfB],
        [halfA, halfD, -halfB],
        [halfA, -halfD, -halfB],
        [-halfA, -halfD, -halfB],
        [0, 0, -1],
        [0, 1],
        [1, 1],
        [1, 0],
        [0, 0],
      );

      // Wall 2: Outer Right End (+X, x = halfA, Normal = [1, 0, 0])
      addQuad(
        [halfA, halfD, -halfB],
        [halfA, halfD, -halfB + c],
        [halfA, -halfD, -halfB + c],
        [halfA, -halfD, -halfB],
        [1, 0, 0],
        [0, 1],
        [1, 1],
        [1, 0],
        [0, 0],
      );

      // Wall 3: Inner Horizontal Top (+Z, z = -halfB + c, Normal = [0, 0, 1])
      addQuad(
        [halfA, halfD, -halfB + c],
        [-halfA + c, halfD, -halfB + c],
        [-halfA + c, -halfD, -halfB + c],
        [halfA, -halfD, -halfB + c],
        [0, 0, 1],
        [0, 1],
        [1, 1],
        [1, 0],
        [0, 0],
      );

      // Wall 4: Inner Vertical Right (+X, x = -halfA + c, Normal = [1, 0, 0])
      addQuad(
        [-halfA + c, halfD, -halfB + c],
        [-halfA + c, halfD, halfB],
        [-halfA + c, -halfD, halfB],
        [-halfA + c, -halfD, -halfB + c],
        [1, 0, 0],
        [0, 1],
        [1, 1],
        [1, 0],
        [0, 0],
      );

      // Wall 5: Top End of Vertical Arm (+Z, z = halfB, Normal = [0, 0, 1])
      addQuad(
        [-halfA + c, halfD, halfB],
        [-halfA, halfD, halfB],
        [-halfA, -halfD, halfB],
        [-halfA + c, -halfD, halfB],
        [0, 0, 1],
        [0, 1],
        [1, 1],
        [1, 0],
        [0, 0],
      );

      // Wall 6: Outer Left (-X, x = -halfA, Normal = [-1, 0, 0])
      addQuad(
        [-halfA, halfD, halfB],
        [-halfA, halfD, -halfB],
        [-halfA, -halfD, -halfB],
        [-halfA, -halfD, halfB],
        [-1, 0, 0],
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
