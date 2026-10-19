import type { Vector3D } from "@small-world-machine/engine";
import {
  Color,
  CullMode,
  InstancedMesh,
  Plane,
  StandardMaterial,
  Texture,
} from "@small-world-machine/engine";
import { DROP_PRESETS, DropPreset, terminalVelocity } from "@small-world-machine/liquid-extras";

const COUNT = 10000;
/** Half extent of the rain box around the camera on x/z, metres. Wrapping keeps density uniform. */
const HALF_EXTENT = 6;
/** Height of the rain box above the ground, metres. */
const HEIGHT = 8;
/** Camera shutter, seconds: a streak is the path a drop covers while the shutter is open. */
const EXPOSURE = 1 / 40;
/** Marshall-Palmer slope for ~10 mm/h, per mm: D ~ exp(-LAMBDA*D), many small drops, few big ones. */
const LAMBDA_PER_MM = 2.5;
const MM = 0.001;
/** Streak thickness: sub-pixel drops still read as a thin line, so widen a little and keep alpha low. */
const WIDTH_BASE = 0.005;
const WIDTH_PER_DIAMETER = 3;
const BASE_WIND_X = -1.4;
const BASE_WIND_Z = -0.7;
const TEXTURE_WIDTH = 16;
const TEXTURE_HEIGHT = 128;

function wrap(value: number, size: number): number {
  return ((value % size) + size) % size;
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
 * Rain as motion-blurred streaks: camera-facing, velocity-aligned soft quads, lit by the scene (not
 * self-emissive), falling at the terminal velocity of their drop size, pushed by a gusting wind. The
 * box follows the camera so the density is the same wherever you look.
 */
export class RainStreaks {
  public readonly mesh: InstancedMesh;

  private readonly _x = new Float32Array(COUNT);
  private readonly _y = new Float32Array(COUNT);
  private readonly _z = new Float32Array(COUNT);
  private readonly _speed = new Float32Array(COUNT);
  private readonly _width = new Float32Array(COUNT);

  constructor(seed: number = 7) {
    const layer = DROP_PRESETS[DropPreset.RAIN].rain;
    const diameterMinMm = layer.diameterMin / MM;
    const diameterMaxMm = layer.diameterMax / MM;
    const tail = 1 - Math.exp(-LAMBDA_PER_MM * (diameterMaxMm - diameterMinMm));

    let state = seed;
    const rand = (): number => {
      state = (state * 9301 + 49297) % 233280;
      return state / 233280;
    };

    const material = new StandardMaterial({
      color: new Color(0.88, 0.93, 1.0, 0.6),
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
      COUNT,
    );
    this.mesh.useInstanceDataAsColor = true;
    this.mesh.initInstanceData(4);
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.frustumCulled = false;

    for (let i = 0; i < COUNT; i++) {
      const diameterMm = diameterMinMm - Math.log(1 - rand() * tail) / LAMBDA_PER_MM;
      const diameter = diameterMm * MM;
      this._speed[i] = terminalVelocity(diameter);
      this._width[i] = WIDTH_BASE + WIDTH_PER_DIAMETER * diameter;
      this._x[i] = (rand() - 0.5) * 2 * HALF_EXTENT;
      this._y[i] = rand() * HEIGHT;
      this._z[i] = (rand() - 0.5) * 2 * HALF_EXTENT;
      // Bigger drops carry more light into the lens.
      const brightness =
        0.55 + 0.45 * ((diameterMm - diameterMinMm) / (diameterMaxMm - diameterMinMm));
      this.mesh.setInstanceDataAt(i, [brightness, brightness, brightness, 1]);
    }
  }

  /**
   * @param deltaTime Seconds since the last frame.
   * @param time Seconds since start; drives the wind gusts.
   * @param camera World position of the camera; the rain box is centred on it.
   */
  public update(deltaTime: number, time: number, camera: Vector3D): void {
    const gust = 1 + 0.35 * Math.sin(time * 0.7) + 0.15 * Math.sin(time * 1.9 + 1.3);
    const windX = BASE_WIND_X * gust;
    const windZ = BASE_WIND_Z * (1 + 0.3 * Math.sin(time * 0.5 + 0.6));
    const matrices = this.mesh.instanceMatrices;
    const xs = this._x;
    const ys = this._y;
    const zs = this._z;

    for (let i = 0; i < COUNT; i++) {
      const speed = this._speed[i]!;
      let x = xs[i]! + windX * deltaTime;
      let y = ys[i]! - speed * deltaTime;
      let z = zs[i]! + windZ * deltaTime;
      x = camera.x + wrap(x - camera.x + HALF_EXTENT, 2 * HALF_EXTENT) - HALF_EXTENT;
      z = camera.z + wrap(z - camera.z + HALF_EXTENT, 2 * HALF_EXTENT) - HALF_EXTENT;
      y = wrap(y, HEIGHT);
      xs[i] = x;
      ys[i] = y;
      zs[i] = z;

      // Streak axis = the drop's velocity; it extends upward from the drop (the blur trails behind it).
      const invSpeed = 1 / Math.hypot(windX, speed, windZ);
      const ux = windX * invSpeed;
      const uy = -speed * invSpeed;
      const uz = windZ * invSpeed;
      const length = speed * EXPOSURE;

      // Face the camera around the axis: right = axis x toCamera, normal = toCamera minus its axis part.
      const cx = camera.x - x;
      const cy = camera.y - y;
      const cz = camera.z - z;
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
