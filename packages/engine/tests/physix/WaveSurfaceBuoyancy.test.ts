import { describe, it, expect } from "vitest";
import { OpenWaterMaterial, OpenWaterSurfaceProbe } from "../../src/core/materials/index.js";
import { PhysicsSystem } from "../../src/physix/PhysicsSystem.js";
import { FluidVolume } from "../../src/physix/FluidVolume.js";
import { Scene } from "../../src/core/Scene.js";
import { Object3D } from "../../src/core/Object3D.js";
import { RigidBody } from "../../src/physix/RigidBody.js";
import { Cube } from "../../src/geometry/Cube.js";
import { BoundingBox } from "../../src/physix/BoundingBox.js";
import { Vector3D } from "../../src/math/Vector3D.js";
import { EventDispatcherImpl } from "../../src/core/events/EventDispatcherImpl.js";

// Fixed, non-trivial wave lanes (S1 spec) driving a probe that mirrors the GPU surface.
const WAVE1: [number, number, number, number] = [1, 0, 0.5, 12];
const WAVE2: [number, number, number, number] = [0, 1, 0.4, 9];
const WAVE3: [number, number, number, number] = [-0.7, 0.7, 0.3, 7];
const SPEED = 1.7;

// Body world position and test-controlled "engine time" at which the surface is sampled.
const BODY_X = 7;
const BODY_Z = 0;
const DRIVEN_TIME = 3.8;
const DT = 1 / 60;
const TICKS = 1200;

const GRAVITY_Y = -10;
const DENSITY = 1.0;
const BODY_MASS = 0.5; // half-density box -> floats at 50% submersion

// Generous container AABB. Its flat top (bounds.max.y) is far above the actual wave crests,
// so the old flat fallback and the true wave surface are cleanly separated.
function makeWater(drag: number): FluidVolume {
  return new FluidVolume(
    new BoundingBox(new Vector3D(-12, -8, -12), new Vector3D(12, 6, 12)),
    DENSITY,
    drag,
  );
}

function makeBody(name: string): Object3D {
  const body = new Object3D(name);
  body.geometry = new Cube({ size: 1 }).getGeometryData();
  body.position.set(BODY_X, 0, BODY_Z);
  body.rigidBody = new RigidBody(BODY_MASS);
  return body;
}

function runPhysics(body: Object3D, water: FluidVolume): void {
  const events = new EventDispatcherImpl();
  const physics = new PhysicsSystem(events);
  physics.gravity.set(0, GRAVITY_Y, 0);
  const scene = new Scene();
  physics.addFluidVolume(water);
  scene.add(body);
  body.updateMatrixWorld();
  body.computeBounds();

  for (let i = 0; i < TICKS; i++) {
    physics.step(scene, DT);
  }
}

describe("WaveSurfaceBuoyancy", () => {
  it("der Körper reitet die echte Fläche", () => {
    const material = new OpenWaterMaterial({
      speed: SPEED,
      wave1: WAVE1,
      wave2: WAVE2,
      wave3: WAVE3,
    });
    const probe = OpenWaterSurfaceProbe.fromMaterial(material);

    // Test-controlled driven time read by the surface closure.
    const drivenTime = DRIVEN_TIME;
    const water = makeWater(0.95);
    water.surfaceHeightAt = (x: number, z: number): number =>
      probe.surfaceHeightAt(x, z, drivenTime);

    const body = makeBody("CrestBody");
    runPhysics(body, water);

    const surfaceY = probe.surfaceHeightAt(BODY_X, BODY_Z, DRIVEN_TIME);
    const restingY = body.position.y;
    const flatY = water.bounds.max.y;
    const box = body.bounds as BoundingBox;
    const objectHeight = box.max.y - box.min.y;
    const bottomY = box.min.y;

    // (a) resting height tracks the probe surface at the body's horizontal position.
    expect(Math.abs(restingY - surfaceY)).toBeLessThan(0.1);

    // Forces roughly balance at the resting submersion (buoyancy ~ weight).
    const submergedRatio = Math.min(1.0, Math.max(0, surfaceY - bottomY) / objectHeight);
    const displacedVolume =
      (box.max.x - box.min.x) * (box.max.y - box.min.y) * (box.max.z - box.min.z) * submergedRatio;
    const buoyancyForce = -GRAVITY_Y * DENSITY * displacedVolume;
    const weight = BODY_MASS * -GRAVITY_Y;
    expect(Math.abs(buoyancyForce - weight) / weight).toBeLessThan(0.05);

    // Wave amplitude at the body's position over a full time window.
    let waveAmplitude = 0;
    for (let t = 0; t <= 20; t += 0.1) {
      waveAmplitude = Math.max(waveAmplitude, Math.abs(probe.surfaceHeightAt(BODY_X, BODY_Z, t)));
    }

    // (b) resting height is more than the full wave amplitude away from the flat AABB top:
    // the solver demonstrably used the wavy surface, not `bounds.max.y`.
    expect(Math.abs(restingY - flatY)).toBeGreaterThan(waveAmplitude);
  });

  it("falls back to the flat AABB top when surfaceHeightAt is not set", () => {
    const material = new OpenWaterMaterial({
      speed: SPEED,
      wave1: WAVE1,
      wave2: WAVE2,
      wave3: WAVE3,
    });
    const probe = OpenWaterSurfaceProbe.fromMaterial(material);

    // Identical scenario, but NO surface hook: the old flat behavior must be unchanged.
    const water = makeWater(0.95);
    expect(water.surfaceHeightAt).toBeUndefined();

    const body = makeBody("FlatFallbackBody");
    runPhysics(body, water);

    const surfaceY = probe.surfaceHeightAt(BODY_X, BODY_Z, DRIVEN_TIME);
    const restingY = body.position.y;
    const flatY = water.bounds.max.y;

    // Rests on the flat AABB top, not on the wave surface.
    expect(Math.abs(restingY - flatY)).toBeLessThan(0.1);
    expect(Math.abs(restingY - surfaceY)).toBeGreaterThan(1.0);
  });
});
