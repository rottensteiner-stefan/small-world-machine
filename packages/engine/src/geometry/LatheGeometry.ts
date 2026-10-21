import { AbstractGeometry } from "./AbstractGeometry.js";
import { MathUtils } from "../math/index.js";

/**
 * Profile of a single revolve ring: the outer wall radius, the optional inner wall
 * radius (hollow shapes), and the vertical position of the ring (negative to drop
 * below the shape's centered origin).
 */
export interface LatheRing {
  /** Radius of the outer wall at this ring. */
  outer: number;
  /** Radius of the inner wall at this ring, when the shape is hollow. */
  inner?: number;
  /** Vertical position of the ring. */
  y: number;
}

/**
 * Configuration for a {@link LatheGeometry} revolve surface.
 */
export interface LatheGeometryOptions {
  /**
   * The revolve profile: one ring per height slice, bottom to top. Consecutive rings
   * SHARE their wall vertices (one vertex row per ring), so wall normals are averaged
   * across profile corners: a kink in the profile is shaded smooth, which is what
   * sphere/capsule-like profiles need. For a hard crease, add the corner twice as two
   * rings at the same height (a zero-height step) or end the wall there and use a cap.
   * Caps and cut-plane caps always own dedicated vertices, so their edges stay sharp.
   * Winding is emitted explicitly (no auto-correction).
   */
  rings: readonly LatheRing[];
  /** The number of radial subdivisions around the circumference. */
  radialSegments: number;
  /** The start angle of the sector in radians. */
  thetaStart: number;
  /** The central angle of the sector in radians. */
  thetaLength: number;
  /** Emits the top disk/annular cap when true. */
  capTop: boolean;
  /** Emits the bottom disk/annular cap when true. */
  capBottom: boolean;
  /** Emits the two cut-plane caps when the profile is a partial sector. */
  sideCaps: boolean;
  /** Flips the UV U axis on the inner wall. */
  flipInnerU: boolean;
  /** UV repeat factor for the side wall [uRepeat, vRepeat]. Defaults to [1, 1]. */
  sideUvRepeat?: [number, number];
  /**
   * Taper factor for the top cap UV projection (e.g. `topOuterRadius / bottomOuterRadius`
   * for shapes whose top opening is smaller than the base). Defaults to 1.
   */
  capUvScaleTop?: number;
}

/**
 * A generic lathe / surface-of-revolution geometry. Revolves a profile of rings around
 * the Y axis, emitting the outer and inner walls with explicit per-quad winding (see
 * {@link AbstractGeometry.addQuad}) plus disk/annular caps and cut-plane caps for
 * partial sectors.
 *
 * This is the consolidation core of the revolve family: the legacy per-shape revolve
 * implementations shared this exact grid/cap/wireframe structure and differed only in
 * how they built their ring profile and capped the ends. Solid shapes express a full
 * disk by omitting the inner radius; hollow shapes provide inner radii per ring.
 * {@link RevolveBuilder} wraps this for tooling that needs to assemble a profile
 * imperatively.
 */
export class LatheGeometry extends AbstractGeometry {
  /** The revolve profile. */
  public readonly rings: readonly LatheRing[];
  /** The number of radial subdivisions. */
  public readonly radialSegments: number;
  /** The start angle in radians. */
  public readonly thetaStart: number;
  /** The central angle in radians. */
  public readonly thetaLength: number;
  /** Whether the top cap is emitted. */
  public readonly capTop: boolean;
  /** Whether the bottom cap is emitted. */
  public readonly capBottom: boolean;
  /** Whether cut-plane caps are emitted for partial sectors. */
  public readonly sideCaps: boolean;
  /** Whether the inner wall UV U axis is flipped. */
  public readonly flipInnerU: boolean;
  /** UV repeat factor for the side wall. */
  public readonly sideUvRepeat: [number, number];
  /** Taper factor for the top cap UV projection. */
  public readonly capUvScaleTop: number;

  /**
   * Creates a new LatheGeometry.
   * @param options The revolve options.
   */
  constructor(options: LatheGeometryOptions) {
    super();
    if (2 > options.rings.length) {
      throw new Error("LatheGeometry requires at least two profile rings.");
    }
    this.rings = options.rings;
    this.radialSegments = Math.max(3, Math.floor(options.radialSegments));
    // Normalize instead of throwing: a negative length is the same sector walked the
    // other way (start moves back, length flips sign, winding stays outward); a length
    // beyond a full turn or a non-finite one is a full circle.
    let thetaStart: number = options.thetaStart;
    let thetaLength: number = options.thetaLength;
    if (Number.isFinite(thetaLength) && 0 > thetaLength) {
      thetaStart += thetaLength;
      thetaLength = -thetaLength;
    }
    this.thetaStart = Number.isFinite(thetaStart) ? thetaStart : 0;
    this.thetaLength = Number.isFinite(thetaLength)
      ? Math.min(thetaLength, MathUtils.TWO_PI)
      : MathUtils.TWO_PI;
    this.capTop = options.capTop;
    this.capBottom = options.capBottom;
    this.sideCaps = options.sideCaps;
    this.flipInnerU = options.flipInnerU;
    this.sideUvRepeat = [options.sideUvRepeat?.[0] ?? 1, options.sideUvRepeat?.[1] ?? 1];
    this.capUvScaleTop = options.capUvScaleTop ?? 1;
    this.generateGeometryData();
  }

  /** The generated vertex buffer. */
  public get vertices(): Float32Array {
    return this._vertices;
  }

  /** The generated UV buffer. */
  public get uvs(): Float32Array {
    return this._uvs;
  }

  /** The generated normals buffer. */
  public get normals(): Float32Array {
    return this._normals;
  }

  /** The generated triangle index buffer. */
  public get indices(): Uint16Array | Uint32Array | undefined {
    return this._indices;
  }

  /** The generated wireframe index buffer. */
  public get wireframeIndices(): Uint16Array | Uint32Array | undefined {
    return this._wireframeIndices;
  }

  /** @inheritdoc */
  protected override generateGeometryData(): void {
    const v: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    const wire: number[] = [];
    const ringCount = this.rings.length;
    const isSector = this.thetaLength < MathUtils.TWO_PI - 0.00001;

    // --- 1. Outer wall surface ---
    this._emitWall(v, uv, idx, wire, false);

    // --- 2. Inner wall surface (hollow rings only) ---
    const hasInner = this.rings.some((ring) => 0 < (ring.inner ?? 0));
    if (hasInner) {
      this._emitWall(v, uv, idx, wire, true);
    }

    // --- 3. Top cap (annular grid if hollow, disk fan otherwise) ---
    const topRing = this.rings[ringCount - 1]!;
    if (this.capTop && 0 < topRing.outer) {
      this._emitCap(v, uv, idx, wire, topRing, topRing.inner ?? 0, false);
    }

    // --- 4. Bottom cap ---
    const bottomRing = this.rings[0]!;
    if (this.capBottom && 0 < bottomRing.outer) {
      this._emitCap(v, uv, idx, wire, bottomRing, bottomRing.inner ?? 0, true);
    }

    // --- 5. Cut-plane side caps for partial sectors ---
    if (isSector && this.sideCaps) {
      this._emitSideCaps(v, uv, idx, wire);
    }

    this._vertices = new Float32Array(v);
    this._uvs = new Float32Array(uv);
    this._indices = this._createIndexArray(idx.length);
    this._indices.set(idx);
    if (0 < wire.length) {
      this._wireframeIndices = this._createIndexArray(wire.length);
      this._wireframeIndices.set(wire);
    }
    this.computeNormals();
    if (!isSector) {
      this._closeSeamNormals();
    }
  }

  /**
   * Full-circle wall seam and poles. The first and last vertex of each wall row sit at
   * the same position but only touch one cell each, so `computeNormals` gives them
   * different normals (a visible seam). Average them; a zero-radius row (pole) is
   * collapsed to one shared normal for all its coincident vertices.
   */
  private _closeSeamNormals(): void {
    const cols = this.radialSegments + 1;
    const ringCount = this.rings.length;
    const hasInner = this.rings.some((ring) => 0 < (ring.inner ?? 0));
    const walls = hasInner ? 2 : 1;
    const n = this._normals;
    for (let w = 0; w < walls; w++) {
      const offset = w * ringCount * cols;
      for (let y = 0; y < ringCount; y++) {
        const ring = this.rings[y]!;
        const radius = 1 === w ? (ring.inner ?? 0) : ring.outer;
        const first = (offset + y * cols) * 3;
        const count = 0 >= radius ? cols : 2;
        let sx = 0;
        let sy = 0;
        let sz = 0;
        for (let k = 0; k < count; k++) {
          const i = 0 >= radius ? first + k * 3 : first + k * (cols - 1) * 3;
          sx += n[i]!;
          sy += n[i + 1]!;
          sz += n[i + 2]!;
        }
        const len = Math.hypot(sx, sy, sz);
        if (len < 0.00001) continue;
        sx /= len;
        sy /= len;
        sz /= len;
        for (let k = 0; k < count; k++) {
          const i = 0 >= radius ? first + k * 3 : first + k * (cols - 1) * 3;
          n[i] = sx;
          n[i + 1] = sy;
          n[i + 2] = sz;
        }
      }
    }
  }

  /**
   * Emits one wall (outer when `innerWall` is false, inner otherwise) as an
   * `(rings.length) x (radialSegments + 1)` quad grid with explicit winding.
   */
  private _emitWall(
    v: number[],
    uv: number[],
    idx: number[],
    wire: number[],
    innerWall: boolean,
  ): void {
    const radial = this.radialSegments;
    const ringCount = this.rings.length;
    const offset = v.length / 3;

    for (let y = 0; y < ringCount; y++) {
      const ring = this.rings[y]!;
      const radius = innerWall ? (ring.inner ?? 0) : ring.outer;
      for (let x = 0; x <= radial; x++) {
        const uCoord = x / radial;
        const theta = this.thetaStart + uCoord * this.thetaLength;
        const vCoord = y / (ringCount - 1);
        v.push(radius * Math.sin(theta), ring.y, radius * Math.cos(theta));
        if (innerWall) {
          uv.push(
            (this.flipInnerU ? 1.0 - uCoord : uCoord) * this.sideUvRepeat[0],
            (1.0 - vCoord) * this.sideUvRepeat[1],
          );
        } else {
          uv.push(uCoord * this.sideUvRepeat[0], (1.0 - vCoord) * this.sideUvRepeat[1]);
        }
      }
    }

    const cols = radial + 1;
    for (let y = 0; y < ringCount - 1; y++) {
      for (let x = 0; x < cols - 1; x++) {
        const a = offset + y * cols + x;
        const b = a + 1;
        const c = a + cols;
        const d = c + 1;
        if (innerWall) {
          this.addQuad(idx, a, c, b, d, false);
        } else {
          this.addQuad(idx, a, b, c, d, false);
        }
        wire.push(a, a + 1);
        wire.push(a, c);
      }
      const last = offset + y * cols + cols - 1;
      const belowLast = offset + (y + 1) * cols + cols - 1;
      wire.push(last, belowLast);
    }
    const bottomRow = offset + (ringCount - 1) * cols;
    for (let x = 0; x < cols - 1; x++) {
      wire.push(bottomRow + x, bottomRow + x + 1);
    }
  }

  /**
   * Emits a cap. For a solid shape (`inner` is zero) this is a triangle fan from the
   * center point to the outer ring; for a hollow shape it is a quad ring between the
   * outer ring and the inner ring. Winding is explicit — the caller declares it via
   * `isBottom` instead of relying on any auto-correction.
   */
  private _emitCap(
    v: number[],
    uv: number[],
    idx: number[],
    wire: number[],
    ring: LatheRing,
    inner: number,
    isBottom: boolean,
  ): void {
    const radial = this.radialSegments;
    const outer = ring.outer;
    const uvScale = isBottom ? 1 : this.capUvScaleTop;

    if (0 >= inner) {
      // --- Solid disk: center point + outer ring fan ---
      const capOffset = v.length / 3;
      v.push(0, ring.y, 0);
      uv.push(0.5, 0.5);
      for (let x = 0; x <= radial; x++) {
        const uCoord = x / radial;
        const theta = this.thetaStart + uCoord * this.thetaLength;
        const sin = Math.sin(theta);
        const cos = Math.cos(theta);
        v.push(outer * sin, ring.y, outer * cos);
        const vCoord = isBottom ? 0.5 - 0.5 * cos : 0.5 + 0.5 * cos;
        uv.push(0.5 + 0.5 * sin, vCoord);
      }
      for (let x = 0; x < radial; x++) {
        if (isBottom) {
          idx.push(capOffset, capOffset + x + 2, capOffset + x + 1);
        } else {
          idx.push(capOffset, capOffset + x + 1, capOffset + x + 2);
        }
        wire.push(capOffset, capOffset + x + 1);
        wire.push(capOffset + x + 1, capOffset + x + 2);
      }
      wire.push(capOffset, capOffset + radial + 1);
      return;
    }

    // --- Hollow shape: annular ring between outer and inner radii ---
    const capOffset = v.length / 3;
    for (let x = 0; x <= radial; x++) {
      const uCoord = x / radial;
      const theta = this.thetaStart + uCoord * this.thetaLength;
      const sin = Math.sin(theta);
      const cos = Math.cos(theta);
      v.push(outer * sin, ring.y, outer * cos);
      v.push(inner * sin, ring.y, inner * cos);
      const outerScale = 0.5 * uvScale * sin;
      const innerScale = 0.5 * uvScale * (inner / outer) * sin;
      uv.push(0.5 + outerScale, isBottom ? 0.5 - 0.5 * uvScale * cos : 0.5 + 0.5 * uvScale * cos);
      uv.push(
        0.5 + innerScale,
        isBottom
          ? 0.5 - 0.5 * uvScale * (inner / outer) * cos
          : 0.5 + 0.5 * uvScale * (inner / outer) * cos,
      );
    }

    for (let x = 0; x < radial; x++) {
      const o1 = capOffset + x * 2;
      const i1 = o1 + 1;
      const o2 = capOffset + (x + 1) * 2;
      const i2 = o2 + 1;
      if (isBottom) {
        this.addQuad(idx, o1, i1, o2, i2, false);
      } else {
        this.addQuad(idx, o1, o2, i1, i2, false);
      }
      wire.push(o1, i1);
      wire.push(o1, o2);
      wire.push(i1, i2);
    }
    const lastTop = capOffset + radial * 2;
    wire.push(lastTop, lastTop + 1);
  }

  /**
   * Emits the two cut-plane caps of a partial sector: for a solid profile a column of
   * quads from the axis to the outer edge, for a hollow profile a column of quads from
   * the inner edge to the outer edge. Winding is explicit per side.
   */
  private _emitSideCaps(v: number[], uv: number[], idx: number[], wire: number[]): void {
    const ringCount = this.rings.length;
    // Per ring: a ring without an inner radius reaches the axis at that height, so a
    // profile that is hollow only at some rings gets the matching cross-section.
    const inner = (ring: LatheRing): number => Math.max(0, ring.inner ?? 0);

    for (const isStart of [true, false]) {
      const angle = isStart ? this.thetaStart : this.thetaStart + this.thetaLength;
      const sin = Math.sin(angle);
      const cos = Math.cos(angle);
      const sideOffset = v.length / 3;

      for (let y = 0; y < ringCount; y++) {
        const ring = this.rings[y]!;
        const vCoord = ringCount > 1 ? y / (ringCount - 1) : 0;
        v.push(inner(ring) * sin, ring.y, inner(ring) * cos);
        uv.push(0, 1.0 - vCoord);
        v.push(ring.outer * sin, ring.y, ring.outer * cos);
        uv.push(1, 1.0 - vCoord);
      }

      for (let y = 0; y < ringCount - 1; y++) {
        const c1 = sideOffset + y * 2;
        const r1 = c1 + 1;
        const c2 = sideOffset + (y + 1) * 2;
        const r2 = c2 + 1;
        if (isStart) {
          this.addQuad(idx, c1, r1, c2, r2, false);
        } else {
          this.addQuad(idx, c1, c2, r1, r2, false);
        }
        wire.push(c1, r1);
        wire.push(c1, c2);
        wire.push(r1, r2);
      }
      const lastRow = sideOffset + (ringCount - 1) * 2;
      wire.push(lastRow, lastRow + 1);
    }
  }
}

/**
 * Imperative builder for {@link LatheGeometry} profiles. Accumulates rings and derives
 * the wall/cap emission flags when the geometry is constructed.
 */
export class RevolveBuilder {
  /** The accumulated rings, bottom to top. */
  private readonly _rings: LatheRing[] = [];

  /**
   * Adds a ring to the revolve profile.
   * @param outer The outer wall radius.
   * @param y The vertical position of the ring.
   * @param inner Optional inner wall radius for hollow shapes.
   * @returns this
   */
  public addRing(outer: number, y: number, inner?: number): this {
    this._rings.push({ outer, y, ...(inner !== undefined ? { inner } : {}) });
    return this;
  }

  /**
   * Adds consecutive rings forming an interpolated segment from bottom to top.
   * @param yStart Vertical position of the first ring.
   * @param yEnd Vertical position of the last ring.
   * @param steps The number of segments (steps + 1 rings are added).
   * @param outerStart Outer radius at the start.
   * @param outerEnd Outer radius at the end.
   * @param innerStart Inner radius at the start, or undefined for a solid wall.
   * @param innerEnd Inner radius at the end, or undefined.
   * @returns this
   */
  public addSegments(
    yStart: number,
    yEnd: number,
    steps: number,
    outerStart: number,
    outerEnd: number,
    innerStart?: number,
    innerEnd?: number,
  ): this {
    if (steps < 1) {
      throw new Error("RevolveBuilder.addSegments requires at least one step.");
    }
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const outer = outerStart + (outerEnd - outerStart) * t;
      const inner =
        innerStart !== undefined && innerEnd !== undefined
          ? innerStart + (innerEnd - innerStart) * t
          : undefined;
      this.addRing(outer, yStart + (yEnd - yStart) * t, inner);
    }
    return this;
  }

  /**
   * Builds the configured LatheGeometry.
   * @param options The emission options (radial segments, sector, caps).
   * @returns The generated geometry.
   */
  public build(options: Omit<LatheGeometryOptions, "rings">): LatheGeometry {
    return new LatheGeometry({ ...options, rings: Object.freeze([...this._rings]) });
  }
}
