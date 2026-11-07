import { AbstractGeometry } from "./AbstractGeometry.js";
import { MathUtils } from "../math/index.js";

/**
 * Configuration options for spherical cap geometry (Kugelsegment / Kugelkappe).
 */
export interface SphericalCapOptions {
  /** Radius of the parent sphere (r). Defaults to 1. */
  radius?: number;
  /** Height of the cap (h). Must be in range (0, 2r]. Defaults to 0.5. */
  height?: number;
  /** Number of radial subdivisions around circumference. Defaults to 32. */
  radialSegments?: number;
  /** Number of height subdivisions from apex to base. Defaults to 16. */
  heightSegments?: number;
  /** Start angle in radians. Defaults to 0. */
  thetaStart?: number;
  /** Central angle in radians (2π for full cap). Defaults to 2π. */
  thetaLength?: number;
  /** Whether the bottom base is open (no circular cap). Defaults to false. */
  openEnded?: boolean;
}

/**
 * A spherical cap geometry (Kugelsegment / Kugelkappe / spherical dome).
 *
 * A portion of a sphere of radius $r$ cut off by a plane at distance $r - h$ from the apex.
 *
 * Mathematical formulas:
 * - Base radius: $a = \sqrt{h(2r - h)}$
 * - Curved mantle area: $M = 2\pi r h$
 * - Base circle area: $A_{\text{base}} = \pi a^2 = \pi h (2r - h)$
 * - Total surface area: $A = M + A_{\text{base}} = \pi h (4r - h)$
 * - Volume: $V = \frac{\pi h^2}{3}(3r - h)$
 *
 * @see https://rechneronline.de/pi/kugelsegment.php
 */
export class SphericalCap extends AbstractGeometry {
  /** Radius of the parent sphere (r). */
  public radius: number;
  /** Height of the spherical cap (h). */
  public height: number;
  /** Number of radial subdivisions around circumference. */
  public radialSegments: number;
  /** Number of height subdivisions from apex to base. */
  public heightSegments: number;
  /** Start angle in radians. */
  public thetaStart: number;
  /** Central angle in radians. */
  public thetaLength: number;
  /** Whether the base disk is open. */
  public openEnded: boolean;

  /**
   * Creates a new SphericalCap geometry.
   * @param options Configuration options.
   */
  constructor(options: SphericalCapOptions = {}) {
    super();
    const {
      radius = 1,
      height = 0.5,
      radialSegments = 32,
      heightSegments = 16,
      thetaStart = 0,
      thetaLength = MathUtils.TWO_PI,
      openEnded = false,
    } = options;

    this.radius = Math.max(0.0001, radius);
    this.height = Math.max(0.0001, Math.min(2 * this.radius, height));
    this.radialSegments = Math.max(3, Math.floor(radialSegments));
    this.heightSegments = Math.max(2, Math.floor(heightSegments));
    this.thetaStart = thetaStart;
    this.thetaLength = Math.max(0, Math.min(MathUtils.TWO_PI, thetaLength));
    this.openEnded = openEnded;

    this.generateGeometryData();
  }

  /**
   * Calculates the base radius $a = \sqrt{h(2r - h)}$.
   */
  public getBaseRadius(): number {
    const r = this.radius;
    const h = this.height;
    return Math.sqrt(Math.max(0, h * (2 * r - h)));
  }

  /**
   * Calculates the curved dome mantle surface area $M = \frac{\theta_{\text{len}}}{2\pi} \cdot 2\pi r h$.
   */
  public getCurvedArea(): number {
    const fraction = this.thetaLength / MathUtils.TWO_PI;
    return fraction * 2 * Math.PI * this.radius * this.height;
  }

  /**
   * Calculates the base circular area $A_{\text{base}} = \frac{\theta_{\text{len}}}{2\pi} \cdot \pi a^2$.
   */
  public getBaseArea(): number {
    const fraction = this.thetaLength / MathUtils.TWO_PI;
    const a = this.getBaseRadius();
    return fraction * Math.PI * a * a;
  }

  /**
   * Calculates the total surface area $A = M + A_{\text{base}} (+ \text{sector sides})$.
   */
  public getTotalSurfaceArea(): number {
    let area = this.getCurvedArea();
    if (!this.openEnded) {
      area += this.getBaseArea();
      if (this.thetaLength < MathUtils.TWO_PI) {
        // Sector side faces: circular segment area = 0.5 * r^2 * (phiMax - sin(phiMax))
        const cosPhi = 1 - this.height / this.radius;
        const phiMax = Math.acos(Math.max(-1, Math.min(1, cosPhi)));
        const segArea =
          0.5 * this.radius * this.radius * (phiMax - Math.sin(phiMax) * Math.cos(phiMax));
        area += 2 * segArea;
      }
    }
    return area;
  }

  /**
   * Calculates the volume $V = \frac{\theta_{\text{len}}}{2\pi} \cdot \frac{\pi h^2}{3}(3r - h)$.
   */
  public getVolume(): number {
    const fraction = this.thetaLength / MathUtils.TWO_PI;
    return fraction * ((Math.PI * this.height * this.height) / 3) * (3 * this.radius - this.height);
  }

  /** @inheritdoc */
  protected override generateGeometryData(): void {
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    const wireIndices: number[] = [];

    const r = this.radius;
    const h = this.height;
    const radSegs = this.radialSegments;
    const hSegs = this.heightSegments;

    const cosPhiMax = 1 - h / r;
    const phiMax = Math.acos(Math.max(-1, Math.min(1, cosPhiMax)));
    const yCenterOffset = h / 2 - r;

    let vertexOffset = 0;

    // 1. Curved Dome Mantle
    const grid: number[][] = [];

    for (let y = 0; y <= hSegs; y++) {
      const row: number[] = [];
      const vRatio = y / hSegs;
      const phi = vRatio * phiMax;
      const sinPhi = Math.sin(phi);
      const cosPhi = Math.cos(phi);

      for (let x = 0; x <= radSegs; x++) {
        const uRatio = x / radSegs;
        const theta = this.thetaStart + uRatio * this.thetaLength;
        const cosTheta = Math.cos(theta);
        const sinTheta = Math.sin(theta);

        const px = r * sinPhi * cosTheta;
        const py = r * cosPhi + yCenterOffset;
        const pz = r * sinPhi * sinTheta;

        positions.push(px, py, pz);
        normals.push(sinPhi * cosTheta, cosPhi, sinPhi * sinTheta);
        uvs.push(uRatio, 1 - vRatio);
        row.push(vertexOffset++);
      }
      grid.push(row);
    }

    for (let y = 0; y < hSegs; y++) {
      for (let x = 0; x < radSegs; x++) {
        const a = grid[y]![x]!;
        const b = grid[y + 1]![x]!;
        const c = grid[y + 1]![x + 1]!;
        const d = grid[y]![x + 1]!;

        if (y !== 0) {
          indices.push(a, d, b);
        }
        indices.push(b, d, c);

        wireIndices.push(a, b, a, d);
        if (x === radSegs - 1) wireIndices.push(d, c);
        if (y === hSegs - 1) wireIndices.push(b, c);
      }
    }

    // 2. Base Disk Cap (at y = -h / 2)
    const baseRadius = this.getBaseRadius();
    const yBase = -h / 2;

    if (!this.openEnded && baseRadius > 0) {
      const centerIdx = vertexOffset++;
      positions.push(0, yBase, 0);
      normals.push(0, -1, 0);
      uvs.push(0.5, 0.5);

      const baseStart = vertexOffset;
      for (let x = 0; x <= radSegs; x++) {
        const uRatio = x / radSegs;
        const theta = this.thetaStart + uRatio * this.thetaLength;
        const cosTheta = Math.cos(theta);
        const sinTheta = Math.sin(theta);

        positions.push(baseRadius * cosTheta, yBase, baseRadius * sinTheta);
        normals.push(0, -1, 0);
        uvs.push(0.5 + 0.5 * cosTheta, 0.5 + 0.5 * sinTheta);
        vertexOffset++;
      }

      for (let x = 0; x < radSegs; x++) {
        const p1 = baseStart + x;
        const p2 = baseStart + x + 1;
        indices.push(centerIdx, p1, p2);
        wireIndices.push(p1, p2);
      }
    }

    // 3. Side Sector Caps (if thetaLength < 2π)
    if (!this.openEnded && this.thetaLength < MathUtils.TWO_PI) {
      // Start sector side
      const theta0 = this.thetaStart;
      const n0x = Math.sin(theta0);
      const n0z = -Math.cos(theta0);

      const sCenter = vertexOffset++;
      positions.push(0, yBase, 0);
      normals.push(n0x, 0, n0z);
      uvs.push(0, 0);

      const sArcStart = vertexOffset;
      for (let y = 0; y <= hSegs; y++) {
        const phi = (y / hSegs) * phiMax;
        const px = r * Math.sin(phi) * Math.cos(theta0);
        const py = r * Math.cos(phi) + yCenterOffset;
        const pz = r * Math.sin(phi) * Math.sin(theta0);

        positions.push(px, py, pz);
        normals.push(n0x, 0, n0z);
        uvs.push(Math.sin(phi), (py - yBase) / h);
        vertexOffset++;
      }

      for (let y = 0; y < hSegs; y++) {
        const p1 = sArcStart + y;
        const p2 = sArcStart + y + 1;
        indices.push(sCenter, p1, p2);
      }

      // End sector side
      const thetaE = this.thetaStart + this.thetaLength;
      const nEx = -Math.sin(thetaE);
      const nEz = Math.cos(thetaE);

      const eCenter = vertexOffset++;
      positions.push(0, yBase, 0);
      normals.push(nEx, 0, nEz);
      uvs.push(0, 0);

      const eArcStart = vertexOffset;
      for (let y = 0; y <= hSegs; y++) {
        const phi = (y / hSegs) * phiMax;
        const px = r * Math.sin(phi) * Math.cos(thetaE);
        const py = r * Math.cos(phi) + yCenterOffset;
        const pz = r * Math.sin(phi) * Math.sin(thetaE);

        positions.push(px, py, pz);
        normals.push(nEx, 0, nEz);
        uvs.push(Math.sin(phi), (py - yBase) / h);
        vertexOffset++;
      }

      for (let y = 0; y < hSegs; y++) {
        const p1 = eArcStart + y;
        const p2 = eArcStart + y + 1;
        indices.push(eCenter, p2, p1);
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
