import { describe, it, expect } from "vitest";
import { PhysicsSystem } from "../../src/physix/PhysicsSystem.js";
import { FluidVolume } from "../../src/physix/FluidVolume.js";
import { Object3D } from "../../src/core/Object3D.js";
import { RigidBody } from "../../src/physix/RigidBody.js";
import { BoundingBox } from "../../src/physix/BoundingBox.js";
import { Vector3D } from "../../src/math/Vector3D.js";
import { Scene } from "../../src/core/Scene.js";
import { EventDispatcherImpl } from "../../src/core/events/EventDispatcherImpl.js";

describe("FluidVolume & Buoyancy", () => {
  it("should apply upward buoyancy force when an object is submerged", () => {
    const events = new EventDispatcherImpl();
    const physics = new PhysicsSystem(events);
    physics.gravity.set(0, -10, 0); // Simplification: gravity is exactly -10

    // Create a 10x10x10 pool of water from Y=-10 to Y=0
    const waterBounds = new BoundingBox(new Vector3D(-5, -10, -5), new Vector3D(5, 0, 5));
    const water = new FluidVolume(waterBounds, 1.0, 0.9); // density 1.0, drag 0.9
    physics.addFluidVolume(water);

    const scene = new Scene();

    // Create a 1x1x1 neutrally buoyant crate (mass 1.0 kg, volume 1.0 m^3)
    const crate = new Object3D("Crate");
    crate.position.set(0, -1, 0); // Center at Y=-1. Bounds min.y=-1.5, max.y=-0.5.
    crate.bounds = new BoundingBox(new Vector3D(-0.5, -1.5, -0.5), new Vector3D(0.5, -0.5, 0.5));
    crate.rigidBody = new RigidBody(1.0); // 1kg
    scene.add(crate);

    // Initial state:
    // Crate Y = -1. Bounding box Y is from -1.5 to -0.5.
    // Water top is Y = 0.
    // Crate is fully submerged (ratio = 1.0).
    // Volume = 1.0 m^3, displaced water = 1.0 kg.
    // Buoyancy force = -(-10) * 1.0 * 1.0 = +10 N.
    // Gravity force = -10 N.
    // Total acceleration = 10 (buoyancy) + (-10) (gravity) = 0.
    // Let's step the simulation.
    crate.updateMatrixWorld();
    crate.computeBounds();

    physics.step(scene, 1 / 60);

    // Since total acceleration is 0, velocity should be 0, and position should barely change
    // (except for minor floating point or order of operations).
    // Wait, the test initializes velocity at 0.
    expect(crate.rigidBody.velocity.y).toBeCloseTo(0, 3);
    expect(crate.position.y).toBeCloseTo(-1, 3);
  });

  it("should apply velocity damping (drag) to submerged objects", () => {
    const events = new EventDispatcherImpl();
    const physics = new PhysicsSystem(events);
    physics.gravity.set(0, 0, 0); // Turn off gravity for pure drag test

    const waterBounds = new BoundingBox(new Vector3D(-10, -10, -10), new Vector3D(10, 10, 10));
    // Drag = 0.5 (meaning it multiplies velocity by 0.5 when fully submerged)
    const water = new FluidVolume(waterBounds, 1.0, 0.5);
    physics.addFluidVolume(water);

    const scene = new Scene();

    const bullet = new Object3D("Bullet");
    bullet.position.set(0, 0, 0);
    bullet.bounds = new BoundingBox(new Vector3D(-1, -1, -1), new Vector3D(1, 1, 1));
    bullet.rigidBody = new RigidBody(1.0);
    bullet.rigidBody.velocity.set(100, 0, 0); // Moving very fast on X
    bullet.rigidBody.friction = 1.0; // No normal friction
    scene.add(bullet);

    bullet.updateMatrixWorld();
    bullet.computeBounds();

    physics.step(scene, 1 / 60);

    // Drag is applied. New velocity should be heavily reduced.
    // Expected drag multiplier: 1.0 - (1.0 - maxDrag) * ratio = 1.0 - (1.0 - 0.5) * 1.0 = 0.5
    expect(bullet.rigidBody.velocity.x).toBeLessThan(100);
    expect(bullet.rigidBody.velocity.x).toBeCloseTo(50, 1);
  });

  it("should apply fluid flow velocity (currents) to submerged objects", () => {
    const events = new EventDispatcherImpl();
    const physics = new PhysicsSystem(events);
    physics.gravity.set(0, 0, 0); // Turn off gravity

    const waterBounds = new BoundingBox(new Vector3D(-10, -10, -10), new Vector3D(10, 10, 10));
    const water = new FluidVolume(waterBounds, 1.0, 1.0, new Vector3D(10, 0, 0)); // Flowing right at 10 units/s
    physics.addFluidVolume(water);

    const scene = new Scene();

    const leaf = new Object3D("Leaf");
    leaf.position.set(0, 0, 0);
    leaf.bounds = new BoundingBox(new Vector3D(-0.5, -0.5, -0.5), new Vector3D(0.5, 0.5, 0.5));
    leaf.rigidBody = new RigidBody(1.0);
    scene.add(leaf);

    leaf.updateMatrixWorld();
    leaf.computeBounds();

    physics.step(scene, 1 / 60);

    // Flow velocity pushes the leaf along X
    expect(leaf.rigidBody.velocity.x).toBeGreaterThan(0);
  });
});
