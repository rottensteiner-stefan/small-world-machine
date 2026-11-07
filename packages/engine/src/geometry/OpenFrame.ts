import { AbstractGeometry } from "./AbstractGeometry.js";

/**
 * Configuration options for OpenFrame geometry (Offener Rahmen / U-profile).
 */
export interface OpenFrameOptions {
  /** Outer width along X (a). Defaults to 2. */
  width?: number;
  /** Outer height along Z (h). Defaults to 2. */
  height?: number;
  /** Wall/beam thickness (c). Defaults to 0.4. */
  thickness?: number;
  /** Extrusion depth along Y (t). Defaults to 0 (planar 2D in X-Z plane). */
  depth?: number;
}

/**
 * An OpenFrame (Offener Rahmen / U-Profile) geometry.
 *
 * A U-shaped polygonal profile formed by an outer rectangular boundary of width $a$
 * and height $h$ with wall thickness $c$, leaving an open rectangular inner notch
 * of inner width $b = a - 2c$ and inner height $i = h - c$.
 *
 * Can be rendered as a 2D planar polygon in the X-Z plane (when depth = 0) with normal (0, 1, 0),
 * or as a solid 3D extruded U-beam prism (when depth > 0).
 *
 * Mathematical formulas:
 * - Inner width: $b = a - 2c$
 * - Inner height: $i = h - c$
 * - Perimeter: $u = 2a + 4h - 4c = a + b + 2c + 2h + 2i$
 * - Cross-sectional area: $A = c(2h + b) = c(2h + a - 2c) = 2ch + cb$
 * - Volume (3D): $V = A \cdot t$
 * - Total surface area (3D): $A_{\text{total}} = 2A + u \cdot t$
 *
 * @see https://rechneronline.de/pi/offener-rahmen.php
 */
export class OpenFrame extends AbstractGeometry {
  /** Outer width (a). */
  public width: number;
  /** Outer height (h). */
  public height: number;
  /** Wall thickness (c). */
  public thickness: number;
  /** Extrusion depth (t). */
  public depth: number;

  /**
   * Creates a new OpenFrame geometry.
   * @param options Configuration options.
   */
  constructor(options: OpenFrameOptions = {}) {
    super();
    const { width = 2, height = 2, thickness = 0.4, depth = 0 } = options;

    this.width = Math.max(0.01, width);
    this.height = Math.max(0.01, height);
    // Thickness must be less than half width and less than height
    const maxThickness = Math.min(this.width / 2 - 0.001, this.height - 0.001);
    this.thickness = Math.max(0.001, Math.min(Math.max(0.001, maxThickness), thickness));
    this.depth = Math.max(0, depth);

    this.generateGeometryData();
  }

  /**
   * Calculates the inner width $b = a - 2c$.
   */
  public getInnerWidth(): number {
    return this.width - 2 * this.thickness;
  }

  /**
   * Calculates the inner height $i = h - c$.
   */
  public getInnerHeight(): number {
    return this.height - this.thickness;
  }

  /**
   * Calculates the perimeter $u = 2a + 4h - 4c$.
   */
  public getPerimeter(): number {
    const a = this.width;
    const h = this.height;
    const c = this.thickness;
    return 2 * a + 4 * h - 4 * c;
  }

  /**
   * Calculates the 2D cross-sectional area $A = c(2h + a - 2c)$.
   */
  public getArea(): number {
    const a = this.width;
    const h = this.height;
    const c = this.thickness;
    return c * (2 * h + a - 2 * c);
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
    const h = this.height;
    const c = this.thickness;
    const d = this.depth;

    const halfA = a / 2;
    const halfH = h / 2;
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
      return [(x + halfA) / a, (z + halfH) / h];
    };

    if (d <= 0.00001) {
      // --- 2D Planar Mesh in X-Z Plane (Y = 0, Normal = [0, 1, 0]) ---
      const norm: [number, number, number] = [0, 1, 0];

      // Left beam: x from -halfA to -halfA + c, z from -halfH to halfH
      addQuad(
        [-halfA, 0, -halfH],
        [-halfA + c, 0, -halfH],
        [-halfA + c, 0, halfH],
        [-halfA, 0, halfH],
        norm,
        calcUV(-halfA, -halfH),
        calcUV(-halfA + c, -halfH),
        calcUV(-halfA + c, halfH),
        calcUV(-halfA, halfH),
      );

      // Right beam: x from halfA - c to halfA, z from -halfH to halfH
      addQuad(
        [halfA - c, 0, -halfH],
        [halfA, 0, -halfH],
        [halfA, 0, halfH],
        [halfA - c, 0, halfH],
        norm,
        calcUV(halfA - c, -halfH),
        calcUV(halfA, -halfH),
        calcUV(halfA, halfH),
        calcUV(halfA - c, halfH),
      );

      // Bottom bar: x from -halfA + c to halfA - c, z from -halfH to -halfH + c
      addQuad(
        [-halfA + c, 0, -halfH],
        [halfA - c, 0, -halfH],
        [halfA - c, 0, -halfH + c],
        [-halfA + c, 0, -halfH + c],
        norm,
        calcUV(-halfA + c, -halfH),
        calcUV(halfA - c, -halfH),
        calcUV(halfA - c, -halfH + c),
        calcUV(-halfA + c, -halfH + c),
      );
    } else {
      // --- 3D Extruded U-Profile Solid ---
      // 1. Top Face (+Y, y = +halfD, Normal = [0, 1, 0])
      const topNorm: [number, number, number] = [0, 1, 0];
      // Top Left beam
      addQuad(
        [-halfA, halfD, -halfH],
        [-halfA + c, halfD, -halfH],
        [-halfA + c, halfD, halfH],
        [-halfA, halfD, halfH],
        topNorm,
        calcUV(-halfA, -halfH),
        calcUV(-halfA + c, -halfH),
        calcUV(-halfA + c, halfH),
        calcUV(-halfA, halfH),
      );
      // Top Right beam
      addQuad(
        [halfA - c, halfD, -halfH],
        [halfA, halfD, -halfH],
        [halfA, halfD, halfH],
        [halfA - c, halfD, halfH],
        topNorm,
        calcUV(halfA - c, -halfH),
        calcUV(halfA, -halfH),
        calcUV(halfA, halfH),
        calcUV(halfA - c, halfH),
      );
      // Top Bottom bar
      addQuad(
        [-halfA + c, halfD, -halfH],
        [halfA - c, halfD, -halfH],
        [halfA - c, halfD, -halfH + c],
        [-halfA + c, halfD, -halfH + c],
        topNorm,
        calcUV(-halfA + c, -halfH),
        calcUV(halfA - c, -halfH),
        calcUV(halfA - c, -halfH + c),
        calcUV(-halfA + c, -halfH + c),
      );

      // 2. Bottom Face (-Y, y = -halfD, Normal = [0, -1, 0])
      const btmNorm: [number, number, number] = [0, -1, 0];
      // Bottom Left beam (reversed winding)
      addQuad(
        [-halfA, -halfD, halfH],
        [-halfA + c, -halfD, halfH],
        [-halfA + c, -halfD, -halfH],
        [-halfA, -halfD, -halfH],
        btmNorm,
        calcUV(-halfA, halfH),
        calcUV(-halfA + c, halfH),
        calcUV(-halfA + c, -halfH),
        calcUV(-halfA, -halfH),
      );
      // Bottom Right beam
      addQuad(
        [halfA - c, -halfD, halfH],
        [halfA, -halfD, halfH],
        [halfA, -halfD, -halfH],
        [halfA - c, -halfD, -halfH],
        btmNorm,
        calcUV(halfA - c, halfH),
        calcUV(halfA, halfH),
        calcUV(halfA, -halfH),
        calcUV(halfA - c, -halfH),
      );
      // Bottom Bottom bar
      addQuad(
        [-halfA + c, -halfD, -halfH + c],
        [halfA - c, -halfD, -halfH + c],
        [halfA - c, -halfD, -halfH],
        [-halfA + c, -halfD, -halfH],
        btmNorm,
        calcUV(-halfA + c, -halfH + c),
        calcUV(halfA - c, -halfH + c),
        calcUV(halfA - c, -halfH),
        calcUV(-halfA + c, -halfH),
      );

      // 3. Side Walls (8 quads)
      // Wall 1: Outer Bottom (-Z, z = -halfH, Normal = [0, 0, -1])
      addQuad(
        [-halfA, halfD, -halfH],
        [halfA, halfD, -halfH],
        [halfA, -halfD, -halfH],
        [-halfA, -halfD, -halfH],
        [0, 0, -1],
        [0, 1],
        [1, 1],
        [1, 0],
        [0, 0],
      );

      // Wall 2: Outer Right (+X, x = halfA, Normal = [1, 0, 0])
      addQuad(
        [halfA, halfD, -halfH],
        [halfA, halfD, halfH],
        [halfA, -halfD, halfH],
        [halfA, -halfD, -halfH],
        [1, 0, 0],
        [0, 1],
        [1, 1],
        [1, 0],
        [0, 0],
      );

      // Wall 3: Top Right Cap (+Z, z = halfH, Normal = [0, 0, 1])
      addQuad(
        [halfA, halfD, halfH],
        [halfA - c, halfD, halfH],
        [halfA - c, -halfD, halfH],
        [halfA, -halfD, halfH],
        [0, 0, 1],
        [0, 1],
        [1, 1],
        [1, 0],
        [0, 0],
      );

      // Wall 4: Inner Right Wall (-X, x = halfA - c, Normal = [-1, 0, 0])
      addQuad(
        [halfA - c, halfD, halfH],
        [halfA - c, halfD, -halfH + c],
        [halfA - c, -halfD, -halfH + c],
        [halfA - c, -halfD, halfH],
        [-1, 0, 0],
        [0, 1],
        [1, 1],
        [1, 0],
        [0, 0],
      );

      // Wall 5: Inner Bottom Wall (+Z, z = -halfH + c, Normal = [0, 0, 1])
      addQuad(
        [halfA - c, halfD, -halfH + c],
        [-halfA + c, halfD, -halfH + c],
        [-halfA + c, -halfD, -halfH + c],
        [halfA - c, -halfD, -halfH + c],
        [0, 0, 1],
        [0, 1],
        [1, 1],
        [1, 0],
        [0, 0],
      );

      // Wall 6: Inner Left Wall (+X, x = -halfA + c, Normal = [1, 0, 0])
      addQuad(
        [-halfA + c, halfD, -halfH + c],
        [-halfA + c, halfD, halfH],
        [-halfA + c, -halfD, halfH],
        [-halfA + c, -halfD, -halfH + c],
        [1, 0, 0],
        [0, 1],
        [1, 1],
        [1, 0],
        [0, 0],
      );

      // Wall 7: Top Left Cap (+Z, z = halfH, Normal = [0, 0, 1])
      addQuad(
        [-halfA + c, halfD, halfH],
        [-halfA, halfD, halfH],
        [-halfA, -halfD, halfH],
        [-halfA + c, -halfD, halfH],
        [0, 0, 1],
        [0, 1],
        [1, 1],
        [1, 0],
        [0, 0],
      );

      // Wall 8: Outer Left (-X, x = -halfA, Normal = [-1, 0, 0])
      addQuad(
        [-halfA, halfD, halfH],
        [-halfA, halfD, -halfH],
        [-halfA, -halfD, -halfH],
        [-halfA, -halfD, halfH],
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
