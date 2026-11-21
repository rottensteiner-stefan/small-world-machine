import {
  BoundingBox,
  Color,
  CullMode,
  CustomShaderMaterial,
  ShaderPropertyType,
  StandardWebGPULayout,
  Texture,
  TextureFilter,
  TextureWrap,
  Vector3D,
  type BoundingVolume,
  type GeometryDataInterface,
  type RawMipChain,
  type ShaderLayout,
} from "@small-world-machine/engine";

/** Octahedral atlas projection domain. */
export type OctahedralMappingMode = "hemi" | "full";

/**
 * Packed manifest describing a baked octahedral impostor atlas pair (albedo+alpha and
 * object-space normal+depth).
 */
export interface OctahedralImpostorManifest {
  readonly version: 1;
  /** Projection domain: `"hemi"` (upper hemisphere, best for ground/mid views) or `"full"` (full sphere, flight). */
  readonly mapping: OctahedralMappingMode;
  /** @fixed Number of view cells per atlas axis (atlas has `gridSize * gridSize` tiles). */
  readonly gridSize: number;
  /** @fixed Pixel width and height of one atlas tile. */
  readonly tileResolution: number;
  /** @domain Bounding sphere radius of the represented prototype in local metres (> 0). */
  readonly boundingRadius: number;
  /** @domain Local Y height of the bounding sphere centre above the base pivot in metres. */
  readonly pivotOffsetY: number;
  /** @domain Alpha-cutout threshold in [0, 1]. Default 0.45. */
  readonly alphaTest: number;
  /** @domain Depth-driven parallax UV offset scale in [0, 1]. Default 0.35. */
  readonly parallaxStrength: number;
}

export interface OctahedralImpostorManifestOptions {
  /** Projection domain: `"hemi"` (default) or `"full"`. */
  mapping?: OctahedralMappingMode;
  /** @fixed Cells per atlas axis (>= 2). Default 12. */
  gridSize?: number;
  /** @fixed Pixels per tile (>= 8). Default 64. */
  tileResolution?: number;
  /** @domain Bounding sphere radius in metres (> 0). Default 1. */
  boundingRadius?: number;
  /** @domain Vertical pivot offset from base to bounding centre in metres. Defaults to `boundingRadius`. */
  pivotOffsetY?: number;
  /** @domain Alpha cutout threshold in [0, 1]. Default 0.45. */
  alphaTest?: number;
  /** @domain Depth parallax scale in [0, 1]. Default 0.35. */
  parallaxStrength?: number;
}

/** Result of sampling the 3 enclosing octahedral grid cells for a view direction. */
export interface OctahedralCellSample {
  c0x: number;
  c0y: number;
  w0: number;
  c1x: number;
  c1y: number;
  w1: number;
  c2x: number;
  c2y: number;
  w2: number;
}

/** CPU-side atlas payloads ready for `Texture` upload or KTX2/PNG serialization. */
export interface OctahedralImpostorAtlasData {
  readonly manifest: OctahedralImpostorManifest;
  readonly width: number;
  readonly height: number;
  /** RGBA8 sRGB albedo (rgb) + alpha coverage (a). */
  readonly albedoAlpha: Uint8Array;
  /** RGBA8 object-space normal `[0..255]` mapped from `[-1, 1]` (rgb) + normalized depth (a). */
  readonly normalDepth: Uint8Array;
}

export interface ProceduralImpostorAtlasOptions {
  /** Canopy leaf tint (sRGB 0..1). Default rich conifer/broadleaf green `(0.22, 0.38, 0.16)`. */
  foliageColor?: readonly [number, number, number];
  /** Trunk bark tint (sRGB 0..1). Default `(0.28, 0.21, 0.14)`. */
  trunkColor?: readonly [number, number, number];
  /** Deterministic pattern seed. Default 1. */
  seed?: number;
}

export interface OctahedralImpostorMaterialOptions {
  readonly manifest: OctahedralImpostorManifest;
  /** Albedo+alpha atlas texture (`u_diffuseMap`). */
  readonly albedoMap: Texture;
  /** Object-space normal+depth atlas texture (`u_normalMap`). Optional (falls back to flat view normal). */
  readonly normalDepthMap?: Texture;
  /** Tint colour multiplier (default white). */
  readonly color?: Color;
  /** @domain Global wind sway horizontal amplitude in metres (default 0.15). */
  readonly windSwayAmplitude?: number;
  /** @domain Global wind oscillation speed in rad/s (default 1.4). */
  readonly windFrequency?: number;
  /** @domain Surface roughness in [0.05, 1] (default 0.85). */
  readonly roughness?: number;
  /** @domain Foliage wrap/backlit translucency in [0, 1] (default 0.25). */
  readonly translucency?: number;
}

export interface CaptureAtlasTileCallbackParams {
  readonly col: number;
  readonly row: number;
  readonly direction: readonly [number, number, number];
  readonly targetPivotY: number;
  readonly boundingRadius: number;
  readonly tileResolution: number;
}

/**
 * Encodes a unit direction `(dx, dy, dz)` (right-handed: +Y up) into hemi-octahedral UV `[0, 1]^2`.
 * Directions below the horizon (`dy < 0`) are clamped cleanly onto the equator (`dy = 0`).
 *
 * @invariant VEG-OCT-BIJECTION: Exact inverse of `hemiOctahedronToDir` for all `dy >= 0`.
 */
export function dirToHemiOctahedron(
  dx: number,
  dy: number,
  dz: number,
  out: [number, number] = [0, 0],
): [number, number] {
  const cy = dy > 0 ? dy : 0;
  const sum = Math.abs(dx) + cy + Math.abs(dz);
  if (sum <= 1e-12) {
    out[0] = 0.5;
    out[1] = 0.5;
    return out;
  }
  const px = dx / sum;
  const pz = dz / sum;
  const nx = px - pz;
  const nz = px + pz;
  out[0] = Math.min(1, Math.max(0, nx * 0.5 + 0.5));
  out[1] = Math.min(1, Math.max(0, nz * 0.5 + 0.5));
  return out;
}

/**
 * Decodes hemi-octahedral UV `[0, 1]^2` back into a unit upper-hemisphere direction `(x, y, z)`.
 *
 * @invariant VEG-OCT-BIJECTION: `hemiOctahedronToDir(dirToHemiOctahedron(d)) == d` for `d.y >= 0`.
 */
export function hemiOctahedronToDir(
  u: number,
  v: number,
  out: [number, number, number] = [0, 1, 0],
): [number, number, number] {
  const nx = u * 2 - 1;
  const nz = v * 2 - 1;
  const px = (nx + nz) * 0.5;
  const pz = (nz - nx) * 0.5;
  const py = Math.max(0, 1 - Math.abs(px) - Math.abs(pz));
  const len = Math.hypot(px, py, pz) || 1;
  out[0] = px / len;
  out[1] = py / len;
  out[2] = pz / len;
  return out;
}

/**
 * Encodes a full-sphere unit direction `(dx, dy, dz)` (+Y up) into octahedral UV `[0, 1]^2`
 * (Cigolle et al. 2014).
 *
 * @invariant VEG-OCT-BIJECTION: Exact inverse of `fullOctahedronToDir` across S^2.
 */
export function dirToFullOctahedron(
  dx: number,
  dy: number,
  dz: number,
  out: [number, number] = [0, 0],
): [number, number] {
  const sum = Math.abs(dx) + Math.abs(dy) + Math.abs(dz);
  if (sum <= 1e-12) {
    out[0] = 0.5;
    out[1] = 0.5;
    return out;
  }
  let nx = dx / sum;
  let nz = dz / sum;
  if (dy < 0) {
    const ox = nx;
    const oz = nz;
    nx = (1 - Math.abs(oz)) * (ox >= 0 ? 1 : -1);
    nz = (1 - Math.abs(ox)) * (oz >= 0 ? 1 : -1);
  }
  out[0] = Math.min(1, Math.max(0, nx * 0.5 + 0.5));
  out[1] = Math.min(1, Math.max(0, nz * 0.5 + 0.5));
  return out;
}

/**
 * Decodes full-octahedral UV `[0, 1]^2` back into a unit direction `(x, y, z)`.
 *
 * @invariant VEG-OCT-BIJECTION: `fullOctahedronToDir(dirToFullOctahedron(d)) == d` across S^2.
 */
export function fullOctahedronToDir(
  u: number,
  v: number,
  out: [number, number, number] = [0, 1, 0],
): [number, number, number] {
  const nx = u * 2 - 1;
  const nz = v * 2 - 1;
  const py = 1 - Math.abs(nx) - Math.abs(nz);
  let px = nx;
  let pz = nz;
  if (py < 0) {
    const ox = px;
    const oz = pz;
    px = (1 - Math.abs(oz)) * (ox >= 0 ? 1 : -1);
    pz = (1 - Math.abs(ox)) * (oz >= 0 ? 1 : -1);
  }
  const len = Math.hypot(px, py, pz) || 1;
  out[0] = px / len;
  out[1] = py / len;
  out[2] = pz / len;
  return out;
}

/** Dispatches to hemi- or full-octahedral forward projection. */
export function dirToOctahedron(
  dx: number,
  dy: number,
  dz: number,
  mode: OctahedralMappingMode,
  out: [number, number] = [0, 0],
): [number, number] {
  return mode === "full"
    ? dirToFullOctahedron(dx, dy, dz, out)
    : dirToHemiOctahedron(dx, dy, dz, out);
}

/** Dispatches to hemi- or full-octahedral inverse projection. */
export function octahedronToDir(
  u: number,
  v: number,
  mode: OctahedralMappingMode,
  out: [number, number, number] = [0, 1, 0],
): [number, number, number] {
  return mode === "full" ? fullOctahedronToDir(u, v, out) : hemiOctahedronToDir(u, v, out);
}

/** Returns the capture camera unit direction pointing from impostor pivot toward the camera for atlas cell `(col, row)`. */
export function octahedralCellCenterDir(
  col: number,
  row: number,
  gridSize: number,
  mode: OctahedralMappingMode,
  out: [number, number, number] = [0, 1, 0],
): [number, number, number] {
  const denom = Math.max(1, gridSize - 1);
  const u = Math.min(1, Math.max(0, col / denom));
  const v = Math.min(1, Math.max(0, row / denom));
  return octahedronToDir(u, v, mode, out);
}

const _octUvScratch: [number, number] = [0, 0];

/**
 * Samples the 3 nearest octahedral grid cells enclosing `dir` and returns exact barycentric
 * blend weights `(w0, w1, w2)`.
 *
 * @invariant VEG-OCT-WEIGHTS: `w0, w1, w2 >= 0` and `w0 + w1 + w2 == 1` identically.
 */
export function sampleOctahedralCells(
  dx: number,
  dy: number,
  dz: number,
  gridSize: number,
  mode: OctahedralMappingMode,
  out?: OctahedralCellSample,
): OctahedralCellSample {
  const res: OctahedralCellSample = out ?? {
    c0x: 0,
    c0y: 0,
    w0: 1,
    c1x: 0,
    c1y: 0,
    w1: 0,
    c2x: 0,
    c2y: 0,
    w2: 0,
  };
  const n = Math.max(2, Math.floor(gridSize));
  const [u, v] = dirToOctahedron(dx, dy, dz, mode, _octUvScratch);
  const gx = u * (n - 1);
  const gy = v * (n - 1);
  const ix = Math.min(n - 2, Math.max(0, Math.floor(gx)));
  const iy = Math.min(n - 2, Math.max(0, Math.floor(gy)));
  const fx = gx - ix;
  const fy = gy - iy;

  res.c0x = ix;
  res.c0y = iy;
  res.c1x = ix + 1;
  res.c1y = iy + 1;

  if (fx >= fy) {
    res.c2x = ix + 1;
    res.c2y = iy;
    res.w0 = 1 - fx;
    res.w1 = fy;
    res.w2 = fx - fy;
  } else {
    res.c2x = ix;
    res.c2y = iy + 1;
    res.w0 = 1 - fy;
    res.w1 = fx;
    res.w2 = fy - fx;
  }
  return res;
}

/** Validates and constructs an `OctahedralImpostorManifest`. */
export function createOctahedralImpostorManifest(
  options: OctahedralImpostorManifestOptions = {},
): OctahedralImpostorManifest {
  const gridSize = Math.floor(options.gridSize ?? 12);
  const tileResolution = Math.floor(options.tileResolution ?? 64);
  const boundingRadius = options.boundingRadius ?? 1.0;
  if (gridSize < 2) {
    throw new Error(`[OctahedralImpostor] gridSize must be >= 2 (got ${gridSize}).`);
  }
  if (tileResolution < 8) {
    throw new Error(`[OctahedralImpostor] tileResolution must be >= 8 (got ${tileResolution}).`);
  }
  if (!(boundingRadius > 0)) {
    throw new Error(`[OctahedralImpostor] boundingRadius must be > 0 (got ${boundingRadius}).`);
  }
  return {
    version: 1,
    mapping: options.mapping ?? "hemi",
    gridSize,
    tileResolution,
    boundingRadius,
    pivotOffsetY: options.pivotOffsetY ?? boundingRadius,
    alphaTest: Math.min(1, Math.max(0, options.alphaTest ?? 0.45)),
    parallaxStrength: Math.min(1, Math.max(0, options.parallaxStrength ?? 0.35)),
  };
}

/**
 * Generates an upright single-quad geometry scaled to `[-boundingRadius, boundingRadius]^2`
 * compatible with `OctahedralImpostorMaterial` (and directly `Uint16Array`-indexed for WebGL1).
 */
export function buildOctahedralImpostorGeometry(
  manifest: OctahedralImpostorManifest,
): GeometryDataInterface {
  const r = manifest.boundingRadius;
  const vertices = new Float32Array([-r, -r, 0, r, -r, 0, r, r, 0, -r, r, 0]);
  const normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]);
  const uvs = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
  const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);
  const bounds: BoundingVolume = new BoundingBox(new Vector3D(-r, -r, -r), new Vector3D(r, r, r));
  return {
    vertices,
    normals,
    uvs,
    indices,
    getBoundingVolume: () => bounds,
  };
}

/**
 * Iterates all `gridSize × gridSize` octahedral view directions and delegates tile capture to
 * `renderTile`, packing the resulting RGBA8 tiles into an `OctahedralImpostorAtlasData` pair.
 */
export async function captureOctahedralImpostorAtlas(
  manifest: OctahedralImpostorManifest,
  renderTile: (params: CaptureAtlasTileCallbackParams) =>
    | Promise<{ albedoAlpha: Uint8Array; normalDepth?: Uint8Array }>
    | {
        albedoAlpha: Uint8Array;
        normalDepth?: Uint8Array;
      },
): Promise<OctahedralImpostorAtlasData> {
  const { gridSize, tileResolution, boundingRadius, pivotOffsetY, mapping } = manifest;
  const atlasSize = gridSize * tileResolution;
  const albedoAlpha = new Uint8Array(atlasSize * atlasSize * 4);
  const normalDepth = new Uint8Array(atlasSize * atlasSize * 4);
  const tileBytes = tileResolution * tileResolution * 4;
  const dir: [number, number, number] = [0, 1, 0];

  for (let row = 0; row < gridSize; row++) {
    for (let col = 0; col < gridSize; col++) {
      octahedralCellCenterDir(col, row, gridSize, mapping, dir);
      const tile = await renderTile({
        col,
        row,
        direction: dir,
        targetPivotY: pivotOffsetY,
        boundingRadius,
        tileResolution,
      });
      if (tile.albedoAlpha.length < tileBytes) {
        throw new Error(
          `[OctahedralImpostor] Tile (${col}, ${row}) albedoAlpha too small (${tile.albedoAlpha.length} < ${tileBytes}).`,
        );
      }
      const dstX0 = col * tileResolution;
      const dstY0 = row * tileResolution;
      for (let py = 0; py < tileResolution; py++) {
        const srcRowOffset = py * tileResolution * 4;
        const dstRowOffset = ((dstY0 + py) * atlasSize + dstX0) * 4;
        albedoAlpha.set(
          tile.albedoAlpha.subarray(srcRowOffset, srcRowOffset + tileResolution * 4),
          dstRowOffset,
        );
        if (tile.normalDepth) {
          normalDepth.set(
            tile.normalDepth.subarray(srcRowOffset, srcRowOffset + tileResolution * 4),
            dstRowOffset,
          );
        } else {
          // Neutral object-space normal (world +Y-biased view fill) + midpoint depth
          for (let px = 0; px < tileResolution; px++) {
            const p = dstRowOffset + px * 4;
            normalDepth[p] = Math.round((dir[0] * 0.5 + 0.5) * 255);
            normalDepth[p + 1] = Math.round((dir[1] * 0.5 + 0.5) * 255);
            normalDepth[p + 2] = Math.round((dir[2] * 0.5 + 0.5) * 255);
            normalDepth[p + 3] = 128;
          }
        }
      }
    }
  }

  return {
    manifest,
    width: atlasSize,
    height: atlasSize,
    albedoAlpha,
    normalDepth,
  };
}

/**
 * Generates a deterministic procedural tree silhouette + normal/depth atlas pair on CPU.
 * Useful for tests, zero-asset prototyping, and validating the 3-cell blend shader offline.
 */
export function createProceduralImpostorAtlas(
  manifest: OctahedralImpostorManifest,
  options: ProceduralImpostorAtlasOptions = {},
): OctahedralImpostorAtlasData {
  const foliage = options.foliageColor ?? [0.22, 0.38, 0.16];
  const trunk = options.trunkColor ?? [0.28, 0.21, 0.14];
  const seed = options.seed ?? 1;
  const { gridSize, tileResolution, mapping } = manifest;
  const atlasSize = gridSize * tileResolution;
  const albedoAlpha = new Uint8Array(atlasSize * atlasSize * 4);
  const normalDepth = new Uint8Array(atlasSize * atlasSize * 4);
  const viewDir: [number, number, number] = [0, 1, 0];

  for (let row = 0; row < gridSize; row++) {
    for (let col = 0; col < gridSize; col++) {
      octahedralCellCenterDir(col, row, gridSize, mapping, viewDir);
      const vx = viewDir[0];
      const vy = viewDir[1];
      const vz = viewDir[2];
      // Orthonormal right/up axes matching vertex billboard projection
      const useFallbackUp = Math.abs(vy) > 0.98;
      const ux = 0;
      const uy = useFallbackUp ? 0 : 1;
      const uz = useFallbackUp ? -1 : 0;
      let rx = uy * vz - uz * vy;
      let ry = uz * vx - ux * vz;
      let rz = ux * vy - uy * vx;
      const rLen = Math.hypot(rx, ry, rz) || 1;
      rx /= rLen;
      ry /= rLen;
      rz /= rLen;
      const cx = vy * rz - vz * ry;
      const cy = vz * rx - vx * rz;
      const cz = vx * ry - vy * rx;

      const x0 = col * tileResolution;
      const y0 = row * tileResolution;
      for (let py = 0; py < tileResolution; py++) {
        // Tile local Y in [-1, 1] (+1 = top)
        const ty = 1 - ((py + 0.5) / tileResolution) * 2;
        for (let px = 0; px < tileResolution; px++) {
          const tx = ((px + 0.5) / tileResolution) * 2 - 1;
          const idx = ((y0 + py) * atlasSize + (x0 + px)) * 4;
          // Project screen coord onto tree crown sphere (centred at (0, 0.12, 0), r = 0.68) & trunk
          const crownCenterS = cx * 0 + cy * 0.12 + cz * 0;
          const crownRightS = rx * 0 + ry * 0.12 + rz * 0;
          const dxCrown = tx - crownRightS;
          const dyCrown = ty - crownCenterS;
          const dist2 = dxCrown * dxCrown + dyCrown * dyCrown;
          const crownRadius = 0.68;
          const wobble =
            0.05 *
            Math.sin((tx * 9.3 + seed * 1.7) * 2.1) *
            Math.cos((ty * 8.1 - seed * 0.9) * 2.1);

          // Simple vertical cylinder test for trunk below crown
          const trunkX = tx;
          const trunkY = ty;
          const inCrown = Math.sqrt(dist2) <= crownRadius + wobble;
          const inTrunk =
            !inCrown &&
            Math.abs(trunkX) <= 0.11 * (1 - 0.35 * (trunkY + 1)) &&
            trunkY >= -0.92 &&
            trunkY <= 0.05;

          if (!inCrown && !inTrunk) {
            albedoAlpha[idx] = Math.round(foliage[0] * 255);
            albedoAlpha[idx + 1] = Math.round(foliage[1] * 255);
            albedoAlpha[idx + 2] = Math.round(foliage[2] * 255);
            albedoAlpha[idx + 3] = 0;
            normalDepth[idx] = 128;
            normalDepth[idx + 1] = 255;
            normalDepth[idx + 2] = 128;
            normalDepth[idx + 3] = 0;
            continue;
          }

          let nx: number;
          let ny: number;
          let nz: number;
          let depth: number;
          if (inCrown) {
            const effR = crownRadius + wobble;
            const dFront = Math.sqrt(Math.max(0, effR * effR - dist2));
            const localX = rx * dxCrown + cx * dyCrown + vx * dFront;
            const localY = ry * dxCrown + cy * dyCrown + vy * dFront;
            const localZ = rz * dxCrown + cz * dyCrown + vz * dFront;
            const nLen = Math.hypot(localX, localY, localZ) || 1;
            nx = localX / nLen;
            ny = localY / nLen;
            nz = localZ / nLen;
            depth = Math.min(1, Math.max(0, 0.5 - dFront * 0.5));
            const shade = 0.8 + 0.2 * ny;
            albedoAlpha[idx] = Math.round(Math.min(1, foliage[0] * shade) * 255);
            albedoAlpha[idx + 1] = Math.round(Math.min(1, foliage[1] * shade) * 255);
            albedoAlpha[idx + 2] = Math.round(Math.min(1, foliage[2] * shade) * 255);
            albedoAlpha[idx + 3] = 255;
          } else {
            const txNorm = trunkX / 0.11;
            const zFront = Math.sqrt(Math.max(0, 1 - txNorm * txNorm));
            nx = rx * txNorm + vx * zFront;
            ny = ry * txNorm + vy * zFront;
            nz = rz * txNorm + vz * zFront;
            const nLen = Math.hypot(nx, ny, nz) || 1;
            nx /= nLen;
            ny /= nLen;
            nz /= nLen;
            depth = 0.55;
            albedoAlpha[idx] = Math.round(trunk[0] * 255);
            albedoAlpha[idx + 1] = Math.round(trunk[1] * 255);
            albedoAlpha[idx + 2] = Math.round(trunk[2] * 255);
            albedoAlpha[idx + 3] = 255;
          }
          normalDepth[idx] = Math.round((nx * 0.5 + 0.5) * 255);
          normalDepth[idx + 1] = Math.round((ny * 0.5 + 0.5) * 255);
          normalDepth[idx + 2] = Math.round((nz * 0.5 + 0.5) * 255);
          normalDepth[idx + 3] = Math.round(depth * 255);
        }
      }
    }
  }

  return {
    manifest,
    width: atlasSize,
    height: atlasSize,
    albedoAlpha,
    normalDepth,
  };
}

/** Converts an `OctahedralImpostorAtlasData` payload into GPU-ready `Texture` objects. */
export function createTexturesFromImpostorAtlas(atlas: OctahedralImpostorAtlasData): {
  albedoMap: Texture;
  normalDepthMap: Texture;
} {
  const albedoChain: RawMipChain = {
    width: atlas.width,
    height: atlas.height,
    mipData: [atlas.albedoAlpha],
  };
  const normalChain: RawMipChain = {
    width: atlas.width,
    height: atlas.height,
    mipData: [atlas.normalDepth],
  };
  const opts = {
    magFilter: TextureFilter.LINEAR,
    minFilter: TextureFilter.LINEAR,
    addressModeU: TextureWrap.CLAMP_TO_EDGE,
    addressModeV: TextureWrap.CLAMP_TO_EDGE,
    generateMipmaps: false,
  };
  return {
    albedoMap: Texture.fromRawMipChain(albedoChain, opts),
    normalDepthMap: Texture.fromRawMipChain(normalChain, opts),
  };
}

const IMPOSTOR_WGSL = `
[WGSL_STRUCTS]
[WGSL_PBR_MATH]

struct OctCell {
    c0: vec2f,
    c1: vec2f,
    c2: vec2f,
    w: vec3f,
}

fn dirToOctUv(d: vec3f, fullMode: f32) -> vec2f {
    if (fullMode > 0.5) {
        let sum = abs(d.x) + abs(d.y) + abs(d.z);
        if (sum <= 1e-6) { return vec2f(0.5, 0.5); }
        var nx = d.x / sum;
        var nz = d.z / sum;
        if (d.y < 0.0) {
            let ox = nx;
            let oz = nz;
            nx = (1.0 - abs(oz)) * select(-1.0, 1.0, ox >= 0.0);
            nz = (1.0 - abs(ox)) * select(-1.0, 1.0, oz >= 0.0);
        }
        return clamp(vec2f(nx * 0.5 + 0.5, nz * 0.5 + 0.5), vec2f(0.0), vec2f(1.0));
    }
    let cy = max(d.y, 0.0);
    let sum = abs(d.x) + cy + abs(d.z);
    if (sum <= 1e-6) { return vec2f(0.5, 0.5); }
    let px = d.x / sum;
    let pz = d.z / sum;
    let nx = px - pz;
    let nz = px + pz;
    return clamp(vec2f(nx * 0.5 + 0.5, nz * 0.5 + 0.5), vec2f(0.0), vec2f(1.0));
}

fn sampleOctCells(d: vec3f, gridSize: f32, fullMode: f32) -> OctCell {
    let uv = dirToOctUv(d, fullMode);
    let maxIdx = max(gridSize - 2.0, 0.0);
    let g = uv * (gridSize - 1.0);
    let ix = clamp(floor(g.x), 0.0, maxIdx);
    let iy = clamp(floor(g.y), 0.0, maxIdx);
    let fx = g.x - ix;
    let fy = g.y - iy;
    var outCell: OctCell;
    outCell.c0 = vec2f(ix, iy);
    outCell.c1 = vec2f(ix + 1.0, iy + 1.0);
    if (fx >= fy) {
        outCell.c2 = vec2f(ix + 1.0, iy);
        outCell.w = vec3f(1.0 - fx, fy, fx - fy);
    } else {
        outCell.c2 = vec2f(ix, iy + 1.0);
        outCell.w = vec3f(1.0 - fy, fx, fy - fx);
    }
    return outCell;
}

@vertex fn vs(
    @location(0) pos: vec3f,
    @location(1) normal: vec3f,
    @location(2) uv: vec2f,
    @location(3) tangent: vec4f,
    @location(4) joints: vec4f,
    @location(5) weights: vec4f
) -> Out {
    var o: Out;
    let pivotY = obj.matParam0.w;
    let worldCenter = (obj.model * vec4f(0.0, pivotY, 0.0, 1.0)).xyz;
    let col0 = obj.model[0].xyz;
    let col1 = obj.model[1].xyz;
    let col2 = obj.model[2].xyz;
    let scaleX = max(length(col0), 1e-4);
    let scaleY = max(length(col1), 1e-4);
    let scaleZ = max(length(col2), 1e-4);
    let bx = col0 / scaleX;
    let by = col1 / scaleY;
    let bz = col2 / scaleZ;

    var toCam = global.viewPos.xyz - worldCenter;
    let camDist = length(toCam);
    if (camDist > 1e-5) {
        toCam = toCam / camDist;
    } else {
        toCam = vec3f(0.0, 0.0, 1.0);
    }
    let upRef = select(vec3f(0.0, 1.0, 0.0), vec3f(0.0, 0.0, -1.0), abs(toCam.y) > 0.98);
    let right = normalize(cross(upRef, toCam));
    let camUp = cross(toCam, right);

    // Subtle global foliage wind sway weighted from quad base to top
    let swayAmp = obj.matParam1.y;
    let swayFreq = obj.matParam1.z;
    let phase = dot(worldCenter.xz, vec2f(0.37, 0.53)) + obj.time * swayFreq;
    let sway = vec2f(sin(phase), cos(phase * 0.77)) * (swayAmp * uv.y);

    let worldPos = worldCenter + right * (pos.x * scaleX + sway.x) + camUp * (pos.y * scaleY) + vec3f(0.0, 0.0, sway.y);
    o.pos = view.vp * vec4f(worldPos, 1.0);
    o.wp = worldPos;
    o.uv = uv;
    o.original_uv = uv;
    // Pass local camera direction in o.n and instance +X/+Z axes in o.t/o.b for normal decode
    o.n = normalize(vec3f(dot(toCam, bx), dot(toCam, by), dot(toCam, bz)));
    o.t = bx;
    o.b = bz;
    o.texIndex = atan2(bz.x, bx.x);
    o.instColor = vec4f(1.0);
    return o;
}

@fragment fn fs(i: Out) -> @location(0) vec4f {
    let gridSize = max(obj.matParam0.x, 2.0);
    let fullMode = obj.matParam0.y;
    let invGrid = obj.matParam1.w;
    let parallaxStrength = obj.matParam1.x;
    let alphaCutoff = obj.extraParams.y;
    let localCam = normalize(i.n);
    let cells = sampleOctCells(localCam, gridSize, fullMode);

    let tileUv0 = (cells.c0 + vec2f(i.uv.x, 1.0 - i.uv.y)) * invGrid;
    let tileUv1 = (cells.c1 + vec2f(i.uv.x, 1.0 - i.uv.y)) * invGrid;
    let tileUv2 = (cells.c2 + vec2f(i.uv.x, 1.0 - i.uv.y)) * invGrid;

    let nDepth0 = textureSample(u_normalMap, s, tileUv0);
    let nDepth1 = textureSample(u_normalMap, s, tileUv1);
    let nDepth2 = textureSample(u_normalMap, s, tileUv2);

    // Subtle depth-based parallax inside each tile, clamped within tile bounds
    let pad = obj.matParam2.z;
    let pOff = (i.uv - vec2f(0.5)) * parallaxStrength * invGrid;
    let uv0 = clamp(tileUv0 + pOff * (0.5 - nDepth0.a), cells.c0 * invGrid + pad, (cells.c0 + 1.0) * invGrid - pad);
    let uv1 = clamp(tileUv1 + pOff * (0.5 - nDepth1.a), cells.c1 * invGrid + pad, (cells.c1 + 1.0) * invGrid - pad);
    let uv2 = clamp(tileUv2 + pOff * (0.5 - nDepth2.a), cells.c2 * invGrid + pad, (cells.c2 + 1.0) * invGrid - pad);

    let c0 = textureSample(u_diffuseMap, s, uv0);
    let c1 = textureSample(u_diffuseMap, s, uv1);
    let c2 = textureSample(u_diffuseMap, s, uv2);

    let blended = c0 * cells.w.x + c1 * cells.w.y + c2 * cells.w.z;
    let finalAlpha = obj.color.a * blended.a;
    if (finalAlpha < alphaCutoff) {
        discard;
    }

    let nMix = (nDepth0.rgb * 2.0 - 1.0) * cells.w.x
             + (nDepth1.rgb * 2.0 - 1.0) * cells.w.y
             + (nDepth2.rgb * 2.0 - 1.0) * cells.w.z;
    let bx = normalize(i.t);
    let bz = normalize(i.b);
    let by = normalize(cross(bz, bx));
    let worldN = normalize(bx * nMix.x + by * nMix.y + bz * nMix.z);
    g_shadingNormal = worldN;

    let albedo = sRGBToLinear(blended.rgb) * sRGBToLinear(obj.color.rgb);
    let L = normalize(global.dirLightDir.xyz);
    let V = normalize(global.viewPos.xyz - i.wp);
    let ndotl = max(dot(worldN, L), 0.0);
    let translucency = obj.matParam2.y;
    let wrapDiff = max((dot(worldN, L) + translucency) / (1.0 + translucency), 0.0);

    var shadow = 1.0;
    if (global.dirShadowInfo.z > 0.5) {
        let numCascades = u32(global.dirShadowInfo.w);
        var cascadeIndex = max(numCascades, 1u) - 1u;
        let viewDist = length(global.viewPos.xyz - i.wp);
        for (var c: u32 = 0u; c < numCascades; c++) {
            if (viewDist < global.cascadeSplits[c]) {
                cascadeIndex = c;
                break;
            }
        }
        let samplePos = i.wp + worldN * global.dirShadowBias[cascadeIndex] * (1.0 - ndotl);
        let shadowPos = global.cascadeMatrices[cascadeIndex] * vec4f(samplePos, 1.0);
        shadow = getShadowDirMain(u_dirShadowMap, shadowSampler, shadowPos, cascadeIndex, global.dirShadowInfo.x);
    }

    let skyAmbient = global.ambientColor.rgb * mix(0.65, 1.15, worldN.y * 0.5 + 0.5);
    let backLight = max(dot(-V, L), 0.0) * translucency * 0.5;
    var color = albedo * (skyAmbient + global.dirLightColor.rgb * (wrapDiff + backLight) * shadow);
    color *= global.exposure;
    color = forwardToneMap(color);
    color = linearToSRGB(color);
    [WGSL_FOG_CALC]
    return vec4f(color, finalAlpha);
}
`;

const IMPOSTOR_GLSL300_VS = `[BASE_VERTEX_HEADER]
uniform float u_time;
uniform vec4 u_matParam0;
uniform vec4 u_matParam1;

void main() {
    float pivotY = u_matParam0.w;
    vec3 worldCenter = (u_model * vec4(0.0, pivotY, 0.0, 1.0)).xyz;
    vec3 col0 = u_model[0].xyz;
    vec3 col1 = u_model[1].xyz;
    vec3 col2 = u_model[2].xyz;
    float scaleX = max(length(col0), 1e-4);
    float scaleY = max(length(col1), 1e-4);
    float scaleZ = max(length(col2), 1e-4);
    vec3 bx = col0 / scaleX;
    vec3 by = col1 / scaleY;
    vec3 bz = col2 / scaleZ;

    vec3 toCam = u_viewPos - worldCenter;
    float camDist = length(toCam);
    toCam = camDist > 1e-5 ? (toCam / camDist) : vec3(0.0, 0.0, 1.0);
    vec3 upRef = abs(toCam.y) > 0.98 ? vec3(0.0, 0.0, -1.0) : vec3(0.0, 1.0, 0.0);
    vec3 right = normalize(cross(upRef, toCam));
    vec3 camUp = cross(toCam, right);

    float swayAmp = u_matParam1.y;
    float swayFreq = u_matParam1.z;
    float phase = dot(worldCenter.xz, vec2(0.37, 0.53)) + u_time * swayFreq;
    vec2 sway = vec2(sin(phase), cos(phase * 0.77)) * (swayAmp * a_uv.y);

    vec3 worldPos = worldCenter + right * (a_position.x * scaleX + sway.x) + camUp * (a_position.y * scaleY) + vec3(0.0, 0.0, sway.y);
    v_worldPos = worldPos;
    v_uv = a_uv;
    v_normal = normalize(vec3(dot(toCam, bx), dot(toCam, by), dot(toCam, bz)));
    v_tbn = mat3(bx, by, bz);
    for (int i = 0; i < 4; i++) {
        v_spotLightSpacePos[i] = vec4(0.0);
    }
    gl_Position = u_vp * vec4(worldPos, 1.0);
}
`;

const IMPOSTOR_GLSL300_FS = `[BASE_FRAGMENT_HEADER]
[FOG_DEFS]
[LIGHT_DEFS]
[PBR_MATH]

uniform vec4 u_matParam0;
uniform vec4 u_matParam1;
uniform vec4 u_matParam2;

vec2 dirToOctUv(vec3 d, float fullMode) {
    if (fullMode > 0.5) {
        float sum = abs(d.x) + abs(d.y) + abs(d.z);
        if (sum <= 1e-6) return vec2(0.5, 0.5);
        float nx = d.x / sum;
        float nz = d.z / sum;
        if (d.y < 0.0) {
            float ox = nx;
            float oz = nz;
            nx = (1.0 - abs(oz)) * (ox >= 0.0 ? 1.0 : -1.0);
            nz = (1.0 - abs(ox)) * (oz >= 0.0 ? 1.0 : -1.0);
        }
        return clamp(vec2(nx * 0.5 + 0.5, nz * 0.5 + 0.5), 0.0, 1.0);
    }
    float cy = max(d.y, 0.0);
    float sum = abs(d.x) + cy + abs(d.z);
    if (sum <= 1e-6) return vec2(0.5, 0.5);
    float px = d.x / sum;
    float pz = d.z / sum;
    return clamp(vec2((px - pz) * 0.5 + 0.5, (px + pz) * 0.5 + 0.5), 0.0, 1.0);
}

void main() {
    float gridSize = max(u_matParam0.x, 2.0);
    float fullMode = u_matParam0.y;
    float invGrid = u_matParam1.w;
    float parallaxStrength = u_matParam1.x;
    float alphaCutoff = u_extraParams.y;

    vec2 octUv = dirToOctUv(normalize(v_normal), fullMode);
    float maxIdx = max(gridSize - 2.0, 0.0);
    vec2 g = octUv * (gridSize - 1.0);
    float ix = clamp(floor(g.x), 0.0, maxIdx);
    float iy = clamp(floor(g.y), 0.0, maxIdx);
    float fx = g.x - ix;
    float fy = g.y - iy;
    vec2 c0 = vec2(ix, iy);
    vec2 c1 = vec2(ix + 1.0, iy + 1.0);
    vec2 c2 = fx >= fy ? vec2(ix + 1.0, iy) : vec2(ix, iy + 1.0);
    vec3 w = fx >= fy ? vec3(1.0 - fx, fy, fx - fy) : vec3(1.0 - fy, fx, fy - fx);

    vec2 tileLocal = vec2(v_uv.x, 1.0 - v_uv.y);
    vec2 tileUv0 = (c0 + tileLocal) * invGrid;
    vec2 tileUv1 = (c1 + tileLocal) * invGrid;
    vec2 tileUv2 = (c2 + tileLocal) * invGrid;

#ifdef USE_NORMAL_MAP
    vec4 nDepth0 = texture(u_normalMap, tileUv0);
    vec4 nDepth1 = texture(u_normalMap, tileUv1);
    vec4 nDepth2 = texture(u_normalMap, tileUv2);
#else
    vec4 nDepth0 = vec4(0.5, 1.0, 0.5, 0.5);
    vec4 nDepth1 = vec4(0.5, 1.0, 0.5, 0.5);
    vec4 nDepth2 = vec4(0.5, 1.0, 0.5, 0.5);
#endif

    float pad = u_matParam2.z;
    vec2 pOff = (v_uv - vec2(0.5)) * parallaxStrength * invGrid;
    vec2 uv0 = clamp(tileUv0 + pOff * (0.5 - nDepth0.a), c0 * invGrid + pad, (c0 + 1.0) * invGrid - pad);
    vec2 uv1 = clamp(tileUv1 + pOff * (0.5 - nDepth1.a), c1 * invGrid + pad, (c1 + 1.0) * invGrid - pad);
    vec2 uv2 = clamp(tileUv2 + pOff * (0.5 - nDepth2.a), c2 * invGrid + pad, (c2 + 1.0) * invGrid - pad);

    vec4 col0 = texture(u_diffuseMap, uv0);
    vec4 col1 = texture(u_diffuseMap, uv1);
    vec4 col2 = texture(u_diffuseMap, uv2);
    vec4 blended = col0 * w.x + col1 * w.y + col2 * w.z;
    float finalAlpha = u_color.a * blended.a;
    if (finalAlpha < alphaCutoff) {
        discard;
    }

    vec3 nMix = (nDepth0.rgb * 2.0 - 1.0) * w.x
              + (nDepth1.rgb * 2.0 - 1.0) * w.y
              + (nDepth2.rgb * 2.0 - 1.0) * w.z;
    vec3 worldN = normalize(v_tbn * nMix);
#ifdef USE_NORMAL_OUT
    g_shadingNormal = worldN;
#endif

    vec3 albedo = sRGBToLinear(blended.rgb) * sRGBToLinear(u_color.rgb);
    vec3 L = normalize(u_dirLightDir);
    vec3 V = normalize(u_viewPos - v_worldPos);
    float ndotl = max(dot(worldN, L), 0.0);
    float translucency = u_matParam2.y;
    float wrapDiff = max((dot(worldN, L) + translucency) / (1.0 + translucency), 0.0);
    float viewDist = length(u_viewPos - v_worldPos);
    float shadow = glassDirShadowFactor(v_worldPos, ndotl, worldN, viewDist);

    vec3 skyAmbient = u_ambientColor * mix(0.65, 1.15, worldN.y * 0.5 + 0.5);
    float backLight = max(dot(-V, L), 0.0) * translucency * 0.5;
    vec3 color = albedo * (skyAmbient + u_dirLightColor * (wrapDiff + backLight) * shadow);
    color *= u_exposure;
    color = forwardToneMap(color);
    color = linearToSRGB(color);
    fragColor = vec4(color, finalAlpha);
    [FOG_CALC]
}
`;

const IMPOSTOR_GLSL100_VS = `
attribute vec3 a_position;
attribute vec3 a_normal;
attribute vec2 a_uv;
attribute vec4 a_tangent;

uniform mat4 u_vp;
uniform mat4 u_model;
uniform vec3 u_viewPos;
uniform float u_time;
uniform vec4 u_matParam0;
uniform vec4 u_matParam1;

varying vec3 v_worldPos;
varying vec3 v_normal;
varying vec2 v_uv;
varying mat3 v_tbn;
varying vec4 v_clipPos;

void main() {
    float pivotY = u_matParam0.w;
    vec3 worldCenter = (u_model * vec4(0.0, pivotY, 0.0, 1.0)).xyz;
    vec3 col0 = u_model[0].xyz;
    vec3 col1 = u_model[1].xyz;
    vec3 col2 = u_model[2].xyz;
    float scaleX = max(length(col0), 1e-4);
    float scaleY = max(length(col1), 1e-4);
    float scaleZ = max(length(col2), 1e-4);
    vec3 bx = col0 / scaleX;
    vec3 by = col1 / scaleY;
    vec3 bz = col2 / scaleZ;

    vec3 toCam = u_viewPos - worldCenter;
    float camDist = length(toCam);
    toCam = camDist > 1e-5 ? (toCam / camDist) : vec3(0.0, 0.0, 1.0);
    vec3 upRef = abs(toCam.y) > 0.98 ? vec3(0.0, 0.0, -1.0) : vec3(0.0, 1.0, 0.0);
    vec3 right = normalize(cross(upRef, toCam));
    vec3 camUp = cross(toCam, right);

    float swayAmp = u_matParam1.y;
    float swayFreq = u_matParam1.z;
    float phase = dot(worldCenter.xz, vec2(0.37, 0.53)) + u_time * swayFreq;
    vec2 sway = vec2(sin(phase), cos(phase * 0.77)) * (swayAmp * a_uv.y);

    vec3 worldPos = worldCenter + right * (a_position.x * scaleX + sway.x) + camUp * (a_position.y * scaleY) + vec3(0.0, 0.0, sway.y);
    v_worldPos = worldPos;
    v_uv = a_uv;
    v_normal = normalize(vec3(dot(toCam, bx), dot(toCam, by), dot(toCam, bz)));
    v_tbn = mat3(bx, by, bz);
    v_clipPos = u_vp * vec4(worldPos, 1.0);
    gl_Position = v_clipPos;
}
`;

const IMPOSTOR_GLSL100_FS = `
[BASE_FS_HEADER]
[FOG_DEFS]
[LIGHT_DEFS]
[PBR_MATH]

uniform vec4 u_matParam0;
uniform vec4 u_matParam1;
uniform vec4 u_matParam2;

vec2 dirToOctUv(vec3 d, float fullMode) {
    if (fullMode > 0.5) {
        float sum = abs(d.x) + abs(d.y) + abs(d.z);
        if (sum <= 1e-6) return vec2(0.5, 0.5);
        float nx = d.x / sum;
        float nz = d.z / sum;
        if (d.y < 0.0) {
            float ox = nx;
            float oz = nz;
            nx = (1.0 - abs(oz)) * (ox >= 0.0 ? 1.0 : -1.0);
            nz = (1.0 - abs(ox)) * (oz >= 0.0 ? 1.0 : -1.0);
        }
        return clamp(vec2(nx * 0.5 + 0.5, nz * 0.5 + 0.5), 0.0, 1.0);
    }
    float cy = max(d.y, 0.0);
    float sum = abs(d.x) + cy + abs(d.z);
    if (sum <= 1e-6) return vec2(0.5, 0.5);
    float px = d.x / sum;
    float pz = d.z / sum;
    return clamp(vec2((px - pz) * 0.5 + 0.5, (px + pz) * 0.5 + 0.5), 0.0, 1.0);
}

void main() {
    float gridSize = max(u_matParam0.x, 2.0);
    float fullMode = u_matParam0.y;
    float invGrid = u_matParam1.w;
    float parallaxStrength = u_matParam1.x;
    float alphaCutoff = u_extraParams.y;

    vec2 octUv = dirToOctUv(normalize(v_normal), fullMode);
    float maxIdx = max(gridSize - 2.0, 0.0);
    vec2 g = octUv * (gridSize - 1.0);
    float ix = clamp(floor(g.x), 0.0, maxIdx);
    float iy = clamp(floor(g.y), 0.0, maxIdx);
    float fx = g.x - ix;
    float fy = g.y - iy;
    vec2 c0 = vec2(ix, iy);
    vec2 c1 = vec2(ix + 1.0, iy + 1.0);
    vec2 c2 = fx >= fy ? vec2(ix + 1.0, iy) : vec2(ix, iy + 1.0);
    vec3 w = fx >= fy ? vec3(1.0 - fx, fy, fx - fy) : vec3(1.0 - fy, fx, fy - fx);

    vec2 tileLocal = vec2(v_uv.x, 1.0 - v_uv.y);
    vec2 tileUv0 = (c0 + tileLocal) * invGrid;
    vec2 tileUv1 = (c1 + tileLocal) * invGrid;
    vec2 tileUv2 = (c2 + tileLocal) * invGrid;

    vec4 nDepth0 = texture2D(u_normalMap, tileUv0);
    vec4 nDepth1 = texture2D(u_normalMap, tileUv1);
    vec4 nDepth2 = texture2D(u_normalMap, tileUv2);

    float pad = u_matParam2.z;
    vec2 pOff = (v_uv - vec2(0.5)) * parallaxStrength * invGrid;
    vec2 uv0 = clamp(tileUv0 + pOff * (0.5 - nDepth0.a), c0 * invGrid + pad, (c0 + 1.0) * invGrid - pad);
    vec2 uv1 = clamp(tileUv1 + pOff * (0.5 - nDepth1.a), c1 * invGrid + pad, (c1 + 1.0) * invGrid - pad);
    vec2 uv2 = clamp(tileUv2 + pOff * (0.5 - nDepth2.a), c2 * invGrid + pad, (c2 + 1.0) * invGrid - pad);

    vec4 col0 = texture2D(u_diffuseMap, uv0);
    vec4 col1 = texture2D(u_diffuseMap, uv1);
    vec4 col2 = texture2D(u_diffuseMap, uv2);
    vec4 blended = col0 * w.x + col1 * w.y + col2 * w.z;
    float finalAlpha = u_color.a * blended.a;
    if (finalAlpha < alphaCutoff) {
        discard;
    }

    vec3 nMix = (nDepth0.rgb * 2.0 - 1.0) * w.x
              + (nDepth1.rgb * 2.0 - 1.0) * w.y
              + (nDepth2.rgb * 2.0 - 1.0) * w.z;
    vec3 worldN = normalize(v_tbn * nMix);
    vec3 albedo = sRGBToLinear(blended.rgb) * sRGBToLinear(u_color.rgb);
    vec3 L = normalize(u_dirLightDir);
    vec3 V = normalize(u_viewPos - v_worldPos);
    float translucency = u_matParam2.y;
    float wrapDiff = max((dot(worldN, L) + translucency) / (1.0 + translucency), 0.0);

    vec3 skyAmbient = u_ambientColor * mix(0.65, 1.15, worldN.y * 0.5 + 0.5);
    float backLight = max(dot(-V, L), 0.0) * translucency * 0.5;
    vec3 color = albedo * (skyAmbient + u_dirLightColor * (wrapDiff + backLight));
    color *= u_exposure;
    color = forwardToneMap(color);
    color = linearToSRGB(color);
    gl_FragColor = vec4(color, finalAlpha);
    [FOG_CALC]
}
`;

function createImpostorLayout(): ShaderLayout {
  return {
    uniforms: { ...StandardWebGPULayout.uniforms },
    uniformLayout: [...StandardWebGPULayout.uniformLayout],
    textures: {
      u_diffuseMap: { type: ShaderPropertyType.TEXTURE },
      u_normalMap: { type: ShaderPropertyType.TEXTURE },
    },
  };
}

/**
 * Cross-tier (`WEB_GPU`, `WEB_GL2`, `WEB_GL1`) octahedral impostor material (ADR 0059 Step 3).
 *
 * Uses spherical camera-facing billboarding with global wind sway, 3-frame barycentric
 * octahedral cell blending, depth-parallax UV offset, alpha-tested cutout, object-space
 * lighting normals rotated with the instance transform, and full directional/shadow/fog/tone parity.
 */
export class OctahedralImpostorMaterial extends CustomShaderMaterial {
  public static readonly TYPE = "OctahedralImpostorMaterial";

  constructor(options: OctahedralImpostorMaterialOptions) {
    const m = options.manifest;
    const tint = options.color ?? new Color(1, 1, 1);
    const windAmp = options.windSwayAmplitude ?? 0.15;
    const windFreq = options.windFrequency ?? 1.4;
    const roughness = Math.min(1, Math.max(0.05, options.roughness ?? 0.85));
    const translucency = Math.min(1, Math.max(0, options.translucency ?? 0.25));

    super({
      sources: {
        wgsl: IMPOSTOR_WGSL,
        glsl300: { vs: IMPOSTOR_GLSL300_VS, fs: IMPOSTOR_GLSL300_FS },
        glsl100: { vs: IMPOSTOR_GLSL100_VS, fs: IMPOSTOR_GLSL100_FS },
      },
      layout: createImpostorLayout(),
      cullMode: CullMode.NONE,
      transparent: false,
      depthWrite: true,
      depthTest: true,
      properties: {
        u_model: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        u_color: tint.toFloat32Array(),
        u_extraParams: [1.0, m.alphaTest, 1.0, 1.0],
        u_time: 0.0,
        u_matParam0: [
          m.gridSize,
          m.mapping === "full" ? 1.0 : 0.0,
          m.boundingRadius,
          m.pivotOffsetY,
        ],
        u_matParam1: [m.parallaxStrength, windAmp, windFreq, 1.0 / m.gridSize],
        u_matParam2: [roughness, translucency, 0.5 / (m.gridSize * m.tileResolution), 0.0],
      },
      textures: {
        u_diffuseMap: options.albedoMap,
        u_normalMap:
          options.normalDepthMap ??
          Texture.fromRawMipChain(
            {
              width: 1,
              height: 1,
              mipData: [new Uint8Array([128, 255, 128, 128])],
            },
            {
              magFilter: TextureFilter.NEAREST,
              minFilter: TextureFilter.NEAREST,
              addressModeU: TextureWrap.CLAMP_TO_EDGE,
              addressModeV: TextureWrap.CLAMP_TO_EDGE,
              generateMipmaps: false,
            },
          ),
      },
    });
    this.color.copyFrom(tint);
  }

  /** Updates animated foliage wind time on this impostor material without allocating. */
  public setTime(seconds: number): void {
    this.properties["u_time"] = seconds;
  }
}
