import { describe, it, expect, beforeEach } from "vitest";
import { PhysicsSystem } from "../../src/physix/PhysicsSystem.js";
import { Scene } from "../../src/core/Scene.js";
import { Object3D } from "../../src/core/Object3D.js";
import { RigidBody } from "../../src/physix/RigidBody.js";
import { Cube } from "../../src/geometry/Cube.js";
import { Sphere } from "../../src/geometry/Sphere.js";
import { StaticCollider } from "../../src/physix/StaticCollider.js";
import { BoundingBox } from "../../src/physix/BoundingBox.js";
import { Vector3D } from "../../src/math/Vector3D.js";
import { EventDispatcherImpl } from "../../src/core/events/EventDispatcherImpl.js";

describe("PhysicsDeterminism", () => {
  beforeEach(() => {
    Object3D.resetNextId();
    StaticCollider.resetNextId();
  });

  it("yields bit-exact positions and velocities regardless of scene insertion order", () => {
    const runSimulation = (
      order: "forward" | "reverse",
    ): {
      posA: Vector3D;
      velA: Vector3D;
      posB: Vector3D;
      velB: Vector3D;
      posC: Vector3D;
      velC: Vector3D;
    } => {
      const events = new EventDispatcherImpl();
      const physics = new PhysicsSystem(events);
      physics.gravity.set(0, -9.81, 0);
      const scene = new Scene();

      // Ball A: falling fast from above
      const ballA = new Object3D("BallA");
      ballA.id = 1;
      ballA.geometry = new Sphere({ radius: 0.5 }).getGeometryData();
      ballA.position.set(0, 5, 0);
      ballA.rigidBody = new RigidBody(1.0);
      ballA.rigidBody.restitution = 0.5;
      ballA.updateMatrixWorld();
      ballA.computeBounds();

      // Ball B: stationary in middle
      const ballB = new Object3D("BallB");
      ballB.id = 2;
      ballB.geometry = new Sphere({ radius: 0.5 }).getGeometryData();
      ballB.position.set(0.1, 2.5, 0);
      ballB.rigidBody = new RigidBody(1.0);
      ballB.rigidBody.restitution = 0.5;
      ballB.updateMatrixWorld();
      ballB.computeBounds();

      // Box C: resting near bottom
      const boxC = new Object3D("BoxC");
      boxC.id = 3;
      boxC.geometry = new Cube({ size: 1.0 }).getGeometryData();
      boxC.position.set(0, 0.5, 0);
      boxC.rigidBody = new RigidBody(2.0);
      boxC.rigidBody.restitution = 0.3;
      boxC.updateMatrixWorld();
      boxC.computeBounds();

      // Floor: static collider
      const floor = new StaticCollider(
        new BoundingBox(new Vector3D(-10, -1, -10), new Vector3D(10, 0, 10)),
      );
      floor.id = 100;
      scene.staticColliders.push(floor);

      if (order === "forward") {
        scene.objects.push(ballA, ballB, boxC);
      } else {
        scene.objects.push(boxC, ballB, ballA);
      }

      // Step simulation for 60 frames (1 second)
      for (let f = 0; f < 60; f++) {
        physics.step(scene, 1 / 60);
      }

      return {
        posA: ballA.position.clone(),
        velA: ballA.rigidBody.velocity.clone(),
        posB: ballB.position.clone(),
        velB: ballB.rigidBody.velocity.clone(),
        posC: boxC.position.clone(),
        velC: boxC.rigidBody.velocity.clone(),
      };
    };

    const simForward = runSimulation("forward");
    const simReverse = runSimulation("reverse");

    // Ball A exact match
    expect(simReverse.posA.x).toBe(simForward.posA.x);
    expect(simReverse.posA.y).toBe(simForward.posA.y);
    expect(simReverse.posA.z).toBe(simForward.posA.z);
    expect(simReverse.velA.x).toBe(simForward.velA.x);
    expect(simReverse.velA.y).toBe(simForward.velA.y);
    expect(simReverse.velA.z).toBe(simForward.velA.z);

    // Ball B exact match
    expect(simReverse.posB.x).toBe(simForward.posB.x);
    expect(simReverse.posB.y).toBe(simForward.posB.y);
    expect(simReverse.posB.z).toBe(simForward.posB.z);
    expect(simReverse.velB.x).toBe(simForward.velB.x);
    expect(simReverse.velB.y).toBe(simForward.velB.y);
    expect(simReverse.velB.z).toBe(simForward.velB.z);

    // Box C exact match
    expect(simReverse.posC.x).toBe(simForward.posC.x);
    expect(simReverse.posC.y).toBe(simForward.posC.y);
    expect(simReverse.posC.z).toBe(simForward.posC.z);
    expect(simReverse.velC.x).toBe(simForward.velC.x);
    expect(simReverse.velC.y).toBe(simForward.velC.y);
    expect(simReverse.velC.z).toBe(simForward.velC.z);
  });

  it("dispatches collision events in canonical deterministic order with consistent pair IDs", () => {
    const runWithOrder = (
      order: "forward" | "reverse",
    ): { idA: number; idB: number; impulse: number }[] => {
      const recordedEvents: { idA: number; idB: number; impulse: number }[] = [];
      const events = new EventDispatcherImpl();
      events.addEventListener("physics:collision", (e: unknown) => {
        const payload = e as { objectA: Object3D; objectB: Object3D; impulse: number };
        recordedEvents.push({
          idA: payload.objectA.id,
          idB: payload.objectB.id,
          impulse: payload.impulse,
        });
      });

      const physics = new PhysicsSystem(events);
      const scene = new Scene();

      const obj1 = new Object3D("Obj1");
      obj1.id = 10;
      obj1.geometry = new Sphere({ radius: 1 }).getGeometryData();
      obj1.position.set(0, 0, 0);
      obj1.rigidBody = new RigidBody(1);
      obj1.rigidBody.velocity.set(2, 0, 0);
      obj1.updateMatrixWorld();
      obj1.computeBounds();

      const obj2 = new Object3D("Obj2");
      obj2.id = 20;
      obj2.geometry = new Sphere({ radius: 1 }).getGeometryData();
      obj2.position.set(0.8, 0, 0);
      obj2.rigidBody = new RigidBody(1);
      obj2.rigidBody.velocity.set(-1, 0, 0);
      obj2.updateMatrixWorld();
      obj2.computeBounds();

      const obj3 = new Object3D("Obj3");
      obj3.id = 30;
      obj3.geometry = new Sphere({ radius: 1 }).getGeometryData();
      obj3.position.set(2.0, 0, 0);
      obj3.rigidBody = new RigidBody(1);
      obj3.rigidBody.velocity.set(-2, 0, 0);
      obj3.updateMatrixWorld();
      obj3.computeBounds();

      if (order === "forward") {
        scene.objects.push(obj1, obj2, obj3);
      } else {
        scene.objects.push(obj3, obj2, obj1);
      }

      physics.step(scene, 1 / 60);
      return recordedEvents;
    };

    const eventsForward = runWithOrder("forward");
    const eventsReverse = runWithOrder("reverse");

    expect(eventsForward.length).toBeGreaterThan(0);
    expect(eventsReverse.length).toBe(eventsForward.length);

    for (let i = 0; i < eventsForward.length; i++) {
      expect(eventsReverse[i]!.idA).toBe(eventsForward[i]!.idA);
      expect(eventsReverse[i]!.idB).toBe(eventsForward[i]!.idB);
      expect(eventsReverse[i]!.impulse).toBeCloseTo(eventsForward[i]!.impulse, 6);
    }
  });

  it("handles static-dynamic pairs deterministically regardless of whether static or dynamic has lower ID", () => {
    const runPair = (
      staticId: number,
      dynamicId: number,
    ): {
      pos: Vector3D;
      vel: Vector3D;
    } => {
      const events = new EventDispatcherImpl();
      const physics = new PhysicsSystem(events);
      const scene = new Scene();

      const staticBox = new StaticCollider(
        new BoundingBox(new Vector3D(-1, -1, -1), new Vector3D(1, 1, 1)),
      );
      staticBox.id = staticId;
      scene.staticColliders.push(staticBox);

      const dynamicSphere = new Object3D("DynSphere");
      dynamicSphere.id = dynamicId;
      dynamicSphere.geometry = new Sphere({ radius: 0.5 }).getGeometryData();
      // Penetrating box on right side (+X)
      dynamicSphere.position.set(1.2, 0, 0);
      dynamicSphere.rigidBody = new RigidBody(1);
      dynamicSphere.rigidBody.velocity.set(-2, 0, 0); // Moving left into box
      dynamicSphere.updateMatrixWorld();
      dynamicSphere.computeBounds();
      scene.objects.push(dynamicSphere);

      physics.step(scene, 1 / 60);

      return {
        pos: dynamicSphere.position.clone(),
        vel: dynamicSphere.rigidBody.velocity.clone(),
      };
    };

    // Case 1: staticId (5) < dynamicId (10)
    const resStaticFirst = runPair(5, 10);
    // Case 2: dynamicId (5) < staticId (10)
    const resDynamicFirst = runPair(10, 5);

    expect(resStaticFirst.pos.x).toBeCloseTo(resDynamicFirst.pos.x, 5);
    expect(resStaticFirst.pos.y).toBeCloseTo(resDynamicFirst.pos.y, 5);
    expect(resStaticFirst.vel.x).toBeCloseTo(resDynamicFirst.vel.x, 5);
    expect(resStaticFirst.vel.y).toBeCloseTo(resDynamicFirst.vel.y, 5);
  });

  /**
   * @invariant STATIC-ORDER-INVARIANCE: Die Einfüge-Reihenfolge mehrerer statischer Collider
   *   (`scene.staticColliders`) UND der dynamischen Objekte beeinflusst den bit-exakten
   *   Simulationszustand nicht — ≥2 Statics in invertierter Reihenfolge + invertierter
   *   Objekt-Auftrag ergeben identische Positions-/Velocity-Komponenten (P4-m4).
   */
  it("yields bit-exact dynamic state with ≥2 statics in reversed collider/object insertion order", () => {
    const runMultiStatic = (order: "forward" | "reverse"): number[][] => {
      const events = new EventDispatcherImpl();
      const physics = new PhysicsSystem(events);
      physics.gravity.set(0, -9.81, 0);
      const scene = new Scene();

      const floor = new StaticCollider(
        new BoundingBox(new Vector3D(-10, -1, -10), new Vector3D(10, 0, 10)),
      );
      floor.id = 100;
      const platform = new StaticCollider(
        new BoundingBox(new Vector3D(4, 0, -2), new Vector3D(6, 1, 2)),
      );
      platform.id = 200;

      if (order === "forward") scene.staticColliders.push(floor, platform);
      else scene.staticColliders.push(platform, floor);

      const ballA = new Object3D("BallA");
      ballA.id = 1;
      ballA.geometry = new Sphere({ radius: 0.5 }).getGeometryData();
      ballA.position.set(0, 5, 0);
      ballA.rigidBody = new RigidBody(1.0);
      ballA.rigidBody.restitution = 0.5;
      ballA.updateMatrixWorld();
      ballA.computeBounds();

      const ballB = new Object3D("BallB");
      ballB.id = 2;
      ballB.geometry = new Sphere({ radius: 0.5 }).getGeometryData();
      ballB.position.set(5, 5, 0);
      ballB.rigidBody = new RigidBody(1.0);
      ballB.rigidBody.restitution = 0.5;
      ballB.updateMatrixWorld();
      ballB.computeBounds();

      if (order === "forward") scene.objects.push(ballA, ballB);
      else scene.objects.push(ballB, ballA);

      for (let f = 0; f < 60; f++) physics.step(scene, 1 / 60);

      return [
        [ballA.position.x, ballA.position.y, ballA.position.z] as number[],
        [
          ballA.rigidBody!.velocity.x,
          ballA.rigidBody!.velocity.y,
          ballA.rigidBody!.velocity.z,
        ] as number[],
        [ballB.position.x, ballB.position.y, ballB.position.z] as number[],
        [
          ballB.rigidBody!.velocity.x,
          ballB.rigidBody!.velocity.y,
          ballB.rigidBody!.velocity.z,
        ] as number[],
      ];
    };

    const forward = runMultiStatic("forward");
    const reverse = runMultiStatic("reverse");

    expect(reverse).toEqual(forward);
  });
});
