import { describe, expect, it } from "vitest";
import { Keys } from "@small-world-machine/engine";
import type { InputInterface, MouseState } from "@small-world-machine/engine";
import { VoxelInputActions } from "../voxel/input/VoxelInputActions.js";

function createMockInput(): { input: InputInterface; pressedKeys: Set<string>; mouse: MouseState } {
  const pressedKeys = new Set<string>();
  const mouse: MouseState = {
    x: 0,
    y: 0,
    dx: 0,
    dy: 0,
    wheelX: 0,
    wheelY: 0,
    zoom: 0,
    left: false,
    right: false,
  };
  const input: InputInterface = {
    mouse,
    isPointerLocked: true,
    isPressed: (code: string | Keys) => pressedKeys.has(code),
    getAxis: (neg: string | Keys, pos: string | Keys) => {
      let val = 0;
      if (pressedKeys.has(neg)) val -= 1;
      if (pressedKeys.has(pos)) val += 1;
      return val;
    },
  };
  return { input, pressedKeys, mouse };
}

describe("VoxelInputActions — composite semantic bindings", () => {
  it("translates WASD into planar movement", () => {
    const { input, pressedKeys } = createMockInput();
    const actions = new VoxelInputActions({ input, enableGamepad: false });

    // Rest
    expect(actions.update().move).toEqual({ x: 0, z: 0 });

    // W = forward (-1 z)
    pressedKeys.add(Keys.W);
    expect(actions.update().move).toEqual({ x: 0, z: -1 });

    // W + D = forward (-1 z) + strafe right (+1 x)
    pressedKeys.add(Keys.D);
    expect(actions.update().move).toEqual({ x: 1, z: -1 });
  });

  it("triggers breakBlock edge via LMB or KeyF or KeyQ without repeat", () => {
    const { input, pressedKeys, mouse } = createMockInput();
    const actions = new VoxelInputActions({ input, enableGamepad: false });

    // Initial frame
    expect(actions.update().breakBlock).toBe(false);

    // Trackpad alternative: KeyF pressed
    pressedKeys.add(Keys.F);
    expect(actions.update().breakBlock).toBe(true);
    // Holding KeyF does not fire again (edge-triggered)
    expect(actions.update().breakBlock).toBe(false);

    pressedKeys.delete(Keys.F);
    expect(actions.update().breakBlock).toBe(false);

    // Mouse LMB
    mouse.left = true;
    expect(actions.update().breakBlock).toBe(true);
    expect(actions.update().breakBlock).toBe(false);
  });

  it("triggers placeBlock edge via RMB or KeyE or KeyR without repeat", () => {
    const { input, pressedKeys } = createMockInput();
    const actions = new VoxelInputActions({ input, enableGamepad: false });

    expect(actions.update().placeBlock).toBe(false);

    // Trackpad alternative: KeyE pressed
    pressedKeys.add(Keys.E);
    expect(actions.update().placeBlock).toBe(true);
    // Holding KeyE does not fire again
    expect(actions.update().placeBlock).toBe(false);

    pressedKeys.delete(Keys.E);
    expect(actions.update().placeBlock).toBe(false);

    // Secondary Trackpad alternative: KeyR
    pressedKeys.add(Keys.R);
    expect(actions.update().placeBlock).toBe(true);
    expect(actions.update().placeBlock).toBe(false);
  });

  it("selects hand slots via Digit1..5", () => {
    const { input, pressedKeys } = createMockInput();
    const actions = new VoxelInputActions({ input, enableGamepad: false });

    expect(actions.update().selectedSlot).toBeNull();

    pressedKeys.add(Keys.D3);
    expect(actions.update().selectedSlot).toBe(2); // Slot index 2 (zero-based)
    // Holding does not re-emit
    expect(actions.update().selectedSlot).toBeNull();
  });

  it("debounces mouse wheel for slot cycling to prevent trackpad inertia spam", () => {
    const { input, mouse } = createMockInput();
    const actions = new VoxelInputActions({ input, enableGamepad: false, wheelDebounceMs: 100 });

    // First wheel gesture
    mouse.wheelY = 15;
    expect(actions.update().cycleSlot).toBe(1);

    // Immediate second wheel gesture within debounce window should be ignored
    mouse.wheelY = 15;
    expect(actions.update().cycleSlot).toBe(0);
  });
});
