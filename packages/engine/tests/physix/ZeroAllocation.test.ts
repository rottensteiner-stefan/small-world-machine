import { describe, expect, it } from "vitest";
import { PhysicsSystem } from "../../src/physix/PhysicsSystem.js";
import { EventDispatcherImpl } from "../../src/core/events/EventDispatcherImpl.js";
import { Scene } from "../../src/core/Scene.js";
import { Object3D } from "../../src/core/Object3D.js";
import { MathPool } from "../../src/math/MathPool.js";
import { RigidBody } from "../../src/physix/RigidBody.js";
import { BoundingSphere } from "../../src/physix/BoundingSphere.js";
import { OBB } from "../../src/physix/OBB.js";
import { BoundingBox } from "../../src/physix/BoundingBox.js";
import { Vector3D } from "../../src/math/Vector3D.js";

describe("Zero-Allocation Guarantees", () => {
  it("PhysicsSystem.step() should not leak any MathPool objects during simulation", () => {
    const physics = new PhysicsSystem(new EventDispatcherImpl());
    const scene = new Scene();

    // Create a few dynamic objects that will collide
    const obj1 = new Object3D();
    obj1.rigidBody = new RigidBody(1);
    obj1.bounds = new BoundingSphere(obj1.position, 1);
    obj1.position.set(0, 5, 0);
    scene.add(obj1);

    const obj2 = new Object3D();
    obj2.rigidBody = new RigidBody(0); // static
    obj2.bounds = new BoundingSphere(obj2.position, 1);
    obj2.position.set(0, 0, 0);
    scene.add(obj2);

    const obj3 = new Object3D();
    obj3.rigidBody = new RigidBody(1);
    obj3.bounds = new OBB();
    obj3.position.set(2, 5, 2);
    obj3.rotation.set(0, 0, 0);
    scene.add(obj3);

    const obj4 = new Object3D();
    obj4.rigidBody = new RigidBody(0); // static
    obj4.bounds = new BoundingBox(new Vector3D(-1, -1, -1), new Vector3D(1, 1, 1));
    obj4.position.set(2, 0, 2);
    scene.add(obj4);

    // Warm up the system (compiles functions, populates caches)
    physics.step(scene, 1 / 60);

    // Measure pool sizes before
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const vectorsBefore = (MathPool as any)._VECTOR_POOL.length;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const matricesBefore = (MathPool as any)._MATRIX_POOL.length;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const quaternionsBefore = (MathPool as any)._QUATERNION_POOL.length;

    // Run heavily to simulate a few seconds of gameplay
    for (let i = 0; i < 1000; i++) {
      physics.step(scene, 1 / 60);
    }

    // Measure pool sizes after
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const vectorsAfter = (MathPool as any)._VECTOR_POOL.length;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const matricesAfter = (MathPool as any)._MATRIX_POOL.length;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const quaternionsAfter = (MathPool as any)._QUATERNION_POOL.length;

    // If these are equal, it means every acquireVector() was strictly matched with releaseVector().
    // It guarantees we aren't leaking math objects per frame, thus preventing GC pressure.
    expect(vectorsAfter).toBe(vectorsBefore);
    expect(matricesAfter).toBe(matricesBefore);
    expect(quaternionsAfter).toBe(quaternionsBefore);
  });

  it("PhysicsSystem internal arrays and event objects should be strictly reused", () => {
    const physics = new PhysicsSystem(new EventDispatcherImpl());
    const scene = new Scene();

    const obj = new Object3D();
    obj.rigidBody = new RigidBody(1);
    scene.add(obj);

    physics.step(scene, 1 / 60);

    // Capture references to the internal arrays
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const internalBodiesRef1 = (physics as any)._bodies;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const internalCollidersRef1 = (physics as any)._allColliders;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const internalEventRef1 = (physics as any)._collisionEvent;

    physics.step(scene, 1 / 60);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const internalBodiesRef2 = (physics as any)._bodies;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const internalCollidersRef2 = (physics as any)._allColliders;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const internalEventRef2 = (physics as any)._collisionEvent;

    // Must be the EXACT same array/object instances in memory!
    expect(internalBodiesRef1).toBe(internalBodiesRef2);
    expect(internalCollidersRef1).toBe(internalCollidersRef2);
    expect(internalEventRef1).toBe(internalEventRef2);
  });
});
