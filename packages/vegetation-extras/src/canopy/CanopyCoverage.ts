/**
 * Canopy coverage map (ADR 0059 step 6a, candidate A): a top-down grid of how much sky the tree
 * crowns hide, built once on the CPU from an instance-field population. Consumers darken ambient
 * light below the canopy with it (forest interiors read dark without any GI).
 *
 * @fixed Coverage per cell = 1 - prod(1 - a_i) over all crowns touching the cell, where a_i is the
 *        crown's soft disc (full opacity inside 70 % of the radius, smoothstep to 0 at the rim)
 *        times `crownOpacity`. Overlapping crowns saturate toward 1, a single crown never does.
 */
import { Texture } from "@small-world-machine/engine";
import { unpackInstancePose, type InstancePose } from "@small-world-machine/engine";

export interface CanopyCoverageMap {
  /** Row-major coverage in [0, 255] (row = +Z, column = +X), `width * height` bytes. */
  readonly data: Uint8Array;
  readonly width: number;
  readonly height: number;
  /** World X / Z of the grid's minimum corner (metres). */
  readonly originX: number;
  readonly originZ: number;
  /** Cell edge in metres. */
  readonly cellSize: number;
}

export interface CanopyCoverageOptions {
  /** @domain Crown radius in metres at instance scale 1 (scaled per instance by its pose). */
  crownRadius: number;
  /** @domain Grid cell edge in metres. Default 1. */
  cellSize?: number;
  /** @domain Sky blocked by one crown at its centre, [0, 1]. Default 0.85 (crowns let some sky through). */
  crownOpacity?: number;
}

/**
 * Builds the coverage map of `count` instance records (16 B each: xyz + packed pose u32 in the
 * `w` slot, the engine record contract). The grid spans the population bounds plus one crown.
 */
export function buildCanopyCoverage(
  records: Float32Array,
  count: number,
  options: CanopyCoverageOptions,
): CanopyCoverageMap {
  const cell = options.cellSize ?? 1;
  const opacity = Math.min(1, Math.max(0, options.crownOpacity ?? 0.85));
  if (!(options.crownRadius > 0) || !(cell > 0)) {
    throw new Error("[CanopyCoverage] crownRadius and cellSize must be > 0.");
  }
  const bits = new Uint32Array(records.buffer, records.byteOffset, records.length);
  const pose: InstancePose = { yawRadians: 0, uniformScale: 0 };
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  let maxR = 0;
  for (let i = 0; i < count; i++) {
    unpackInstancePose(bits[i * 4 + 3]!, pose);
    const r = options.crownRadius * pose.uniformScale;
    maxR = Math.max(maxR, r);
    minX = Math.min(minX, records[i * 4]!);
    maxX = Math.max(maxX, records[i * 4]!);
    minZ = Math.min(minZ, records[i * 4 + 2]!);
    maxZ = Math.max(maxZ, records[i * 4 + 2]!);
  }
  if (count === 0) {
    return { data: new Uint8Array(1), width: 1, height: 1, originX: 0, originZ: 0, cellSize: cell };
  }
  const originX = Math.floor((minX - maxR) / cell) * cell;
  const originZ = Math.floor((minZ - maxR) / cell) * cell;
  const width = Math.max(1, Math.ceil((maxX + maxR - originX) / cell));
  const height = Math.max(1, Math.ceil((maxZ + maxR - originZ) / cell));
  // Accumulate the open-sky fraction (product of 1 - a_i), convert to coverage at the end.
  const open = new Float32Array(width * height).fill(1);
  for (let i = 0; i < count; i++) {
    unpackInstancePose(bits[i * 4 + 3]!, pose);
    const r = options.crownRadius * pose.uniformScale;
    if (!(r > 0)) continue;
    const cx = records[i * 4]!;
    const cz = records[i * 4 + 2]!;
    const x0 = Math.max(0, Math.floor((cx - r - originX) / cell));
    const x1 = Math.min(width - 1, Math.floor((cx + r - originX) / cell));
    const z0 = Math.max(0, Math.floor((cz - r - originZ) / cell));
    const z1 = Math.min(height - 1, Math.floor((cz + r - originZ) / cell));
    for (let z = z0; z <= z1; z++) {
      const dz = originZ + (z + 0.5) * cell - cz;
      for (let x = x0; x <= x1; x++) {
        const dx = originX + (x + 0.5) * cell - cx;
        const t = Math.sqrt(dx * dx + dz * dz) / r;
        if (t >= 1) continue;
        const edge = t <= 0.7 ? 1 : 1 - smoothstep((t - 0.7) / 0.3);
        open[z * width + x]! *= 1 - opacity * edge;
      }
    }
  }
  const data = new Uint8Array(width * height);
  for (let k = 0; k < data.length; k++) data[k] = Math.round((1 - open[k]!) * 255);
  return { data, width, height, originX, originZ, cellSize: cell };
}

function smoothstep(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

/** Coverage [0, 1] of `map` at world XZ (nearest cell; 0 outside the map). */
export function canopyCoverageAt(map: CanopyCoverageMap, x: number, z: number): number {
  const cx = Math.floor((x - map.originX) / map.cellSize);
  const cz = Math.floor((z - map.originZ) / map.cellSize);
  if (cx < 0 || cz < 0 || cx >= map.width || cz >= map.height) return 0;
  return map.data[cz * map.width + cx]! / 255;
}

/**
 * Below-canopy weight at height `y`: 1 up to 35 % of `canopyHeight`, smoothstep to 0 at the crown
 * top (the same fade as the field shader's `fieldCanopyAmbient`).
 */
export function canopyHeightFade(y: number, canopyHeight: number): number {
  const t = Math.min(1, Math.max(0, (y - 0.35 * canopyHeight) / (0.65 * canopyHeight)));
  return 1 - t * t * (3 - 2 * t);
}

/** RGBA pixels of a canopy AO map for a square ground plane centred on the origin. */
export interface CanopyGroundAo {
  readonly data: Uint8ClampedArray;
  readonly size: number;
}

/**
 * Bakes `map` into ambient-occlusion pixels for a `groundSize` m square plane centred on the
 * origin, one texel per `texelSize` m: grey = 1 - (1 - ambientFloor) * coverage. Row 0 is +Z
 * (engine `Ground` uv: v = 1 at -Z). DOM-free; see `createCanopyGroundAoTexture` for a Texture.
 */
export function buildCanopyGroundAo(
  map: CanopyCoverageMap,
  ambientFloor: number,
  groundSize: number,
  texelSize = 1,
): CanopyGroundAo {
  const size = Math.max(1, Math.round(groundSize / texelSize));
  const data = new Uint8ClampedArray(size * size * 4);
  const half = groundSize / 2;
  for (let row = 0; row < size; row++) {
    const z = half - (row + 0.5) * texelSize;
    for (let col = 0; col < size; col++) {
      const x = -half + (col + 0.5) * texelSize;
      const g = Math.round((1 - (1 - ambientFloor) * canopyCoverageAt(map, x, z)) * 255);
      const o = (row * size + col) * 4;
      data[o] = g;
      data[o + 1] = g;
      data[o + 2] = g;
      data[o + 3] = 255;
    }
  }
  return { data, size };
}

/** Browser helper: `buildCanopyGroundAo` as an engine `Texture` (assign to `StandardMaterial.aoMap`). */
export function createCanopyGroundAoTexture(
  map: CanopyCoverageMap,
  ambientFloor: number,
  groundSize: number,
  texelSize = 1,
): Texture {
  const ao = buildCanopyGroundAo(map, ambientFloor, groundSize, texelSize);
  const canvas = document.createElement("canvas");
  canvas.width = ao.size;
  canvas.height = ao.size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("[CanopyCoverage] 2D canvas unavailable.");
  const img = ctx.createImageData(ao.size, ao.size);
  img.data.set(ao.data);
  ctx.putImageData(img, 0, 0);
  return Texture.fromCanvas(canvas);
}
