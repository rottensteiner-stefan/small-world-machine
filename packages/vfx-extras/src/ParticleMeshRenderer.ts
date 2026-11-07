import type {
  GeometryDataInterface,
  AbstractMaterial,
  Vector3D,
} from "@small-world-machine/engine";
import { InstancedMesh, Plane } from "@small-world-machine/engine";
import type { ParticleSystem } from "./ParticleSystem.js";
import { createOctagonBillboardGeometry } from "./geometry/OctagonBillboardGeometry.js";

/**
 * Per-instance facing mode for particle billboards.
 * - `none`: keeps authored orientation (identity).
 * - `yaw`: rotates only around world +Y to face the camera horizontally.
 * - `spherical`: rotates in both yaw and pitch to face the camera dead-on.
 * - `velocityStretched`: aligns local +Y with the particle velocity vector, stretches along +Y by
 *   `1 + speed * stretchFactor`, and rotates around the velocity axis to face the camera.
 */
export type ParticleBillboardMode = "none" | "yaw" | "spherical" | "velocityStretched";

export interface ParticleMeshRendererOptions {
  /** Name of the underlying InstancedMesh. Defaults to "ParticleMeshRenderer". */
  name?: string;
  /** The ParticleSystem driving the simulation. */
  system: ParticleSystem;
  /**
   * Shared instanced geometry for every particle (e.g. low-poly Sphere, Quad, Cube).
   * If omitted, built automatically from `geometryMode` (defaults to `"quad"`).
   */
  geometry?: GeometryDataInterface;
  /**
   * Built-in billboard geometry preset when `geometry` is omitted (or when `"octagon"` is selected
   * to trim transparent quad corners).
   * @domain `"quad"` | `"octagon"` — defaults to `"quad"`.
   */
  geometryMode?: "quad" | "octagon";
  /** Shared material for the instanced mesh. */
  material: AbstractMaterial;
  /** If true, writes per-instance RGBA color (r, g, b, a) into the instance color buffer. Defaults to true. */
  enableColorBuffer?: boolean;
  /**
   * How live particle quads face the camera. CPU-side look-at per instance (the same math as the
   * engine's `BillboardInstancer`): the engine `isSprite` billboard path never runs on instanced
   * draws. `yaw` rotates only around +Y, `spherical` also pitches to stay dead-on, and
   * `velocityStretched` aligns +Y with the velocity vector. Defaults to `none`. Requires passing a
   * camera position to {@link ParticleMeshRenderer.sync}.
   */
  billboard?: ParticleBillboardMode | undefined;
  /**
   * Velocity elongation factor for `billboard: "velocityStretched"`. Scale along the velocity axis
   * is `size * (1 + speed * stretchFactor)`.
   * @domain [0, Infinity) — defaults to 0.15 when `billboard === "velocityStretched"`, else 0.
   */
  stretchFactor?: number | undefined;
  /**
   * Whether the per-particle alpha is folded into the instance scale (default `true`, embers erode
   * away as they fade). Set `false` when the material itself consumes the instance alpha as
   * opacity (e.g. alpha-blended smoke): the quad then keeps its authored size and only fades.
   * Existing callers are unaffected.
   */
  foldAlphaIntoScale?: boolean | undefined;
}

/**
 * High-performance rendering bridge connecting a ParticleSystem to an InstancedMesh.
 * Synchronizes particle positions, scales, and colors into GPU buffers in a single draw call,
 * reading straight out of the system's SoA arrays (no per-particle objects).
 */
export class ParticleMeshRenderer {
  public readonly mesh: InstancedMesh;
  public readonly system: ParticleSystem;

  private readonly _enableColorBuffer: boolean;
  private readonly _billboard: Exclude<ParticleBillboardMode, "none"> | undefined;
  private readonly _stretchFactor: number;
  private readonly _foldAlphaIntoScale: boolean;
  private _prevLiveCount = 0;

  constructor(options: ParticleMeshRendererOptions) {
    this.system = options.system;
    const resolvedGeometry =
      options.geometry ??
      (options.geometryMode === "octagon"
        ? createOctagonBillboardGeometry()
        : new Plane({ width: 1, height: 1 }).getGeometryData());
    this.mesh = new InstancedMesh(
      options.name ?? "ParticleMeshRenderer",
      resolvedGeometry,
      options.material,
      this.system.capacity,
    );
    // Zero-initialize matrix slots once up front so unwritten/dead tail slots never hold the
    // constructor's default identity matrices.
    this.mesh.instanceMatrices.fill(0);
    this._enableColorBuffer = options.enableColorBuffer ?? true;
    this._foldAlphaIntoScale = options.foldAlphaIntoScale ?? true;
    this._billboard =
      options.billboard === undefined || options.billboard === "none"
        ? undefined
        : options.billboard;
    this._stretchFactor = Math.max(
      0,
      options.stretchFactor ?? (this._billboard === "velocityStretched" ? 0.15 : 0),
    );
    if (this._enableColorBuffer) {
      this.mesh.initInstanceData(4); // r, g, b, a
      // The instance-data buffer carries RGBA color here, so the renderers compile an instance-color
      // variant and the base shaders tint the surface with it (see InstancedMesh.useInstanceDataAsColor).
      this.mesh.useInstanceDataAsColor = true;
    }
  }

  /**
   * Synchronizes live particle transforms and colors into a compacted `0..liveCount` prefix of the
   * GPU instance buffers and sets `mesh.instanceCount = liveCount`. Zero allocation: writes matrix
   * basis vectors directly in-place without trigonometric (`atan2`/`sin`/`cos`) calls.
   * @param cameraPosition World position of the camera; only used for billboard modes.
   */
  public sync(cameraPosition?: Vector3D): void {
    const arrays = this.system.arrays;
    const capacity = this.system.capacity;

    const matrices = this.mesh.instanceMatrices;
    const instanceData = this.mesh.instanceData;
    const writeColor = instanceData !== undefined && this._enableColorBuffer;
    const foldAlpha = this._foldAlphaIntoScale;
    const stretchFactor = this._stretchFactor;

    const billboard = this._billboard;
    const camX = billboard ? cameraPosition?.x : undefined;
    const camY = billboard ? cameraPosition?.y : undefined;
    const camZ = billboard ? cameraPosition?.z : undefined;
    const hasCamera =
      billboard !== undefined && camX !== undefined && camY !== undefined && camZ !== undefined;

    let liveCount = 0;

    for (let i = 0; i < capacity; i++) {
      if (arrays.aliveFlags[i] !== 1) continue;
      const alpha = arrays.alphas[i]!;
      if (alpha <= 0.001) continue;

      const offset16 = liveCount * 16;
      const o = i * 3;
      const px = arrays.positions[o]!;
      const py = arrays.positions[o + 1]!;
      const pz = arrays.positions[o + 2]!;
      const s = foldAlpha ? arrays.sizes[i]! * alpha : arrays.sizes[i]!;

      if (hasCamera) {
        const dx = camX - px;
        const dy = camY - py;
        const dz = camZ - pz;

        if (billboard === "velocityStretched") {
          const vx = arrays.velocities[o]!;
          const vy = arrays.velocities[o + 1]!;
          const vz = arrays.velocities[o + 2]!;
          const speed = Math.hypot(vx, vy, vz);

          if (speed > 1e-5) {
            const invSpeed = 1 / speed;
            // Local +Y (up) = normalized velocity vector
            const ux = vx * invSpeed;
            const uy = vy * invSpeed;
            const uz = vz * invSpeed;

            // Local +X (right) = normalize(up x toCamera)
            let rx = uy * dz - uz * dy;
            let ry = uz * dx - ux * dz;
            let rz = ux * dy - uy * dx;
            const rLen = Math.hypot(rx, ry, rz);
            if (rLen > 1e-5) {
              const invR = 1 / rLen;
              rx *= invR;
              ry *= invR;
              rz *= invR;
            } else {
              // Fallback orthogonal basis when velocity points directly along camera line-of-sight
              if (Math.abs(uy) < 0.999) {
                const fl = Math.hypot(uz, -ux);
                rx = uz / fl;
                ry = 0;
                rz = -ux / fl;
              } else {
                rx = 1;
                ry = 0;
                rz = 0;
              }
            }

            // Local +Z (forward) = right x up
            const fx = ry * uz - rz * uy;
            const fy = rz * ux - rx * uz;
            const fz = rx * uy - ry * ux;

            const sy = s * (1 + speed * stretchFactor);

            matrices[offset16] = rx * s;
            matrices[offset16 + 1] = ry * s;
            matrices[offset16 + 2] = rz * s;
            matrices[offset16 + 3] = 0;

            matrices[offset16 + 4] = ux * sy;
            matrices[offset16 + 5] = uy * sy;
            matrices[offset16 + 6] = uz * sy;
            matrices[offset16 + 7] = 0;

            matrices[offset16 + 8] = fx * s;
            matrices[offset16 + 9] = fy * s;
            matrices[offset16 + 10] = fz * s;
            matrices[offset16 + 11] = 0;
          } else {
            // Stationary fallback: spherical facing
            const xz = Math.hypot(dx, dz);
            const sY = xz > 0 ? dx / xz : 0;
            const cY = xz > 0 ? dz / xz : 1;
            const dist = Math.hypot(xz, dy);
            const sX = dist > 0 ? -dy / dist : 0;
            const cX = dist > 0 ? xz / dist : 1;

            matrices[offset16] = cY * s;
            matrices[offset16 + 1] = 0;
            matrices[offset16 + 2] = -sY * s;
            matrices[offset16 + 3] = 0;

            matrices[offset16 + 4] = sY * sX * s;
            matrices[offset16 + 5] = cX * s;
            matrices[offset16 + 6] = cY * sX * s;
            matrices[offset16 + 7] = 0;

            matrices[offset16 + 8] = sY * cX * s;
            matrices[offset16 + 9] = -sX * s;
            matrices[offset16 + 10] = cY * cX * s;
            matrices[offset16 + 11] = 0;
          }
        } else {
          const xz = Math.hypot(dx, dz);
          const sY = xz > 0 ? dx / xz : 0;
          const cY = xz > 0 ? dz / xz : 1;

          if (billboard === "spherical") {
            const dist = Math.hypot(xz, dy);
            const sX = dist > 0 ? -dy / dist : 0;
            const cX = dist > 0 ? xz / dist : 1;

            matrices[offset16] = cY * s;
            matrices[offset16 + 1] = 0;
            matrices[offset16 + 2] = -sY * s;
            matrices[offset16 + 3] = 0;

            matrices[offset16 + 4] = sY * sX * s;
            matrices[offset16 + 5] = cX * s;
            matrices[offset16 + 6] = cY * sX * s;
            matrices[offset16 + 7] = 0;

            matrices[offset16 + 8] = sY * cX * s;
            matrices[offset16 + 9] = -sX * s;
            matrices[offset16 + 10] = cY * cX * s;
            matrices[offset16 + 11] = 0;
          } else {
            matrices[offset16] = cY * s;
            matrices[offset16 + 1] = 0;
            matrices[offset16 + 2] = -sY * s;
            matrices[offset16 + 3] = 0;

            matrices[offset16 + 4] = 0;
            matrices[offset16 + 5] = s;
            matrices[offset16 + 6] = 0;
            matrices[offset16 + 7] = 0;

            matrices[offset16 + 8] = sY * s;
            matrices[offset16 + 9] = 0;
            matrices[offset16 + 10] = cY * s;
            matrices[offset16 + 11] = 0;
          }
        }
      } else {
        matrices[offset16] = s;
        matrices[offset16 + 1] = 0;
        matrices[offset16 + 2] = 0;
        matrices[offset16 + 3] = 0;

        matrices[offset16 + 4] = 0;
        matrices[offset16 + 5] = s;
        matrices[offset16 + 6] = 0;
        matrices[offset16 + 7] = 0;

        matrices[offset16 + 8] = 0;
        matrices[offset16 + 9] = 0;
        matrices[offset16 + 10] = s;
        matrices[offset16 + 11] = 0;
      }

      matrices[offset16 + 12] = px;
      matrices[offset16 + 13] = py;
      matrices[offset16 + 14] = pz;
      matrices[offset16 + 15] = 1;

      if (writeColor) {
        const src4 = i * 4;
        const dst4 = liveCount * 4;
        instanceData[dst4] = arrays.colors[src4]!;
        instanceData[dst4 + 1] = arrays.colors[src4 + 1]!;
        instanceData[dst4 + 2] = arrays.colors[src4 + 2]!;
        instanceData[dst4 + 3] = alpha;
      }

      liveCount++;
    }

    if (liveCount < this._prevLiveCount) {
      matrices.fill(0, liveCount * 16, this._prevLiveCount * 16);
    }
    this._prevLiveCount = liveCount;
    this.mesh.instanceCount = liveCount;

    this.mesh.instanceMatrixNeedsUpdate = true;
    if (writeColor) {
      this.mesh.instanceDataNeedsUpdate = true;
    }
  }
}
