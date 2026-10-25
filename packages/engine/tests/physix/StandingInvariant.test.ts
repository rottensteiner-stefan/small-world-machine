import { describe, it, expect } from "vitest";
import { PhysicsSystem } from "../../src/physix/PhysicsSystem.js";
import { Scene } from "../../src/core/Scene.js";
import { Object3D } from "../../src/core/Object3D.js";
import { RigidBody } from "../../src/physix/RigidBody.js";
import { Cube } from "../../src/geometry/Cube.js";
import { StaticCollider } from "../../src/physix/StaticCollider.js";
import { BoundingBox } from "../../src/physix/BoundingBox.js";
import { Vector3D } from "../../src/math/Vector3D.js";
import { EventDispatcherImpl } from "../../src/core/events/EventDispatcherImpl.js";

/**
 * @invariant PHYS-STANDING: Ein abgestelltes (/parked) RigidBody wandert nicht: Nach Erreichen des
 *   Ruhegleichgewichts (Sleep) bleibt jede Position/Velocity über weitere identische Fixed-Steps
 *   bit-exakt konstant (kein numerisches Kriechen/Drift). Ein waches Ruhecontact (allowSleep=false)
 *   darf nicht materiell wandern/absinken (begrenzter Offset, Velocity ~ 0). Anker: `PhysicsSystem.step`
 *   (`_internalStep` Sleep-Evaluation nach Integration & Kontaktlösen).
 */

const makeRestScene = (
  allowSleep: boolean,
): { physics: PhysicsSystem; scene: Scene; box: Object3D } => {
  Object3D.resetNextId();
  StaticCollider.resetNextId();
  const events = new EventDispatcherImpl();
  const physics = new PhysicsSystem(events);
  physics.gravity.set(0, -9.81, 0);
  const scene = new Scene();

  const box = new Object3D("ParkedBox");
  box.id = 1;
  box.geometry = new Cube({ size: 1.0 }).getGeometryData();
  box.position.set(0, 0.5, 0); // exakt aufliegend auf dem Boden (Floor-Oberseite y=0)
  box.rigidBody = new RigidBody(2.0);
  box.rigidBody.restitution = 0.3;
  box.rigidBody.allowSleep = allowSleep;
  box.updateMatrixWorld();
  box.computeBounds();
  scene.objects.push(box);

  const floor = new StaticCollider(
    new BoundingBox(new Vector3D(-10, -1, -10), new Vector3D(10, 0, 10)),
  );
  floor.id = 100;
  scene.staticColliders.push(floor);
  return { physics, scene, box };
};

const boxKey = (box: Object3D): number[] => [
  box.position.x,
  box.position.y,
  box.position.z,
  box.rigidBody!.velocity.x,
  box.rigidBody!.velocity.y,
  box.rigidBody!.velocity.z,
];

describe("PHYS-STANDING (parked object must not wander)", () => {
  it("a sleeping parked body stays bit-exact across further identical fixed steps (no drift)", () => {
    const { physics, scene, box } = makeRestScene(true);

    // Schritt 1: in Ruhe bringen bis Sleep einsetzt.
    let slept = false;
    for (let f = 0; f < 120; f++) {
      physics.step(scene, 1 / 60);
      if (box.rigidBody!.isSleeping) slept = true;
    }
    expect(slept).toBe(true);
    expect(box.rigidBody!.isSleeping).toBe(true);
    const rested = boxKey(box);

    // Schritt 2: weitere 300 IDENTISCHE Fixed-Steps — Zustand muss buchstäblich feststehen.
    for (let f = 0; f < 300; f++) physics.step(scene, 1 / 60);
    expect(boxKey(box)).toEqual(rested);
    expect(box.rigidBody!.isSleeping).toBe(true);
  });

  it("an awake resting body neither sinks nor levitates (bounded wander, zero velocity)", () => {
    const { physics, scene, box } = makeRestScene(false);

    // Abgesetzt und wach (kein Sleep): nur der Kontaktlöser hält es. Über 300 weitere Steps
    // darf es weder durch den Boden sacken noch schweben (Sub-ULP-Solver-Rauschen ist ok).
    for (let f = 0; f < 120; f++) physics.step(scene, 1 / 60);
    const settledY = box.position.y;

    for (let f = 0; f < 300; f++) physics.step(scene, 1 / 60);

    expect(Math.abs(box.position.x - 0)).toBeLessThan(1e-6);
    expect(Math.abs(box.position.y - settledY)).toBeLessThan(1e-6);
    expect(Math.abs(box.position.z - 0)).toBeLessThan(1e-6);
    expect(Math.abs(box.rigidBody!.velocity.x)).toBeLessThan(1e-9);
    expect(Math.abs(box.rigidBody!.velocity.y)).toBeLessThan(1e-9);
    expect(Math.abs(box.rigidBody!.velocity.z)).toBeLessThan(1e-9);
  });
});
