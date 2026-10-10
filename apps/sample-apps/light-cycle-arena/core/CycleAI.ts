import { Vector3D } from "@small-world-machine/engine/math/index.js";
import { ArenaGrid } from "./ArenaGrid.js";

const rotateLeft = (d: Vector3D): Vector3D => new Vector3D(-d.z, 0, d.x);
const rotateRight = (d: Vector3D): Vector3D => new Vector3D(d.z, 0, -d.x);

/**
 * One-step lookahead chase heuristic: at each grid intersection, scores the 3 reachable
 * directions (straight/left/right -- reversing into your own trail isn't a reachable option
 * on this grid in the first place) by whether they're immediately safe and how much they close
 * the Manhattan distance to `target`.
 *
 * Deliberately not a `StateMachineBehavior`: there's exactly one decision made once per
 * intersection, not an ongoing per-frame state -- a full FSM here would be abstraction without
 * a second state to justify it. Revisit if a future pass wants genuinely distinct behavior
 * modes (e.g. a real ambush "cut off the exit" plan instead of pure greedy chase).
 */
export class CycleAI {
  public static decide(
    currentPosition: Vector3D,
    currentDirection: Vector3D,
    target: Vector3D,
    grid: ArenaGrid,
  ): Vector3D {
    const candidates = [
      currentDirection,
      rotateLeft(currentDirection),
      rotateRight(currentDirection),
    ];

    let best: Vector3D | null = null;
    let bestScore = -Infinity;

    for (const dir of candidates) {
      const nextX = currentPosition.x + dir.x * grid.gridSize;
      const nextZ = currentPosition.z + dir.z * grid.gridSize;
      const cell = grid.worldToCell(nextX, nextZ);
      if (!grid.isFree(cell.cx, cell.cz)) continue;

      const distBefore =
        Math.abs(currentPosition.x - target.x) + Math.abs(currentPosition.z - target.z);
      const distAfter = Math.abs(nextX - target.x) + Math.abs(nextZ - target.z);
      const score = distBefore - distAfter;

      if (score > bestScore) {
        bestScore = score;
        best = dir;
      }
    }

    return best ?? currentDirection; // no safe option left -- the crash is unavoidable
  }
}
