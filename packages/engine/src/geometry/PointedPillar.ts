import { AbstractGeometry } from "./AbstractGeometry.js";
import { MathUtils } from "../math/index.js";

/**
 * Configuration options for pointed pillar geometry (Spitze Säule / column with conical tip).
 */
export interface PointedPillarOptions {
  /** Radius at the bottom base (a). Defaults to 1. */
  radiusBase?: number;
  /** Radius at the transition between column and conical roof tip (b). Defaults to 0.75. */
  radiusTransition?: number;
  /** Height of the cylindrical/frustum column shaft (h1). Defaults to 2. */
  heightPillar?: number;
  /** Height of the pointed cone tip roof (h2). Defaults to 1. */
  heightTip?: number;
  /** Number of radial subdivisions around circumference. Defaults to 32. */
  radialSegments?: number;
  /** Number of height subdivisions along column shaft. Defaults to 1. */
  heightSegments?: number;
  /** Start angle in radians. Defaults to 0. */
  thetaStart?: number;
  /** Central angle in radians (2π for full pillar). Defaults to 2π. */
  thetaLength?: number;
  /** Whether the bottom base is open (no cap). Defaults to false. */
  openEnded?: boolean;
}

/**
 * A pointed pillar geometry (Spitze Säule / obelisk-like column with conical tip).
 *
 * Consists of a lower frustum column of height $h_1$ tapering from base radius $a$
 * to transition radius $b$, topped by a conical tip of height $h_2$ with base radius $b$.
 *
 * Mathematical formulas:
 * - Pillar slant height: $s_1 = \sqrt{(a - b)^2 + h_1^2}$
 * - Tip slant height: $s_2 = \sqrt{b^2 + h_2^2}$
 * - Lateral area (Mantelfläche): $M = \pi \left( (a + b)s_1 + b s_2 \right)$
 * - Base area: $A_{\text{base}} = \pi a^2$
 * - Total surface area: $A = \pi a^2 + M$
 * - Volume: $V = \frac{\pi}{3} \left( h_1(a^2 + ab + b^2) + b^2 h_2 \right)$
 *
 * @see https://rechneronline.de/pi/spitze-saeule.php
 */
export class PointedPillar extends AbstractGeometry {
  /** Radius at the bottom base (a). */
  public radiusBase: number;
  /** Radius at the transition ring (b). */
  public radiusTransition: number;
  /** Height of the lower column shaft (h1). */
  public heightPillar: number;
  /** Height of the conical roof tip (h2). */
  public heightTip: number;
  /** Number of radial subdivisions. */
  public radialSegments: number;
  /** Number of height subdivisions on column shaft. */
  public heightSegments: number;
  /** Start angle in radians. */
  public thetaStart: number;
  /** Central angle in radians. */
  public thetaLength: number;
  /** Whether the bottom base is open. */
  public openEnded: boolean;

  /**
   * Creates a new PointedPillar geometry.
   * @param options Configuration options.
   */
  constructor(options: PointedPillarOptions = {}) {
    super();
    const {
      radiusBase = 1,
      radiusTransition = 0.75,
      heightPillar = 2,
      heightTip = 1,
      radialSegments = 32,
      heightSegments = 1,
      thetaStart = 0,
      thetaLength = MathUtils.TWO_PI,
      openEnded = false,
    } = options;

    this.radiusBase = Math.max(0, radiusBase);
    this.radiusTransition = Math.max(0, radiusTransition);
    this.heightPillar = Math.max(0, heightPillar);
    this.heightTip = Math.max(0, heightTip);
    this.radialSegments = Math.max(3, Math.floor(radialSegments));
    this.heightSegments = Math.max(1, Math.floor(heightSegments));
    this.thetaStart = thetaStart;
    this.thetaLength = Math.max(0, Math.min(MathUtils.TWO_PI, thetaLength));
    this.openEnded = openEnded;

    this.generateGeometryData();
  }

  /**
   * Calculates the slant height of the lower column $s_1 = \sqrt{(a - b)^2 + h_1^2}$.
   */
  public getSlantHeightPillar(): number {
    return Math.sqrt((this.radiusBase - this.radiusTransition) ** 2 + this.heightPillar ** 2);
  }

  /**
   * Calculates the slant height of the conical tip $s_2 = \sqrt{b^2 + h_2^2}$.
   */
  public getSlantHeightTip(): number {
    return Math.sqrt(this.radiusTransition ** 2 + this.heightTip ** 2);
  }

  /**
   * Calculates the lateral mantle area (column mantle + tip mantle).
   */
  public getLateralArea(): number {
    const fraction = this.thetaLength / MathUtils.TWO_PI;
    const m1 = Math.PI * (this.radiusBase + this.radiusTransition) * this.getSlantHeightPillar();
    const m2 = Math.PI * this.radiusTransition * this.getSlantHeightTip();
    return fraction * (m1 + m2);
  }

  /**
   * Calculates the bottom base circular area $A_{\text{base}} = \pi a^2$.
   */
  public getBaseArea(): number {
    const fraction = this.thetaLength / MathUtils.TWO_PI;
    return fraction * Math.PI * this.radiusBase ** 2;
  }

  /**
   * Calculates the total surface area $A = A_{\text{base}} + M$.
   */
  public getTotalSurfaceArea(): number {
    let area = this.getLateralArea();
    if (!this.openEnded) {
      area += this.getBaseArea();
      if (this.thetaLength < MathUtils.TWO_PI) {
        // Two vertical cutting plane sectors
        const h1 = this.heightPillar;
        const h2 = this.heightTip;
        const a = this.radiusBase;
        const b = this.radiusTransition;
        // Each sector side is a trapezoid (column) + triangle (tip)
        const sideArea = 0.5 * (a + b) * h1 + 0.5 * b * h2;
        area += 2 * sideArea;
      }
    }
    return area;
  }

  /**
   * Calculates the volume $V = \frac{\pi}{3} \left( h_1(a^2 + ab + b^2) + b^2 h_2 \right)$.
   */
  public getVolume(): number {
    const fraction = this.thetaLength / MathUtils.TWO_PI;
    const a = this.radiusBase;
    const b = this.radiusTransition;
    const h1 = this.heightPillar;
    const h2 = this.heightTip;
    const vColumn = ((Math.PI * h1) / 3) * (a * a + a * b + b * b);
    const vTip = (Math.PI * b * b * h2) / 3;
    return fraction * (vColumn + vTip);
  }

  /** @inheritdoc */
  protected override generateGeometryData(): void {
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    const wireIndices: number[] = [];

    const totalHeight = this.heightPillar + this.heightTip;
    const halfHeight = totalHeight / 2;
    const yBottom = -halfHeight;
    const yMid = -halfHeight + this.heightPillar;
    const yTop = halfHeight;

    const radSegs = this.radialSegments;
    const hSegs = this.heightSegments;

    // 1. Column frustum mantle
    const slantCol = this.getSlantHeightPillar();
    const cosSlopeCol = slantCol > 0 ? this.heightPillar / slantCol : 1;
    const sinSlopeCol = slantCol > 0 ? (this.radiusBase - this.radiusTransition) / slantCol : 0;

    let vertexOffset = 0;
    const colGrid: number[][] = [];

    for (let y = 0; y <= hSegs; y++) {
      const row: number[] = [];
      const vRatio = y / hSegs;
      const currentRadius = this.radiusBase + vRatio * (this.radiusTransition - this.radiusBase);
      const currentY = yBottom + vRatio * this.heightPillar;
      const vCoord = (vRatio * this.heightPillar) / (totalHeight || 1);

      for (let x = 0; x <= radSegs; x++) {
        const uRatio = x / radSegs;
        const theta = this.thetaStart + uRatio * this.thetaLength;
        const cosTheta = Math.cos(theta);
        const sinTheta = Math.sin(theta);

        positions.push(currentRadius * cosTheta, currentY, currentRadius * sinTheta);
        normals.push(cosTheta * cosSlopeCol, sinSlopeCol, sinTheta * cosSlopeCol);
        uvs.push(uRatio, vCoord);
        row.push(vertexOffset++);
      }
      colGrid.push(row);
    }

    for (let y = 0; y < hSegs; y++) {
      for (let x = 0; x < radSegs; x++) {
        const a = colGrid[y]![x]!;
        const b = colGrid[y + 1]![x]!;
        const c = colGrid[y + 1]![x + 1]!;
        const d = colGrid[y]![x + 1]!;

        indices.push(a, b, d);
        indices.push(b, c, d);
      }
    }
    wireIndices.push(...this.gridWireframe(hSegs + 1, radSegs + 1));

    // 2. Conical roof tip mantle (split vertices for sharp transition ridge!)
    const slantTip = this.getSlantHeightTip();
    const cosSlopeTip = slantTip > 0 ? this.heightTip / slantTip : 1;
    const sinSlopeTip = slantTip > 0 ? this.radiusTransition / slantTip : 0;

    const tipGrid: number[][] = [];
    const tipHeightSegments = Math.max(1, Math.round(this.heightSegments / 2));

    for (let y = 0; y <= tipHeightSegments; y++) {
      const row: number[] = [];
      const vRatio = y / tipHeightSegments;
      const currentRadius = this.radiusTransition * (1 - vRatio);
      const currentY = yMid + vRatio * this.heightTip;
      const vCoord = (this.heightPillar + vRatio * this.heightTip) / (totalHeight || 1);

      for (let x = 0; x <= radSegs; x++) {
        const uRatio = x / radSegs;
        const theta = this.thetaStart + uRatio * this.thetaLength;
        const cosTheta = Math.cos(theta);
        const sinTheta = Math.sin(theta);

        positions.push(currentRadius * cosTheta, currentY, currentRadius * sinTheta);
        normals.push(cosTheta * cosSlopeTip, sinSlopeTip, sinTheta * cosSlopeTip);
        uvs.push(uRatio, vCoord);
        row.push(vertexOffset++);
      }
      tipGrid.push(row);
    }

    for (let y = 0; y < tipHeightSegments; y++) {
      for (let x = 0; x < radSegs; x++) {
        const a = tipGrid[y]![x]!;
        const b = tipGrid[y + 1]![x]!;
        const c = tipGrid[y + 1]![x + 1]!;
        const d = tipGrid[y]![x + 1]!;

        indices.push(a, b, d);
        indices.push(b, c, d);

        wireIndices.push(a, b, a, d);
        if (x === radSegs - 1) wireIndices.push(d, c);
      }
    }

    // 3. Bottom Cap (Disk)
    if (!this.openEnded && this.radiusBase > 0) {
      const centerIdx = vertexOffset++;
      positions.push(0, yBottom, 0);
      normals.push(0, -1, 0);
      uvs.push(0.5, 0.5);

      const baseRingStart = vertexOffset;
      for (let x = 0; x <= radSegs; x++) {
        const uRatio = x / radSegs;
        const theta = this.thetaStart + uRatio * this.thetaLength;
        const cosTheta = Math.cos(theta);
        const sinTheta = Math.sin(theta);

        positions.push(this.radiusBase * cosTheta, yBottom, this.radiusBase * sinTheta);
        normals.push(0, -1, 0);
        uvs.push(0.5 + 0.5 * cosTheta, 0.5 + 0.5 * sinTheta);
        vertexOffset++;
      }

      for (let x = 0; x < radSegs; x++) {
        const p1 = baseRingStart + x;
        const p2 = baseRingStart + x + 1;
        indices.push(centerIdx, p1, p2);
        wireIndices.push(p1, p2);
      }
    }

    // 4. Sector Side Caps (if thetaLength < 2π)
    if (!this.openEnded && this.thetaLength < MathUtils.TWO_PI) {
      // Start side cap
      const cos0 = Math.cos(this.thetaStart);
      const sin0 = Math.sin(this.thetaStart);
      const normalStart = [sin0, 0, -cos0];

      const sBottom = vertexOffset++;
      const sMid = vertexOffset++;
      const sTip = vertexOffset++;
      const sCenterBottom = vertexOffset++;
      const sCenterMid = vertexOffset++;

      positions.push(this.radiusBase * cos0, yBottom, this.radiusBase * sin0);
      positions.push(this.radiusTransition * cos0, yMid, this.radiusTransition * sin0);
      positions.push(0, yTop, 0);
      positions.push(0, yBottom, 0);
      positions.push(0, yMid, 0);

      for (let i = 0; i < 5; i++) {
        normals.push(normalStart[0]!, normalStart[1]!, normalStart[2]!);
        uvs.push(0, 0.5);
      }

      // Column trapezoid: (sCenterBottom, sCenterMid, sMid, sBottom)
      indices.push(sCenterBottom, sCenterMid, sBottom);
      indices.push(sCenterMid, sMid, sBottom);
      // Tip triangle: (sCenterMid, sTip, sMid)
      indices.push(sCenterMid, sTip, sMid);

      // End side cap
      const angleEnd = this.thetaStart + this.thetaLength;
      const cosE = Math.cos(angleEnd);
      const sinE = Math.sin(angleEnd);
      const normalEnd = [-sinE, 0, cosE];

      const eBottom = vertexOffset++;
      const eMid = vertexOffset++;
      const eTip = vertexOffset++;
      const eCenterBottom = vertexOffset++;
      const eCenterMid = vertexOffset;

      positions.push(this.radiusBase * cosE, yBottom, this.radiusBase * sinE);
      positions.push(this.radiusTransition * cosE, yMid, this.radiusTransition * sinE);
      positions.push(0, yTop, 0);
      positions.push(0, yBottom, 0);
      positions.push(0, yMid, 0);

      for (let i = 0; i < 5; i++) {
        normals.push(normalEnd[0]!, normalEnd[1]!, normalEnd[2]!);
        uvs.push(1, 0.5);
      }

      indices.push(eCenterBottom, eBottom, eCenterMid);
      indices.push(eCenterMid, eBottom, eMid);
      indices.push(eCenterMid, eMid, eTip);
    }

    this.setBuffers({
      vertices: positions,
      uvs,
      normals,
      indices,
      wireframeIndices: wireIndices,
    });
  }
}
