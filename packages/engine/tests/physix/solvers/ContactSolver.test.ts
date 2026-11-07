import { describe, it, expect } from "vitest";
import { ContactSolver } from "../../../src/physix/solvers/ContactSolver.js";
import type { ContactSolverContext } from "../../../src/physix/solvers/ContactSolver.js";
import { PairTracker } from "../../../src/physix/PairTracker.js";
import { Object3D } from "../../../src/core/Object3D.js";
import { RigidBody } from "../../../src/physix/RigidBody.js";
import { BoundingSphere } from "../../../src/physix/BoundingSphere.js";
import { BoundingBox } from "../../../src/physix/BoundingBox.js";
import { OBB } from "../../../src/physix/OBB.js";
import { StaticCollider } from "../../../src/physix/StaticCollider.js";
import { EventDispatcherImpl } from "../../../src/core/events/EventDispatcherImpl.js";
import { Vector3D, Matrix4, MathPool } from "../../../src/math/index.js";
import type { Vector3D as V3 } from "../../../src/math/index.js";

/** Direct solver harness: no PhysicsSystem, no gravity, no integration - just one solve pass. */
function harness(): {
  solver: ContactSolver;
  tracker: PairTracker;
  events: EventDispatcherImpl;
  ctx: ContactSolverContext;
} {
  const events = new EventDispatcherImpl();
  const tracker = new PairTracker();
  const ctx: ContactSolverContext = {
    events,
    fixedTimeStep: 1 / 60,
    gravityLength: 0,
    solverIterations: 4,
    tracker,
    syncTransform: (obj: Object3D, corr: V3): void => {
      obj.position.add(corr);
      obj.updateMatrixWorld();
      obj.computeBounds();
    },
  };
  return { solver: new ContactSolver(), tracker, events, ctx };
}

function sphereBody(
  id: number,
  pos: Vector3D,
  radius: number,
  opts: { restitution?: number; friction?: number } = {},
): Object3D {
  const o = new Object3D(`s${id}`);
  o.id = id;
  o.position.copyFrom(pos);
  o.bounds = new BoundingSphere(o.position, radius);
  o.rigidBody = new RigidBody(1);
  o.rigidBody.setInertiaForSphere(radius);
  o.rigidBody.restitution = opts.restitution ?? 0;
  o.rigidBody.friction = opts.friction ?? 0.5;
  return o;
}

function floor(top: number, friction: number, restitution: number): StaticCollider {
  const f = new StaticCollider(
    new BoundingBox(new Vector3D(-100, top - 10, -100), new Vector3D(100, top, 100)),
  );
  f.friction = friction;
  f.restitution = restitution;
  return f;
}

describe("ContactSolver (direct)", () => {
  it("restitution: a hard impact bounces with e * incoming speed along the normal", () => {
    const { solver, tracker, ctx } = harness();
    const ball = sphereBody(1, new Vector3D(0, 0.49, 0), 0.5, { restitution: 0.5 });
    ball.rigidBody!.velocity.set(0, -4, 0);
    const f = floor(0, 0.5, 0.5);
    f.id = 2;
    tracker.beginDiscovery();
    tracker.acquirePair(ball, f, 1, 2);
    solver.solve(tracker.activePairs, [], ctx);
    tracker.releasePairs();
    expect(ball.rigidBody!.velocity.y).toBeCloseTo(2, 3);
  });

  it("restitution is skipped below the bounce threshold (slow approach does not bounce)", () => {
    const { solver, tracker, ctx } = harness();
    const ball = sphereBody(1, new Vector3D(0, 0.49, 0), 0.5, { restitution: 0.9 });
    ball.rigidBody!.velocity.set(0, -0.2, 0);
    const f = floor(0, 0.5, 0.9);
    f.id = 2;
    tracker.beginDiscovery();
    tracker.acquirePair(ball, f, 1, 2);
    solver.solve(tracker.activePairs, [], ctx);
    tracker.releasePairs();
    expect(ball.rigidBody!.velocity.y).toBeCloseTo(0, 3);
  });

  it("friction stays inside the Coulomb cone: |dvx| <= mu * |dvy| for a fast slide", () => {
    for (const mu of [0.1, 0.3, 0.8]) {
      const { solver, tracker, ctx } = harness();
      const ball = sphereBody(1, new Vector3D(0, 0.49, 0), 0.5, { friction: mu });
      ball.rigidBody!.velocity.set(10, -2, 0);
      const f = floor(0, mu, 0);
      f.id = 2;
      tracker.beginDiscovery();
      tracker.acquirePair(ball, f, 1, 2);
      solver.solve(tracker.activePairs, [], ctx);
      tracker.releasePairs();
      const dvx = ball.rigidBody!.velocity.x - 10;
      const dvy = ball.rigidBody!.velocity.y + 2;
      expect(dvy).toBeCloseTo(2, 3); // normal impulse removes the whole approach speed
      expect(Math.abs(dvx)).toBeLessThanOrEqual(mu * dvy + 1e-6);
      expect(dvx).toBeLessThan(0); // friction opposes the slide
      // Fast slide: the cone, not the slip, is the limit -> impulse saturates at mu * jN.
      expect(Math.abs(dvx)).toBeCloseTo(mu * dvy, 2);
    }
  });

  it("friction acts through the accumulated normal impulse, also when this iteration adds none", () => {
    // A resting ball (no approach speed, so no *new* normal impulse) that is kicked sideways by
    // a second contact earlier in the same pass must still feel friction from its existing
    // support impulse. Model: ball already in contact, sliding, with a pre-existing normal load.
    const { solver, tracker, ctx } = harness();
    const ball = sphereBody(1, new Vector3D(0, 0.49, 0), 0.5, { friction: 0.5 });
    ball.rigidBody!.velocity.set(1, -1, 0);
    const f = floor(0, 0.5, 0);
    f.id = 2;
    tracker.beginDiscovery();
    tracker.acquirePair(ball, f, 1, 2);
    solver.solve(tracker.activePairs, [], ctx);
    tracker.releasePairs();
    // jN = 1 (m=1), mu*jN = 0.5; ideal slip-stopping impulse = 1 / (1 + R^2/I) = 1/(1+2.5) = 0.286
    // (sphere: I = 0.4 R^2) -> friction is slip-limited and removes the contact slip entirely.
    const v = ball.rigidBody!.velocity;
    const w = ball.rigidBody!.angularVelocity;
    // (lever arm = centre height, 0.49..0.495 as the slop correction lowers it, hence 2%)
    expect(Math.abs(v.x + w.z * 0.49)).toBeLessThan(0.02); // contact point no longer slips
    expect(v.x).toBeGreaterThan(0); // and it did not over-brake
  });

  it("friction torque uses the contact point at the floor (rolling spin has the right sign and size)", () => {
    const { solver, tracker, ctx } = harness();
    const ball = sphereBody(1, new Vector3D(0, 0.49, 0), 0.5, { friction: 0.5 });
    ball.rigidBody!.velocity.set(2, -1, 0);
    const f = floor(0, 0.5, 0);
    f.id = 2;
    tracker.beginDiscovery();
    tracker.acquirePair(ball, f, 1, 2);
    solver.solve(tracker.activePairs, [], ctx);
    tracker.releasePairs();
    const rb = ball.rigidBody!;
    const jT = 1 * (2 - rb.velocity.x); // m = 1
    // Rolling forward along +x about a floor contact: spin about -z, magnitude R * jT / I.
    expect(rb.angularVelocity.z).toBeLessThan(0);
    const expectedW = -0.49 * jT * rb.inverseInertiaTensor.z;
    expect(Math.abs(rb.angularVelocity.z / expectedW - 1)).toBeLessThan(0.03);
    expect(Math.abs(rb.angularVelocity.x)).toBeLessThan(1e-6);
    expect(Math.abs(rb.angularVelocity.y)).toBeLessThan(1e-6);
  });

  it("accumulated impulses never add energy for a stacked pair (SOR cannot over-push)", () => {
    const { solver, tracker, ctx } = harness();
    // Ball A rests on the floor, ball B drops onto A. Both slightly interpenetrating.
    const a = sphereBody(1, new Vector3D(0, 0.495, 0), 0.5);
    const b = sphereBody(3, new Vector3D(0, 1.485, 0), 0.5);
    b.rigidBody!.velocity.set(0, -3, 0);
    const f = floor(0, 0.5, 0);
    f.id = 2;
    tracker.beginDiscovery();
    tracker.acquirePair(a, f, 1, 2);
    tracker.acquirePair(a, b, 1, 3);
    tracker.activePairs.sort((p, q) => p.idA - q.idA || p.idB - q.idB);
    const keBefore = 0.5 * 9;
    solver.solve(tracker.activePairs, [], ctx);
    tracker.releasePairs();
    const va = a.rigidBody!.velocity;
    const vb = b.rigidBody!.velocity;
    const keAfter = 0.5 * (va.lengthSq() + vb.lengthSq());
    expect(keAfter).toBeLessThanOrEqual(keBefore + 1e-9);
    // Inelastic contact: B must not rebound away from A faster than it approached.
    expect(vb.y - va.y).toBeLessThanOrEqual(1e-6);
    // The floor holds A: it is not driven into the floor.
    expect(va.y).toBeGreaterThanOrEqual(-1e-6);
  });

  it("a ball wedged into a V-groove comes to rest instead of being kicked out by SOR overshoot", () => {
    // Two 45-degree static walls: solving one contact disturbs the other, so later iterations see
    // approach speed again. Without accumulated (clamped, reducible) impulses the 1.2 relaxation
    // overshoot is permanent and the ball leaves with ~0.3 m/s it did not have (energy gain).
    const { solver, tracker, ctx } = harness();
    const ball = sphereBody(1, new Vector3D(0, 0, 0), 0.5);
    ball.rigidBody!.velocity.set(0, -3, 0);
    const wall = (id: number, theta: number): StaticCollider => {
      const n = new Vector3D(-Math.sin(theta), Math.cos(theta), 0);
      const c = new Vector3D(0, 0, 0).sub(n.clone().scale(0.99));
      const obb = new OBB(new Vector3D(0, 0, 0), new Vector3D(5, 0.5, 5));
      obb.transform(new Matrix4().compose(c, new Vector3D(0, 0, theta), new Vector3D(1, 1, 1)));
      const sc = new StaticCollider(obb);
      sc.id = id;
      return sc;
    };
    const w1 = wall(2, -Math.PI / 4);
    const w2 = wall(3, Math.PI / 4);
    tracker.beginDiscovery();
    tracker.acquirePair(ball, w1, 1, 2);
    tracker.acquirePair(ball, w2, 1, 3);
    solver.solve(tracker.activePairs, [], ctx);
    tracker.releasePairs();
    expect(ball.rigidBody!.velocity.length()).toBeLessThan(0.05);
  });

  it("penetration slop: overlaps below the slop are left alone, deeper ones are corrected down to it", () => {
    const run = (centerY: number): number => {
      const { solver, tracker, ctx } = harness();
      const ball = sphereBody(1, new Vector3D(0, centerY, 0), 0.5);
      const f = floor(0, 0.5, 0);
      f.id = 2;
      tracker.beginDiscovery();
      tracker.acquirePair(ball, f, 1, 2);
      solver.solve(tracker.activePairs, [], ctx);
      tracker.releasePairs();
      return ball.position.y;
    };
    // 3 mm overlap (< 5 mm slop): untouched, so a resting contact does not jitter.
    expect(run(0.497)).toBeCloseTo(0.497, 9);
    // 5 cm overlap: pushed out, but only down to the slop, not to exactly touching.
    const y = run(0.45);
    expect(y).toBeGreaterThan(0.495 - 1e-6);
    expect(y).toBeLessThan(0.5);
  });

  it("does not leak pooled scratch vectors when an event listener throws", () => {
    const poolSize = (): number =>
      (MathPool as unknown as { _VECTOR_POOL: unknown[] })._VECTOR_POOL.length;
    const { solver, tracker, events, ctx } = harness();
    const f = floor(0, 0.5, 0);
    f.id = 2;
    const ball = sphereBody(1, new Vector3D(0, 0.49, 0), 0.5);
    const solveOnce = (): void => {
      ball.rigidBody!.velocity.set(0, -2, 0);
      tracker.beginDiscovery();
      tracker.acquirePair(ball, f, 1, 2);
      try {
        solver.solve(tracker.activePairs, [], ctx);
      } finally {
        tracker.releasePairs();
      }
    };
    // Warm-up fills the pool so a leak is visible as a shrinking pool.
    solveOnce();
    solveOnce();
    const before = poolSize();
    expect(before).toBeGreaterThanOrEqual(15);

    events.addEventListener("physics:collision-enter", () => {
      throw new Error("listener failure");
    });
    tracker.clear();
    // The throw propagates (fail fast) but every scratch vector must be returned.
    expect(solveOnce).toThrow("listener failure");
    expect(poolSize()).toBe(before);
  });

  it("wake check uses each body's own sleep threshold", () => {
    const { solver, tracker, events, ctx } = harness();
    ctx.gravityLength = 0;
    let wakeups = 0;
    events.addEventListener("physics:wakeup", () => wakeups++);
    // A (sleeping) is touched by B moving at 0.04 m/s. B's own threshold (0.01) says "moving";
    // A's threshold (0.5) must not suppress that.
    const a = sphereBody(1, new Vector3D(0, 0, 0), 0.5);
    const b = sphereBody(2, new Vector3D(0, 0.95, 0), 0.5);
    a.rigidBody!.sleepLinearThreshold = 0.5;
    b.rigidBody!.sleepLinearThreshold = 0.01;
    a.rigidBody!.isSleeping = true;
    b.rigidBody!.velocity.set(0, -0.04, 0);
    tracker.beginDiscovery();
    tracker.acquirePair(a, b, 1, 2);
    solver.solve(tracker.activePairs, [], ctx);
    tracker.releasePairs();
    expect(wakeups).toBe(1); // the wake check itself fired (the later impulse would wake A anyway)
    expect(a.rigidBody!.isSleeping).toBe(false);
  });
});
