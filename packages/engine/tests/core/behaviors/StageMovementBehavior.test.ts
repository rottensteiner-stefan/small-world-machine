import { describe, it, expect } from "vitest";
import { StageMovementBehavior } from "../../../src/core/behaviors/StageMovementBehavior.js";
import { StageZone } from "../../../src/core/stage/StageZone.js";
import { Object3D } from "../../../src/core/Object3D.js";
import { InputInterface, MouseState } from "../../../src/core/input/Input.js";
import { Keys } from "../../../src/enums/Keys.js";

class MockInput implements InputInterface {
  public mouse: MouseState = {
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
  public isPointerLocked = false;
  private _keys = new Map<string, boolean>();

  public isPressed(code: string): boolean {
    return !!this._keys.get(code);
  }

  public getAxis(neg: string, pos: string): number {
    let v = 0;
    if (this.isPressed(neg)) v -= 1;
    if (this.isPressed(pos)) v += 1;
    return v;
  }

  public setKey(code: string, pressed: boolean): void {
    this._keys.set(code, pressed);
  }
}

/** A simple axis-aligned zone: u maps straight to world X, v maps to depth/scale -- moving
 * toward v=1 ("deeper") shrinks scale, matching a real forced-perspective corridor. */
function makeZone(): StageZone {
  return new StageZone({
    id: "zone",
    name: "Test Zone",
    points: [
      { u: 0, v: 0, scale: 1.0 }, // near-left
      { u: 1, v: 0, scale: 1.0 }, // near-right
      { u: 1, v: 1, scale: 0.3 }, // far-right
      { u: 0, v: 1, scale: 0.3 }, // far-left
    ],
  });
}

function uvToWorld(u: number): { x: number; y: number; z: number } {
  return { x: (u - 0.5) * 10, y: 0, z: 0 };
}

describe("StageMovementBehavior facing rotation", () => {
  it("faces the camera by default at spawn, before any movement input", () => {
    const input = new MockInput();
    const behavior = new StageMovementBehavior({
      input,
      zones: [makeZone()],
      projection: { mode: "custom" },
      customUvToWorld: uvToWorld,
      startUV: { u: 0.5, v: 0.5 },
    });
    const obj = new Object3D("Player");
    obj.addBehavior(behavior);

    behavior.update(0); // first call only seeds initial state, no movement yet

    expect(obj.rotation.y).toBeCloseTo(Math.PI);
  });

  it("applies facingOffset to the default spawn rotation", () => {
    const input = new MockInput();
    const behavior = new StageMovementBehavior({
      input,
      zones: [makeZone()],
      projection: { mode: "custom" },
      customUvToWorld: uvToWorld,
      startUV: { u: 0.5, v: 0.5 },
      facingOffset: Math.PI / 2,
    });
    const obj = new Object3D("Player");
    obj.addBehavior(behavior);

    behavior.update(0);

    expect(obj.rotation.y).toBeCloseTo(Math.PI + Math.PI / 2);
  });

  it("turns to face AWAY from the camera when walking deeper into the scene (W)", () => {
    const input = new MockInput();
    const behavior = new StageMovementBehavior({
      input,
      rotationSpeed: 1000, // effectively instant, so one update() call fully turns
      zones: [makeZone()],
      projection: { mode: "custom" },
      customUvToWorld: uvToWorld,
      startUV: { u: 0.5, v: 0.1 }, // near edge, so moving toward v=1 stays inside the zone
    });
    const obj = new Object3D("Player");
    obj.addBehavior(behavior);
    behavior.update(0); // seed

    input.setKey(Keys.W, true);
    behavior.update(0.1);

    // Walking deeper shrinks scale (depthDelta < 0) with no world-X change (worldDx = 0) --
    // the character must end up facing -Z (this engine's forward), i.e. rotation.y = 0, NOT
    // Math.PI (which would mean facing the camera -- backwards from the direction of travel).
    expect(Math.abs(((obj.rotation.y % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI))).toBeCloseTo(
      0,
      1,
    );
  });

  it("turns to face the camera when walking back out toward it (S)", () => {
    const input = new MockInput();
    const behavior = new StageMovementBehavior({
      input,
      rotationSpeed: 1000,
      zones: [makeZone()],
      projection: { mode: "custom" },
      customUvToWorld: uvToWorld,
      startUV: { u: 0.5, v: 0.9 }, // far edge, so moving toward v=0 stays inside the zone
    });
    const obj = new Object3D("Player");
    obj.addBehavior(behavior);
    behavior.update(0);
    obj.rotation.y = 0; // start from an arbitrary non-target angle to prove it actually turns

    input.setKey(Keys.S, true);
    behavior.update(0.1);

    // Walking back out grows scale (depthDelta > 0) -- must face +Z (toward camera), i.e. an
    // angle of π (mod 2π; atan2 may equally return -π for the same physical direction).
    const normalized = ((obj.rotation.y % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    expect(Math.abs(normalized - Math.PI)).toBeLessThan(0.05);
  });
});
