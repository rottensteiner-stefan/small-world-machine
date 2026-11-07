import { AbstractGeometry, MathUtils, Vector3D } from "@small-world-machine/engine";

/**
 * Configuration options for lathe (revolution) geometry.
 */
export interface LatheOptions {
  /** 2D profile points (x = radius, y = height), listed from bottom to top. Defaults to an
   * organic hourglass curve. */
  profile?: Vector3D[];
  /** Number of segments around the revolution. Defaults to 32. */
  segments?: number;
  /** Whether to close the surface into a seamless ring (no UV seam), meaning the last segment
   * wraps back to the first. Defaults to false. */
  closed?: boolean;
  /** Start angle of the revolution in radians. Defaults to 0. */
  startAngle?: number;
  /** Total arc of the revolution in radians (2π = full rotation). Defaults to 2π. */
  arcAngle?: number;
}

const DEFAULT_PROFILE: readonly Vector3D[] = [
  new Vector3D(0.5, 0, 0),
  new Vector3D(0.42, 0.2, 0),
  new Vector3D(0.55, 0.4, 0),
  new Vector3D(0.32, 0.6, 0),
  new Vector3D(0.46, 0.8, 0),
  new Vector3D(0.4, 1, 0),
];

/**
 * A surface of revolution: rotates a 2D profile (radius × height) around the Y axis, producing
 * vases, bottles, goblets, rings and other lathe-turned objects. The profile must be strictly
 * monotonic in height to avoid self-intersecting rings.
 */
export class Lathe extends AbstractGeometry {
  /** The (cloned) profile points that define the revolution contour. */
  public profile: Vector3D[];
  /** Number of segments around the revolution. */
  public segments: number;
  /** Whether the surface is closed into a seamless ring. */
  public closed: boolean;
  /** Start angle of the revolution in radians. */
  public startAngle: number;
  /** Total arc of the revolution in radians. */
  public arcAngle: number;

  /**
   * Creates a new Lathe geometry.
   * @param options The configuration options.
   */
  constructor(options: LatheOptions = {}) {
    super();
    const {
      profile,
      segments = 32,
      closed = false,
      startAngle = 0,
      arcAngle = MathUtils.TWO_PI,
    } = options;
    this.profile = (profile ?? (DEFAULT_PROFILE as readonly Vector3D[])).map(
      (p: Vector3D) => new Vector3D(p.x, p.y, p.z),
    );
    this.segments = Math.min(360, Math.max(3, Math.floor(segments)));
    this.closed = closed;
    this.startAngle = startAngle;
    this.arcAngle = Math.max(0.0001, Math.abs(arcAngle));
    this.generateGeometryData();
  }

  /** @inheritdoc */
  protected override generateGeometryData(): void {
    const v: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];

    const ptCount = this.profile.length;
    if (ptCount < 2) {
      this._vertices = new Float32Array();
      this._indices = undefined;
      return;
    }

    // A closed ring shares the first and last revolution columns (no seam); an open arc needs
    // distinct boundary columns to cap the start and end angles without a wrap-around edge.
    const cols = this.closed ? this.segments : this.segments + 1;
    const arcStep = this.arcAngle / this.segments;

    for (let i = 0; i < cols; i++) {
      const theta = this.startAngle + i * arcStep;
      const cosT = Math.cos(theta);
      const sinT = Math.sin(theta);
      const u = i / (cols - 1);

      for (let j = 0; j < ptCount; j++) {
        const p = this.profile[j]!;
        v.push(p.x * cosT, p.y, p.x * sinT);
        uv.push(u, ptCount === 1 ? 0 : j / (ptCount - 1));
      }
    }

    for (let i = 0; i < this.segments; i++) {
      const iNext = (i + 1) % cols;
      for (let j = 0; j < ptCount - 1; j++) {
        const a = i * ptCount + j;
        const b = iNext * ptCount + j;
        const c = iNext * ptCount + j + 1;
        const d = i * ptCount + j + 1;
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
}
