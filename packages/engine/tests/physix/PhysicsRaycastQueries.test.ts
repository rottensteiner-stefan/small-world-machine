import { describe, it, expect } from "vitest";
import { Object3D } from "../../src/core/Object3D.js";
import { StaticCollider } from "../../src/physix/StaticCollider.js";
import { BoundingBox } from "../../src/physix/BoundingBox.js";
import { BoundingSphere } from "../../src/physix/BoundingSphere.js";
import { OBB } from "../../src/physix/OBB.js";
import { Ray } from "../../src/physix/Ray.js";
import { PhysicsSystem } from "../../src/physix/PhysicsSystem.js";
import { EventDispatcherImpl } from "../../src/core/events/EventDispatcherImpl.js";
import { Scene } from "../../src/core/Scene.js";
import { Vector3D } from "../../src/math/index.js";

describe("Physics Raycast & Query API", () => {
  describe("Ray.intersectVolumeDetailed", () => {
    it("computes exact hit point and outward normal for Sphere", () => {
      const ray = new Ray(new Vector3D(0, 0, 10), new Vector3D(0, 0, -1));
      const sphere = new BoundingSphere(new Vector3D(0, 0, 0), 2.0);

      const hitPoint = new Vector3D();
      const hitNormal = new Vector3D();
      const t = ray.intersectVolumeDetailed(sphere, hitPoint, hitNormal);

      expect(t).toBeCloseTo(8.0);
      expect(hitPoint.x).toBeCloseTo(0);
      expect(hitPoint.y).toBeCloseTo(0);
      expect(hitPoint.z).toBeCloseTo(2.0);

      expect(hitNormal.x).toBeCloseTo(0);
      expect(hitNormal.y).toBeCloseTo(0);
      expect(hitNormal.z).toBeCloseTo(1.0);
    });

    it("computes exact hit point and face normal for Box (AABB)", () => {
      // Ray shooting along +X into a box spanning [5, 7]
      const ray = new Ray(new Vector3D(0, 0, 0), new Vector3D(1, 0, 0));
      const box = new BoundingBox(new Vector3D(5, -2, -2), new Vector3D(7, 2, 2));

      const hitPoint = new Vector3D();
      const hitNormal = new Vector3D();
      const t = ray.intersectVolumeDetailed(box, hitPoint, hitNormal);

      expect(t).toBeCloseTo(5.0);
      expect(hitPoint.x).toBeCloseTo(5.0);
      expect(hitPoint.y).toBeCloseTo(0);
      expect(hitPoint.z).toBeCloseTo(0);

      // Normal points towards -X (outward from the left face)
      expect(hitNormal.x).toBeCloseTo(-1.0);
      expect(hitNormal.y).toBeCloseTo(0);
      expect(hitNormal.z).toBeCloseTo(0);
    });

    it("computes exact hit point and normal for OBB", () => {
      const ray = new Ray(new Vector3D(0, 10, 0), new Vector3D(0, -1, 0));
      const obb = new OBB(new Vector3D(0, 0, 0), new Vector3D(2, 2, 2));

      const hitPoint = new Vector3D();
      const hitNormal = new Vector3D();
      const t = ray.intersectVolumeDetailed(obb, hitPoint, hitNormal);

      expect(t).toBeCloseTo(8.0);
      expect(hitPoint.y).toBeCloseTo(2.0);
      expect(hitNormal.y).toBeCloseTo(1.0);
    });
  });

  describe("PhysicsSystem.raycast & raycastAll", () => {
    it("returns the closest obstacle along ray and ignores farther objects", () => {
      const events = new EventDispatcherImpl();
      const physics = new PhysicsSystem(events);
      const scene = new Scene();

      // Near box at z = -5 (thickness 1, from -5 to -4)
      const nearBox = new StaticCollider(
        new BoundingBox(new Vector3D(-1, -1, -5), new Vector3D(1, 1, -4)),
      );
      // Far sphere at z = -20
      const farSphere = new StaticCollider(new BoundingSphere(new Vector3D(0, 0, -20), 2.0));

      scene.staticColliders.push(farSphere, nearBox);

      // Step once to register static colliders into broadphase
      physics.step(scene, 1 / 60);

      const ray = new Ray(new Vector3D(0, 0, 0), new Vector3D(0, 0, -1));
      const hit = physics.raycast(ray);

      expect(hit).not.toBeNull();
      expect(hit!.collider).toBe(nearBox);
      expect(hit!.distance).toBeCloseTo(4.0);
      expect(hit!.point.z).toBeCloseTo(-4.0);
      expect(hit!.normal.z).toBeCloseTo(1.0);
    });

    it("respects maxDistance and returns null if target is out of range", () => {
      const events = new EventDispatcherImpl();
      const physics = new PhysicsSystem(events);
      const scene = new Scene();

      const obstacle = new StaticCollider(
        new BoundingBox(new Vector3D(-1, -1, 10), new Vector3D(1, 1, 12)),
      );
      scene.staticColliders.push(obstacle);
      physics.step(scene, 1 / 60);

      const ray = new Ray(new Vector3D(0, 0, 0), new Vector3D(0, 0, 1));
      // Max distance is 5.0, obstacle starts at 10.0
      const hit = physics.raycast(ray, 5.0);
      expect(hit).toBeNull();
    });

    it("respects collision layer mask and ignores non-matching layers", () => {
      const events = new EventDispatcherImpl();
      const physics = new PhysicsSystem(events);
      const scene = new Scene();

      const enemy = new Object3D("Enemy");
      enemy.position.set(0, 0, 5);
      enemy.bounds = new BoundingSphere(enemy.position, 1.0);
      enemy.collisionLayer = 0b0100; // Layer 3 (Enemy)

      const terrain = new Object3D("Terrain");
      terrain.position.set(0, 0, 10);
      terrain.bounds = new BoundingBox(new Vector3D(-5, -5, 9), new Vector3D(5, 5, 11));
      terrain.collisionLayer = 0b0010; // Layer 2 (Terrain)

      scene.objects.push(enemy, terrain);
      physics.step(scene, 1 / 60);

      const ray = new Ray(new Vector3D(0, 0, 0), new Vector3D(0, 0, 1));

      // Raycast querying ONLY Terrain (0b0010)
      const hit = physics.raycast(ray, Infinity, 0b0010);
      expect(hit).not.toBeNull();
      expect(hit!.object).toBe(terrain);
      expect(hit!.distance).toBeCloseTo(9.0);
    });

    it("ignores trigger volumes when ignoreTriggers is true", () => {
      const events = new EventDispatcherImpl();
      const physics = new PhysicsSystem(events);
      const scene = new Scene();

      // Trigger volume in front
      const trigger = new StaticCollider(
        new BoundingBox(new Vector3D(-2, -2, 2), new Vector3D(2, 2, 4)),
      );
      trigger.isTrigger = true;

      // Solid wall behind trigger
      const wall = new StaticCollider(
        new BoundingBox(new Vector3D(-5, -5, 10), new Vector3D(5, 5, 12)),
      );

      scene.staticColliders.push(trigger, wall);
      physics.step(scene, 1 / 60);

      const ray = new Ray(new Vector3D(0, 0, 0), new Vector3D(0, 0, 1));
      const hit = physics.raycast(ray, Infinity, 0xffffffff, undefined, true);

      expect(hit).not.toBeNull();
      expect(hit!.collider).toBe(wall);
      expect(hit!.distance).toBeCloseTo(10.0);
    });

    it("raycastAll returns multiple hits sorted by distance ascending", () => {
      const events = new EventDispatcherImpl();
      const physics = new PhysicsSystem(events);
      const scene = new Scene();

      const obj1 = new StaticCollider(
        new BoundingBox(new Vector3D(-1, -1, 10), new Vector3D(1, 1, 12)),
      );
      const obj2 = new StaticCollider(
        new BoundingBox(new Vector3D(-1, -1, 4), new Vector3D(1, 1, 6)),
      );
      const obj3 = new StaticCollider(
        new BoundingBox(new Vector3D(-1, -1, 20), new Vector3D(1, 1, 22)),
      );

      scene.staticColliders.push(obj1, obj2, obj3);
      physics.step(scene, 1 / 60);

      const ray = new Ray(new Vector3D(0, 0, 0), new Vector3D(0, 0, 1));
      const hits = physics.raycastAll(ray);

      expect(hits.length).toBe(3);
      expect(hits[0]!.collider).toBe(obj2); // distance 4.0
      expect(hits[1]!.collider).toBe(obj1); // distance 10.0
      expect(hits[2]!.collider).toBe(obj3); // distance 20.0
      expect(hits[0]!.distance).toBeLessThan(hits[1]!.distance);
      expect(hits[1]!.distance).toBeLessThan(hits[2]!.distance);
    });
  });

  describe("PhysicsSystem.sphereCast", () => {
    it("sweeps a volumetric sphere and detects contact", () => {
      const events = new EventDispatcherImpl();
      const physics = new PhysicsSystem(events);
      const scene = new Scene();

      // Wall at x = 10 (thickness 1.0)
      const wall = new StaticCollider(
        new BoundingBox(new Vector3D(9.5, -5, -5), new Vector3D(10.5, 5, 5)),
      );
      scene.staticColliders.push(wall);
      physics.step(scene, 1 / 60);

      // Sphere with radius 1.0 sweeping from x = 0 towards +X
      const hit = physics.sphereCast(new Vector3D(0, 0, 0), 1.0, new Vector3D(1, 0, 0), 50);

      expect(hit).not.toBeNull();
      expect(hit!.collider).toBe(wall);
      // Wall min is 9.5, sphere radius is 1.0, so sphere center reaches 8.5 at impact
      expect(hit!.distance).toBeCloseTo(8.5, 1);
    });
  });
});
