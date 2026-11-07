import { describe, it, expect } from "vitest";
import { ArenaGrid } from "../core/ArenaGrid.js";
import { CycleAI } from "../core/CycleAI.js";
import { Vector3D } from "@small-world-machine/engine/math/index.js";

describe("ArenaGrid", () => {
  it("reports an unclaimed cell as free", () => {
    const grid = new ArenaGrid(4, 20);
    expect(grid.isFree(0, 0)).toBe(true);
  });

  it("reports an out-of-bounds cell as not free", () => {
    const grid = new ArenaGrid(4, 20);
    expect(grid.isFree(100, 100)).toBe(false);
  });

  it("reports a cell occupied by an opponent as not free", () => {
    const grid = new ArenaGrid(4, 20);
    grid.occupy(1, 1, 1);
    expect(grid.isFree(1, 1)).toBe(false);
  });

  it("a cycle crashes into its own trail when its path loops back on itself", () => {
    // Tron core rule: re-entering ANY previously claimed cell -- even your own -- is a crash.
    const grid = new ArenaGrid(4, 20);
    const ownerId = 0;

    // Trace a closed 1x1 loop: (0,0) -> (1,0) -> (1,1) -> (0,1), all claimed by the same cycle.
    grid.occupy(0, 0, ownerId);
    grid.occupy(1, 0, ownerId);
    grid.occupy(1, 1, ownerId);
    grid.occupy(0, 1, ownerId);

    // Re-entering the very first cell of the loop must now be a fatal collision.
    expect(grid.isFree(0, 0)).toBe(false);
  });
});

describe("CycleAI.decide", () => {
  it("never picks a direction that re-enters the cycle's own trail", () => {
    const grid = new ArenaGrid(4, 20);
    const currentPosition = new Vector3D(4, 0, 0);
    const currentDirection = new Vector3D(0, 0, 1); // heading +Z

    // From cell (1,0) heading +Z: straight -> (1,1), left -> (0,0), right -> (2,0).
    // Claim straight and left as the cycle's own trail, leaving right as the only safe option.
    grid.occupy(1, 1, 0);
    grid.occupy(0, 0, 0);

    const chosen = CycleAI.decide(
      currentPosition,
      currentDirection,
      new Vector3D(100, 0, 100),
      grid,
    );

    const nextX = currentPosition.x + chosen.x * grid.gridSize;
    const nextZ = currentPosition.z + chosen.z * grid.gridSize;
    const nextCell = grid.worldToCell(nextX, nextZ);

    // Only the right turn (dir = (1, 0, 0), landing on cell (2, 0)) remains safe.
    expect(nextCell).toEqual({ cx: 2, cz: 0 });
    expect(grid.isFree(nextCell.cx, nextCell.cz)).toBe(true);
  });
});
