/** A single arena cell coordinate. */
export interface CellCoord {
  cx: number;
  cz: number;
}

/**
 * Tracks which grid cells are permanently occupied by a cycle's trail (or its own current
 * cell), plus arena bounds -- the single source of truth for Light Cycle collision.
 *
 * Deliberately NOT built on `PhysicsSystem`: every cycle only ever moves and turns exactly on
 * this grid (see `GridMovementBehavior`), so an exact integer cell-occupancy map is both
 * simpler and more precise than a continuous-space AABB/CCD check would be here.
 */
export class ArenaGrid {
  public readonly gridSize: number;
  public readonly halfExtentCells: number;

  private readonly _occupied: Map<string, number> = new Map();

  constructor(gridSize: number, sizeCells: number) {
    this.gridSize = gridSize;
    this.halfExtentCells = Math.floor(sizeCells / 2);
  }

  public worldToCell(x: number, z: number): CellCoord {
    return { cx: Math.round(x / this.gridSize), cz: Math.round(z / this.gridSize) };
  }

  public isInBounds(cx: number, cz: number): boolean {
    return Math.abs(cx) <= this.halfExtentCells && Math.abs(cz) <= this.halfExtentCells;
  }

  /**
   * A cell is free if it's in bounds and unclaimed -- by anyone, including the querying cycle
   * itself. Callers always ask about the cell they're about to *move into* (never the one
   * they're currently standing on, see `GridMovementBehavior`), so a cycle re-entering any cell
   * of its own trail -- e.g. by looping back on itself -- must crash exactly like running into
   * an opponent's trail, matching the genre's core "don't cross your own trail" rule.
   */
  public isFree(cx: number, cz: number): boolean {
    if (!this.isInBounds(cx, cz)) return false;
    return !this._occupied.has(`${cx},${cz}`);
  }

  public occupy(cx: number, cz: number, ownerId: number): void {
    this._occupied.set(`${cx},${cz}`, ownerId);
  }
}
