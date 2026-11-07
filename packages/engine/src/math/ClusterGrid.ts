/** Default screen-space tile size (pixels) for the clustered light grid. */
export const DEFAULT_CLUSTER_TILE_SIZE: [number, number] = [16, 16];

/** Default number of logarithmically-staggered depth slices for the clustered light grid. */
export const DEFAULT_CLUSTER_Z_SLICES = 24;

/** Default maximum number of lights a single cluster cell can reference. */
export const DEFAULT_MAX_LIGHTS_PER_CLUSTER = 32;

/**
 * Fixed row width (in texels) for WebGL2's cluster grid/index data textures -- there is no 1D
 * texture target in WebGL2, so the flat cluster/index arrays are laid out as
 * `ivec2(i % CLUSTER_TEX_WIDTH, i / CLUSTER_TEX_WIDTH)` on a 2D texture instead. Must match the
 * `CLUSTER_TEX_WIDTH` constant in `light_calc.frag.glsl`/`light_calc_pbr.frag.glsl` exactly.
 */
export const CLUSTER_TEX_WIDTH = 1024;

/**
 * Fixed WebGL2 texture units for the clustered light culling grid/index textures -- plain
 * exported constants rather than renderer instance/class state, since the numbers are
 * shared by every `WebGL2Renderer` instance (see docs/adr/0007-clustered-lighting-webgl2-webgpu-only.md).
 * Texture unit 11 is reserved for the spot shadow depth array, unit 12 for directional shadows (and
 * dummy fallback), unit 13 for `WebGL2Renderer._RAW_DEPTH_UNIT` (PCSS raw depth blocker-search), and
 * units 14-15 for the cluster grid and cluster indices textures. The reserved range 11-15 leaves
 * units 0-10 for material/IBL samplers within WebGL2's guaranteed `MAX_TEXTURE_IMAGE_UNITS` of 16
 * (see WebGLProgramCache._RESERVED_GLOBAL_UNIT_START).
 */
export const CLUSTER_GRID_UNIT = 14;
export const CLUSTER_INDEX_UNIT = 15;

/** Dimensions of the clustered light grid, in cells per axis. */
export interface ClusterGridDims {
  /** Number of cells along the screen-space X axis. */
  x: number;
  /** Number of cells along the screen-space Y axis. */
  y: number;
  /** Number of depth slices along the view-space Z axis. */
  z: number;
}

/**
 * Computes the cluster grid dimensions for a given screen resolution.
 * @param screenWidth Canvas width in pixels.
 * @param screenHeight Canvas height in pixels.
 * @param tileSize Screen-space tile size in pixels, [width, height].
 * @param zSlices Number of depth slices.
 */
export function computeClusterCounts(
  screenWidth: number,
  screenHeight: number,
  tileSize: [number, number] = DEFAULT_CLUSTER_TILE_SIZE,
  zSlices: number = DEFAULT_CLUSTER_Z_SLICES,
): ClusterGridDims {
  return {
    x: Math.max(1, Math.ceil(screenWidth / tileSize[0])),
    y: Math.max(1, Math.ceil(screenHeight / tileSize[1])),
    z: Math.max(1, zSlices),
  };
}

/**
 * Maps a view-space depth to a logarithmically-staggered depth slice index, so cells stay thin
 * near the camera and widen towards the far plane (same family of formula as the existing CSM
 * log/uniform split, see `DirectionalLight.updateCascades()`).
 * @param viewZ View-space depth (positive distance from the camera).
 * @param near Camera near-plane distance.
 * @param far Camera far-plane distance.
 * @param numSlices Number of depth slices.
 */
export function zSliceFromViewDepth(
  viewZ: number,
  near: number,
  far: number,
  numSlices: number,
): number {
  const clampedZ = Math.min(Math.max(viewZ, near), far);
  const slice = Math.floor((Math.log(clampedZ / near) * numSlices) / Math.log(far / near));
  return Math.min(Math.max(slice, 0), numSlices - 1);
}

/** A single light's coverage range within the cluster grid, all bounds inclusive. */
export interface LightClusterCoverage {
  /** First cell along the X axis this light can reach. */
  cellMinX: number;
  /** Last cell along the X axis this light can reach. */
  cellMaxX: number;
  /** First cell along the Y axis this light can reach. */
  cellMinY: number;
  /** Last cell along the Y axis this light can reach. */
  cellMaxY: number;
  /** First depth slice this light can reach. */
  sliceMin: number;
  /** Last depth slice this light can reach. */
  sliceMax: number;
}

/**
 * Computes which cluster cells a single light's bounding sphere can possibly reach, by
 * projecting the sphere's screen-space footprint (X/Y) and its radial-distance range (Z) --
 * the same approach `cluster_cull.wgsl`'s `lightCoverage()` uses on WebGPU, kept here as a pure,
 * backend-neutral function so the WebGL2 CPU culling pass can reuse and unit-test it directly.
 * Falls back to covering the whole X/Y grid when the light center is behind the camera or the
 * camera sits inside the sphere (a projected NDC center would be meaningless there) --
 * over-inclusion is safe, dropping a light that's actually visible is not.
 * @param viewDist Radial distance from the camera to the light center.
 * @param radius The light's range/radius.
 * @param ndcX Light center's screen-space NDC X (only meaningful when `clipW > 0`).
 * @param ndcY Light center's screen-space NDC Y (only meaningful when `clipW > 0`).
 * @param clipW The clip-space W component from projecting the light center through `vp`.
 * @param projScaleX Projection matrix diagonal term [0][0].
 * @param projScaleY Projection matrix diagonal term [1][1].
 * @param screenWidth Canvas width in pixels.
 * @param screenHeight Canvas height in pixels.
 * @param tileSize Screen-space tile size in pixels, [width, height].
 * @param dims Grid dimensions from `computeClusterCounts()`.
 * @param near Camera near-plane distance.
 * @param far Camera far-plane distance.
 */
export function lightClusterCoverage(
  viewDist: number,
  radius: number,
  ndcX: number,
  ndcY: number,
  clipW: number,
  projScaleX: number,
  projScaleY: number,
  screenWidth: number,
  screenHeight: number,
  tileSize: [number, number],
  dims: ClusterGridDims,
  near: number,
  far: number,
  out?: LightClusterCoverage,
): LightClusterCoverage {
  let cellMinX = 0;
  let cellMaxX = dims.x - 1;
  let cellMinY = 0;
  let cellMaxY = dims.y - 1;

  if (clipW > 0.0001 && viewDist > radius && projScaleX > 0 && projScaleY > 0) {
    const tanX = ndcX / projScaleX;
    const tanY = ndcY / projScaleY;
    const vz = viewDist / Math.sqrt(1 + tanX * tanX + tanY * tanY);

    if (vz > radius) {
      const vx = tanX * vz;
      const vy = tanY * vz;
      const denom = vz * vz - radius * radius;

      const radX = radius * Math.sqrt(Math.max(vx * vx + vz * vz - radius * radius, 0));
      const mXMin = (vx * vz - radX) / denom;
      const mXMax = (vx * vz + radX) / denom;
      const ndcXMin = mXMin * projScaleX;
      const ndcXMax = mXMax * projScaleX;

      const radY = radius * Math.sqrt(Math.max(vy * vy + vz * vz - radius * radius, 0));
      const mYMin = (vy * vz - radY) / denom;
      const mYMax = (vy * vz + radY) / denom;
      const ndcYMin = mYMin * projScaleY;
      const ndcYMax = mYMax * projScaleY;

      const pxX0 = (ndcXMin * 0.5 + 0.5) * screenWidth;
      const pxX1 = (ndcXMax * 0.5 + 0.5) * screenWidth;
      const pxY0 = (ndcYMin * 0.5 + 0.5) * screenHeight;
      const pxY1 = (ndcYMax * 0.5 + 0.5) * screenHeight;

      cellMinX = clampInt(Math.floor(pxX0 / tileSize[0]), 0, dims.x - 1);
      cellMaxX = clampInt(Math.floor(pxX1 / tileSize[0]), 0, dims.x - 1);
      cellMinY = clampInt(Math.floor(pxY0 / tileSize[1]), 0, dims.y - 1);
      cellMaxY = clampInt(Math.floor(pxY1 / tileSize[1]), 0, dims.y - 1);
    }
  }

  const dMin = Math.max(viewDist - radius, near);
  const dMax = Math.min(viewDist + radius, far);
  const result = out ?? {
    cellMinX: 0,
    cellMaxX: 0,
    cellMinY: 0,
    cellMaxY: 0,
    sliceMin: 0,
    sliceMax: 0,
  };
  result.cellMinX = cellMinX;
  result.cellMaxX = cellMaxX;
  result.cellMinY = cellMinY;
  result.cellMaxY = cellMaxY;
  result.sliceMin = zSliceFromViewDepth(dMin, near, far, dims.z);
  result.sliceMax = zSliceFromViewDepth(dMax, near, far, dims.z);
  return result;
}

function clampInt(value: number, lo: number, hi: number): number {
  return Math.min(Math.max(value, lo), hi);
}

/**
 * Flattens a 3D cluster cell coordinate into a linear index (X-major, then Y, then Z).
 * @param x Cell coordinate along the X axis.
 * @param y Cell coordinate along the Y axis.
 * @param z Cell coordinate along the Z axis (depth slice).
 * @param dims Grid dimensions from `computeClusterCounts()`.
 */
export function clusterIndex(x: number, y: number, z: number, dims: ClusterGridDims): number {
  return x + dims.x * (y + dims.y * z);
}
