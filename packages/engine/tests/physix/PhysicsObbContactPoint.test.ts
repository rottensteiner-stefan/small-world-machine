import { beforeEach, describe, expect, it } from "vitest";
import { PhysicsSystem } from "../../src/physix/PhysicsSystem.js";
import { Scene } from "../../src/core/Scene.js";
import { Object3D } from "../../src/core/Object3D.js";
import { RigidBody } from "../../src/physix/RigidBody.js";
import { OBB } from "../../src/physix/OBB.js";
import { Cube } from "../../src/geometry/index.js";
import { EventDispatcherImpl } from "../../src/core/events/EventDispatcherImpl.js";

describe("OBB contact point (lever arm)", () => {
  let system: PhysicsSystem;
  let scene: Scene;

  beforeEach(() => {
    system = new PhysicsSystem(new EventDispatcherImpl());
    system.gravity.set(0, -9.81, 0);
    scene = new Scene();
  });

  it("a crate resting far from the centre of a large OBB floor does not start to spin", () => {
    const floor = new Object3D();
    floor.geometry = new Cube({ size: 1 }).getGeometryData();
    floor.position.set(0, -0.5, 0);
    floor.scale.set(40, 1, 40);
    floor.rigidBody = new RigidBody(0);
    floor.bounds = new OBB(); // pre-assigned OBB: computeBounds() transforms the geometry bounds into it
    scene.add(floor);

    // Crate 10 m off the floor's centre, starting almost touching.
    const crate = new Object3D();
    crate.geometry = new Cube({ size: 1 }).getGeometryData();
    crate.position.set(10, 0.5, 0);
    const rb = new RigidBody(1);
    rb.restitution = 0;
    crate.rigidBody = rb;
    crate.bounds = new OBB();
    scene.add(crate);
    for (const o of [floor, crate]) {
      o.updateMatrixWorld();
      o.computeBounds();
    }

    let maxSpin = 0;
    for (let i = 0; i < 240; i++) {
      system.step(scene, 1 / 60);
      maxSpin = Math.max(maxSpin, rb.angularVelocity.length());
    }

    // A midpoint-of-centres contact (5 m lever arm) spins the crate hard; a contact on the
    // crate's own bottom face produces no torque from a vertical normal.
    expect(maxSpin).toBeLessThan(0.05);
    expect(crate.position.y).toBeCloseTo(0.5, 1);
  });
});
