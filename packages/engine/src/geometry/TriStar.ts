import { AbstractGeometry } from "./AbstractGeometry.js";

/**
 * Configuration options for TriStar geometry (Dreistern / 3-Pointed Star / Concave Hexagon).
 */
export interface TriStarOptions {
  /** Arm edge length (a). Defaults to 1.5. */
  armLength?: number;
  /** Inner apex angle at the tip in radians (alpha). Defaults to PI / 6 (30 degrees). Must be < PI. */
  innerAngle?: number;
  /** Extrusion depth along Y (t). Defaults to 0 (planar 2D in X-Z plane). */
  depth?: number;
}

/**
 * A TriStar (Dreistern / 3-Pointed Star) geometry.
 *
 * A symmetric 3-pointed star formed by placing 3 isosceles triangles of leg length $a$
 * and tip angle $\alpha$ onto the three sides of an equilateral base triangle of side length $b$.
 * For $\alpha < 60^\circ$ ($\pi / 3$), this forms a concave equilateral hexagon with 6 outer edges of length $a$.
 *
 * Can be rendered as a 2D planar polygon in the X-Z plane (when depth = 0) with normal (0, 1, 0),
 * or as a solid 3D extruded prism (when depth > 0).
 *
 * Mathematical formulas:
 * - Arm edge length: $a$
 * - Inner apex angle: $\alpha$
 * - Outer angle: $\beta = 120^\circ + \alpha = \frac{2\pi}{3} + \alpha$
 * - Arm base width: $b = \sqrt{2a^2(1 - \cos \alpha)} = 2a \sin(\alpha / 2)$
 * - Arm height: $i = \sqrt{\frac{4a^2 - b^2}{4}} = a \cos(\alpha / 2)$
 * - Chord length between outer tips: $l = \sqrt{2a^2(1 - \cos \beta)}$
 * - Total height: $h = \frac{\sqrt{3}}{2} l$
 * - Tip circumradius: $R = \frac{l}{\sqrt{3}} = a \cos(\alpha / 2) + \frac{a}{\sqrt{3}} \sin(\alpha / 2)$
 * - Inner notch radius: $r_{\text{in}} = \frac{b}{\sqrt{3}} = \frac{2a}{\sqrt{3}} \sin(\alpha / 2)$
 * - Perimeter: $u = 6a$
 * - Area: $A = \frac{3}{2} i b + \frac{\sqrt{3}}{4} b^2$
 * - Volume (3D): $V = A \cdot t$
 * - Total surface area (3D): $A_{\text{total}} = 2A + u \cdot t$
 *
 * @see https://rechneronline.de/pi/dreistern.php
 */
export class TriStar extends AbstractGeometry {
  /** Star arm leg length (a). */
  public armLength: number;
  /** Inner apex angle at the tips in radians (alpha). */
  public innerAngle: number;
  /** Extrusion depth (t). */
  public depth: number;

  /**
   * Creates a new TriStar geometry.
   * @param options Configuration options.
   */
  constructor(options: TriStarOptions = {}) {
    super();
    const { armLength = 1.5, innerAngle = Math.PI / 6, depth = 0 } = options;

    this.armLength = Math.max(0.01, armLength);
    this.innerAngle = Math.max(0.001, Math.min(Math.PI - 0.001, innerAngle));
    this.depth = Math.max(0, depth);

    this.generateGeometryData();
  }

  /**
   * Calculates the outer angle $\beta = 120^\circ + \alpha = \frac{2\pi}{3} + \alpha$ in radians.
   */
  public getOuterAngle(): number {
    return (2 * Math.PI) / 3 + this.innerAngle;
  }

  /**
   * Calculates the arm base width $b = 2a \sin(\alpha / 2)$.
   */
  public getBaseLength(): number {
    return 2 * this.armLength * Math.sin(this.innerAngle / 2);
  }

  /**
   * Calculates the arm height $i = a \cos(\alpha / 2)$.
   */
  public getArmHeight(): number {
    return this.armLength * Math.cos(this.innerAngle / 2);
  }

  /**
   * Calculates the distance / chord length between outer tips $l = \sqrt{2a^2(1 - \cos \beta)}$.
   */
  public getChordLength(): number {
    const beta = this.getOuterAngle();
    return Math.sqrt(2 * this.armLength * this.armLength * (1 - Math.cos(beta)));
  }

  /**
   * Calculates the total height $h = \frac{\sqrt{3}}{2} l$.
   */
  public getTotalHeight(): number {
    return (Math.sqrt(3) / 2) * this.getChordLength();
  }

  /**
   * Calculates the circumradius to outer tips $R = \frac{l}{\sqrt{3}}$.
   */
  public getOuterRadius(): number {
    return this.getChordLength() / Math.sqrt(3);
  }

  /**
   * Calculates the inner notch radius $r_{\text{in}} = \frac{b}{\sqrt{3}}$.
   */
  public getInnerRadius(): number {
    return this.getBaseLength() / Math.sqrt(3);
  }

  /**
   * Calculates the perimeter $u = 6a$.
   */
  public getPerimeter(): number {
    return 6 * this.armLength;
  }

  /**
   * Calculates the 2D surface area $A = \frac{3}{2} i b + \frac{\sqrt{3}}{4} b^2$.
   */
  public getArea(): number {
    const b = this.getBaseLength();
    const i = this.getArmHeight();
    return 1.5 * i * b + (Math.sqrt(3) / 4) * b * b;
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

    const R = this.getOuterRadius();
    const rIn = this.getInnerRadius();
    const d = this.depth;
    const halfD = d / 2;

    // 6 Star boundary vertices in CCW order around origin in X-Z plane
    // Angle 0 at top (-Z): theta = -PI / 2
    const starPointsXZ: [number, number][] = [];
    for (let k = 0; k < 6; k++) {
      const angle = -Math.PI / 2 + (k * Math.PI) / 3;
      const radius = k % 2 === 0 ? R : rIn;
      starPointsXZ.push([radius * Math.cos(angle), radius * Math.sin(angle)]);
    }

    let vertexOffset = 0;

    const calcUV = (x: number, z: number): [number, number] => {
      return [0.5 + x / (2 * R), 0.5 + z / (2 * R)];
    };

    if (d <= 0.00001) {
      // --- 2D Planar Mesh in X-Z Plane (Y = 0, Normal = [0, 1, 0]) ---
      const norm: [number, number, number] = [0, 1, 0];

      // Center point
      const centerIdx = vertexOffset++;
      positions.push(0, 0, 0);
      normals.push(...norm);
      uvs.push(0.5, 0.5);

      // 6 Boundary points
      const boundaryOffset = vertexOffset;
      for (let k = 0; k < 6; k++) {
        const [x, z] = starPointsXZ[k]!;
        positions.push(x, 0, z);
        normals.push(...norm);
        uvs.push(...calcUV(x, z));
        vertexOffset++;
      }

      // Triangles from center to boundary edges (CCW: center -> nextK -> k)
      for (let k = 0; k < 6; k++) {
        const nextK = (k + 1) % 6;
        indices.push(centerIdx, boundaryOffset + nextK, boundaryOffset + k);
        wireIndices.push(boundaryOffset + k, boundaryOffset + nextK);
      }
    } else {
      // --- 3D Extruded Star Solid ---
      // 1. Top Face (+Y, y = +halfD, Normal = [0, 1, 0])
      const topNorm: [number, number, number] = [0, 1, 0];
      const topCenterIdx = vertexOffset++;
      positions.push(0, halfD, 0);
      normals.push(...topNorm);
      uvs.push(0.5, 0.5);

      const topBoundaryOffset = vertexOffset;
      for (let k = 0; k < 6; k++) {
        const [x, z] = starPointsXZ[k]!;
        positions.push(x, halfD, z);
        normals.push(...topNorm);
        uvs.push(...calcUV(x, z));
        vertexOffset++;
      }

      for (let k = 0; k < 6; k++) {
        const nextK = (k + 1) % 6;
        indices.push(topCenterIdx, topBoundaryOffset + nextK, topBoundaryOffset + k);
        wireIndices.push(topBoundaryOffset + k, topBoundaryOffset + nextK);
      }

      // 2. Bottom Face (-Y, y = -halfD, Normal = [0, -1, 0])
      const btmNorm: [number, number, number] = [0, -1, 0];
      const btmCenterIdx = vertexOffset++;
      positions.push(0, -halfD, 0);
      normals.push(...btmNorm);
      uvs.push(0.5, 0.5);

      const btmBoundaryOffset = vertexOffset;
      for (let k = 0; k < 6; k++) {
        const [x, z] = starPointsXZ[k]!;
        positions.push(x, -halfD, z);
        normals.push(...btmNorm);
        uvs.push(...calcUV(x, z));
        vertexOffset++;
      }

      for (let k = 0; k < 6; k++) {
        const nextK = (k + 1) % 6;
        // Reversed winding for bottom
        indices.push(btmCenterIdx, btmBoundaryOffset + k, btmBoundaryOffset + nextK);
        wireIndices.push(btmBoundaryOffset + k, btmBoundaryOffset + nextK);
      }

      // 3. Side Walls (6 quads)
      const addQuad = (
        p0: [number, number, number],
        p1: [number, number, number],
        p2: [number, number, number],
        p3: [number, number, number],
        snorm: [number, number, number],
      ): void => {
        const idx0 = vertexOffset++;
        const idx1 = vertexOffset++;
        const idx2 = vertexOffset++;
        const idx3 = vertexOffset++;

        positions.push(...p0, ...p1, ...p2, ...p3);
        normals.push(...snorm, ...snorm, ...snorm, ...snorm);
        uvs.push(0, 1, 1, 1, 1, 0, 0, 0);

        const e1x = p1[0] - p0[0],
          e1y = p1[1] - p0[1],
          e1z = p1[2] - p0[2];
        const e2x = p2[0] - p0[0],
          e2y = p2[1] - p0[1],
          e2z = p2[2] - p0[2];
        const fnx = e1y * e2z - e1z * e2y;
        const fny = e1z * e2x - e1x * e2z;
        const fnz = e1x * e2y - e1y * e2x;
        const dot = fnx * snorm[0] + fny * snorm[1] + fnz * snorm[2];

        if (dot >= 0) {
          indices.push(idx0, idx1, idx2, idx0, idx2, idx3);
        } else {
          indices.push(idx0, idx2, idx1, idx0, idx3, idx2);
        }
        wireIndices.push(idx0, idx1, idx1, idx2, idx2, idx3, idx3, idx0);
      };

      for (let k = 0; k < 6; k++) {
        const [x0, z0] = starPointsXZ[k]!;
        const [x1, z1] = starPointsXZ[(k + 1) % 6]!;

        const dx = x1 - x0;
        const dz = z1 - z0;
        const nx = dz;
        const nz = -dx;
        const nlen = Math.sqrt(nx * nx + nz * nz) || 1;

        addQuad(
          [x0, halfD, z0],
          [x1, halfD, z1],
          [x1, -halfD, z1],
          [x0, -halfD, z0],
          [nx / nlen, 0, nz / nlen],
        );
      }
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
