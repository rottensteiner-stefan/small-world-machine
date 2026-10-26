/**
 * A 2D point defining a corner vertex of a stage zone, in normalized image space (0..1 on both
 * axes, matching the background art's own pixel grid -- u=0 left edge, v=0 top edge).
 */
export interface StagePoint2D {
  u: number;
  v: number;
  /** Uniform character scale at this corner (default: 1.0). Used for forced-perspective
   * shrinking as the character "recedes" into the painted background -- see `getScaleAt`. */
  scale?: number;
}

/**
 * Directional linear scale gradient across a stage zone.
 */
export interface StageLinearScaleGradient {
  mode?: "linear";
  /** Start anchor point in normalized image coordinates (u, v) and character scale. */
  start: { u: number; v: number; scale: number };
  /** End anchor point in normalized image coordinates (u, v) and character scale. */
  end: { u: number; v: number; scale: number };
  /** Minimum scale clamp (default: 0.01). */
  minScale?: number;
  /** Maximum scale clamp (default: Infinity). */
  maxScale?: number;
}

/**
 * Vanishing-point perspective scale gradient across a stage zone.
 */
export interface StageVanishingPointScaleGradient {
  mode: "vanishing-point";
  /** Vanishing point in normalized image coordinates (u, v) where perspective lines converge. */
  vanishingPoint: { u: number; v: number };
  /** Reference point in normalized image coordinates (u, v) where character scale is known. */
  reference: { u: number; v: number; scale: number };
  /** Target character scale at the vanishing point (default: 0). */
  vanishingScale?: number;
  /** Minimum scale clamp (default: 0.01). */
  minScale?: number;
  /** Maximum scale clamp (default: Infinity). */
  maxScale?: number;
}

/**
 * A continuous gradient scaling field across a 2.5D stage zone.
 */
export type StageScaleGradient = StageLinearScaleGradient | StageVanishingPointScaleGradient;

/**
 * Configuration options for creating a StageZone.
 */
export interface StageZoneOptions {
  id: string;
  name: string;
  /** Points in order, tracing the polygon's perimeter (either winding direction). Minimum 3. */
  points: StagePoint2D[];
  /** Optional continuous gradient scaling field across the entire zone. */
  scaleGradient?: StageScaleGradient | undefined;
  /** Force using scale gradient for local axes calculation even on 4-point quads (default: false). */
  useScaleGradient?: boolean | undefined;
}

/**
 * A walkable region of a 2.5D stage, traced directly on top of a painted background image in
 * that image's own normalized (u, v) space -- no camera, no world coordinates, no perspective
 * reconstruction. This intentionally mirrors how classic 2.5D adventures (Grim Fandango, Monkey
 * Island) author walk masks: an artist draws a shape directly on the picture, and a small
 * per-corner `scale` or a continuous scale gradient fakes the size falloff a real camera would
 * produce. There is no rectangle or vanishing-point constraint on the shape -- it's an arbitrary
 * n-gon polygon decomposed into interior triangles via ear-clipping.
 */
export class StageZone {
  public readonly id: string;
  public readonly name: string;
  public readonly points: { u: number; v: number; scale: number }[];
  public readonly scaleGradient?: StageScaleGradient | undefined;
  public readonly useScaleGradient: boolean;

  private _triangles: [number, number, number][] = [];
  private _triangulationIndices: number[] = [];
  private _lastTriangulatedPointCount: number = 0;

  constructor(options: StageZoneOptions) {
    if (options.points.length < 3) {
      throw new Error(
        `StageZone "${options.id}" needs at least 3 points to form a polygon (got ${options.points.length}).`,
      );
    }
    this.id = options.id;
    this.name = options.name;
    this.scaleGradient = options.scaleGradient;
    this.useScaleGradient = options.useScaleGradient ?? false;

    this.points = options.points.map((p) => {
      let scale = p.scale;
      if (scale === undefined) {
        if (options.scaleGradient) {
          scale = StageZone._evaluateGradient(p.u, p.v, options.scaleGradient);
        } else {
          scale = 1.0;
        }
      }
      return { u: p.u, v: p.v, scale };
    });

    this.retriangulate();
  }

  /**
   * The list of triangle vertex index triplets [i0, i1, i2] partitioning this polygon.
   */
  public get triangles(): readonly [number, number, number][] {
    if (this._triangles.length === 0 || this.points.length !== this._lastTriangulatedPointCount) {
      this.retriangulate();
    }
    return this._triangles;
  }

  /**
   * Flat array of indices for direct consumption by GPU index buffers (e.g. `PolygonFan`).
   */
  public get triangulationIndices(): readonly number[] {
    if (this._triangles.length === 0 || this.points.length !== this._lastTriangulatedPointCount) {
      this.retriangulate();
    }
    return this._triangulationIndices;
  }

  /**
   * Recomputes the interior triangulation of the polygon using ear clipping (or preserving the
   * canonical 2-triangle split for convex quads).
   */
  public retriangulate(): void {
    const pts = this.points;
    const n = pts.length;
    if (n < 3) {
      this._triangles = [];
      this._triangulationIndices = [];
      this._lastTriangulatedPointCount = n;
      return;
    }

    if (n === 3) {
      this._triangles = [[0, 1, 2]];
    } else if (n === 4 && this._isConvexQuad()) {
      // Retain exact byte-identical 2-triangle fan for convex 4-point quads
      this._triangles = [
        [0, 1, 2],
        [0, 2, 3],
      ];
    } else {
      this._triangles = StageZone._earClip(pts);
    }

    const indices: number[] = [];
    for (const tri of this._triangles) {
      indices.push(tri[0], tri[1], tri[2]);
    }
    this._triangulationIndices = indices;
    this._lastTriangulatedPointCount = n;
  }

  private _isConvexQuad(): boolean {
    const pts = this.points;
    if (pts.length !== 4) return false;
    const p0 = pts[0]!;
    const p1 = pts[1]!;
    const p2 = pts[2]!;
    const p3 = pts[3]!;

    const cross = (
      a: { u: number; v: number },
      b: { u: number; v: number },
      c: { u: number; v: number },
    ): number => (b.u - a.u) * (c.v - b.v) - (b.v - a.v) * (c.u - b.u);

    const c0 = cross(p3, p0, p1);
    const c1 = cross(p0, p1, p2);
    const c2 = cross(p1, p2, p3);
    const c3 = cross(p2, p3, p0);

    const pos = c0 > 1e-9 && c1 > 1e-9 && c2 > 1e-9 && c3 > 1e-9;
    const neg = c0 < -1e-9 && c1 < -1e-9 && c2 < -1e-9 && c3 < -1e-9;
    return pos || neg;
  }

  /**
   * Ear-clips a simple 2D polygon of arbitrary point count into non-overlapping interior triangles.
   */
  private static _earClip(pts: readonly { u: number; v: number }[]): [number, number, number][] {
    const n = pts.length;
    if (n < 3) return [];
    if (n === 3) return [[0, 1, 2]];

    let area = 0;
    for (let i = 0; i < n; i++) {
      const p1 = pts[i]!;
      const p2 = pts[(i + 1) % n]!;
      area += p1.u * p2.v - p2.u * p1.v;
    }
    const isPositive = area > 0;

    const loop: number[] = [];
    for (let i = 0; i < n; i++) loop.push(i);
    if (!isPositive) loop.reverse();

    const triangles: [number, number, number][] = [];
    let guard = loop.length * loop.length * 2 + 50;

    while (loop.length > 3 && guard-- > 0) {
      let earFound = false;
      for (let i = 0; i < loop.length && !earFound; i++) {
        const prev = loop[(i - 1 + loop.length) % loop.length]!;
        const cur = loop[i]!;
        const next = loop[(i + 1) % loop.length]!;

        const pPrev = pts[prev]!;
        const pCur = pts[cur]!;
        const pNext = pts[next]!;

        const crossVal =
          (pCur.u - pPrev.u) * (pNext.v - pCur.v) - (pCur.v - pPrev.v) * (pNext.u - pCur.u);
        if (crossVal <= 1e-9) continue;

        let blocked = false;
        for (let j = 0; j < loop.length && !blocked; j++) {
          const v = loop[j]!;
          if (v === prev || v === cur || v === next) continue;
          if (StageZone._pointInTriangle(pPrev, pCur, pNext, pts[v]!)) {
            blocked = true;
          }
        }

        if (!blocked) {
          triangles.push([prev, cur, next]);
          loop.splice(i, 1);
          earFound = true;
        }
      }

      if (!earFound && loop.length > 3) {
        let worst = 0;
        let minArea = Infinity;
        for (let i = 0; i < loop.length; i++) {
          const prev = loop[(i - 1 + loop.length) % loop.length]!;
          const cur = loop[i]!;
          const next = loop[(i + 1) % loop.length]!;
          const a = Math.abs(
            (pts[cur]!.u - pts[prev]!.u) * (pts[next]!.v - pts[cur]!.v) -
              (pts[cur]!.v - pts[prev]!.v) * (pts[next]!.u - pts[cur]!.u),
          );
          if (a < minArea) {
            minArea = a;
            worst = i;
          }
        }
        loop.splice(worst, 1);
      }
    }

    if (loop.length === 3) {
      triangles.push([loop[0]!, loop[1]!, loop[2]!]);
    }

    return triangles;
  }

  private static _pointInTriangle(
    a: { u: number; v: number },
    b: { u: number; v: number },
    c: { u: number; v: number },
    p: { u: number; v: number },
  ): boolean {
    if (
      (Math.abs(p.u - a.u) < 1e-9 && Math.abs(p.v - a.v) < 1e-9) ||
      (Math.abs(p.u - b.u) < 1e-9 && Math.abs(p.v - b.v) < 1e-9) ||
      (Math.abs(p.u - c.u) < 1e-9 && Math.abs(p.v - c.v) < 1e-9)
    ) {
      return false;
    }
    const c1 = (b.u - a.u) * (p.v - a.v) - (b.v - a.v) * (p.u - a.u);
    const c2 = (c.u - b.u) * (p.v - b.v) - (c.v - b.v) * (p.u - b.u);
    const c3 = (a.u - c.u) * (p.v - c.v) - (a.v - c.v) * (p.u - c.u);

    return c1 >= -1e-9 && c2 >= -1e-9 && c3 >= -1e-9;
  }

  private static _evaluateGradient(u: number, v: number, gradient: StageScaleGradient): number {
    const minScale = gradient.minScale ?? 0.01;
    const maxScale = gradient.maxScale ?? Infinity;

    if (gradient.mode === "vanishing-point") {
      const { vanishingPoint, reference, vanishingScale = 0 } = gradient;
      const dRefSq = (reference.u - vanishingPoint.u) ** 2 + (reference.v - vanishingPoint.v) ** 2;
      if (dRefSq < 1e-8) {
        return Math.max(minScale, Math.min(maxScale, reference.scale));
      }
      const dRef = Math.sqrt(dRefSq);
      const dCur = Math.sqrt((u - vanishingPoint.u) ** 2 + (v - vanishingPoint.v) ** 2);
      const t = dCur / dRef;
      const scale = vanishingScale + t * (reference.scale - vanishingScale);
      return Math.max(minScale, Math.min(maxScale, scale));
    }

    const { start, end } = gradient;
    const du = end.u - start.u;
    const dv = end.v - start.v;
    const lenSq = du * du + dv * dv;
    if (lenSq < 1e-8) {
      return Math.max(minScale, Math.min(maxScale, start.scale));
    }
    const t = ((u - start.u) * du + (v - start.v) * dv) / lenSq;
    const scale = start.scale + t * (end.scale - start.scale);
    return Math.max(minScale, Math.min(maxScale, scale));
  }

  /**
   * Point-in-polygon test using Ray-Casting (Even-Odd rule) with optional edge tolerance.
   * Works for both convex and concave polygons of any vertex count.
   * @param u Normalized image-space X (0..1).
   * @param v Normalized image-space Y (0..1).
   * @param tolerance Optional distance buffer (in the same 0..1 units) for seamless transitions
   * between adjoining zones.
   */
  public containsPoint(u: number, v: number, tolerance: number = 0.0): boolean {
    const pts = this.points;
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const ui = pts[i]!.u;
      const vi = pts[i]!.v;
      const uj = pts[j]!.u;
      const vj = pts[j]!.v;

      const intersect = vi > v !== vj > v && u < ((uj - ui) * (v - vi)) / (vj - vi) + ui;
      if (intersect) inside = !inside;
    }

    if (inside) return true;

    if (tolerance > 0) {
      for (let i = 0; i < pts.length; i++) {
        const p1 = pts[i]!;
        const p2 = pts[(i + 1) % pts.length]!;
        const dSq = this._distToSegmentSquared(u, v, p1.u, p1.v, p2.u, p2.v);
        if (dSq <= tolerance * tolerance) return true;
      }
    }

    return false;
  }

  private _closestPointOnSegment(
    pu: number,
    pv: number,
    u1: number,
    v1: number,
    u2: number,
    v2: number,
  ): { u: number; v: number } {
    const l2 = (u2 - u1) * (u2 - u1) + (v2 - v1) * (v2 - v1);
    if (l2 === 0) return { u: u1, v: v1 };
    let t = ((pu - u1) * (u2 - u1) + (pv - v1) * (v2 - v1)) / l2;
    t = Math.max(0, Math.min(1, t));
    return { u: u1 + t * (u2 - u1), v: v1 + t * (v2 - v1) };
  }

  private _distToSegmentSquared(
    pu: number,
    pv: number,
    u1: number,
    v1: number,
    u2: number,
    v2: number,
  ): number {
    const proj = this._closestPointOnSegment(pu, pv, u1, v1, u2, v2);
    return (pu - proj.u) * (pu - proj.u) + (pv - proj.v) * (pv - proj.v);
  }

  /**
   * Returns the closest point to (u, v) that actually lies on this zone's polygon -- itself if
   * already inside, otherwise the nearest point on its perimeter. Used to pin a character to a
   * zone's drawn boundary instead of letting it linger at a coordinate just outside every zone
   * (which `containsPoint`'s edge tolerance alone would otherwise allow).
   */
  public clampToPolygon(u: number, v: number): { u: number; v: number } {
    if (this.containsPoint(u, v)) return { u, v };

    const pts = this.points;
    let bestDistSq = Infinity;
    let best = { u, v };
    for (let i = 0; i < pts.length; i++) {
      const p1 = pts[i]!;
      const p2 = pts[(i + 1) % pts.length]!;
      const proj = this._closestPointOnSegment(u, v, p1.u, p1.v, p2.u, p2.v);
      const dSq = (u - proj.u) * (u - proj.u) + (v - proj.v) * (v - proj.v);
      if (dSq < bestDistSq) {
        bestDistSq = dSq;
        best = proj;
      }
    }
    return best;
  }

  /**
   * Interpolates the character scale factor at given (u, v) coordinates using either the
   * continuous gradient field (if configured) or barycentric interpolation across the polygon's
   * triangulated interior.
   */
  public getScaleAt(u: number, v: number): number {
    if (this.scaleGradient) {
      return StageZone._evaluateGradient(u, v, this.scaleGradient);
    }

    const pts = this.points;
    const triangles = this.triangles;

    for (const [i0, i1, i2] of triangles) {
      const scale = this._barycentricScale(pts[i0]!, pts[i1]!, pts[i2]!, u, v);
      if (scale !== null) return scale;
    }

    // Try clamped position on polygon boundary before falling back to flat average
    const clamped = this.clampToPolygon(u, v);
    if (clamped.u !== u || clamped.v !== v) {
      for (const [i0, i1, i2] of triangles) {
        const scale = this._barycentricScale(pts[i0]!, pts[i1]!, pts[i2]!, clamped.u, clamped.v);
        if (scale !== null) return scale;
      }
    }

    // Fallback: average across every corner (point outside polygon)
    let sum = 0;
    for (const p of pts) sum += p.scale;
    return sum / pts.length;
  }

  /**
   * Derives this zone's local movement basis at a given (u, v) position: `forward` is the
   * direction in which the interpolated `scale` (see `getScaleAt`) decreases fastest -- i.e.
   * "deeper into the painted background" -- and `right` is a 90-degree clockwise rotation in screen
   * space (+u right, +v down). A zone traced onto a perspective background is rarely axis-aligned,
   * so character input (WASD) must be mapped through this basis instead of fixed screen axes.
   *
   * For existing 4-point quads without an explicit `scaleGradient` or `useScaleGradient: true`,
   * this retains the legacy corner-pair basis (forward from edge P0-P1 toward P3-P2, right from
   * edge P0-P3 toward P1-P2) for byte-identical behavior across existing scenes. Polygons with
   * n!=4 or explicit gradient configuration derive their axes directly from the continuous scale
   * gradient field or the local triangle gradient.
   */
  public getLocalAxes(
    u: number,
    v: number,
  ): { forward: { u: number; v: number }; right: { u: number; v: number } } {
    if (this.scaleGradient) {
      if (this.scaleGradient.mode === "vanishing-point") {
        const { vanishingPoint, reference, vanishingScale = 0 } = this.scaleGradient;
        const ds = reference.scale - vanishingScale;
        const toVpU = vanishingPoint.u - u;
        const toVpV = vanishingPoint.v - v;
        const dir = ds >= 0 ? 1 : -1;
        const forward = StageZone._normalize2D(dir * toVpU, dir * toVpV, 0, -1);
        return { forward, right: { u: -forward.v, v: forward.u } };
      }

      const { start, end } = this.scaleGradient;
      const du = end.u - start.u;
      const dv = end.v - start.v;
      const ds = end.scale - start.scale;
      if (Math.abs(ds) > 1e-5 && du * du + dv * dv > 1e-8) {
        // ds < 0 means scale decreases from start to end -> forward is (du, dv)
        // ds > 0 means scale decreases from end to start -> forward is (-du, -dv)
        const dir = ds < 0 ? 1 : -1;
        const forward = StageZone._normalize2D(dir * du, dir * dv, 0, -1);
        return { forward, right: { u: -forward.v, v: forward.u } };
      }
      return { forward: { u: 0, v: -1 }, right: { u: 1, v: 0 } };
    }

    const pts = this.points;

    if (pts.length === 4 && !this.useScaleGradient) {
      const [p0, p1, p2, p3] = pts as [
        { u: number; v: number; scale: number },
        { u: number; v: number; scale: number },
        { u: number; v: number; scale: number },
        { u: number; v: number; scale: number },
      ];
      const forwardU = (p3.u - p0.u + (p2.u - p1.u)) * 0.5;
      const forwardV = (p3.v - p0.v + (p2.v - p1.v)) * 0.5;
      const rightU = (p1.u - p0.u + (p2.u - p3.u)) * 0.5;
      const rightV = (p1.v - p0.v + (p2.v - p3.v)) * 0.5;

      return {
        forward: StageZone._normalize2D(forwardU, forwardV, 0, -1),
        right: StageZone._normalize2D(rightU, rightV, 1, 0),
      };
    }

    const triangles = this.triangles;
    for (const [i0, i1, i2] of triangles) {
      const gradient = this._gradientForTriangle(pts[i0]!, pts[i1]!, pts[i2]!, u, v);
      if (gradient) {
        const forward = StageZone._normalize2D(-gradient.gu, -gradient.gv, 0, -1);
        return { forward, right: { u: -forward.v, v: forward.u } };
      }
    }

    const clamped = this.clampToPolygon(u, v);
    if (clamped.u !== u || clamped.v !== v) {
      for (const [i0, i1, i2] of triangles) {
        const gradient = this._gradientForTriangle(
          pts[i0]!,
          pts[i1]!,
          pts[i2]!,
          clamped.u,
          clamped.v,
        );
        if (gradient) {
          const forward = StageZone._normalize2D(-gradient.gu, -gradient.gv, 0, -1);
          return { forward, right: { u: -forward.v, v: forward.u } };
        }
      }
    }

    return { forward: { u: 0, v: -1 }, right: { u: 1, v: 0 } };
  }

  private static _normalize2D(
    u: number,
    v: number,
    fallbackU: number,
    fallbackV: number,
  ): { u: number; v: number } {
    const len = Math.sqrt(u * u + v * v);
    if (len < 0.00001) return { u: fallbackU, v: fallbackV };
    return { u: u / len, v: v / len };
  }

  /**
   * Barycentric weights of (pu, pv) with respect to triangle (a, b, c), or `null` if the
   * triangle is degenerate or the point falls outside it (with a small tolerance for points
   * right on an edge).
   */
  private _baryWeights(
    a: { u: number; v: number },
    b: { u: number; v: number },
    c: { u: number; v: number },
    pu: number,
    pv: number,
  ): { w1: number; w2: number; w3: number } | null {
    const det = (b.v - c.v) * (a.u - c.u) + (c.u - b.u) * (a.v - c.v);
    if (Math.abs(det) < 0.00001) return null;

    const w1 = ((b.v - c.v) * (pu - c.u) + (c.u - b.u) * (pv - c.v)) / det;
    const w2 = ((c.v - a.v) * (pu - c.u) + (a.u - c.u) * (pv - c.v)) / det;
    const w3 = 1.0 - w1 - w2;

    if (w1 >= -0.01 && w2 >= -0.01 && w3 >= -0.01) return { w1, w2, w3 };
    return null;
  }

  private _barycentricScale(
    a: { u: number; v: number; scale: number },
    b: { u: number; v: number; scale: number },
    c: { u: number; v: number; scale: number },
    pu: number,
    pv: number,
  ): number | null {
    const w = this._baryWeights(a, b, c, pu, pv);
    if (!w) return null;
    return w.w1 * a.scale + w.w2 * b.scale + w.w3 * c.scale;
  }

  /**
   * Gradient of the linear `scale` field across triangle (a, b, c), evaluated only when (pu, pv)
   * actually falls inside that triangle -- `null` otherwise, or when the gradient is degenerate
   * (zero-area triangle, or a near-zero gradient such as a uniformly-scaled zone).
   */
  private _gradientForTriangle(
    a: { u: number; v: number; scale: number },
    b: { u: number; v: number; scale: number },
    c: { u: number; v: number; scale: number },
    pu: number,
    pv: number,
  ): { gu: number; gv: number } | null {
    if (!this._baryWeights(a, b, c, pu, pv)) return null;

    const e1u = b.u - a.u;
    const e1v = b.v - a.v;
    const e2u = c.u - a.u;
    const e2v = c.v - a.v;
    const d1 = b.scale - a.scale;
    const d2 = c.scale - a.scale;

    const det = e1u * e2v - e1v * e2u;
    if (Math.abs(det) < 0.00001) return null;

    const gu = (d1 * e2v - d2 * e1v) / det;
    const gv = (e1u * d2 - e2u * d1) / det;
    if (Math.sqrt(gu * gu + gv * gv) < 0.00001) return null;

    return { gu, gv };
  }
}
