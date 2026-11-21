import { Object3D } from "../core/Object3D.js";
import type { Camera } from "../core/cameras/Camera.js";
import type { AbstractMaterial } from "../core/materials/AbstractMaterial.js";
import { Topology } from "../enums/index.js";
import type { BoundingVolume, GeometryDataInterface } from "../interfaces/index.js";
import { Frustum, Vector3D } from "../math/index.js";
import { BoundingBox } from "../physix/index.js";

/** Bitmask flags marking neighboring edges that touch a 1-level-coarser quadtree leaf. */
export const WaterTileEdge = {
  NONE: 0,
  NORTH: 1, // -Z
  EAST: 2, // +X
  SOUTH: 4, // +Z
  WEST: 8, // -X
} as const;

const UINT16_MAX_VERTICES = 65_535;
const DEFAULT_MAX_NODES = 2048;
const DEFAULT_MAX_LEAVES = 384;

function rotateGridCoord(side: number, gx: number, gz: number, s: number): number {
  let rx = gx;
  let rz = gz;
  if (side === 1) {
    // East (+X): 90 deg rotation preserving CCW +Y winding
    rx = s - gz;
    rz = gx;
  } else if (side === 2) {
    // South (+Z): 180 deg rotation
    rx = s - gx;
    rz = s - gz;
  } else if (side === 3) {
    // West (-X): 270 deg rotation
    rx = gz;
    rz = s - gx;
  }
  return rx + (s + 1) * rz;
}

/**
 * Generates all 16 crack-free edge-stitched `GeometryDataInterface` index variants sharing one
 * vertex buffer for a centered `[-0.5, +0.5]^2` XZ grid tile (`Y = 0`, upward `+Y` normal).
 *
 * Uses four disjoint perimeter border trapezoids (separated cleanly along the inner corner
 * diagonals `(0,0)-(1,1)`, `(S,0)-(S-1,1)`, `(S,S)-(S-1,S-1)`, `(0,S)-(1,S-1)`) so any of the
 * 16 edge-mask combinations `[NORTH, EAST, SOUTH, WEST]` is watertight with zero corner conflicts.
 */
export function buildWaterTileVariants(
  tileSegments: number = 16,
  verticalBoundsPadding: number = 12,
): GeometryDataInterface[] {
  const s = Math.floor(tileSegments);
  if (s < 4 || s % 2 !== 0) {
    throw new RangeError(
      `WaterQuadtree tileSegments must be an even integer >= 4, got ${tileSegments}.`,
    );
  }
  const vertCount = (s + 1) * (s + 1);
  if (vertCount > UINT16_MAX_VERTICES) {
    throw new RangeError(
      `WaterQuadtree tile vertex count (${vertCount}) exceeds Uint16 limit (${UINT16_MAX_VERTICES}).`,
    );
  }

  const vertices = new Float32Array(vertCount * 3);
  const normals = new Float32Array(vertCount * 3);
  const tangents = new Float32Array(vertCount * 4);
  const uvs = new Float32Array(vertCount * 2);

  let ptr3 = 0;
  let ptr4 = 0;
  let ptr2 = 0;
  for (let z = 0; z <= s; z++) {
    const vz = z / s;
    const pz = vz - 0.5;
    for (let x = 0; x <= s; x++) {
      const ux = x / s;
      vertices[ptr3] = ux - 0.5;
      vertices[ptr3 + 1] = 0;
      vertices[ptr3 + 2] = pz;

      normals[ptr3] = 0;
      normals[ptr3 + 1] = 1;
      normals[ptr3 + 2] = 0;

      tangents[ptr4] = 1;
      tangents[ptr4 + 1] = 0;
      tangents[ptr4 + 2] = 0;
      tangents[ptr4 + 3] = 1;

      uvs[ptr2] = ux;
      uvs[ptr2 + 1] = 1.0 - vz;

      ptr3 += 3;
      ptr4 += 4;
      ptr2 += 2;
    }
  }

  const sharedBounds: BoundingVolume = new BoundingBox(
    new Vector3D(-0.5, -verticalBoundsPadding, -0.5),
    new Vector3D(0.5, verticalBoundsPadding, 0.5),
  );
  const getBoundingVolume = (): BoundingVolume => sharedBounds;

  // Interior quads [1..s-1] x [1..s-1] are shared identically by all 16 variants.
  const interiorIndices: number[] = [];
  for (let gz = 1; gz < s - 1; gz++) {
    for (let gx = 1; gx < s - 1; gx++) {
      const a = gx + (s + 1) * gz;
      const b = gx + (s + 1) * (gz + 1);
      const c = gx + 1 + (s + 1) * (gz + 1);
      const d = gx + 1 + (s + 1) * gz;
      interiorIndices.push(a, b, d, b, c, d);
    }
  }

  const variants: GeometryDataInterface[] = new Array<GeometryDataInterface>(16);
  const halfPairs = s / 2;

  for (let mask = 0; mask < 16; mask++) {
    const tri: number[] = interiorIndices.slice();

    for (let side = 0; side < 4; side++) {
      const coarse = (mask & (1 << side)) !== 0;
      const idx = (gx: number, gz: number): number => rotateGridCoord(side, gx, gz, s);

      for (let k = 0; k < halfPairs; k++) {
        const x0 = k * 2;
        const x1 = x0 + 1;
        const x2 = x0 + 2;
        const isFirst = k === 0;
        const isLast = x2 === s;

        if (!coarse) {
          if (isFirst) {
            tri.push(idx(0, 0), idx(1, 1), idx(1, 0));
            tri.push(idx(1, 0), idx(1, 1), idx(2, 1));
            tri.push(idx(1, 0), idx(2, 1), idx(2, 0));
          } else if (isLast) {
            tri.push(idx(x0, 0), idx(x0, 1), idx(x1, 1));
            tri.push(idx(x0, 0), idx(x1, 1), idx(x1, 0));
            tri.push(idx(x1, 0), idx(x1, 1), idx(x2, 0));
          } else {
            tri.push(idx(x0, 0), idx(x0, 1), idx(x1, 0));
            tri.push(idx(x1, 0), idx(x0, 1), idx(x1, 1));
            tri.push(idx(x1, 0), idx(x1, 1), idx(x2, 0));
            tri.push(idx(x2, 0), idx(x1, 1), idx(x2, 1));
          }
        } else {
          // Omit odd outer vertex (x1, 0) cleanly so neighbor edge matches 2x coarser vertices.
          if (isFirst) {
            tri.push(idx(0, 0), idx(1, 1), idx(x2, 0));
            tri.push(idx(1, 1), idx(x2, 1), idx(x2, 0));
          } else if (isLast) {
            tri.push(idx(x0, 0), idx(x0, 1), idx(x1, 1));
            tri.push(idx(x0, 0), idx(x1, 1), idx(x2, 0));
          } else {
            tri.push(idx(x0, 0), idx(x0, 1), idx(x1, 1));
            tri.push(idx(x0, 0), idx(x1, 1), idx(x2, 0));
            tri.push(idx(x1, 1), idx(x2, 1), idx(x2, 0));
          }
        }
      }
    }

    const indices = new Uint16Array(tri);
    variants[mask] = {
      vertices,
      indices,
      normals,
      tangents,
      uvs,
      topology: Topology.TRIANGLE_LIST,
      getBoundingVolume,
    };
  }

  return variants;
}

/** Configuration for {@link WaterQuadtree}. */
export interface WaterQuadtreeOptions {
  /**
   * Total XZ edge length of the quadtree root domain in meters.
   * @domain World domain span in meters (> 0; defaults to 4096).
   */
  worldSize?: number;
  /**
   * Maximum subdivision depth (`0` = single root tile, `6` = 64x64 finest leaf grid).
   * @domain Subdivision depth integer in `[0, 10]` (defaults to 6).
   */
  maxLevel?: number;
  /**
   * Even number of grid subdivisions per leaf tile edge.
   * @domain Even integer in `[4, 254]` (defaults to 16).
   */
  tileSegments?: number;
  /**
   * Distance-to-node-size multiplier triggering quadtree subdivision. Higher values keep fine LOD
   * farther from the camera.
   * @domain Multiplier >= 1.2 (defaults to 2.2).
   */
  lodDistanceFactor?: number;
  /**
   * Vertical half-extent padding in meters used for conservative wave-displacement frustum culling.
   * @domain Vertical displacement padding in meters (>= 0.1; defaults to 12).
   */
  maxWaveHeight?: number;
  /**
   * Base water surface elevation along world `+Y`.
   * @domain World Y water elevation in meters (defaults to 0).
   */
  waterLevel?: number;
  /**
   * Snaps the quadtree root around the camera XZ coordinates in finest-root increments so
   * horizons move seamlessly without vertex phase swimming.
   * @domain Boolean toggle (defaults to true).
   */
  followCamera?: boolean;
  /**
   * Enables camera frustum culling during quadtree traversal.
   * @domain Boolean toggle (defaults to true).
   */
  frustumCulling?: boolean;
  /** Material shared across all active quadtree water tiles. */
  material?: AbstractMaterial;
  /** Maximum pooled `Object3D` leaf nodes pre-allocated under `root`. Defaults to 384. */
  maxActiveLeaves?: number;
}

/** Readout returned by {@link WaterQuadtree.update} describing active LOD selection. */
export interface WaterQuadtreeStats {
  readonly activeLeafCount: number;
  readonly activeTriangleCount: number;
  readonly originX: number;
  readonly originZ: number;
}

/**
 * Continuous 2:1-balanced Quadtree / CDLOD water mesh system.
 *
 * Dynamically refines ocean/lake geometry near the camera and simplifies cleanly toward the horizon
 * using 16 crack-free edge-stitched tile variants within WebGL1 `Uint16Array` limits. All nodes,
 * bounds checks, and `Object3D` slots are pre-allocated for zero-GC per-frame updates.
 */
export class WaterQuadtree {
  /** @domain Root XZ span in meters. */
  public readonly worldSize: number;
  /** @domain Maximum subdivision depth (`0..10`). */
  public readonly maxLevel: number;
  /** @domain Grid cells per leaf tile edge (even integer). */
  public readonly tileSegments: number;
  /** @domain Subdivision split range multiplier relative to node size. */
  public readonly lodDistanceFactor: number;
  /** @domain Vertical AABB wave displacement padding in meters. */
  public readonly maxWaveHeight: number;
  /** @domain Water surface Y elevation in world meters. */
  public waterLevel: number;
  /** @domain Whether the quadtree tracks the camera XZ quantized to coarse grid steps. */
  public followCamera: boolean;
  /** @domain Whether per-node camera frustum culling runs during traversal. */
  public frustumCulling: boolean;

  /** Parent container node to add into the scene graph. */
  public readonly root: Object3D = new Object3D("WaterQuadtree");

  private _material: AbstractMaterial | undefined;
  private readonly _variants: GeometryDataInterface[];
  private readonly _tilePool: Object3D[];
  private readonly _maxLeaves: number;
  private readonly _frustum: Frustum = new Frustum();
  private readonly _scratchBox: BoundingBox = new BoundingBox(
    new Vector3D(0, 0, 0),
    new Vector3D(0, 0, 0),
  );

  // Flat pre-allocated quadtree node pool (zero per-frame heap allocations).
  private readonly _maxNodes: number;
  private readonly _nodeCx: Float64Array;
  private readonly _nodeCz: Float64Array;
  private readonly _nodeSize: Float64Array;
  private readonly _nodeLevel: Int32Array;
  private readonly _nodeIsLeaf: Uint8Array;
  private readonly _nodeChild0: Int32Array;
  private readonly _nodeChild1: Int32Array;
  private readonly _nodeChild2: Int32Array;
  private readonly _nodeChild3: Int32Array;
  private readonly _leafQueue: Int32Array;
  private _nodeCount: number = 0;

  private _originX: number = 0;
  private _originZ: number = 0;
  private _activeLeafCount: number = 0;
  private _activeTriangleCount: number = 0;

  constructor(options: WaterQuadtreeOptions = {}) {
    const {
      worldSize = 4096,
      maxLevel = 6,
      tileSegments = 16,
      lodDistanceFactor = 2.2,
      maxWaveHeight = 12,
      waterLevel = 0,
      followCamera = true,
      frustumCulling = true,
      material,
      maxActiveLeaves = DEFAULT_MAX_LEAVES,
    } = options;

    this.worldSize = Math.max(8, worldSize);
    this.maxLevel = Math.max(0, Math.min(10, Math.floor(maxLevel)));
    this.tileSegments = Math.max(4, Math.floor(tileSegments));
    this.lodDistanceFactor = Math.max(1.2, lodDistanceFactor);
    this.maxWaveHeight = Math.max(0.1, maxWaveHeight);
    this.waterLevel = waterLevel;
    this.followCamera = followCamera;
    this.frustumCulling = frustumCulling;
    this._material = material;

    this._variants = buildWaterTileVariants(this.tileSegments, this.maxWaveHeight);
    this._maxLeaves = Math.max(16, Math.floor(maxActiveLeaves));
    this._maxNodes = Math.max(DEFAULT_MAX_NODES, this._maxLeaves * 6);

    this._nodeCx = new Float64Array(this._maxNodes);
    this._nodeCz = new Float64Array(this._maxNodes);
    this._nodeSize = new Float64Array(this._maxNodes);
    this._nodeLevel = new Int32Array(this._maxNodes);
    this._nodeIsLeaf = new Uint8Array(this._maxNodes);
    this._nodeChild0 = new Int32Array(this._maxNodes);
    this._nodeChild1 = new Int32Array(this._maxNodes);
    this._nodeChild2 = new Int32Array(this._maxNodes);
    this._nodeChild3 = new Int32Array(this._maxNodes);
    this._leafQueue = new Int32Array(this._maxNodes);

    this._tilePool = new Array<Object3D>(this._maxLeaves);
    for (let i = 0; i < this._maxLeaves; i++) {
      const tile = new Object3D(`WaterTile_${i}`);
      tile.geometry = this._variants[0]!;
      tile.material = material;
      tile.frustumCulled = false; // Quadtree performs hierarchical frustum culling directly.
      tile.isVisible = false;
      this.root.add(tile);
      this._tilePool[i] = tile;
    }
  }

  /** Gets or updates the material shared across every water quadtree tile. */
  public get material(): AbstractMaterial | undefined {
    return this._material;
  }

  public set material(value: AbstractMaterial | undefined) {
    this._material = value;
    for (let i = 0; i < this._tilePool.length; i++) {
      this._tilePool[i]!.material = value;
    }
  }

  /** Number of visible leaf tiles selected by the last `update()` call. */
  public get activeLeafCount(): number {
    return this._activeLeafCount;
  }

  /** Total triangles emitted across all visible leaf tiles in the last `update()` call. */
  public get activeTriangleCount(): number {
    return this._activeTriangleCount;
  }

  /**
   * Updates the 2:1 balanced quadtree selection around `camera` with zero heap allocations.
   */
  public update(camera: Camera): WaterQuadtreeStats {
    const camX = camera.position.x;
    const camY = camera.position.y;
    const camZ = camera.position.z;

    if (this.followCamera) {
      // Snap in coarsest-leaf steps (minimum worldSize/4) so vertex positions never swim sub-grid.
      const snapStep = this.worldSize / Math.max(4, 1 << Math.min(2, this.maxLevel));
      this._originX = Math.round(camX / snapStep) * snapStep;
      this._originZ = Math.round(camZ / snapStep) * snapStep;
    } else {
      this._originX = 0;
      this._originZ = 0;
    }

    if (this.frustumCulling) {
      this._frustum.setFromMatrix(camera.viewProjectionMatrix4);
    }

    // 1. Build top-down quadtree using distance split thresholds.
    this._nodeCount = 1;
    this._nodeCx[0] = this._originX;
    this._nodeCz[0] = this._originZ;
    this._nodeSize[0] = this.worldSize;
    this._nodeLevel[0] = 0;
    this._nodeIsLeaf[0] = 0;
    this._nodeChild0[0] = -1;
    this._nodeChild1[0] = -1;
    this._nodeChild2[0] = -1;
    this._nodeChild3[0] = -1;

    this._subdivideTopDown(0, camX, camY, camZ);

    // 2. Collect leaves & enforce 2:1 quadtree balance invariant via work queue.
    let queueLen = 0;
    for (let i = 0; i < this._nodeCount; i++) {
      if (this._nodeIsLeaf[i] === 1) {
        this._leafQueue[queueLen++] = i;
      }
    }

    const minX = this._originX - this.worldSize * 0.5;
    const maxX = this._originX + this.worldSize * 0.5;
    const minZ = this._originZ - this.worldSize * 0.5;
    const maxZ = this._originZ + this.worldSize * 0.5;

    let head = 0;
    while (head < queueLen) {
      const nodeIdx = this._leafQueue[head++]!;
      if (this._nodeIsLeaf[nodeIdx] !== 1) continue;

      const level = this._nodeLevel[nodeIdx]!;
      const cx = this._nodeCx[nodeIdx]!;
      const cz = this._nodeCz[nodeIdx]!;
      const half = this._nodeSize[nodeIdx]! * 0.5;
      const probeDist = half + this._finestCellHalf() * 0.5;

      // Check all 4 cardinal neighbors; if any neighbor leaf is > 1 level finer, split this node.
      let needsSplit = false;
      if (level < this.maxLevel && this._nodeCount + 4 <= this._maxNodes) {
        for (let dir = 0; dir < 4; dir++) {
          const px = dir === 1 ? cx + probeDist : dir === 3 ? cx - probeDist : cx;
          const pz = dir === 0 ? cz - probeDist : dir === 2 ? cz + probeDist : cz;
          if (px <= minX || px >= maxX || pz <= minZ || pz >= maxZ) continue;
          const neighbor = this._findLeafAt(px, pz);
          if (neighbor >= 0 && this._nodeLevel[neighbor]! > level + 1) {
            needsSplit = true;
            break;
          }
        }
      }

      if (needsSplit) {
        this._splitNode(nodeIdx);
        this._leafQueue[queueLen++] = this._nodeChild0[nodeIdx]!;
        this._leafQueue[queueLen++] = this._nodeChild1[nodeIdx]!;
        this._leafQueue[queueLen++] = this._nodeChild2[nodeIdx]!;
        this._leafQueue[queueLen++] = this._nodeChild3[nodeIdx]!;
      }
    }

    // 3. Emit visible frustum-culled leaves with exact N/E/S/W edge-stitching bitmasks.
    let activeCount = 0;
    let totalTris = 0;
    const probeEps = this._finestCellHalf() * 0.5;

    for (let i = 0; i < this._nodeCount; i++) {
      if (this._nodeIsLeaf[i] !== 1) continue;

      const cx = this._nodeCx[i]!;
      const cz = this._nodeCz[i]!;
      const size = this._nodeSize[i]!;
      const half = size * 0.5;

      if (this.frustumCulling && !this._intersectsNodeFrustum(cx, cz, half)) {
        continue;
      }
      if (activeCount >= this._maxLeaves) break;

      const level = this._nodeLevel[i]!;
      let edgeMask = WaterTileEdge.NONE;

      // Check 4 neighbors: set bit if neighbor exists and is coarser (neighborLevel < level).
      const nxN = cx;
      const nzN = cz - half - probeEps;
      if (nzN > minZ) {
        const nIdx = this._findLeafAt(nxN, nzN);
        if (nIdx >= 0 && this._nodeLevel[nIdx]! < level) edgeMask |= WaterTileEdge.NORTH;
      }
      const nxE = cx + half + probeEps;
      const nzE = cz;
      if (nxE < maxX) {
        const nIdx = this._findLeafAt(nxE, nzE);
        if (nIdx >= 0 && this._nodeLevel[nIdx]! < level) edgeMask |= WaterTileEdge.EAST;
      }
      const nxS = cx;
      const nzS = cz + half + probeEps;
      if (nzS < maxZ) {
        const nIdx = this._findLeafAt(nxS, nzS);
        if (nIdx >= 0 && this._nodeLevel[nIdx]! < level) edgeMask |= WaterTileEdge.SOUTH;
      }
      const nxW = cx - half - probeEps;
      const nzW = cz;
      if (nxW > minX) {
        const nIdx = this._findLeafAt(nxW, nzW);
        if (nIdx >= 0 && this._nodeLevel[nIdx]! < level) edgeMask |= WaterTileEdge.WEST;
      }

      const tile = this._tilePool[activeCount]!;
      const geom = this._variants[edgeMask]!;
      tile.geometry = geom;
      tile.material = this._material;
      tile.position.set(cx, this.waterLevel, cz);
      tile.scale.set(size, 1, size);
      tile.isVisible = true;
      tile.inFrustum = true;

      activeCount++;
      totalTris += geom.indices ? geom.indices.length / 3 : 0;
    }

    for (let i = activeCount; i < this._tilePool.length; i++) {
      this._tilePool[i]!.isVisible = false;
    }

    this._activeLeafCount = activeCount;
    this._activeTriangleCount = totalTris;

    return {
      activeLeafCount: activeCount,
      activeTriangleCount: totalTris,
      originX: this._originX,
      originZ: this._originZ,
    };
  }

  private _finestCellHalf(): number {
    return (this.worldSize / (1 << this.maxLevel)) * 0.5;
  }

  private _intersectsNodeFrustum(cx: number, cz: number, half: number): boolean {
    this._scratchBox.min.set(cx - half, this.waterLevel - this.maxWaveHeight, cz - half);
    this._scratchBox.max.set(cx + half, this.waterLevel + this.maxWaveHeight, cz + half);
    return this._frustum.intersectsBox(this._scratchBox);
  }

  private _subdivideTopDown(nodeIdx: number, camX: number, camY: number, camZ: number): void {
    const level = this._nodeLevel[nodeIdx]!;
    const cx = this._nodeCx[nodeIdx]!;
    const cz = this._nodeCz[nodeIdx]!;
    const size = this._nodeSize[nodeIdx]!;
    const half = size * 0.5;

    // Conservative 3D Euclidean distance from camera to this node's water AABB.
    const dx = Math.max(0, Math.abs(camX - cx) - half);
    const dy = Math.max(0, Math.abs(camY - this.waterLevel) - this.maxWaveHeight);
    const dz = Math.max(0, Math.abs(camZ - cz) - half);
    const distSq = dx * dx + dy * dy + dz * dz;
    const splitRange = size * this.lodDistanceFactor;

    if (
      level >= this.maxLevel ||
      distSq > splitRange * splitRange ||
      this._nodeCount + 4 > this._maxNodes
    ) {
      this._nodeIsLeaf[nodeIdx] = 1;
      return;
    }

    this._splitNode(nodeIdx);
    this._subdivideTopDown(this._nodeChild0[nodeIdx]!, camX, camY, camZ);
    this._subdivideTopDown(this._nodeChild1[nodeIdx]!, camX, camY, camZ);
    this._subdivideTopDown(this._nodeChild2[nodeIdx]!, camX, camY, camZ);
    this._subdivideTopDown(this._nodeChild3[nodeIdx]!, camX, camY, camZ);
  }

  private _splitNode(nodeIdx: number): void {
    const base = this._nodeCount;
    const quarter = this._nodeSize[nodeIdx]! * 0.25;
    const childSize = this._nodeSize[nodeIdx]! * 0.5;
    const childLevel = this._nodeLevel[nodeIdx]! + 1;
    const cx = this._nodeCx[nodeIdx]!;
    const cz = this._nodeCz[nodeIdx]!;

    this._nodeIsLeaf[nodeIdx] = 0;

    // 0: NW (-X, -Z), 1: NE (+X, -Z), 2: SW (-X, +Z), 3: SE (+X, +Z)
    this._initChild(base, cx - quarter, cz - quarter, childSize, childLevel);
    this._initChild(base + 1, cx + quarter, cz - quarter, childSize, childLevel);
    this._initChild(base + 2, cx - quarter, cz + quarter, childSize, childLevel);
    this._initChild(base + 3, cx + quarter, cz + quarter, childSize, childLevel);

    this._nodeChild0[nodeIdx] = base;
    this._nodeChild1[nodeIdx] = base + 1;
    this._nodeChild2[nodeIdx] = base + 2;
    this._nodeChild3[nodeIdx] = base + 3;
    this._nodeCount += 4;
  }

  private _initChild(idx: number, cx: number, cz: number, size: number, level: number): void {
    this._nodeCx[idx] = cx;
    this._nodeCz[idx] = cz;
    this._nodeSize[idx] = size;
    this._nodeLevel[idx] = level;
    this._nodeIsLeaf[idx] = 1;
    this._nodeChild0[idx] = -1;
    this._nodeChild1[idx] = -1;
    this._nodeChild2[idx] = -1;
    this._nodeChild3[idx] = -1;
  }

  private _findLeafAt(px: number, pz: number): number {
    let idx = 0;
    while (idx >= 0) {
      if (this._nodeIsLeaf[idx] === 1) return idx;
      const right = px >= this._nodeCx[idx]!;
      const south = pz >= this._nodeCz[idx]!;
      const childSlot = (south ? 2 : 0) + (right ? 1 : 0);
      if (childSlot === 0) idx = this._nodeChild0[idx]!;
      else if (childSlot === 1) idx = this._nodeChild1[idx]!;
      else if (childSlot === 2) idx = this._nodeChild2[idx]!;
      else idx = this._nodeChild3[idx]!;
    }
    return -1;
  }
}
