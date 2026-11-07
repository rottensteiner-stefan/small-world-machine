import { CullMode } from "../../enums/index.js";
import { InstancedMesh } from "../../core/InstancedMesh.js";
import { Color } from "../../core/colors/index.js";
import { StandardMaterial } from "../../core/materials/index.js";
import { Texture } from "../../core/textures/Texture.js";
import { Plane } from "../../geometry/index.js";
import type { Object3D } from "../../core/Object3D.js";
import type { Vector3D } from "../../math/index.js";
import { mulberry32 } from "../../utils/SeededRandom.js";

const MM = 0.001;

/** Fixed pool size when no `count` is given. A light, ambient rain. */
const DEFAULT_COUNT = 6000;
/** Deterministic seed value when none is given. */
const DEFAULT_SEED = 7;
/** Half extent of the rain box around the camera on x/z, metres. Wrapping keeps density uniform. */
const DEFAULT_HALF_EXTENT = 6;
/** Height of the rain box above the ground, metres. */
const DEFAULT_HEIGHT = 8;
/** Camera shutter, seconds: a streak is the path a drop covers while the shutter is open. */
const DEFAULT_EXPOSURE = 1 / 40;
/** Base gust wind, metres per second. */
const DEFAULT_WIND_X = -1.4;
const DEFAULT_WIND_Z = -0.7;
/** Marshall-Palmer slope for ~10 mm/h, per mm: D ~ exp(-LAMBDA*D), many small drops, few big ones. */
const LAMBDA_PER_MM = 2.5;
/** Rain drop diameter range, metres -- matches `DropPreset.RAIN` in `@small-world-machine/liquid-extras`. */
const DROP_DIAMETER_MIN = 0.0005;
const DROP_DIAMETER_MAX = 0.0025;
/** Streak thickness: sub-pixel drops still read as a thin line, so widen a little and keep alpha low. */
const WIDTH_BASE = 0.005;
const WIDTH_PER_DIAMETER = 3;
const TEXTURE_WIDTH = 16;
const TEXTURE_HEIGHT = 128;

/** Art-direction knobs for a reusable rain field. Everything defaults to the look from
 *  showcase 30; pass `count` to go from light rain up to a storm. */
export interface RainStreaksOptions {
  /** Number of streak quads in the pool (the visible rain density). Defaults to 6000 (light rain);
   *  showcase 30's storm look uses 10000. */
  count?: number;
  /** Deterministic RNG seed. Defaults to 7. */
  seed?: number;
  /** Half extent of the camera-following rain box on x/z, metres. Defaults to 6. */
  halfExtent?: number;
  /** Height of the rain box, metres. Defaults to 8. */
  height?: number;
  /** Camera shutter for the motion-blurred streak length, seconds. Defaults to 1/40. */
  exposure?: number;
  /** Base horizontal wind push (m/s); the gust animation oscillates around it. Defaults to x -1.4. */
  windX?: number;
  /** Base horizontal wind push (m/s) along z. Defaults to -0.7. */
  windZ?: number;
  /** Sampled drop diameter range (min, max), metres. Defaults to `DropPreset.RAIN` (0.0005-0.0025);
   *  smaller values read as drizzle, larger as heavy rain. */
  dropSizeRange?: readonly [number, number];
  /** Base tint of the streaks (kept pale so scene lighting reads through). Defaults to a wet blue-grey. */
  color?: Color;
  /** Global catch-light multiplier applied on top of the per-drop size shading. Defaults to 1. */
  brightness?: number;
}

function wrap(value: number, size: number): number {
  return ((value % size) + size) % size;
}

/**
 * Terminal fall speed of a raindrop in still air, m/s. Atlas, Srivastava & Sekhon (1973),
 * Rev. Geophys. 11(1). The canonical copy lives in `@small-world-machine/liquid-extras`
 * (`drops/DropProperties.ts`, used by the drop-impact system); the engine core cannot import
 * that package, so the formula is repeated here with the same citation. Keep both in sync.
 */
function terminalVelocity(diameter: number): number {
  return Math.max(0, 9.65 - 10.3 * Math.exp((-0.6 * diameter) / MM));
}

/** Soft symmetric streak: gaussian across, sine-shaped along. Symmetric so no tier can flip it. */
function createStreakTexture(): Texture {
  const canvas = document.createElement("canvas");
  canvas.width = TEXTURE_WIDTH;
  canvas.height = TEXTURE_HEIGHT;
  const context = canvas.getContext("2d") as CanvasRenderingContext2D;
  const image = context.createImageData(TEXTURE_WIDTH, TEXTURE_HEIGHT);
  for (let y = 0; y < TEXTURE_HEIGHT; y++) {
    const along = Math.sin(Math.PI * ((y + 0.5) / TEXTURE_HEIGHT)) ** 0.8;
    for (let x = 0; x < TEXTURE_WIDTH; x++) {
      const across = ((x + 0.5) / TEXTURE_WIDTH - 0.5) / 0.2;
      const alpha = along * Math.exp(-across * across);
      const offset = (y * TEXTURE_WIDTH + x) * 4;
      image.data[offset] = 255;
      image.data[offset + 1] = 255;
      image.data[offset + 2] = 255;
      image.data[offset + 3] = Math.round(alpha * 255);
    }
  }
  context.putImageData(image, 0, 0);
  return Texture.fromCanvas(canvas);
}

/**
 * Rain as motion-blurred streaks: camera-facing, velocity-aligned soft quads, lit by the scene
 * (not self-emissive), falling at the terminal velocity of their drop size, pushed by a gusting
 * wind. The box follows the camera so the density is the same wherever you look.
 *
 * The light-rain fallback of the engine's weather subsystem (alongside `WeatherEmitter` for
 * generic falling particles). Add `mesh` to the scene and call `update()` every frame with the
 * camera's world position. Pair with `scene.fog` (e.g. `FogMode.EXP2`) for a wet, hazy look --
 * reference: showcase 30 (streaks + puddles) and showcase 32 (`WeatherEmitter` + fog).
 */
export class RainStreaks {
  /** The instanced streak mesh; add it to the scene. Exclude it from planar reflections. */
  public readonly mesh: InstancedMesh;

  private readonly _halfExtent: number;
  private readonly _height: number;
  private readonly _exposure: number;
  private readonly _windX: number;
  private readonly _windZ: number;
  private readonly _brightness: number;

  private readonly _x: Float32Array;
  private readonly _y: Float32Array;
  private readonly _z: Float32Array;
  private readonly _speed: Float32Array;
  private readonly _width: Float32Array;

  constructor(options: RainStreaksOptions = {}) {
    const requestedCount = options.count ?? DEFAULT_COUNT;
    if (
      !Number.isFinite(requestedCount) ||
      !Number.isInteger(requestedCount) ||
      requestedCount < 1
    ) {
      throw new RangeError("RainStreaks: `count` must be a positive integer");
    }
    const count = requestedCount;
    const dropMin = options.dropSizeRange?.[0] ?? DROP_DIAMETER_MIN;
    const dropMax = options.dropSizeRange?.[1] ?? DROP_DIAMETER_MAX;
    if (
      !Number.isFinite(dropMin) ||
      !Number.isFinite(dropMax) ||
      dropMin < 0 ||
      dropMin > dropMax
    ) {
      throw new RangeError("RainStreaks: `dropSizeRange` must be a [min, max] pair in metres");
    }

    this._halfExtent = options.halfExtent ?? DEFAULT_HALF_EXTENT;
    this._height = options.height ?? DEFAULT_HEIGHT;
    this._exposure = options.exposure ?? DEFAULT_EXPOSURE;
    this._windX = options.windX ?? DEFAULT_WIND_X;
    this._windZ = options.windZ ?? DEFAULT_WIND_Z;
    this._brightness = options.brightness ?? 1;
    this._x = new Float32Array(count);
    this._y = new Float32Array(count);
    this._z = new Float32Array(count);
    this._speed = new Float32Array(count);
    this._width = new Float32Array(count);

    const diameterMinMm = dropMin / MM;
    const diameterMaxMm = dropMax / MM;
    const tail = 1 - Math.exp(-LAMBDA_PER_MM * (diameterMaxMm - diameterMinMm));

    const rand = mulberry32(options.seed ?? DEFAULT_SEED);
    const diameterSpanMm = diameterMaxMm - diameterMinMm;

    const material = new StandardMaterial({
      color: options.color ?? new Color(0.88, 0.93, 1.0, 0.6),
      diffuseMap: createStreakTexture(),
      roughness: 0.5,
      metallic: 0,
    });
    material.transparent = true;
    material.cullMode = CullMode.NONE;

    this.mesh = new InstancedMesh(
      "RainStreaks",
      new Plane({ width: 1, height: 1 }).getGeometryData(),
      material,
      count,
    );
    this.mesh.useInstanceDataAsColor = true;
    this.mesh.initInstanceData(4);
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.frustumCulled = false;

    for (let i = 0; i < count; i++) {
      const diameterMm = diameterMinMm - Math.log(1 - rand() * tail) / LAMBDA_PER_MM;
      const diameter = diameterMm * MM;
      this._speed[i] = terminalVelocity(diameter);
      this._width[i] = WIDTH_BASE + WIDTH_PER_DIAMETER * diameter;
      this._x[i] = (rand() - 0.5) * 2 * this._halfExtent;
      this._y[i] = rand() * this._height;
      this._z[i] = (rand() - 0.5) * 2 * this._halfExtent;
      // Bigger drops carry more light into the lens.
      // A degenerate range (min == max) has no spread: use the middle brightness, not 0/0.
      const sizeT = diameterSpanMm > 0 ? (diameterMm - diameterMinMm) / diameterSpanMm : 0.5;
      const brightness = 0.55 + 0.45 * sizeT;
      const gain = brightness * this._brightness;
      this.mesh.setInstanceDataAt(i, [gain, gain, gain, 1]);
    }
  }

  /**
   * Detaches the mesh from its parent and releases the procedural streak canvas texture.
   * Safe to call twice. The mesh must not be rendered afterwards.
   */
  public dispose(): void {
    this.mesh.parent?.remove(this.mesh);
    const material = this.mesh.material as StandardMaterial | undefined;
    material?.diffuseMap?.dispose();
  }

  /**
   * @param deltaTime Seconds since the last frame.
   * @param time Seconds since start; drives the wind gusts.
   * @param cameraPosition World position of the camera; the rain box is centred on it.
   */
  public update(deltaTime: number, time: number, cameraPosition: Vector3D): void {
    const gust = 1 + 0.35 * Math.sin(time * 0.7) + 0.15 * Math.sin(time * 1.9 + 1.3);
    const windX = this._windX * gust;
    const windZ = this._windZ * (1 + 0.3 * Math.sin(time * 0.5 + 0.6));
    const matrices = this.mesh.instanceMatrices;
    const xs = this._x;
    const ys = this._y;
    const zs = this._z;
    const halfExtent = this._halfExtent;
    const boxWidth = halfExtent * 2;
    const height = this._height;
    const exposure = this._exposure;
    const cameraX = cameraPosition.x;
    const cameraY = cameraPosition.y;
    const cameraZ = cameraPosition.z;

    for (let i = 0; i < this._x.length; i++) {
      const speed = this._speed[i]!;
      let x = xs[i]! + windX * deltaTime;
      let y = ys[i]! - speed * deltaTime;
      let z = zs[i]! + windZ * deltaTime;
      x = cameraX + wrap(x - cameraX + halfExtent, boxWidth) - halfExtent;
      z = cameraZ + wrap(z - cameraZ + halfExtent, boxWidth) - halfExtent;
      y = wrap(y, height);
      xs[i] = x;
      ys[i] = y;
      zs[i] = z;

      // Streak axis = the drop's velocity; it extends upward from the drop (the blur trails behind it).
      // Drops below ~0.11 mm have zero terminal speed; with no wind the velocity vanishes, so
      // fall back to a vertical axis instead of dividing by zero (NaN matrices).
      const velocityLength = Math.hypot(windX, speed, windZ);
      const hasVelocity = velocityLength > 1e-6;
      const invSpeed = hasVelocity ? 1 / velocityLength : 0;
      const ux = windX * invSpeed;
      const uy = hasVelocity ? -speed * invSpeed : -1;
      const uz = windZ * invSpeed;
      const length = speed * exposure;

      // Face the camera around the axis: right = axis x toCamera, normal = toCamera minus its axis part.
      const cx = cameraX - x;
      const cy = cameraY - y;
      const cz = cameraZ - z;
      let rx = uy * cz - uz * cy;
      let ry = uz * cx - ux * cz;
      let rz = ux * cy - uy * cx;
      const rLength = Math.hypot(rx, ry, rz);
      if (rLength < 1e-6) {
        rx = 1;
        ry = 0;
        rz = 0;
      } else {
        rx /= rLength;
        ry /= rLength;
        rz /= rLength;
      }
      const along = cx * ux + cy * uy + cz * uz;
      let nx = cx - along * ux;
      let ny = cy - along * uy;
      let nz = cz - along * uz;
      const nLength = Math.hypot(nx, ny, nz) || 1;
      nx /= nLength;
      ny /= nLength;
      nz /= nLength;

      const width = this._width[i]!;
      const o = i * 16;
      matrices[o] = rx * width;
      matrices[o + 1] = ry * width;
      matrices[o + 2] = rz * width;
      matrices[o + 3] = 0;
      matrices[o + 4] = -ux * length;
      matrices[o + 5] = -uy * length;
      matrices[o + 6] = -uz * length;
      matrices[o + 7] = 0;
      matrices[o + 8] = nx;
      matrices[o + 9] = ny;
      matrices[o + 10] = nz;
      matrices[o + 11] = 0;
      matrices[o + 12] = x - ux * length * 0.5;
      matrices[o + 13] = y - uy * length * 0.5;
      matrices[o + 14] = z - uz * length * 0.5;
      matrices[o + 15] = 1;
    }
    this.mesh.instanceMatrixNeedsUpdate = true;
  }
}

/** Convenience: builds a `RainStreaks` and immediately adds its mesh to `parent` -- accepts
 * either a `Scene` or an `Object3D`. */
export function attachRainStreaks(
  parent: { add(...objs: Object3D[]): void },
  options?: RainStreaksOptions,
): RainStreaks {
  const rain = new RainStreaks(options);
  parent.add(rain.mesh);
  return rain;
}
