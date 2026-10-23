import { describe, expect, it, vi } from "vitest";
import type { InputInterface } from "@small-world-machine/engine";
import { Camera } from "@small-world-machine/engine/core/cameras/Camera.js";
import { PerspectiveProjection } from "@small-world-machine/engine/math/projections/index.js";
import { VoxelPlayerCollision } from "../voxel/physics/VoxelPlayerCollision.js";
import { PlayerRig } from "../voxel/player/PlayerRig.js";
import type { ChunkWorld } from "../voxel/ChunkWorld.js";

function makeFakeInput(): InputInterface {
  return {
    isPressed: vi.fn().mockReturnValue(false),
    getAxis: vi.fn().mockReturnValue(0),
    mouse: { x: 0, y: 0, dx: 0, dy: 0, left: false, right: false, middle: false, wheel: 0 },
    isPointerLocked: false,
    requestPointerLock: vi.fn(),
    exitPointerLock: vi.fn(),
  } as unknown as InputInterface;
}

function makeFakeWorld(solidPredicate: (x: number, y: number, z: number) => boolean): ChunkWorld {
  return {
    isSolidAt: (x: number, y: number, z: number) => solidPredicate(x, y, z),
    setFocus: vi.fn(),
    update: vi.fn(),
  } as unknown as ChunkWorld;
}

describe("VoxelPlayerCollision — Step-Up & Survival Rig (M4)", () => {
  it("detects 1-block obstacles ahead for auto-jump when headroom is clear", () => {
    // Solid block at (1, 10, 0), but air at (1, 11, 0) and (1, 12, 0)
    const world = makeFakeWorld((x, y, z) => {
      if (x === 1 && y === 10 && z === 0) return true;
      // Floor under player at y=9
      if (y < 10) return true;
      return false;
    });

    const player = new VoxelPlayerCollision({
      world,
      input: makeFakeInput(),
    });

    // Spawn player standing on y=10 (feet at 0.5, 10, 0.5)
    player.setSpawn(0.5, 10, 0.5);

    // Fake onGround state by calling update with zero velocity or mock
    // Private _onGround is initially false on setSpawn; we can simulate grounded check:
    (player as unknown as { _onGround: boolean })._onGround = true;

    // Moving forward in +X direction towards the obstacle at (1, 10, 0)
    expect(player.canStepUp(1, 0)).toBe(true);

    // Moving backwards (-X) where there is no obstacle
    expect(player.canStepUp(-1, 0)).toBe(false);
  });

  it("refuses step-up if headroom above the obstacle is blocked (wall > 1 block high)", () => {
    // Solid wall at (1, 10, 0) AND (1, 11, 0)
    const world = makeFakeWorld((x, y, z) => {
      if (x === 1 && (y === 10 || y === 11) && z === 0) return true;
      if (y < 10) return true;
      return false;
    });

    const player = new VoxelPlayerCollision({
      world,
      input: makeFakeInput(),
    });

    player.setSpawn(0.5, 10, 0.5);
    (player as unknown as { _onGround: boolean })._onGround = true;

    expect(player.canStepUp(1, 0)).toBe(false);
  });

  it("freezes movement when player rig is dead", () => {
    const world = makeFakeWorld(() => false);
    const rig = new PlayerRig();
    const input = makeFakeInput();

    const player = new VoxelPlayerCollision({
      world,
      input,
      rig,
    });

    const cam = new Camera(new PerspectiveProjection());
    player.target = cam;
    player.setSpawn(10, 20, 10);

    // Kill player
    rig.takeDamage(20);
    expect(rig.isDead).toBe(true);

    player.update(0.016);

    // Feet remains exactly at spawn position, no fall, no move
    const feet = player.getFeetPosition();
    expect(feet.x).toBe(10);
    expect(feet.y).toBe(20);
    expect(feet.z).toBe(10);
  });
});
