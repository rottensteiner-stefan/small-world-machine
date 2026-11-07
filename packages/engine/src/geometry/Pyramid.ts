import { AbstractGeometry } from "./AbstractGeometry.js";
import { MathUtils } from "../math/index.js";

/**
 * Configuration options for pyramid geometry.
 */
export interface PyramidOptions {
  /** The size of the square base. Defaults to 1. */
  base?: number;
  /** The total height of the pyramid. Defaults to 1. */
  height?: number;
  /** The number of radial segments (faces). Defaults to 4 for a square pyramid. */
  radialSegments?: number;
}

/**
 * A pyramid geometry with a flat base and a tip.
 */
export class Pyramid extends AbstractGeometry {
  /** The size of the base. */
  public base: number;
  /** The height of the pyramid. */
  public height: number;
  /** The number of radial segments. */
  public radialSegments: number;

  /**
   * Creates a new Pyramid geometry.
   * @param options The configuration options.
   */
  constructor(options: PyramidOptions = {}) {
    super();
    const { base = 1, height = 1, radialSegments = 4 } = options;
    this.base = Math.max(0, base);
    this.height = Math.max(0, height);
    this.radialSegments = Math.max(3, Math.floor(radialSegments));
    this.generateGeometryData();
  }

  /** @inheritdoc */
  protected override generateGeometryData(): void {
    const v: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    const wireframeLines: number[] = [];
    const hh: number = this.height / 2.0;
    const rb: number = this.base / 2.0;

    // --- Side faces ---
    // Tip vertex
    v.push(0, hh, 0);
    uv.push(0.5, 1.0);
    const tipIndex: number = 0;

    for (let i: number = 0; i <= this.radialSegments; i++) {
      const theta: number = (i / this.radialSegments) * MathUtils.TWO_PI;
      v.push(rb * Math.sin(theta), -hh, rb * Math.cos(theta));
      uv.push(i / this.radialSegments, 0.0);
    }

    for (let i: number = 0; i < this.radialSegments; i++) {
      idx.push(tipIndex, i + 1, i + 2);
      wireframeLines.push(tipIndex, i + 1);
      wireframeLines.push(i + 1, i + 2);
    }

    // --- Base cap ---
    const baseCenterIndex: number = v.length / 3;
    v.push(0, -hh, 0);
    uv.push(0.5, 0.5);

    const baseOffset: number = v.length / 3;
    for (let i: number = 0; i <= this.radialSegments; i++) {
      const theta: number = (i / this.radialSegments) * MathUtils.TWO_PI;
      v.push(rb * Math.sin(theta), -hh, rb * Math.cos(theta));
      uv.push(0.5 + Math.sin(theta) * 0.5, 0.5 + Math.cos(theta) * 0.5);
    }

    for (let i: number = 0; i < this.radialSegments; i++) {
      idx.push(baseCenterIndex, baseOffset + i + 1, baseOffset + i);
    }

    this._vertices = new Float32Array(v);
    this._uvs = new Float32Array(uv);
    this._indices = this._createIndexArray(idx.length);
    this._indices.set(idx);

    this._wireframeIndices = this._createIndexArray(wireframeLines.length);
    this._wireframeIndices.set(wireframeLines);

    this.computeNormals();
  }
}
