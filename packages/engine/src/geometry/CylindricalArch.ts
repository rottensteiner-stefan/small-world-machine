import { AbstractGeometry } from "./AbstractGeometry.js";
import { MathUtils } from "../math/index.js";

/**
 * Configuration options for CylindricalArch geometry (Zylinderbogen / Rohrbogen / Curved Pipe Elbow).
 */
export interface CylindricalArchOptions {
  /** The radius of the circular pipe cross-section (r). Defaults to 0.5. */
  pipeRadius?: number;
  /** The inner bend radius / hole radius of the arc (a). Defaults to 1.0. Major radius is R = a + r. */
  bendRadius?: number;
  /** The sweep angle of the arc in radians. Defaults to PI / 2 (90 degree elbow). */
  arcAngle?: number;
  /** Number of radial subdivisions around the pipe circumference. Defaults to 32. */
  radialSegments?: number;
  /** Number of subdivisions along the curved bend arc. Defaults to 32. */
  arcSegments?: number;
  /** Whether the pipe ends are open (no planar circular caps). Defaults to false. */
  openEnded?: boolean;
}

/**
 * A CylindricalArch (Zylinderbogen / Rohrbogen / Curved Pipe Elbow) geometry.
 *
 * A curved solid cylinder segment forming a quarter torus (or customizable angular torus sector)
 * used to connect two perpendicular cylindrical pipes smoothly.
 *
 * Mathematical formulas:
 * - Pipe cross-section radius: $r$
 * - Inner bend radius: $a$
 * - Major torus radius: $R = a + r$
 * - Sweep angle: $\theta_{\text{arc}}$ (defaults to $\pi / 2 = 90^\circ$)
 * - Mantle surface area: $M = \frac{\theta_{\text{arc}}}{2\pi} \cdot (4\pi^2 R r) = 2\pi \theta_{\text{arc}} (a + r) r = \pi^2 (a + r) r$ (for $90^\circ$)
 * - Total surface area: $A = M + 2\pi r^2 = \pi^2 (a + r) r + 2\pi r^2$
 * - Volume: $V = \frac{\theta_{\text{arc}}}{2\pi} \cdot (2\pi^2 R r^2) = \pi \theta_{\text{arc}} (a + r) r^2 = \frac{1}{2} \pi^2 (a + r) r^2$ (for $90^\circ$)
 * - Surface-to-volume ratio: $A / V$
 *
 * @see https://rechneronline.de/pi/zylinderbogen.php
 */
export class CylindricalArch extends AbstractGeometry {
  /** Pipe cross-section radius (r). */
  public pipeRadius: number;
  /** Inner bend radius (a). */
  public bendRadius: number;
  /** Sweep angle in radians (theta). */
  public arcAngle: number;
  /** Number of subdivisions around pipe circumference. */
  public radialSegments: number;
  /** Number of subdivisions along bend arc. */
  public arcSegments: number;
  /** Whether pipe ends are open (no caps). */
  public openEnded: boolean;

  /**
   * Creates a new CylindricalArch geometry.
   * @param options Configuration options.
   */
  constructor(options: CylindricalArchOptions = {}) {
    super();
    const {
      pipeRadius = 0.5,
      bendRadius = 1.0,
      arcAngle = MathUtils.HALF_PI,
      radialSegments = 32,
      arcSegments = 32,
      openEnded = false,
    } = options;

    this.pipeRadius = Math.max(0.01, pipeRadius);
    this.bendRadius = Math.max(0.001, bendRadius);
    this.arcAngle = Math.max(0.001, Math.min(MathUtils.TWO_PI, arcAngle));
    this.radialSegments = Math.max(3, Math.floor(radialSegments));
    this.arcSegments = Math.max(2, Math.floor(arcSegments));
    this.openEnded = openEnded;

    this.generateGeometryData();
  }

  /**
   * Calculates the major torus radius $R = a + r$.
   */
  public getMajorRadius(): number {
    return this.bendRadius + this.pipeRadius;
  }

  /**
   * Calculates the curved mantle surface area $M = 2\pi \cdot \theta_{\text{arc}} (a + r) r$.
   */
  public getMantleArea(): number {
    const R = this.getMajorRadius();
    return 2 * Math.PI * this.arcAngle * R * this.pipeRadius;
  }

  /**
   * Calculates the circular cap area of a single pipe end $A_{\text{cap}} = \pi r^2$.
   */
  public getCapArea(): number {
    return Math.PI * this.pipeRadius * this.pipeRadius;
  }

  /**
   * Calculates the total surface area $A = M + 2\pi r^2$ (or $M$ if openEnded).
   */
  public getTotalSurfaceArea(): number {
    const mantle = this.getMantleArea();
    if (this.openEnded) {
      return mantle;
    }
    return mantle + 2 * this.getCapArea();
  }

  /**
   * Calculates the volume $V = \pi \cdot \theta_{\text{arc}} (a + r) r^2$.
   */
  public getVolume(): number {
    const R = this.getMajorRadius();
    return Math.PI * this.arcAngle * R * this.pipeRadius * this.pipeRadius;
  }

  /**
   * Calculates the surface-to-volume ratio $A / V$.
   */
  public getSurfaceToVolumeRatio(): number {
    const vol = this.getVolume();
    if (vol <= 0) return 0;
    return this.getTotalSurfaceArea() / vol;
  }

  /** @inheritdoc */
  protected override generateGeometryData(): void {
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    const wireIndices: number[] = [];

    const r = this.pipeRadius;
    const a = this.bendRadius;
    const R = a + r;
    const arc = this.arcAngle;
    const radSegs = this.radialSegments;
    const arcSegs = this.arcSegments;

    let vertexOffset = 0;

    // --- 1. Curved Pipe Mantle Surface ---
    // Theta sweeps along the bend in the X-Z plane [0, arc]
    // Phi sweeps around the tube circular cross section [0, 2*PI]
    const mantleStart = vertexOffset;

    for (let i = 0; i <= arcSegs; i++) {
      const u = i / arcSegs;
      const theta = u * arc;
      const cosTheta = Math.cos(theta);
      const sinTheta = Math.sin(theta);

      for (let j = 0; j <= radSegs; j++) {
        const v = j / radSegs;
        const phi = v * MathUtils.TWO_PI;
        const cosPhi = Math.cos(phi);
        const sinPhi = Math.sin(phi);

        // Position: center curve at (R*cosTheta, 0, R*sinTheta)
        // Tube radial offset: cosPhi along normal (cosTheta, 0, sinTheta), sinPhi along (0, 1, 0)
        const px = (R + r * cosPhi) * cosTheta;
        const py = r * sinPhi;
        const pz = (R + r * cosPhi) * sinTheta;

        // Outward surface normal
        const nx = cosPhi * cosTheta;
        const ny = sinPhi;
        const nz = cosPhi * sinTheta;

        positions.push(px, py, pz);
        normals.push(nx, ny, nz);
        uvs.push(u, v);
        vertexOffset++;
      }
    }

    for (let i = 0; i < arcSegs; i++) {
      for (let j = 0; j < radSegs; j++) {
        const aIdx = mantleStart + i * (radSegs + 1) + j;
        const bIdx = mantleStart + (i + 1) * (radSegs + 1) + j;
        const cIdx = mantleStart + (i + 1) * (radSegs + 1) + (j + 1);
        const dIdx = mantleStart + i * (radSegs + 1) + (j + 1);

        indices.push(aIdx, dIdx, bIdx);
        indices.push(bIdx, dIdx, cIdx);

        wireIndices.push(aIdx, bIdx);
        wireIndices.push(aIdx, dIdx);
      }
      const lastRowA = mantleStart + i * (radSegs + 1) + radSegs;
      const lastRowB = mantleStart + (i + 1) * (radSegs + 1) + radSegs;
      wireIndices.push(lastRowA, lastRowB);
    }
    const endRowOffset = mantleStart + arcSegs * (radSegs + 1);
    for (let j = 0; j < radSegs; j++) {
      wireIndices.push(endRowOffset + j, endRowOffset + j + 1);
    }

    // --- 2. Start Cap at theta = 0 (Z = 0 plane, normal = [0, 0, -1]) ---
    if (!this.openEnded) {
      const startCapCenter = vertexOffset++;
      // Center of start pipe is at (R, 0, 0)
      positions.push(R, 0, 0);
      normals.push(0, 0, -1);
      uvs.push(0.5, 0.5);

      const startCapRimOffset = vertexOffset;
      for (let j = 0; j <= radSegs; j++) {
        const phi = (j / radSegs) * MathUtils.TWO_PI;
        const px = R + r * Math.cos(phi);
        const py = r * Math.sin(phi);
        positions.push(px, py, 0);
        normals.push(0, 0, -1);
        uvs.push(0.5 + 0.5 * Math.cos(phi), 0.5 + 0.5 * Math.sin(phi));
        vertexOffset++;
      }

      for (let j = 0; j < radSegs; j++) {
        // Outward facing normal [0, 0, -1] => clockwise in X-Y plane
        indices.push(startCapCenter, startCapRimOffset + j + 1, startCapRimOffset + j);
        wireIndices.push(startCapCenter, startCapRimOffset + j);
        wireIndices.push(startCapRimOffset + j, startCapRimOffset + j + 1);
      }
      wireIndices.push(startCapCenter, startCapRimOffset + radSegs);

      // --- 3. End Cap at theta = arc (normal = [-sin(arc), 0, cos(arc)]) ---
      const cosArc = Math.cos(arc);
      const sinArc = Math.sin(arc);
      // Tangent vector along curve at end is (-sinArc, 0, cosArc) => outward normal is (-sinArc, 0, cosArc)
      const endNormX = -sinArc;
      const endNormZ = cosArc;

      const endCapCenter = vertexOffset++;
      positions.push(R * cosArc, 0, R * sinArc);
      normals.push(endNormX, 0, endNormZ);
      uvs.push(0.5, 0.5);

      const endCapRimOffset = vertexOffset;
      for (let j = 0; j <= radSegs; j++) {
        const phi = (j / radSegs) * MathUtils.TWO_PI;
        const px = (R + r * Math.cos(phi)) * cosArc;
        const py = r * Math.sin(phi);
        const pz = (R + r * Math.cos(phi)) * sinArc;
        positions.push(px, py, pz);
        normals.push(endNormX, 0, endNormZ);
        uvs.push(0.5 + 0.5 * Math.cos(phi), 0.5 + 0.5 * Math.sin(phi));
        vertexOffset++;
      }

      for (let j = 0; j < radSegs; j++) {
        indices.push(endCapCenter, endCapRimOffset + j, endCapRimOffset + j + 1);
        wireIndices.push(endCapCenter, endCapRimOffset + j);
        wireIndices.push(endCapRimOffset + j, endCapRimOffset + j + 1);
      }
      wireIndices.push(endCapCenter, endCapRimOffset + radSegs);
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
