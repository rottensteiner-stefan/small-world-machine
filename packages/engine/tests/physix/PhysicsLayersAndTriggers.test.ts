import { describe, it, expect } from "vitest";
import { Object3D } from "../../src/core/Object3D.js";
import { RigidBody } from "../../src/physix/RigidBody.js";
import { StaticCollider } from "../../src/physix/StaticCollider.js";
import { BoundingBox } from "../../src/physix/BoundingBox.js";
import { BoundingSphere } from "../../src/physix/BoundingSphere.js";
import { PhysicsBroadphase } from "../../src/physix/broadphase/PhysicsBroadphase.js";
import { PhysicsSystem } from "../../src/physix/PhysicsSystem.js";
import { EventDispatcherImpl } from "../../src/core/events/EventDispatcherImpl.js";
import { Scene } from "../../src/core/Scene.js";
import { Vector3D } from "../../src/math/index.js";

describe("Collision Layers, Bitmasks & Trigger-System", () => {
  describe("Layer & Mask Bitmask Filtering", () => {
    it("PhysicsBroadphase.canCollide accurately checks bidirectional bitmasks", () => {
      const objA = new Object3D("Player");
      objA.collisionLayer = 0b0001; // Layer 1 (Player)
      objA.collisionMask = 0b0010 | 0b0100; // Collides with World (2) and Enemies (4)

      const objB = new Object3D("EnemyBullet");
      objB.collisionLayer = 0b1000; // Layer 4 (EnemyBullet)
      objB.collisionMask = 0b0001 | 0b0010; // Collides with Player (1) and World (2)

      // objA doesn't collide with EnemyBullet (mask doesn't include 8)
      expect(PhysicsBroadphase.canCollide(objA, objB)).toBe(false);

      const objC = new Object3D("Enemy");
      objC.collisionLayer = 0b0100; // Layer 3 (Enemy)
      objC.collisionMask = 0b0001 | 0b0010; // Collides with Player (1) and World (2)

      // Both agree on interaction
      expect(PhysicsBroadphase.canCollide(objA, objC)).toBe(true);
    });

    it("prevents collision pairing and forces when masks do not match", () => {
      const events = new EventDispatcherImpl();
      const physics = new PhysicsSystem(events);
      physics.gravity.set(0, 0, 0);
      const scene = new Scene();

      // Moving bullet on layer 8, masks only layer 4
      const bullet = new Object3D("Bullet");
      bullet.position.set(0, 0, 0);
      bullet.bounds = new BoundingSphere(bullet.position, 1.0);
      bullet.rigidBody = new RigidBody(1.0);
      bullet.rigidBody.velocity.set(10, 0, 0);
      bullet.collisionLayer = 0b1000;
      bullet.collisionMask = 0b0100; // Only collides with Layer 3 (0b0100)

      // Player on layer 1, masks layer 2
      const player = new Object3D("Player");
      player.position.set(0.5, 0, 0); // Overlapping
      player.bounds = new BoundingSphere(player.position, 1.0);
      player.rigidBody = new RigidBody(1.0);
      player.collisionLayer = 0b0001;
      player.collisionMask = 0b0010;

      scene.objects.push(bullet, player);

      let collisionFired = false;
      events.addEventListener("physics:collision", () => {
        collisionFired = true;
      });

      physics.step(scene, 1 / 60);

      expect(collisionFired).toBe(false);
      // Bullet continues unimpeded through non-colliding layer
      expect(bullet.rigidBody.velocity.x).toBeCloseTo(10);
    });
  });

  describe("Trigger Lifecycle Events (Enter, Stay, Exit)", () => {
    it("dispatches trigger-enter, trigger-stay, and trigger-exit without exerting physical force", () => {
      const events = new EventDispatcherImpl();
      const physics = new PhysicsSystem(events);
      physics.gravity.set(0, 0, 0);
      const scene = new Scene();

      // Static trigger volume at x=0
      const trigger = new StaticCollider(
        new BoundingBox(new Vector3D(-2, -2, -2), new Vector3D(2, 2, 2)),
      );
      trigger.isTrigger = true;
      scene.staticColliders.push(trigger);

      // Dynamic player moving through the trigger
      const player = new Object3D("Player");
      player.position.set(-5, 0, 0);
      player.bounds = new BoundingSphere(player.position, 0.5);
      player.rigidBody = new RigidBody(1.0);
      player.rigidBody.velocity.set(60, 0, 0); // moves 1 unit per 1/60s step
      scene.objects.push(player);

      const history: string[] = [];
      events.addEventListener("physics:trigger-enter", () => history.push("enter"));
      events.addEventListener("physics:trigger-stay", () => history.push("stay"));
      events.addEventListener("physics:trigger-exit", () => history.push("exit"));

      // Step 1: Player at -5 (distance 5, outside trigger [-2, 2])
      physics.step(scene, 1 / 60);
      expect(player.position.x).toBeCloseTo(-4.0);
      expect(history).toEqual([]);

      // Step 2: Player moves to -3.0 (outside, radius 0.5 reaches -2.5)
      physics.step(scene, 1 / 60);
      expect(player.position.x).toBeCloseTo(-3.0);
      expect(history).toEqual([]);

      // Step 3: Player moves to -2.0 (enters trigger: right edge at -1.5 is inside [-2, 2])
      physics.step(scene, 1 / 60);
      expect(player.position.x).toBeCloseTo(-2.0);
      expect(history).toEqual(["enter"]);

      // Step 4: Player moves to -1.0 (stays inside trigger)
      physics.step(scene, 1 / 60);
      expect(player.position.x).toBeCloseTo(-1.0);
      expect(history).toEqual(["enter", "stay"]);

      // Step 5: Player moves to 0.0 (stays inside trigger)
      physics.step(scene, 1 / 60);
      expect(player.position.x).toBeCloseTo(0.0);
      expect(history).toEqual(["enter", "stay", "stay"]);

      // Player velocity must remain completely constant (no physical bounce/impulse from trigger)
      expect(player.rigidBody.velocity.x).toBeCloseTo(60);

      // Move player out past x=5
      player.position.set(5, 0, 0);
      player.updateMatrixWorld();
      physics.step(scene, 1 / 60);

      // Trigger exit must be fired
      expect(history).toContain("exit");
    });
  });

  describe("Physical Collision Lifecycle Events (Enter, Stay, Exit)", () => {
    it("dispatches collision-enter, collision-stay, and collision-exit for physical contacts", () => {
      const events = new EventDispatcherImpl();
      const physics = new PhysicsSystem(events);
      physics.gravity.set(0, 0, 0);
      const scene = new Scene();

      // Static wall at x=0
      const wall = new StaticCollider(
        new BoundingBox(new Vector3D(-1, -10, -10), new Vector3D(0, 10, 10)),
      );
      scene.staticColliders.push(wall);

      // Ball resting against the wall at x=0.5 (radius 0.5 touches wall at x=0)
      const ball = new Object3D("Ball");
      ball.position.set(0.4, 0, 0); // slight penetration
      ball.bounds = new BoundingSphere(ball.position, 0.5);
      ball.rigidBody = new RigidBody(1.0);
      ball.rigidBody.velocity.set(-1, 0, 0);
      scene.objects.push(ball);

      const history: string[] = [];
      events.addEventListener("physics:collision-enter", () => history.push("enter"));
      events.addEventListener("physics:collision-stay", () => history.push("stay"));
      events.addEventListener("physics:collision-exit", () => history.push("exit"));

      // Step 1: Initial contact
      physics.step(scene, 1 / 60);
      expect(history).toEqual(["enter"]);

      // Step 2: Continuous contact
      ball.position.set(0.49, 0, 0);
      physics.step(scene, 1 / 60);
      expect(history).toEqual(["enter", "stay"]);

      // Step 3: Ball moves away
      ball.position.set(5.0, 0, 0);
      physics.step(scene, 1 / 60);
      expect(history).toEqual(["enter", "stay", "exit"]);
    });
  });
});
