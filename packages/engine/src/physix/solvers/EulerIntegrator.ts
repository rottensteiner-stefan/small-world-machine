import type { Object3D } from "../../core/Object3D.js";
import type { Vector3D } from "../../math/index.js";
import { MathUtils, MathPool } from "../../math/index.js";

/**
 * Shortest-path angular delta from `from` to `to` (radians, wrapped into (-PI, PI]).
 */
function shortestAngleDelta(from: number, to: number): number {
  let delta = (to - from) % MathUtils.TWO_PI;
  if (delta > MathUtils.PI) delta -= MathUtils.TWO_PI;
  else if (delta < -MathUtils.PI) delta += MathUtils.TWO_PI;
  return delta;
}

/**
 * Numerical integration solver implementing Semi-Implicit Euler equations for linear and angular dynamics.
 */
export class EulerIntegrator {
  /**
   * Integrates linear forces, acceleration, and velocity, returning the computed positional displacement.
   * @param obj Target Object3D.
   * @param gravity Global gravity vector.
   * @param fluidLinearDrag Damping multiplier from fluid submersion (1.0 = no fluid).
   * @param dt Substep delta time in seconds.
   * @param outDeltaP Output vector receiving the computed position displacement (v * dt).
   */
  public static integrateVelocity(
    obj: Object3D,
    gravity: Vector3D,
    fluidLinearDrag: number,
    dt: number,
    outDeltaP: Vector3D,
  ): void {
    const rb = obj.rigidBody!;

    // acceleration = (forces / mass) + gravity
    rb.acceleration.x = rb.forces.x * rb.inverseMass + gravity.x;
    rb.acceleration.y = rb.forces.y * rb.inverseMass + gravity.y;
    rb.acceleration.z = rb.forces.z * rb.inverseMass + gravity.z;

    // v = v + a * dt
    rb.velocity.x += rb.acceleration.x * dt;
    rb.velocity.y += rb.acceleration.y * dt;
    rb.velocity.z += rb.acceleration.z * dt;

    // Apply linear and fluid damping
    const damping = rb.linearDamping * fluidLinearDrag;
    rb.velocity.x *= damping;
    rb.velocity.y *= damping;
    rb.velocity.z *= damping;

    // deltaP = v * dt
    outDeltaP.x = rb.velocity.x * dt;
    outDeltaP.y = rb.velocity.y * dt;
    outDeltaP.z = rb.velocity.z * dt;
  }

  /**
   * Applies positional displacement to the target Object3D.
   * @param obj Target Object3D.
   * @param deltaP Displacement vector.
   */
  public static applyDisplacement(obj: Object3D, deltaP: Vector3D): void {
    obj.position.x += deltaP.x;
    obj.position.y += deltaP.y;
    obj.position.z += deltaP.z;
  }

  /**
   * Integrates torque, angular acceleration, angular velocity, and updates object rotation.
   * @param obj Target Object3D.
   * @param fluidAngularDrag Damping multiplier from fluid submersion (1.0 = no fluid).
   * @param dt Substep delta time in seconds.
   */
  public static integrateAngular(obj: Object3D, fluidAngularDrag: number, dt: number): void {
    const rb = obj.rigidBody!;

    // angularAcceleration = torque / inertia (using 3D principal moments of inertia)
    rb.angularAcceleration.x = rb.torque.x * rb.inverseInertiaTensor.x;
    rb.angularAcceleration.y = rb.torque.y * rb.inverseInertiaTensor.y;
    rb.angularAcceleration.z = rb.torque.z * rb.inverseInertiaTensor.z;

    // w = w + alpha * dt
    rb.angularVelocity.x += rb.angularAcceleration.x * dt;
    rb.angularVelocity.y += rb.angularAcceleration.y * dt;
    rb.angularVelocity.z += rb.angularAcceleration.z * dt;

    // Apply angular damping
    const damping = rb.angularDamping * fluidAngularDrag;
    rb.angularVelocity.x *= damping;
    rb.angularVelocity.y *= damping;
    rb.angularVelocity.z *= damping;

    const wx = rb.angularVelocity.x;
    const wy = rb.angularVelocity.y;
    const wz = rb.angularVelocity.z;
    const wLengthSq = wx * wx + wy * wy + wz * wz;

    if (wLengthSq > 1e-12) {
      const wLength = Math.sqrt(wLengthSq);
      const halfAngle = wLength * dt * 0.5;
      const s = Math.sin(halfAngle) / wLength;

      const deltaQ = MathPool.acquireQuaternion();
      const currentQ = MathPool.acquireQuaternion();
      deltaQ.set(wx * s, wy * s, wz * s, Math.cos(halfAngle));
      currentQ.setFromEuler(obj.rotation).premultiply(deltaQ).normalize();

      if (obj.quaternion) {
        obj.quaternion.copyFrom(currentQ);
      }
      currentQ.toEuler(obj.rotation);

      MathPool.releaseQuaternion(deltaQ);
      MathPool.releaseQuaternion(currentQ);
    }
  }

  /**
   * Computes the render-interpolated (blend) pose between previous and current physics state,
   * WITHOUT mutating `obj` (window: after `interpolateTransform`/`applyRenderInterpolation` runs,
   * `position`/`rotation` hold the DISCRETE simulated pose while only `worldMatrix` is blended --
   * this read-out is the honest way to obtain the blend pose for camera-follow consumers, S3
   * DP-2A). Pure scratch math into caller-provided vectors: zero allocation.
   * @param obj The tracked rigid body.
   * @param alpha Interpolation alpha in [0,1); must equal the accumulator's `interpolationAlpha`.
   * @param truePos Out: copy of `obj.position` (discrete true pose).
   * @param trueRot Out: copy of `obj.rotation` (discrete true pose).
   * @param blendPos Out: lerp(prevPosition, truePos, alpha) - the render pose.
   * @param blendRot Out: shortest-path angular lerp of prevRotation toward trueRot.
   */
  public static computeInterpolatedPose(
    obj: Object3D,
    alpha: number,
    truePos: Vector3D,
    trueRot: Vector3D,
    blendPos: Vector3D,
    blendRot: Vector3D,
  ): void {
    const rb = obj.rigidBody!;

    truePos.copyFrom(obj.position);
    trueRot.copyFrom(obj.rotation);

    blendPos.copyFrom(rb.prevPosition).lerp(truePos, alpha);
    blendRot.set(
      rb.prevRotation.x + shortestAngleDelta(rb.prevRotation.x, trueRot.x) * alpha,
      rb.prevRotation.y + shortestAngleDelta(rb.prevRotation.y, trueRot.y) * alpha,
      rb.prevRotation.z + shortestAngleDelta(rb.prevRotation.z, trueRot.z) * alpha,
    );
  }

  /**
   * Applies render-interpolation between previous and current physics state.
   *
   * WINDOW (S3 DP-2A): after this returns, `obj.position`/`obj.rotation` (and `obj.quaternion`)
   * are RESTORED to the discrete simulated pose, while `obj.worldMatrix` carries the blended
   * render pose. This is deliberate -- the simulated state must stay exact for the next physics
   * step. Any consumer that reads a body's pose for RENDERING purposes (camera-follow, spline
   * tools, gizmos) must read the blend pose via
   * `PhysicsSystem.getInterpolatedPosition()`/`EulerIntegrator.computeInterpolatedPose()` inside
   * the interpolate-then-render window of the frame instead of `obj.position`, or it will see the
   * discrete pose while the body is drawn at the blend pose (1-frame-style jitter on high-Hz
   * displays, baggage of M2).
   */
  public static interpolateTransform(
    obj: Object3D,
    alpha: number,
    truePos: Vector3D,
    trueRot: Vector3D,
    blendPos: Vector3D,
    blendRot: Vector3D,
  ): void {
    EulerIntegrator.computeInterpolatedPose(obj, alpha, truePos, trueRot, blendPos, blendRot);

    obj.position.copyFrom(blendPos);
    obj.rotation.copyFrom(blendRot);

    let trueQuat = null;
    if (obj.quaternion) {
      trueQuat = MathPool.acquireQuaternion().copyFrom(obj.quaternion);
      obj.quaternion.setFromEuler(blendRot);
    }

    obj.updateMatrixWorld();

    obj.position.copyFrom(truePos);
    obj.rotation.copyFrom(trueRot);

    if (obj.quaternion && trueQuat) {
      obj.quaternion.copyFrom(trueQuat);
      MathPool.releaseQuaternion(trueQuat);
    }
  }
}
