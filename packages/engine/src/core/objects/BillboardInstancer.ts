import { Camera } from "../cameras/Camera.js";
import { InstancedMesh } from "../InstancedMesh.js";
import { AbstractMaterial, StandardMaterial } from "../materials/index.js";
import { Color } from "../colors/index.js";
import { Plane } from "../../geometry/index.js";
import { Matrix4, Vector3D } from "../../math/index.js";
import { GeometryDataInterface } from "../../interfaces/index.js";

export interface BillboardScatterArea {
  width: number;
  depth: number;
  center?: Vector3D;
}

export interface BillboardInstancerOptions {
  /** Fixed instance pool size. Ignored (set to `positions.length`) when `positions` is given. Defaults to 300. */
  count?: number;
  /** Explicit world-space placement, one entry per instance. Takes precedence over `scatterArea`. */
  positions?: Vector3D[];
  /** Random placement within a flat rectangle, used when `positions` is omitted. */
  scatterArea?: BillboardScatterArea;
  /** [min, max] uniform quad scale. Defaults to [0.6, 1.2]. */
  size?: [number, number];
  /** Only yaw (Y-axis) rotates to face the camera -- vegetation doesn't tilt with camera pitch.
   * Defaults to true. `false` gives a fully spherical (always dead-on) billboard. */
  axisLocked?: boolean;
  /** Instanced quad geometry, shared by every instance. Defaults to a unit `Plane`. */
  geometry?: GeometryDataInterface;
  /** Instanced material, shared by every instance. Defaults to a transparent, faintly green StandardMaterial. */
  material?: AbstractMaterial;
}

const DEFAULT_COUNT = 300;
const DEFAULT_SIZE: [number, number] = [0.6, 1.2];

function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/**
 * A reusable, `InstancedMesh`-backed field of camera-facing billboard quads (grass, foliage,
 * crowds -- the "Unreal/Fortnite tree" pattern). Billboard-facing happens entirely CPU-side, per
 * instance, by writing a look-at rotation directly into that instance's slot of the shared
 * `InstancedMesh` matrix buffer -- the engine's existing `isSprite` billboard path never runs on
 * the instanced draw path (it's a separate, non-instanced-only code path), so this reimplements
 * the same "face the camera" math at the instance-matrix level instead, needing zero renderer
 * changes.
 */
export class BillboardInstancer {
  public readonly mesh: InstancedMesh;

  private readonly _axisLocked: boolean;
  private readonly _positions: Float32Array;
  private readonly _scales: Float32Array;

  private readonly _scratchPos = new Vector3D();
  private readonly _scratchRot = new Vector3D();
  private readonly _scratchScale = new Vector3D();
  private readonly _scratchMatrix = new Matrix4();

  constructor(name: string, options: BillboardInstancerOptions) {
    this._axisLocked = options.axisLocked ?? true;

    const positions = options.positions;
    const count = positions ? positions.length : (options.count ?? DEFAULT_COUNT);
    const sizeRange = options.size ?? DEFAULT_SIZE;

    const geometry = options.geometry ?? new Plane({ width: 1, height: 1 }).getGeometryData();
    const material =
      options.material ??
      new StandardMaterial({
        color: new Color(0.3, 0.45, 0.22),
        roughness: 0.85,
        metallic: 0.0,
        transparent: true,
        alphaTest: 0.3,
      });

    this.mesh = new InstancedMesh(name, geometry, material, count);

    this._positions = new Float32Array(count * 3);
    this._scales = new Float32Array(count);

    if (positions) {
      for (let i = 0; i < count; i++) {
        const p = positions[i]!;
        this._positions[i * 3 + 0] = p.x;
        this._positions[i * 3 + 1] = p.y;
        this._positions[i * 3 + 2] = p.z;
        this._scales[i] = randRange(sizeRange[0], sizeRange[1]);
      }
    } else {
      const area = options.scatterArea ?? { width: 10, depth: 10 };
      const center = area.center ?? new Vector3D(0, 0, 0);
      for (let i = 0; i < count; i++) {
        this._positions[i * 3 + 0] = center.x + (Math.random() - 0.5) * area.width;
        this._positions[i * 3 + 1] = center.y;
        this._positions[i * 3 + 2] = center.z + (Math.random() - 0.5) * area.depth;
        this._scales[i] = randRange(sizeRange[0], sizeRange[1]);
      }
    }
  }

  public update(camera: Camera): void {
    const camPos = camera.position;
    const camX = camPos.x;
    const camY = camPos.y;
    const camZ = camPos.z;
    const count = this.mesh.instanceCount;
    const positions = this._positions;
    const scales = this._scales;
    const scratchPos = this._scratchPos;
    const scratchRot = this._scratchRot;
    const scratchScale = this._scratchScale;
    const scratchMatrix = this._scratchMatrix;
    const axisLocked = this._axisLocked;

    for (let i = 0; i < count; i++) {
      const idx = i * 3;
      const x = positions[idx + 0]!;
      const y = positions[idx + 1]!;
      const z = positions[idx + 2]!;
      const scale = scales[i]!;

      scratchPos.set(x, y, z);
      scratchScale.set(scale, scale, scale);

      const dx = camX - x;
      const dz = camZ - z;

      if (axisLocked) {
        // Plane geometry lies in the local XY plane, facing +Z (src/geometry/Plane.ts:59) -- the
        // standard yaw-only billboard formula for a +Z-forward quad.
        scratchRot.set(0, Math.atan2(dx, dz), 0);
      } else {
        const dy = camY - y;
        const xzDist = Math.hypot(dx, dz);
        scratchRot.set(-Math.atan2(dy, xzDist), Math.atan2(dx, dz), 0);
      }

      scratchMatrix.compose(scratchPos, scratchRot, scratchScale);
      this.mesh.setMatrixAt(i, scratchMatrix);
    }
    this.mesh.instanceMatrixNeedsUpdate = true;
  }
}
