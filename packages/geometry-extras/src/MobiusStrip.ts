import { AbstractGeometry, MathUtils } from "@small-world-machine/engine";

/**
 * Configuration options for Möbius strip geometry.
 */
export interface MobiusStripOptions {
  /** The center radius of the strip's loop. Defaults to 1. */
  radius?: number;
  /** The total width of the strip (across the twist axis). Defaults to 0.4. */
  width?: number;
  /** The number of segments along the length of the strip. Defaults to 96. */
  segments?: number;
  /** The number of segments across the width of the strip. Defaults to 8. */
  widthSegments?: number;
  /**
   * The number of half-twists applied over one loop. Defaults to 1 (the classic,
   * non-orientable Möbius strip). Even values produce an orientable twisted band
   * instead; higher odd values produce more exotic multi-twist variants.
   */
  twists?: number;
}

/**
 * A Möbius strip: a ribbon looped back on itself with a half-twist, rendered as an
 * open strip mesh whose two ends meet edge-to-edge in space without being explicitly
 * welded -- the only way to approximate a non-orientable surface with an orientable
 * (and therefore consistently shadeable) triangle mesh.
 */
export class MobiusStrip extends AbstractGeometry {
  /** The center radius of the strip's loop. */
  public radius: number;
  /** The total width of the strip. */
  public width: number;
  /** The number of segments along the length of the strip. */
  public segments: number;
  /** The number of segments across the width of the strip. */
  public widthSegments: number;
  /** The number of half-twists applied over one loop. */
  public twists: number;

  /**
   * Creates a new MobiusStrip geometry.
   * @param options The configuration options.
   */
  constructor(options: MobiusStripOptions = {}) {
    super();
    const { radius = 1, width = 0.4, segments = 96, widthSegments = 8, twists = 1 } = options;
    this.radius = Math.max(0, radius);
    this.width = Math.max(0, width);
    this.segments = Math.max(2, Math.floor(segments));
    this.widthSegments = Math.max(1, Math.floor(widthSegments));
    this.twists = Math.max(1, Math.floor(Math.abs(twists)));
    this.generateGeometryData();
  }

  /** @inheritdoc */
  protected override generateGeometryData(): void {
    const v: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    const cols: number = this.widthSegments + 1;

    for (let i: number = 0; i <= this.segments; i++) {
      const uRatio: number = i / this.segments;
      const u: number = uRatio * MathUtils.TWO_PI;
      const twistAngle: number = (this.twists * u) / 2;
      const cosTwist: number = Math.cos(twistAngle);
      const sinTwist: number = Math.sin(twistAngle);
      const cosU: number = Math.cos(u);
      const sinU: number = Math.sin(u);

      for (let j: number = 0; j <= this.widthSegments; j++) {
        const vRatio: number = j / this.widthSegments;
        const w: number = (vRatio - 0.5) * this.width;
        const ringRadius: number = this.radius + w * cosTwist;

        v.push(ringRadius * cosU, w * sinTwist, ringRadius * sinU);
        uv.push(uRatio, vRatio);
      }
    }

    for (let i: number = 0; i < this.segments; i++) {
      for (let j: number = 0; j < this.widthSegments; j++) {
        const a: number = i * cols + j;
        const b: number = (i + 1) * cols + j;
        const c: number = (i + 1) * cols + j + 1;
        const d: number = i * cols + j + 1;
        idx.push(a, b, d);
        idx.push(b, c, d);
      }
    }

    this._vertices = new Float32Array(v);
    this._uvs = new Float32Array(uv);
    this._indices = this._createIndexArray(idx.length);
    this._indices.set(idx);
    this.computeNormals();
  }

  /**
   * Computes the wireframe indices as a length/width grid, avoiding the diagonal
   * quad lines a generic triangle-edge wireframe would produce.
   */
  public override computeWireframeIndices(): void {
    const lines: number[] = [];
    const cols: number = this.widthSegments + 1;

    for (let i: number = 0; i <= this.segments; i++) {
      for (let j: number = 0; j < this.widthSegments; j++) {
        const current: number = i * cols + j;
        lines.push(current, current + 1);
      }
    }

    for (let i: number = 0; i < this.segments; i++) {
      for (let j: number = 0; j <= this.widthSegments; j++) {
        const current: number = i * cols + j;
        lines.push(current, current + cols);
      }
    }

    this._wireframeIndices = this._createIndexArray(lines.length);
    this._wireframeIndices.set(lines);
  }
}
