import type { Collidable, BoundingVolume } from "../interfaces/index.js";

/**
 * A simple 2D spatial hash for fast broad-phase collision detection on the XZ plane.
 * Useful for grid-based games like YAD where vertical checks are mostly irrelevant for walls.
 */
export class SpatialHash {
  public cellSize: number;
  private _cells: Collidable[][] = [];
  private _tableSize: number;

  /**
   * @param cellSize The size of a single grid cell. E.g. if walls are 2 units, use 2.
   * @param tableSize The number of hash buckets. Use a prime number for fewer collisions.
   */
  constructor(cellSize: number = 2, tableSize: number = 4093) {
    this.cellSize = cellSize;
    this._tableSize = tableSize;
    for (let i = 0; i < this._tableSize; i++) {
      this._cells.push([]);
    }
  }

  /**
   * Inserts an object into the spatial hash based on its bounding volume.
   */
  public insert(obj: Collidable): void {
    if (!obj.bounds) return;

    const { startCellX, endCellX, startCellZ, endCellZ } = this._cellRange(obj.bounds);

    for (let x = startCellX; x <= endCellX; x++) {
      for (let z = startCellZ; z <= endCellZ; z++) {
        const hash = this._getHash(x, z);
        const list = this._cells[hash]!;
        if (!list.includes(obj)) {
          list.push(obj);
        }
      }
    }
  }

  /**
   * Clears the spatial hash.
   */
  public clear(): void {
    for (let i = 0; i < this._tableSize; i++) {
      this._cells[i]!.length = 0;
    }
  }

  /**
   * Queries for potential collisions in the given volume's area.
   */
  public query(volume: BoundingVolume, outResult: Collidable[]): void {
    const { startCellX, endCellX, startCellZ, endCellZ } = this._cellRange(volume);

    for (let x = startCellX; x <= endCellX; x++) {
      for (let z = startCellZ; z <= endCellZ; z++) {
        const hash = this._getHash(x, z);
        const list = this._cells[hash]!;
        for (let i = 0; i < list.length; i++) {
          const obj = list[i]!;
          if (obj.bounds && obj.bounds.intersectsVolume(volume)) {
            if (!outResult.includes(obj)) {
              outResult.push(obj);
            }
          }
        }
      }
    }
  }

  /**
   * Queries for potential collisions along a ray on the XZ plane.
   * This is a simple broad-phase approach stepping along the ray direction.
   */
  public queryRay(
    ray: import("./Ray.js").Ray,
    outResult: Collidable[],
    maxDistance: number = 100,
  ): void {
    // Step size roughly half a cell to not miss any cells
    const stepSize = this.cellSize * 0.5;
    for (let d = 0; d <= maxDistance; d += stepSize) {
      const px = ray.origin.x + ray.direction.x * d;
      const pz = ray.origin.z + ray.direction.z * d;

      const cx = Math.floor(px / this.cellSize);
      const cz = Math.floor(pz / this.cellSize);
      const hash = this._getHash(cx, cz);

      const list = this._cells[hash]!;
      for (let i = 0; i < list.length; i++) {
        const obj = list[i]!;
        if (!outResult.includes(obj)) {
          outResult.push(obj);
        }
      }
    }
  }

  /** Converts a bounding volume's XZ footprint (center ± broad radius) into cell-index bounds. */
  private _cellRange(volume: BoundingVolume): {
    startCellX: number;
    endCellX: number;
    startCellZ: number;
    endCellZ: number;
  } {
    const r = volume.getBroadRadius();
    return {
      startCellX: Math.floor((volume.center.x - r) / this.cellSize),
      endCellX: Math.floor((volume.center.x + r) / this.cellSize),
      startCellZ: Math.floor((volume.center.z - r) / this.cellSize),
      endCellZ: Math.floor((volume.center.z + r) / this.cellSize),
    };
  }

  private _getHash(x: number, z: number): number {
    let hash = (x * 73856093) ^ (z * 19349663);
    hash = hash % this._tableSize;
    if (hash < 0) hash += this._tableSize;
    return hash;
  }
}
