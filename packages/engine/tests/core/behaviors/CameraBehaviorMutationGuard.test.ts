import { describe, it, expect } from "vitest";
import { Camera } from "../../../src/core/cameras/Camera.js";
import { PerspectiveProjection } from "../../../src/math/projections/PerspectiveProjection.js";
import { Behavior } from "../../../src/core/behaviors/Behavior.js";
import { Vector3D } from "../../../src/math/index.js";

/**
 * S3 fix m1 / DP-6A: `Camera.update` must be mutation-safe under behavioral list edits, mirroring
 * the `Scene._updateBehaviorsRecursive` guard (`Scene.ts` ~L250). Without it, a behavior that
 * detaches itself (or an earlier-indexed sibling) during `camera.update` splices the list and the
 * loop silently SKIPS the behavior that shifted into the vacated slot.
 */

class SelfDetachingBehavior extends Behavior {
  public runs = 0;
  constructor(private readonly _camera: Camera) {
    super();
  }
  public override update(): void {
    this.runs++;
    this._camera.removeBehavior(this);
  }
}

class AppendingBehavior extends Behavior {
  public runs = 0;
  private readonly _camera: Camera;
  private readonly _toAppend: RecordingBehavior;
  constructor(camera: Camera, toAppend: RecordingBehavior) {
    super();
    this._camera = camera;
    this._toAppend = toAppend;
  }
  public override update(): void {
    this.runs++;
    this._camera.addBehavior(this._toAppend);
  }
}

class RecordingBehavior extends Behavior {
  public runs = 0;
  public override update(): void {
    this.runs++;
  }
}

const createCamera = (): Camera =>
  new Camera(new PerspectiveProjection({ fov: Math.PI / 3, aspect: 1.6, near: 0.1, far: 1000 }));

describe("Camera.update: behavior-list mutation safety (S3 m1 / DP-6A)", () => {
  it("does not skip a sibling behavior when an earlier behavior detaches itself mid-update", () => {
    const camera = createCamera();
    const selfDetacher = new SelfDetachingBehavior(camera);
    const recorder = new RecordingBehavior();
    camera.addBehavior(selfDetacher);
    camera.addBehavior(recorder);

    camera.update(new Vector3D(), 0, 0, 0.016);

    // The self-detacher removes itself while iterating; without the Scene-style re-visit guard the
    // loop would advance past the shifted-down recorder and never run it.
    expect(recorder.runs).toBe(1);
    expect(selfDetacher.runs).toBe(1);
    expect(camera.behaviors).toEqual([recorder]);
  });

  it("never double-runs a behavior when the mutation only appends (slot identity unchanged)", () => {
    const camera = createCamera();
    const recorder = new RecordingBehavior();
    const appender = new AppendingBehavior(camera, recorder);
    camera.addBehavior(appender);

    camera.update(new Vector3D(), 0, 0, 0.016);

    // Append does not shift the current slot, so the re-visit guard must NOT fire and the appender
    // runs exactly once -- otherwise the guard would be a double-run bug, not a skip fix.
    expect(appender.runs).toBe(1);
    expect(recorder.runs).toBe(1);
  });
});
