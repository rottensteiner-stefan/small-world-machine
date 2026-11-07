import { AbstractGeometry } from "./AbstractGeometry.js";

/**
 * Configuration options for arch geometry (Bogen / Roman bridge arch).
 */
export interface ArchOptions {
  /** Total span length / width of the arch block along X (l). Defaults to 4. */
  length?: number;
  /** Total height of the arch block along Y (h). Defaults to 3. */
  height?: number;
  /** Extrusion depth / thickness along Z (t). Defaults to 1. */
  depth?: number;
  /** Radius of the semicircular arch opening (r). Defaults to 1.5. Must satisfy r < h and 2r < l. */
  radius?: number;
  /** Number of radial subdivisions along the semicircular arch curve. Defaults to 32. */
  radialSegments?: number;
}

/**
 * A Roman bridge arch geometry (Bogen / Rundbogen).
 *
 * A rectangular masonry block of span length $l$, height $h$, and depth $t$,
 * with a semicircular arch vault tunnel of radius $r$ cut out at the bottom.
 *
 * Mathematical formulas:
 * - Front / back face area: $A_{\text{face}} = h l - \frac{\pi r^2}{2}$
 * - Intrados (vault tunnel ceiling) area: $A_{\text{intrados}} = \pi r t$
 * - Outer boundary area: $A_{\text{outer}} = 2t(l + h - r)$
 * - Total surface area: $A = 2(h l - \frac{\pi r^2}{2}) + \pi r t + 2t(l + h - r)$
 * - Volume: $V = (h l - \frac{\pi r^2}{2}) t$
 *
 * @see https://rechneronline.de/pi/bogen.php
 */
export class Arch extends AbstractGeometry {
  /** Total span length along X (l). */
  public length: number;
  /** Total height along Y (h). */
  public height: number;
  /** Extrusion depth along Z (t). */
  public depth: number;
  /** Radius of the semicircular arch cutout (r). */
  public radius: number;
  /** Number of subdivisions along the arch curve. */
  public radialSegments: number;

  /**
   * Creates a new Arch geometry.
   * @param options Configuration options.
   */
  constructor(options: ArchOptions = {}) {
    super();
    const { length = 4, height = 3, depth = 1, radius = 1.5, radialSegments = 32 } = options;

    this.length = Math.max(0.1, length);
    this.height = Math.max(0.1, height);
    this.depth = Math.max(0.01, depth);
    // Radius must be strictly less than height and less than half of length
    const maxRadius = Math.min(this.height * 0.99, (this.length / 2) * 0.99);
    this.radius = Math.max(0.01, Math.min(maxRadius, radius));
    this.radialSegments = Math.max(4, Math.floor(radialSegments));

    this.generateGeometryData();
  }

  /**
   * Calculates the cross-sectional front / back face area $A_{\text{face}} = h l - \frac{\pi r^2}{2}$.
   */
  public getFaceArea(): number {
    return this.height * this.length - (Math.PI * this.radius * this.radius) / 2;
  }

  /**
   * Calculates the curved intrados (inner vault tunnel) area $A_{\text{intrados}} = \pi r t$.
   */
  public getIntradosArea(): number {
    return Math.PI * this.radius * this.depth;
  }

  /**
   * Calculates the total surface area $A = 2 A_{\text{face}} + A_{\text{intrados}} + 2t(l + h - r)$.
   */
  public getTotalSurfaceArea(): number {
    const faceArea = this.getFaceArea();
    const intrados = this.getIntradosArea();
    const outer = 2 * this.depth * (this.length + this.height - this.radius);
    return 2 * faceArea + intrados + outer;
  }

  /**
   * Calculates the volume $V = A_{\text{face}} \cdot t = \left( h l - \frac{\pi r^2}{2} \right) t$.
   */
  public getVolume(): number {
    return this.getFaceArea() * this.depth;
  }

  /** @inheritdoc */
  protected override generateGeometryData(): void {
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    const wireIndices: number[] = [];

    const l = this.length;
    const h = this.height;
    const t = this.depth;
    const r = this.radius;
    const segs = this.radialSegments;

    const halfL = l / 2;
    const halfH = h / 2;
    const halfT = t / 2;
    const yBottom = -halfH;
    const yTop = halfH;

    let vertexOffset = 0;

    // Helper to add a quad
    const addQuad = (
      p0: number[],
      p1: number[],
      p2: number[],
      p3: number[],
      normal: number[],
      uv0: number[],
      uv1: number[],
      uv2: number[],
      uv3: number[],
    ): void => {
      const idx0 = vertexOffset++;
      const idx1 = vertexOffset++;
      const idx2 = vertexOffset++;
      const idx3 = vertexOffset++;

      positions.push(...p0, ...p1, ...p2, ...p3);
      normals.push(...normal, ...normal, ...normal, ...normal);
      uvs.push(...uv0, ...uv1, ...uv2, ...uv3);

      indices.push(idx0, idx1, idx2, idx0, idx2, idx3);
      wireIndices.push(idx0, idx1, idx1, idx2, idx2, idx3, idx3, idx0);
    };

    // 1. Front Face (+Z, z = +halfT, normal = [0, 0, 1])
    const frontNormal = [0, 0, 1];
    const frontZ = halfT;

    // Arch curve points: theta from 0 to PI
    const frontArchIndices: number[] = [];
    for (let i = 0; i <= segs; i++) {
      const theta = (i / segs) * Math.PI;
      const px = -r * Math.cos(theta);
      const py = yBottom + r * Math.sin(theta);
      positions.push(px, py, frontZ);
      normals.push(...frontNormal);
      uvs.push((px + halfL) / l, (py + halfH) / h);
      frontArchIndices.push(vertexOffset++);
    }

    // Top edge points
    const frontTopIndices: number[] = [];
    for (let i = 0; i <= segs; i++) {
      const px = -halfL + (i / segs) * l;
      const py = yTop;
      positions.push(px, py, frontZ);
      normals.push(...frontNormal);
      uvs.push((px + halfL) / l, 1);
      frontTopIndices.push(vertexOffset++);
    }

    // Bottom corners
    const idxBL_Front = vertexOffset++;
    positions.push(-halfL, yBottom, frontZ);
    normals.push(...frontNormal);
    uvs.push(0, 0);

    const idxBR_Front = vertexOffset++;
    positions.push(halfL, yBottom, frontZ);
    normals.push(...frontNormal);
    uvs.push(1, 0);

    // Left pillar triangle: (idxBL_Front, frontArchIndices[0], frontTopIndices[0])
    indices.push(idxBL_Front, frontArchIndices[0]!, frontTopIndices[0]!);
    wireIndices.push(
      idxBL_Front,
      frontArchIndices[0]!,
      frontArchIndices[0]!,
      frontTopIndices[0]!,
      frontTopIndices[0]!,
      idxBL_Front,
    );

    // Right pillar triangle: (frontArchIndices[segs], idxBR_Front, frontTopIndices[segs])
    indices.push(frontArchIndices[segs]!, idxBR_Front, frontTopIndices[segs]!);
    wireIndices.push(
      frontArchIndices[segs]!,
      idxBR_Front,
      idxBR_Front,
      frontTopIndices[segs]!,
      frontTopIndices[segs]!,
      frontArchIndices[segs]!,
    );

    // Quads between arch curve and top edge
    for (let i = 0; i < segs; i++) {
      const pArch0 = frontArchIndices[i]!;
      const pArch1 = frontArchIndices[i + 1]!;
      const pTop0 = frontTopIndices[i]!;
      const pTop1 = frontTopIndices[i + 1]!;

      indices.push(pArch0, pArch1, pTop1);
      indices.push(pArch0, pTop1, pTop0);

      wireIndices.push(pArch0, pArch1, pTop0, pTop1);
    }

    // 2. Back Face (-Z, z = -halfT, normal = [0, 0, -1])
    const backNormal = [0, 0, -1];
    const backZ = -halfT;

    const backArchIndices: number[] = [];
    for (let i = 0; i <= segs; i++) {
      const theta = (i / segs) * Math.PI;
      const px = -r * Math.cos(theta);
      const py = yBottom + r * Math.sin(theta);
      positions.push(px, py, backZ);
      normals.push(...backNormal);
      uvs.push(1 - (px + halfL) / l, (py + halfH) / h);
      backArchIndices.push(vertexOffset++);
    }

    const backTopIndices: number[] = [];
    for (let i = 0; i <= segs; i++) {
      const px = -halfL + (i / segs) * l;
      const py = yTop;
      positions.push(px, py, backZ);
      normals.push(...backNormal);
      uvs.push(1 - (px + halfL) / l, 1);
      backTopIndices.push(vertexOffset++);
    }

    const idxBL_Back = vertexOffset++;
    positions.push(-halfL, yBottom, backZ);
    normals.push(...backNormal);
    uvs.push(1, 0);

    const idxBR_Back = vertexOffset++;
    positions.push(halfL, yBottom, backZ);
    normals.push(...backNormal);
    uvs.push(0, 0);

    // Left pillar triangle (reversed winding for back face):
    indices.push(idxBL_Back, backTopIndices[0]!, backArchIndices[0]!);
    wireIndices.push(
      idxBL_Back,
      backArchIndices[0]!,
      backArchIndices[0]!,
      backTopIndices[0]!,
      backTopIndices[0]!,
      idxBL_Back,
    );

    // Right pillar triangle:
    indices.push(backArchIndices[segs]!, backTopIndices[segs]!, idxBR_Back);
    wireIndices.push(
      backArchIndices[segs]!,
      idxBR_Back,
      idxBR_Back,
      backTopIndices[segs]!,
      backTopIndices[segs]!,
      backArchIndices[segs]!,
    );

    for (let i = 0; i < segs; i++) {
      const pArch0 = backArchIndices[i]!;
      const pArch1 = backArchIndices[i + 1]!;
      const pTop0 = backTopIndices[i]!;
      const pTop1 = backTopIndices[i + 1]!;

      indices.push(pArch0, pTop1, pArch1);
      indices.push(pArch0, pTop0, pTop1);

      wireIndices.push(pArch0, pArch1, pTop0, pTop1);
    }

    // 3. Intrados (Curved Inner Arch Ceiling)
    for (let i = 0; i < segs; i++) {
      const theta0 = (i / segs) * Math.PI;
      const theta1 = ((i + 1) / segs) * Math.PI;

      const cos0 = Math.cos(theta0);
      const sin0 = Math.sin(theta0);
      const cos1 = Math.cos(theta1);
      const sin1 = Math.sin(theta1);

      const x0 = -r * cos0;
      const y0 = yBottom + r * sin0;
      const x1 = -r * cos1;
      const y1 = yBottom + r * sin1;

      // Inward pointing normal: (cosTheta, -sinTheta, 0)
      const norm0 = [cos0, -sin0, 0];
      const norm1 = [cos1, -sin1, 0];

      const u0 = i / segs;
      const u1 = (i + 1) / segs;

      const idx0 = vertexOffset++;
      const idx1 = vertexOffset++;
      const idx2 = vertexOffset++;
      const idx3 = vertexOffset++;

      positions.push(x0, y0, halfT);
      positions.push(x1, y1, halfT);
      positions.push(x1, y1, -halfT);
      positions.push(x0, y0, -halfT);

      normals.push(...norm0, ...norm1, ...norm1, ...norm0);
      uvs.push(u0, 1, u1, 1, u1, 0, u0, 0);

      indices.push(idx0, idx2, idx1);
      indices.push(idx0, idx3, idx2);

      wireIndices.push(idx0, idx1, idx1, idx2, idx2, idx3, idx3, idx0);
    }

    // 4. Outer Faces (Top, Left, Right, Bottom-Left Foot, Bottom-Right Foot)
    // Top face (+Y, y = +halfH)
    addQuad(
      [-halfL, halfH, halfT],
      [halfL, halfH, halfT],
      [halfL, halfH, -halfT],
      [-halfL, halfH, -halfT],
      [0, 1, 0],
      [0, 1],
      [1, 1],
      [1, 0],
      [0, 0],
    );

    // Left outer side (-X, x = -halfL)
    addQuad(
      [-halfL, yBottom, halfT],
      [-halfL, halfH, halfT],
      [-halfL, halfH, -halfT],
      [-halfL, yBottom, -halfT],
      [-1, 0, 0],
      [0, 0],
      [0, 1],
      [1, 1],
      [1, 0],
    );

    // Right outer side (+X, x = +halfL)
    addQuad(
      [halfL, yBottom, -halfT],
      [halfL, halfH, -halfT],
      [halfL, halfH, halfT],
      [halfL, yBottom, halfT],
      [1, 0, 0],
      [0, 0],
      [0, 1],
      [1, 1],
      [1, 0],
    );

    // Bottom Left Foot (-Y, x from -halfL to -r)
    addQuad(
      [-halfL, yBottom, -halfT],
      [-r, yBottom, -halfT],
      [-r, yBottom, halfT],
      [-halfL, yBottom, halfT],
      [0, -1, 0],
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    );

    // Bottom Right Foot (-Y, x from +r to +halfL)
    addQuad(
      [r, yBottom, -halfT],
      [halfL, yBottom, -halfT],
      [halfL, yBottom, halfT],
      [r, yBottom, halfT],
      [0, -1, 0],
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    );

    this._vertices = new Float32Array(positions);
    this._normals = new Float32Array(normals);
    this._uvs = new Float32Array(uvs);
    this._indices = this._createIndexArray(indices.length);
    this._indices.set(indices);
    this._wireframeIndices = this._createIndexArray(wireIndices.length);
    this._wireframeIndices.set(wireIndices);
  }
}
