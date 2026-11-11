/**
 * Tree population as one GPU instance field (ADR 0059): LOD bands from screen-size thresholds,
 * species albedo/cutout, canopy ambient, leaf backlight and LOD transition in one call.
 *
 * Industry model: Unreal "Hierarchical Instanced Static Mesh" with per-LOD screen sizes (here:
 * projected pixel diameters) and the foliage tool's per-type settings.
 */
import {
  GltfMaterialParser,
  InstanceFieldSystem,
  unpackInstancePose,
  type FieldCanopy,
  type GeometryDataInterface,
  type InstancePose,
  type LodBucketDescriptor,
  type LodTransitionMode,
  type TextureArray,
} from "@small-world-machine/engine";
import { buildCanopyCoverage } from "../canopy/CanopyCoverage.js";
import type { WindFieldOptions } from "../wind/WindField.js";

/**
 * LOD buckets from ascending upper pixel bounds (bucket 0 = farthest/coarsest; the last bound is
 * the near cap, e.g. 1e6). Lower bound of bucket 0 = `cullPixelSize + 1`.
 */
export function lodBucketsFromMaxima(
  maxPx: readonly number[],
  cullPixelSize: number,
): LodBucketDescriptor[] {
  return maxPx.map((max, i) => ({
    name: `L${maxPx.length - 1 - i}`,
    lodIndex: maxPx.length - 1 - i,
    minProjectedSize: i === 0 ? cullPixelSize + 1 : maxPx[i - 1]! + 1,
    maxProjectedSize: max,
    geometrySlot: i,
  }));
}

/** Conservative cull radius at scale 1: farthest vertex from the base x 1.1, at least `floor` m. */
export function geometryBoundingRadius(geo: GeometryDataInterface, floor = 2): number {
  let maxR2 = 0;
  const v = geo.vertices;
  for (let i = 0; i < v.length; i += 3) {
    maxR2 = Math.max(maxR2, v[i]! * v[i]! + v[i + 1]! * v[i + 1]! + v[i + 2]! * v[i + 2]!);
  }
  return Math.max(Math.sqrt(maxR2) * 1.1, floor);
}

/** Highest vertex y (plant base at y = 0). */
export function geometryHeight(geo: GeometryDataInterface): number {
  let maxY = 0;
  for (let i = 1; i < geo.vertices.length; i += 3) maxY = Math.max(maxY, geo.vertices[i]!);
  return maxY;
}

/** Gentle forest breeze (travelling gusts with calm phases) for plants up to `height` m. */
export function forestBreeze(height: number): WindFieldOptions {
  return {
    directionX: 1,
    directionZ: 0,
    speed: 6,
    gustLength: 55,
    crossStretch: 2.5,
    calm: 0.5,
    strength: 0.05,
    gustStrength: 0.22,
    flutterStrength: 0.04,
    flutterFrequency: 1.1,
    boundaryHeight: height,
    groundFactor: 0.45,
    maxLean: 0.6,
  };
}

/**
 * Canopy of a population: crown radius = `crownFill` x the widest XZ extent of `geometry`, crown
 * top = geometry height x mean instance scale.
 */
export function buildPopulationCanopy(
  records: Float32Array,
  geometry: GeometryDataInterface,
  options: { ambientFloor: number; cellSize?: number; crownFill?: number },
): FieldCanopy {
  const v = geometry.vertices;
  let crown = 0;
  for (let i = 0; i < v.length; i += 3) crown = Math.max(crown, Math.hypot(v[i]!, v[i + 2]!));
  const count = records.length / 4;
  const bits = new Uint32Array(records.buffer, records.byteOffset, records.length);
  const pose: InstancePose = { yawRadians: 0, uniformScale: 0 };
  let scaleSum = 0;
  for (let i = 0; i < count; i++) {
    unpackInstancePose(bits[i * 4 + 3]!, pose);
    scaleSum += pose.uniformScale;
  }
  const map = buildCanopyCoverage(records, count, {
    crownRadius: Math.max(0.5, crown * (options.crownFill ?? 0.8)),
    cellSize: options.cellSize ?? 1,
  });
  return {
    ...map,
    ambientFloor: options.ambientFloor,
    canopyHeight: geometryHeight(geometry) * (count > 0 ? scaleSum / count : 1),
  };
}

export interface TreeFieldOptions {
  /** Instance records (16 B: xyz + packed pose u32 bits). */
  records: Float32Array;
  /** LOD geometries, COARSEST FIRST (bucket order). */
  lods: readonly GeometryDataInterface[];
  /** Ascending upper pixel bound per LOD (same length; last = near cap). */
  lodMaxPx: readonly number[];
  /** Cull radius at scale 1 (default: `geometryBoundingRadius` of the finest LOD). */
  boundingRadius?: number;
  cullPixelSize?: number;
  cellSize?: number;
  /** Views incl. shadow cascades (default 4). */
  maxViews?: number;
  lodTransitionMode?: LodTransitionMode;
  albedo?: TextureArray;
  alphaTest?: number;
  canopy?: FieldCanopy;
  /** sRGB leaf transmission tint (ADR 0060), masked per vertex by the foliage mask. */
  backlightSrgb?: readonly [number, number, number];
  id?: string;
}

/** Builds (not registers) the tree field. */
export function createTreeField(o: TreeFieldOptions): InstanceFieldSystem {
  if (o.lods.length === 0 || o.lods.length !== o.lodMaxPx.length) {
    throw new Error("[TreeField] lods and lodMaxPx must be non-empty and of equal length.");
  }
  const cullPx = o.cullPixelSize ?? 2;
  const count = o.records.length / 4;
  const bl = o.backlightSrgb;
  return new InstanceFieldSystem(null, {
    instanceRecords: o.records,
    prototypes: [
      {
        id: o.id ?? "tree",
        boundingRadius: o.boundingRadius ?? geometryBoundingRadius(o.lods[o.lods.length - 1]!),
        lodBuckets: lodBucketsFromMaxima(o.lodMaxPx, cullPx),
        materialSlot: 0,
        maxInstances: count,
      },
    ],
    geometryTable: [o.lods],
    options: {
      cellSize: o.cellSize ?? 12,
      maxInstances: count,
      cullPixelSize: cullPx,
      maxViews: o.maxViews ?? 4,
    },
    ...(o.lodTransitionMode ? { lodTransitionMode: o.lodTransitionMode } : {}),
    ...(o.albedo ? { albedoArray: o.albedo } : {}),
    ...(o.alphaTest ? { alphaTest: o.alphaTest } : {}),
    ...(o.canopy ? { canopy: o.canopy } : {}),
    ...(bl
      ? {
          backlight: [
            GltfMaterialParser.engineSRGBToLinear(bl[0]),
            GltfMaterialParser.engineSRGBToLinear(bl[1]),
            GltfMaterialParser.engineSRGBToLinear(bl[2]),
          ] as [number, number, number],
        }
      : {}),
  });
}
