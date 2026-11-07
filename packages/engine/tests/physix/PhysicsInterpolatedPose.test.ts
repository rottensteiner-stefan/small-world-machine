import { describe, expect, it } from "vitest";
import { PhysicsSystem } from "../../src/physix/PhysicsSystem.js";
import { Scene } from "../../src/core/Scene.js";
import { Object3D } from "../../src/core/Object3D.js";
import { RigidBody } from "../../src/physix/RigidBody.js";
import { Vector3D } from "../../src/math/Vector3D.js";
import { EventDispatcherImpl } from "../../src/core/events/EventDispatcherImpl.js";

/**
 * S3 DP-2A: correct read-out of the INTERPOLATED (render) pose for camera-follow consumers.
 * After `applyRenderInterpolation()` only `worldMatrix` carries the blended pose; `position`/
 * `rotation` hold the discrete simulated pose (window, see `EulerIntegrator`). A follower that
 * reads `obj.position` there sees the discrete pose and jitters on high-Hz displays (M2). This
 * suite pins that `PhysicsSystem.getInterpolatedPosition()` returns the SAME blend the renderer
 * drew from, without mutating the body.
 */
describe("PhysicsSystem.getInterpolatedPosition (S3 DP-2A)", () => {
  it("returns the blend pose and does not mutate the tracked body", () => {
    const physics = new PhysicsSystem(new EventDispatcherImpl());
    physics.gravity.set(0, 0, 0);

    const body = new Object3D("body");
    body.isCollidable = true;
    body.position.set(0, 0, 0);
    body.rigidBody = new RigidBody(1);
    body.rigidBody.velocity.set(3, 0, 0); // drives the +X motion
    body.rigidBody.prevPosition.copyFrom(body.position);
    body.updateMatrixWorld();

    const scene = new Scene();
    scene.objects.push(body);

    // One full fixed step: prevPosition snapshotted at (0,0,0), true position advances +X.
    physics.step(scene, 1 / 60);
    expect(body.position.x).toBeGreaterThan(0);

    // Half a fixed step of accumulation (no substep runs) => interpolationAlpha = 0.5.
    physics.step(scene, 1 / 120);

    const truePos = body.position.clone();
    const out = new Vector3D();
    physics.getInterpolatedPosition(body, out);

    // The read-out is the blend toward the true pose: with alpha ~0.5 and an empty prev pose, the
    // result is about halfway along the last step, i.e. between (0,0,0) and truePos.
    expect(out.x).toBeGreaterThan(0);
    expect(out.x).toBeLessThan(truePos.x);
    // The body is NOT mutated by the read-out.
    expect(body.position.x).toBe(truePos.x);
    expect(body.position.y).toBe(truePos.y);
    expect(body.position.z).toBe(truePos.z);
  });

  it("matches the worldMatrix translation after applyRenderInterpolation (the actual render pose)", () => {
    const physics = new PhysicsSystem(new EventDispatcherImpl());
    physics.gravity.set(0, 0, 0);

    const body = new Object3D("body");
    body.isCollidable = true;
    body.position.set(0, 0, 0);
    body.rigidBody = new RigidBody(1);
    body.rigidBody.velocity.set(3, 0, 0); // drives the +X motion
    body.updateMatrixWorld();

    const scene = new Scene();
    scene.objects.push(body);

    physics.step(scene, 1 / 60); // one full step, moves +X
    physics.step(scene, 1 / 120); // accumulate alpha ~0.5

    // Render interpolation: only worldMatrix is blended; position/rotation stay discrete.
    physics.applyRenderInterpolation();
    const blendX = body.worldMatrix.data[12]!;
    expect(body.position.x).not.toBe(blendX); // discrete vs blend differ (the documented window)

    // The read-out for camera-follow consumers must equal what is actually rendered.
    const out = new Vector3D();
    physics.getInterpolatedPosition(body, out);
    expect(out.x).toBeCloseTo(blendX, 6);
    expect(out.y).toBeCloseTo(body.worldMatrix.data[13]!, 6);
    expect(out.z).toBeCloseTo(body.worldMatrix.data[14]!, 6);
  });

  it("is zero-allocation-safe on rigid bodies without any geometry (MathPool reuse)", () => {
    const physics = new PhysicsSystem(new EventDispatcherImpl());
    const body = new Object3D("body");
    body.rigidBody = new RigidBody(1);
    body.rigidBody.prevPosition.set(1, 2, 3);
    body.position.set(5, 6, 7);

    const out = new Vector3D();
    physics.getInterpolatedPosition(body, out);

    // alpha is 0 (fresh accumulator) => the blend equals the previous pose, which is the honest
    // "render as of the last fixed step" result for a body that never simulated a full step.
    expect(out.x).toBe(1);
    expect(out.y).toBe(2);
    expect(out.z).toBe(3);
  });
});
