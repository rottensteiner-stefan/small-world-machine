import { InstancedMesh } from "../../core/InstancedMesh.js";
import type { Object3D } from "../../core/Object3D.js";
import type { AbstractMaterial } from "../../core/materials/index.js";
import { StandardMaterial } from "../../core/materials/index.js";
import { Color } from "../../core/colors/index.js";
import { Sphere } from "../../geometry/index.js";
import { Matrix4, Vector3D } from "../../math/index.js";
import type { GeometryDataInterface } from "../../interfaces/index.js";

export interface WeatherEmitterSpawnArea {
  /** Extent along X, centered on `center.x`. */
  width: number;
  /** Extent along Z, centered on `center.z`. */
  depth: number;
  /** Extent along Y; particles recycle when they fall below `center.y - height / 2`. */
  height: number;
}

export interface WeatherEmitterOptions {
  /** Fixed particle pool size. Defaults to 400. */
  count?: number;
  /** Box within which particles fall and drift. */
  spawnArea: WeatherEmitterSpawnArea;
  /** Center of the spawn box. Defaults to the origin. */
  center?: Vector3D;
  /** [min, max] fall speed in units/second, randomized per particle. Defaults to [0.6, 1.4]. */
  fallSpeed?: [number, number];
  /** Constant horizontal drift (Y component ignored). Defaults to zero. */
  wind?: Vector3D;
  /** Sinusoidal wind amplitude added on top of `wind`, phase-shifted per particle. Defaults to 0. */
  windGustiness?: number;
  /** [min, max] uniform particle scale. Defaults to [0.04, 0.1]. */
  particleSize?: [number, number];
  /** Instanced geometry, shared by every particle. Defaults to a small low-poly sphere (ash flake). */
  geometry?: GeometryDataInterface;
  /** Instanced material, shared by every particle. Defaults to a pale, faintly emissive grey-green. */
  material?: AbstractMaterial;
  /** Randomizes per-particle rotation and lets it tumble slowly as it falls. Defaults to true. */
  tumble?: boolean;
}

const DEFAULT_COUNT = 400;
const DEFAULT_FALL_SPEED: [number, number] = [0.6, 1.4];
const DEFAULT_PARTICLE_SIZE: [number, number] = [0.04, 0.1];

function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/**
 * A reusable, `InstancedMesh`-backed atmospheric particle emitter (falling ash, dust, rain, snow --
 * see `WeatherEmitterOptions`) for a box-shaped volume.
 *
 * Every particle is a fixed slot in parallel `Float32Array` fields (no per-particle objects, no
 * per-frame allocation in `update()`), matching the instanced-pool pattern.
 */
export class WeatherEmitter {
  public readonly mesh: InstancedMesh;

  private readonly _spawnArea: WeatherEmitterSpawnArea;
  private readonly _center: Vector3D;
  private readonly _fallSpeedRange: [number, number];
  private readonly _wind: Vector3D;
  private readonly _windGustiness: number;
  private readonly _tumble: boolean;

  private readonly _positions: Float32Array;
  private readonly _fallSpeeds: Float32Array;
  private readonly _windPhases: Float32Array;
  private readonly _scales: Float32Array;
  private readonly _rotations: Float32Array;
  private readonly _rotationSpeeds: Float32Array;

  private readonly _scratchPos = new Vector3D();
  private readonly _scratchRot = new Vector3D();
  private readonly _scratchScale = new Vector3D();
  private readonly _scratchMatrix = new Matrix4();

  private _time = 0;

  constructor(name: string, options: WeatherEmitterOptions) {
    const count = options.count ?? DEFAULT_COUNT;
    this._spawnArea = options.spawnArea;
    this._center = options.center ?? new Vector3D(0, 0, 0);
    this._fallSpeedRange = options.fallSpeed ?? DEFAULT_FALL_SPEED;
    this._wind = options.wind ?? new Vector3D(0, 0, 0);
    this._windGustiness = options.windGustiness ?? 0;
    this._tumble = options.tumble ?? true;

    const geometry =
      options.geometry ??
      new Sphere({ radius: 1, widthSegments: 5, heightSegments: 4 }).getGeometryData();
    const material =
      options.material ??
      new StandardMaterial({
        color: new Color(0.62, 0.6, 0.52),
        emissiveColor: new Color(0.25, 0.32, 0.18),
        emissiveIntensity: 0.35,
        roughness: 0.9,
        metallic: 0.0,
      });

    this.mesh = new InstancedMesh(name, geometry, material, count);

    this._positions = new Float32Array(count * 3);
    this._fallSpeeds = new Float32Array(count);
    this._windPhases = new Float32Array(count);
    this._scales = new Float32Array(count);
    this._rotations = new Float32Array(count * 3);
    this._rotationSpeeds = new Float32Array(count * 3);

    const sizeRange = options.particleSize ?? DEFAULT_PARTICLE_SIZE;
    for (let i = 0; i < count; i++) {
      this._resetParticle(i, sizeRange, true);
    }
    this._writeAllInstances();
  }

  /** Places particle `i` at a random position inside the spawn box (or, on recycle, back at the
   * top with a fresh X/Z), and rerolls its per-particle fall speed/wind phase/size/rotation. */
  private _resetParticle(i: number, sizeRange: [number, number], initial: boolean): void {
    const { width, depth, height } = this._spawnArea;
    const x = this._center.x + (Math.random() - 0.5) * width;
    const z = this._center.z + (Math.random() - 0.5) * depth;
    const y = initial
      ? this._center.y + (Math.random() - 0.5) * height
      : this._center.y + height / 2;

    this._positions[i * 3 + 0] = x;
    this._positions[i * 3 + 1] = y;
    this._positions[i * 3 + 2] = z;
    this._fallSpeeds[i] = randRange(this._fallSpeedRange[0], this._fallSpeedRange[1]);
    this._windPhases[i] = Math.random() * Math.PI * 2;
    this._scales[i] = randRange(sizeRange[0], sizeRange[1]);

    if (this._tumble) {
      this._rotations[i * 3 + 0] = Math.random() * Math.PI * 2;
      this._rotations[i * 3 + 1] = Math.random() * Math.PI * 2;
      this._rotations[i * 3 + 2] = Math.random() * Math.PI * 2;
      this._rotationSpeeds[i * 3 + 0] = randRange(-0.6, 0.6);
      this._rotationSpeeds[i * 3 + 1] = randRange(-0.6, 0.6);
      this._rotationSpeeds[i * 3 + 2] = randRange(-0.6, 0.6);
    }
  }

  public update(deltaTime: number): void {
    this._time += deltaTime;

    const { width, depth, height } = this._spawnArea;
    const floorY = this._center.y - height / 2;
    const halfWidth = width / 2;
    const halfDepth = depth / 2;

    for (let i = 0; i < this.mesh.instanceCount; i++) {
      const windX =
        this._wind.x + Math.sin(this._time * 0.6 + this._windPhases[i]!) * this._windGustiness;
      const windZ =
        this._wind.z + Math.cos(this._time * 0.5 + this._windPhases[i]!) * this._windGustiness;

      this._positions[i * 3 + 0]! += windX * deltaTime;
      this._positions[i * 3 + 1]! -= this._fallSpeeds[i]! * deltaTime;
      this._positions[i * 3 + 2]! += windZ * deltaTime;

      // Toroidal horizontal wrap: drifting particles stay within the visible field instead of
      // thinning out downwind over time.
      const relX = this._positions[i * 3 + 0]! - this._center.x;
      if (relX > halfWidth) this._positions[i * 3 + 0]! -= width;
      else if (relX < -halfWidth) this._positions[i * 3 + 0]! += width;
      const relZ = this._positions[i * 3 + 2]! - this._center.z;
      if (relZ > halfDepth) this._positions[i * 3 + 2]! -= depth;
      else if (relZ < -halfDepth) this._positions[i * 3 + 2]! += depth;

      if (this._positions[i * 3 + 1]! < floorY) {
        this._resetParticle(i, [this._scales[i]!, this._scales[i]!], false);
      }

      if (this._tumble) {
        this._rotations[i * 3 + 0]! += this._rotationSpeeds[i * 3 + 0]! * deltaTime;
        this._rotations[i * 3 + 1]! += this._rotationSpeeds[i * 3 + 1]! * deltaTime;
        this._rotations[i * 3 + 2]! += this._rotationSpeeds[i * 3 + 2]! * deltaTime;
      }

      this._writeInstance(i);
    }

    this.mesh.instanceMatrixNeedsUpdate = true;
  }

  private _writeAllInstances(): void {
    for (let i = 0; i < this.mesh.instanceCount; i++) this._writeInstance(i);
    this.mesh.instanceMatrixNeedsUpdate = true;
  }

  private _writeInstance(i: number): void {
    this._scratchPos.set(
      this._positions[i * 3 + 0]!,
      this._positions[i * 3 + 1]!,
      this._positions[i * 3 + 2]!,
    );
    this._scratchRot.set(
      this._rotations[i * 3 + 0]!,
      this._rotations[i * 3 + 1]!,
      this._rotations[i * 3 + 2]!,
    );
    this._scratchScale.set(this._scales[i]!, this._scales[i]!, this._scales[i]!);
    this._scratchMatrix.compose(this._scratchPos, this._scratchRot, this._scratchScale);
    this.mesh.setMatrixAt(i, this._scratchMatrix);
  }
}

/** Convenience: builds a `WeatherEmitter` and immediately adds its mesh to `parent` -- accepts
 * either a `Scene` or an `Object3D` (they don't share a base class, only this `add()` shape). */
export function attachWeatherEmitter(
  parent: { add(...objs: Object3D[]): void },
  name: string,
  options: WeatherEmitterOptions,
): WeatherEmitter {
  const emitter = new WeatherEmitter(name, options);
  parent.add(emitter.mesh);
  return emitter;
}
