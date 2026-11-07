import type { Vector3D } from "@small-world-machine/engine";
import type { ParticleArrays } from "../Particle.js";
import type { ParticleAffector } from "../ParticleAffector.js";

/** Maximum number of analytical SDF primitives evaluated per `SdfColliderAffector`. */
export const MAX_SDF_PRIMITIVES = 16;

/**
 * Analytical Signed Distance Field (SDF) primitive descriptor (Inigo Quilez distance functions).
 */
export type SdfPrimitive =
  | {
      readonly type: "sphere";
      /** @domain Sphere center in world space (meters). */
      readonly center: Vector3D;
      /** @domain [0, Infinity) — Sphere radius in meters. */
      readonly radius: number;
    }
  | {
      readonly type: "box";
      /** @domain Box center in world space (meters). */
      readonly center: Vector3D;
      /** @domain Box half-extents (hx, hy, hz) in meters; non-negative. */
      readonly halfExtents: Vector3D;
      /** @domain [0, Infinity) — Optional corner rounding radius in meters; defaults to 0. */
      readonly roundRadius?: number;
    }
  | {
      readonly type: "capsule";
      /** @domain First capsule segment endpoint in world space (meters). */
      readonly a: Vector3D;
      /** @domain Second capsule segment endpoint in world space (meters). */
      readonly b: Vector3D;
      /** @domain [0, Infinity) — Capsule radius in meters. */
      readonly radius: number;
    }
  | {
      readonly type: "plane";
      /** @domain Unit plane normal pointing into the allowed half-space. */
      readonly normal: Vector3D;
      /** @domain Plane offset `d` such that `dot(normal, p) - offset = 0` is the surface. */
      readonly offset: number;
    };

/**
 * Callback or ring-buffer sink notified when a particle collides with the SDF surface.
 * All arguments are primitive numbers so zero heap objects are allocated on the hot path.
 */
export type SdfCollisionCallback = (
  slotIndex: number,
  px: number,
  py: number,
  pz: number,
  nx: number,
  ny: number,
  nz: number,
  impactSpeed: number,
) => void;

export interface SdfColliderAffectorOptions {
  /**
   * Up to {@link MAX_SDF_PRIMITIVES} analytical SDF primitives forming the collision volume.
   * @domain 1..16 primitives.
   */
  primitives: readonly SdfPrimitive[];
  /**
   * Polynomial smooth-minimum (`smin`) blend radius in meters between primitives (Quilez 2013).
   * `0` uses exact sharp union `min(d1, d2)`.
   * @domain [0, Infinity) — defaults to 0.
   */
  smoothRadius?: number;
  /**
   * Coefficient of normal restitution (`0` = inelastic slide, `1` = perfectly elastic bounce).
   * @domain [0, 1] — defaults to 0.5.
   */
  restitution?: number;
  /**
   * Tangential surface friction factor (`0` = frictionless, `1` = full tangential stop on contact).
   * @domain [0, 1] — defaults to 0.15.
   */
  friction?: number;
  /**
   * Fixed collision shell radius added around every particle center in meters.
   * @domain [0, Infinity) — defaults to 0.
   */
  particleRadius?: number;
  /**
   * Optional multiplier folding each particle's `sizes[i]` into its collision shell radius
   * (`effectiveRadius = particleRadius + sizeRadiusScale * sizes[i]`).
   * @domain [0, Infinity) — defaults to 0.
   */
  sizeRadiusScale?: number;
  /**
   * Optional zero-allocation callback invoked on impact (e.g. to feed a `SubEmitter` ring buffer).
   */
  onCollision?: SdfCollisionCallback;
}

const TETRA_EPS = 1e-4;

/**
 * Evaluates a single analytical SDF primitive at `(px, py, pz)` without allocations.
 */
export function evaluateSdfPrimitive(
  prim: SdfPrimitive,
  px: number,
  py: number,
  pz: number,
): number {
  switch (prim.type) {
    case "sphere": {
      const dx = px - prim.center.x;
      const dy = py - prim.center.y;
      const dz = pz - prim.center.z;
      return Math.hypot(dx, dy, dz) - prim.radius;
    }
    case "box": {
      const r = prim.roundRadius ?? 0;
      const qx = Math.abs(px - prim.center.x) - prim.halfExtents.x;
      const qy = Math.abs(py - prim.center.y) - prim.halfExtents.y;
      const qz = Math.abs(pz - prim.center.z) - prim.halfExtents.z;
      const ox = Math.max(qx, 0);
      const oy = Math.max(qy, 0);
      const oz = Math.max(qz, 0);
      const outside = Math.hypot(ox, oy, oz);
      const inside = Math.min(Math.max(qx, qy, qz), 0);
      return outside + inside - r;
    }
    case "capsule": {
      const pax = px - prim.a.x;
      const pay = py - prim.a.y;
      const paz = pz - prim.a.z;
      const bax = prim.b.x - prim.a.x;
      const bay = prim.b.y - prim.a.y;
      const baz = prim.b.z - prim.a.z;
      const baba = bax * bax + bay * bay + baz * baz;
      const h = baba > 0 ? Math.max(0, Math.min(1, (pax * bax + pay * bay + paz * baz) / baba)) : 0;
      const dx = pax - bax * h;
      const dy = pay - bay * h;
      const dz = paz - baz * h;
      return Math.hypot(dx, dy, dz) - prim.radius;
    }
    case "plane": {
      const nx = prim.normal.x;
      const ny = prim.normal.y;
      const nz = prim.normal.z;
      const len = Math.hypot(nx, ny, nz);
      if (len <= 0) return Infinity;
      return (nx * px + ny * py + nz * pz) / len - prim.offset;
    }
  }
}

/**
 * Quadratic polynomial smooth minimum (`smin`, Inigo Quilez 2013).
 */
export function sdfSmoothMin(a: number, b: number, k: number): number {
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

/**
 * Analytical SDF collision affector. Evaluates a composite signed distance field of up to 16
 * primitives (`sphere`, `box`, `capsule`, `plane`) with optional `smin` blending and resolves
 * penetrations in `postIntegrate` with restitution and tangential friction.
 *
 * @invariant SDF-NON-PENETRATION — After `postIntegrate`, every live particle satisfies
 * `evaluate(p) >= effectiveRadius - 1e-4`, and post-impact speed never exceeds pre-impact speed
 * for `restitution <= 1` and `friction >= 0`.
 */
export class SdfColliderAffector implements ParticleAffector {
  public readonly primitives: readonly SdfPrimitive[];
  public smoothRadius: number;
  public restitution: number;
  public friction: number;
  public particleRadius: number;
  public sizeRadiusScale: number;
  public onCollision: SdfCollisionCallback | undefined;

  // Scratch normal components and gradient magnitude (zero-allocation tetrahedral stencil).
  private _nx = 0;
  private _ny = 1;
  private _nz = 0;
  private _gradMag = 1;

  constructor(options: SdfColliderAffectorOptions) {
    if (options.primitives.length > MAX_SDF_PRIMITIVES) {
      throw new Error(
        `[SdfColliderAffector] Exceeded MAX_SDF_PRIMITIVES (${MAX_SDF_PRIMITIVES}): got ${options.primitives.length}.`,
      );
    }
    this.primitives = options.primitives.slice(0, MAX_SDF_PRIMITIVES);
    this.smoothRadius = Math.max(0, options.smoothRadius ?? 0);
    this.restitution = Math.max(0, Math.min(1, options.restitution ?? 0.5));
    this.friction = Math.max(0, Math.min(1, options.friction ?? 0.15));
    this.particleRadius = Math.max(0, options.particleRadius ?? 0);
    this.sizeRadiusScale = Math.max(0, options.sizeRadiusScale ?? 0);
    this.onCollision = options.onCollision;
  }

  /**
   * Evaluates the composite signed distance field at `(px, py, pz)` in world space.
   */
  public evaluate(px: number, py: number, pz: number): number {
    const prims = this.primitives;
    const n = prims.length;
    if (n === 0) return Infinity;
    let d = evaluateSdfPrimitive(prims[0]!, px, py, pz);
    const k = this.smoothRadius;
    for (let i = 1; i < n; i++) {
      const di = evaluateSdfPrimitive(prims[i]!, px, py, pz);
      d = k > 0 ? sdfSmoothMin(d, di, k) : Math.min(d, di);
    }
    return d;
  }

  /**
   * Computes the unit surface normal `∇φ(p)` into `this._nx, this._ny, this._nz` using the 4-tap
   * tetrahedral central-difference stencil (Quilez) with fallback for degenerate origins.
   */
  private _computeNormal(px: number, py: number, pz: number): void {
    const e = TETRA_EPS;
    // Tetrahedral vertices: k0=(1,-1,-1), k1=(-1,-1,1), k2=(-1,1,-1), k3=(1,1,1)
    const d0 = this.evaluate(px + e, py - e, pz - e);
    const d1 = this.evaluate(px - e, py - e, pz + e);
    const d2 = this.evaluate(px - e, py + e, pz - e);
    const d3 = this.evaluate(px + e, py + e, pz + e);

    const gx = d0 - d1 - d2 + d3;
    const gy = -d0 - d1 + d2 + d3;
    const gz = -d0 + d1 - d2 + d3;
    const len = Math.hypot(gx, gy, gz);
    if (len > 1e-12) {
      this._nx = gx / len;
      this._ny = gy / len;
      this._nz = gz / len;
      // In tetrahedral stencil, |g| = 4 * e * |∇φ|
      this._gradMag = Math.max(0.25, len / (4 * e));
    } else {
      this._nx = 0;
      this._ny = 1;
      this._nz = 0;
      this._gradMag = 1;
    }
  }

  /**
   * Force pass is a no-op because collision push-out and velocity reflection run in `postIntegrate`
   * after `ParticleSystem.update` has integrated the frame's positions.
   */
  public apply(_arrays: ParticleArrays, _index: number, _dt: number): void {
    // Handled in postIntegrate.
  }

  public applyBatch(_arrays: ParticleArrays, _count: number, _dt: number): void {
    // Handled in postIntegrate.
  }

  /**
   * Resolves SDF penetrations and reflects inward velocities after Euler integration.
   */
  public postIntegrate(arrays: ParticleArrays, count: number, _dt: number): void {
    if (this.primitives.length === 0) return;

    const positions = arrays.positions;
    const velocities = arrays.velocities;
    const sizes = arrays.sizes;
    const alive = arrays.aliveFlags;
    const baseRadius = this.particleRadius;
    const sizeScale = this.sizeRadiusScale;
    const restitution = this.restitution;
    const friction = this.friction;
    const onCollision = this.onCollision;

    for (let i = 0; i < count; i++) {
      if (alive[i] === 0) continue;

      const o = i * 3;
      let px = positions[o]!;
      let py = positions[o + 1]!;
      let pz = positions[o + 2]!;

      const rEff = baseRadius + sizeScale * sizes[i]!;
      const sdf = this.evaluate(px, py, pz);
      const pen = sdf - rEff;

      if (pen < 0) {
        this._computeNormal(px, py, pz);
        const nx = this._nx;
        const ny = this._ny;
        const nz = this._nz;

        // Newton step along ∇φ / |∇φ|² so smooth-union (smin) fillets where |∇φ| < 1 still reach
        // the exact φ(p) = rEff isosurface within 1–3 steps.
        let curPen = pen;
        for (let iter = 0; iter < 3 && curPen < -1e-5; iter++) {
          if (iter > 0) {
            this._computeNormal(px, py, pz);
          }
          const step = (curPen - 1e-5) / this._gradMag;
          px -= step * this._nx;
          py -= step * this._ny;
          pz -= step * this._nz;
          curPen = this.evaluate(px, py, pz) - rEff;
        }

        positions[o] = px;
        positions[o + 1] = py;
        positions[o + 2] = pz;

        const vx = velocities[o]!;
        const vy = velocities[o + 1]!;
        const vz = velocities[o + 2]!;
        const vn = vx * nx + vy * ny + vz * nz;

        if (vn < 0) {
          // Decompose velocity into normal (vn * n) and tangential (v - vn * n) components.
          const vnx = vn * nx;
          const vny = vn * ny;
          const vnz = vn * nz;
          const vtx = vx - vnx;
          const vty = vy - vny;
          const vtz = vz - vnz;

          const tangScale = 1 - friction;
          velocities[o] = vtx * tangScale - restitution * vnx;
          velocities[o + 1] = vty * tangScale - restitution * vny;
          velocities[o + 2] = vtz * tangScale - restitution * vnz;

          if (onCollision !== undefined) {
            onCollision(i, px, py, pz, nx, ny, nz, -vn);
          }
        }
      }
    }
  }
}
