import type { Object3D } from "../core/Object3D.js";
import type { Scene } from "../core/Scene.js";
import { Vector3D, MathPool } from "../math/index.js";
import type { EventDispatcherImpl } from "../core/events/EventDispatcherImpl.js";
import type { Collidable } from "../interfaces/index.js";
import { BoundingType } from "../enums/index.js";
import type { FluidVolume } from "./FluidVolume.js";
import { BuoyancySolver } from "./fluids/BuoyancySolver.js";
import { PhysicsBroadphase } from "./broadphase/PhysicsBroadphase.js";
import { SweptVolumeCCD } from "./ccd/SweptSphereCCD.js";
import { EulerIntegrator } from "./solvers/EulerIntegrator.js";
import { ContactSolver } from "./solvers/ContactSolver.js";
import { PairTracker } from "./PairTracker.js";
import { SpatialQueries } from "./solvers/SpatialQueries.js";
import type { Ray } from "./Ray.js";
import type { RaycastHit } from "./RaycastHit.js";
import type { Joint } from "./joints/Joint.js";

/**
 * A lightweight physics solver using Semi-Implicit Euler integration and spatial broadphase acceleration.
 */
export class PhysicsSystem {
  /** Global gravity vector (default: -9.81 on Y) */
  public gravity: Vector3D = new Vector3D(0, -9.81, 0);
  /** The fixed time step for physics calculations (e.g. 1/60). */
  public fixedTimeStep: number = 1 / 60;
  /** Maximum number of sub-steps per frame to prevent spiral of death. */
  public maxSubSteps: number = 10;
  /** Maximum delta time allowed per frame. */
  public maxDeltaTime: number = 0.25;
  /**
   * Continuous Collision Detection (CCD) threshold, as a multiple of a body's broad radius.
   * Set to `Infinity` to disable CCD entirely.
   */
  public ccdMotionThreshold: number = 1.0;

  /**
   * Telemetry: total number of fixed steps discarded because a frame needed more than
   * `maxSubSteps` of simulation (the remaining time is dropped to avoid a spiral of death).
   * Time clamped by `maxDeltaTime` is not counted. Monotonic; reset by assigning 0.
   */
  public droppedSteps: number = 0;

  /** Active Physics Joints / Constraints tracked directly by the system. */
  public joints: Joint[] = [];

  private _accumulator: number = 0;
  private _bodies: Object3D[] = [];
  private _allColliders: Collidable[] = [];
  private _fluidVolumes: FluidVolume[] = [];
  private _allJoints: Joint[] = [];

  private _broadphase = new PhysicsBroadphase();
  private _ccd = new SweptVolumeCCD();
  private _broadphaseQueryHits: Collidable[] = [];
  private _warnedObjects = new Set<Object3D>();

  private _collidableIdMap = new WeakMap<Collidable, number>();
  /** Internal collider ids live in `[2^25, 2^26)`: dense, and inside the exact range of `pairKey`. */
  private _nextInternalId: number = 33554432;

  private readonly _contactSolver = new ContactSolver();
  private readonly _tracker = new PairTracker();
  private readonly _spatialQueries = new SpatialQueries(this._broadphase);

  /**
   * Returns a stable integer ID for any Collidable object.
   * Uses `collider.id` if defined, or assigns a stable internal ID.
   */
  public getColliderId(collider: Collidable): number {
    if (collider.id !== undefined) return collider.id;
    let id = this._collidableIdMap.get(collider);
    if (id === undefined) {
      id = this._nextInternalId++;
      this._collidableIdMap.set(collider, id);
    }
    return id;
  }

  private _releasePairs(): void {
    this._tracker.releasePairs();
  }

  /**
   * Creates a new PhysicsSystem.
   * @param events The event bus to dispatch collision events.
   */
  constructor(private events: EventDispatcherImpl) {}

  public addFluidVolume(fv: FluidVolume): void {
    if (!this._fluidVolumes.includes(fv)) {
      this._fluidVolumes.push(fv);
    }
  }

  public removeFluidVolume(fv: FluidVolume): void {
    const idx = this._fluidVolumes.indexOf(fv);
    if (idx !== -1) {
      this._fluidVolumes.splice(idx, 1);
    }
  }

  /**
   * Recursively collects both dynamic rigidbodies and collidable objects in a single pass.
   */
  private _collectRecursive(obj: Object3D, bodies: Object3D[], colliders: Collidable[]): void {
    if (obj.isCollidable) {
      if (
        obj.rigidBody &&
        obj.rigidBody.inverseMass > 0 &&
        obj.parent !== undefined &&
        obj.parent.parent !== undefined &&
        !this._warnedObjects.has(obj)
      ) {
        // The integrator and solver treat `position`/`rotation` as world state (RigidBodyMath
        // assumption): a dynamic body nested under another object is simulated in the parent's
        // local frame, which is wrong as soon as the parent is transformed.
        console.warn(
          `[PhysicsSystem] Warning: dynamic body '${obj.name}' is nested below another object. Physics treats its position/rotation as world space; keep dynamic bodies at scene root.`,
        );
        this._warnedObjects.add(obj);
      }
      if (obj.bounds) {
        colliders.push(obj);
      }
      if (obj.rigidBody && obj.rigidBody.inverseMass > 0) {
        bodies.push(obj);
      } else if (obj.bounds && !obj.rigidBody && !this._warnedObjects.has(obj)) {
        console.warn(
          `[PhysicsSystem] Warning: Object '${obj.name}' is collidable but lacks a RigidBody. Treating as static (mass=0). Add 'obj.rigidBody = new RigidBody(0);' to suppress this warning.`,
        );
        this._warnedObjects.add(obj);
      }
    }
    for (let i = 0; i < obj.children.length; i++) {
      this._collectRecursive(obj.children[i]!, bodies, colliders);
    }
  }

  /**
   * Steps the physics simulation forward.
  /**
   * Adds a joint to the physics simulation.
   */
  public addJoint(joint: Joint): void {
    if (!this.joints.includes(joint)) {
      this.joints.push(joint);
    }
  }

  /**
   * Removes a joint from the physics simulation.
   */
  public removeJoint(joint: Joint): boolean {
    const idx = this.joints.indexOf(joint);
    if (idx !== -1) {
      this.joints.splice(idx, 1);
      return true;
    }
    return false;
  }

  /**
   * Clears all joints tracked by the system.
   */
  public clearJoints(): void {
    this.joints.length = 0;
  }

  /**
   * Advances the physics simulation for a given Scene by delta time `dt`.
   * Automatically executes fixed-timestep sub-steps to preserve determinism and numerical stability.
   * @param scene The scene containing objects with RigidBodies.
   * @param dt Delta time in seconds.
   */
  public step(scene: Scene, dt: number): void {
    if (dt <= 0) return;

    if (dt > this.maxDeltaTime) dt = this.maxDeltaTime;

    this._accumulator += dt;

    const bodies = this._bodies;
    const allColliders = this._allColliders;
    const allJoints = this._allJoints;
    bodies.length = 0;
    allColliders.length = 0;
    allJoints.length = 0;

    for (let i = 0; i < scene.objects.length; i++) {
      this._collectRecursive(scene.objects[i]!, bodies, allColliders);
    }

    for (let i = 0; i < scene.staticColliders.length; i++) {
      const c = scene.staticColliders[i]!;
      if (c.bounds) {
        allColliders.push(c);
      }
    }

    for (let i = 0; i < this.joints.length; i++) {
      allJoints.push(this.joints[i]!);
    }
    if (scene.joints) {
      for (let i = 0; i < scene.joints.length; i++) {
        allJoints.push(scene.joints[i]!);
      }
    }

    // Sort dynamic bodies deterministically by ID to ensure order-independent integration & CCD
    bodies.sort((a, b) => this.getColliderId(a) - this.getColliderId(b));

    let subSteps = 0;
    while (this._accumulator >= this.fixedTimeStep && subSteps < this.maxSubSteps) {
      this._internalStep(bodies, allColliders, allJoints, this.fixedTimeStep);
      this._accumulator -= this.fixedTimeStep;
      subSteps++;
    }

    if (this._accumulator >= this.fixedTimeStep) {
      // Spiral-of-death guard: simulation time beyond `maxSubSteps` is dropped, not deferred.
      // Make it observable so a frame-budget problem is not silent.
      this.droppedSteps += Math.floor(this._accumulator / this.fixedTimeStep);
      this._accumulator %= this.fixedTimeStep;
    }

    for (const obj of bodies) {
      obj.rigidBody!.clearForces();
    }
  }

  /**
   * How far the accumulator has progressed into the next fixed timestep [0, 1).
   */
  public get interpolationAlpha(): number {
    return this._accumulator / this.fixedTimeStep;
  }

  /**
   * Renders every tracked rigid body's transform interpolated between previous and current physics states.
   */
  public applyRenderInterpolation(): void {
    const alpha = this.interpolationAlpha;
    const bodies = this._bodies;

    const truePos = MathPool.acquireVector();
    const trueRot = MathPool.acquireVector();
    const blendPos = MathPool.acquireVector();
    const blendRot = MathPool.acquireVector();

    for (let i = 0; i < bodies.length; i++) {
      EulerIntegrator.interpolateTransform(bodies[i]!, alpha, truePos, trueRot, blendPos, blendRot);
    }

    MathPool.releaseVector(truePos);
    MathPool.releaseVector(trueRot);
    MathPool.releaseVector(blendPos);
    MathPool.releaseVector(blendRot);
  }

  private _internalStep(
    bodies: Object3D[],
    allColliders: Collidable[],
    allJoints: Joint[],
    dt: number,
  ): void {
    // 1. Accumulate continuous joint forces (e.g. Hookean springs)
    for (let i = 0; i < allJoints.length; i++) {
      const joint = allJoints[i]!;
      if (joint.enabled && !joint.isBroken) {
        joint.applyForces?.(dt);
      }
    }

    const deltaP = MathPool.acquireVector();

    for (let i = 0; i < bodies.length; i++) {
      const obj = bodies[i]!;
      const rb = obj.rigidBody!;

      if (rb.isSleeping) {
        continue;
      }

      rb.prevPosition.copyFrom(obj.position);
      rb.prevRotation.copyFrom(obj.rotation);

      const fluidForces = BuoyancySolver.applyFluidForces(obj, this._fluidVolumes, this.gravity);

      EulerIntegrator.integrateVelocity(obj, this.gravity, fluidForces.linearDrag, dt, deltaP);

      this._ccd.checkCandidate(obj, deltaP, this.ccdMotionThreshold);

      EulerIntegrator.applyDisplacement(obj, deltaP);

      EulerIntegrator.integrateAngular(obj, fluidForces.angularDrag, dt);

      obj.updateMatrixWorld();
      obj.computeBounds();
      rb.clearForces();
    }

    MathPool.releaseVector(deltaP);

    this._resolveCollisions(bodies, allColliders, allJoints, dt);

    // Sleep evaluation at the end of substep (after integration and collision resolution)
    for (let i = 0; i < bodies.length; i++) {
      const obj = bodies[i]!;
      const rb = obj.rigidBody!;

      if (rb.allowSleep && !rb.isSleeping) {
        const linSq = rb.velocity.lengthSq();
        const angSq = rb.angularVelocity.lengthSq();
        const linThreshSq = rb.sleepLinearThreshold * rb.sleepLinearThreshold;
        const angThreshSq = rb.sleepAngularThreshold * rb.sleepAngularThreshold;

        if (linSq < linThreshSq && angSq < angThreshSq) {
          rb._sleepTimer += dt;
          if (rb._sleepTimer >= rb.sleepTimeThreshold) {
            rb.putToSleep();
            this.events.dispatchEvent("physics:sleep", { object: obj });
          }
        } else {
          rb._sleepTimer = 0;
        }
      }
    }
  }

  /** Number of iterative solver iterations per substep for stacking stability & constraint relaxation (default: 4). */
  public solverIterations: number = 4;

  private _syncObjectTransformAndBounds(obj: Object3D, posCorr: Vector3D): void {
    obj.position.add(posCorr);
    obj.updateMatrixWorld();
    if (obj.geometry) {
      obj.computeBounds();
    } else if (obj.bounds) {
      const b = obj.bounds;
      if (b.type === BoundingType.BOX) {
        const box = b;
        box.min.add(posCorr);
        box.max.add(posCorr);
        box.center.add(posCorr);
      } else if (b.type === BoundingType.SPHERE) {
        const sphere = b;
        if (sphere.center !== obj.position) {
          sphere.center.add(posCorr);
        }
      } else if (b.type === BoundingType.OBB) {
        const obb = b;
        obb.center.add(posCorr);
      } else if (b.type === BoundingType.HULL) {
        const hull = b;
        hull.transform(obj.worldMatrix);
      }
    }
  }

  private _resolveCollisions(
    bodies: Object3D[],
    allColliders: Collidable[],
    allJoints: Joint[] = this._allJoints,
    dt: number = this.fixedTimeStep,
  ): void {
    this._broadphase.update(allColliders);

    if (this._ccd.hasCandidates) {
      const clamped = this._ccd.resolve(this._broadphase);
      // A clamped body now sits *behind* the swept volume it was placed into by `update()`:
      // re-insert it so subsequent narrow-phase queries around its real position cannot miss it.
      for (let i = 0; i < clamped.length; i++) {
        this._broadphase.reinsertCollider(clamped[i]!);
      }
    }

    this._releasePairs();
    this._tracker.beginDiscovery();

    for (let i = 0; i < bodies.length; i++) {
      const dynObj = bodies[i]!;
      const rbDyn = dynObj.rigidBody;
      if (!dynObj.bounds || (rbDyn && rbDyn.isSleeping)) continue;

      this._broadphaseQueryHits.length = 0;
      this._broadphase.queryVolume(dynObj.bounds, this._broadphaseQueryHits);

      const idDyn = this.getColliderId(dynObj);

      for (let j = 0; j < this._broadphaseQueryHits.length; j++) {
        const otherObj = this._broadphaseQueryHits[j]!;
        if (dynObj === otherObj || !otherObj.bounds) continue;

        if (!PhysicsBroadphase.canCollide(dynObj, otherObj)) continue;

        let skipCollision = false;
        for (let k = 0; k < allJoints.length; k++) {
          const joint = allJoints[k]!;
          if (
            !joint.collideConnected &&
            ((joint.bodyA === dynObj && joint.bodyB === otherObj) ||
              (joint.bodyA === otherObj && joint.bodyB === dynObj))
          ) {
            skipCollision = true;
            break;
          }
        }
        if (skipCollision) continue;

        const idOther = this.getColliderId(otherObj);
        if (idDyn === idOther) continue;

        const idA = idDyn < idOther ? idDyn : idOther;
        const idB = idDyn < idOther ? idOther : idDyn;
        const first = idDyn < idOther ? dynObj : otherObj;
        const second = idDyn < idOther ? otherObj : dynObj;

        // The PairTracker owns the 64-bit pair key and the per-step discovery dedup, so the
        // same unordered pair can never be pushed twice within one step.
        if (!this._tracker.markDiscovered(idA, idB)) continue;

        this._tracker.acquirePair(first, second, idA, idB);
      }
    }

    // Deterministic canonical sorting by (idA, idB)
    this._tracker.activePairs.sort((p1, p2) =>
      p1.idA !== p2.idA ? p1.idA - p2.idA : p1.idB - p2.idB,
    );

    this._contactSolver.solve(this._tracker.activePairs, allJoints, {
      events: this.events,
      fixedTimeStep: dt,
      gravityLength: this.gravity.length(),
      solverIterations: this.solverIterations,
      tracker: this._tracker,
      syncTransform: (obj, posCorr) => this._syncObjectTransformAndBounds(obj, posCorr),
    });
  }

  /**
   * Resets and clears the broadphase tree, active pairs, and trigger/collision tracking state.
   */
  public clear(): void {
    this._broadphase.clear();
    this._releasePairs();
    this._tracker.clear();
    this._bodies.length = 0;
    this._allColliders.length = 0;
    this._accumulator = 0;
  }

  /**
   * Casts a ray against all active colliders in the scene, returning the closest hit.
   * @param ray The ray to cast.
   * @param maxDistance Maximum travel distance (default: Infinity).
   * @param mask 32-bit collision layer mask filter (default: 0xFFFFFFFF).
   * @param outHit Optional RaycastHit object receiving the hit details.
   * @param ignoreTriggers If true, ignores sensor/trigger colliders (default: true).
   * @returns RaycastHit or null if nothing was hit within maxDistance.
   */
  public raycast(
    ray: Ray,
    maxDistance: number = Infinity,
    mask: number = 0xffffffff,
    outHit?: RaycastHit,
    ignoreTriggers: boolean = true,
  ): RaycastHit | null {
    return this._spatialQueries.raycast(ray, maxDistance, mask, outHit, ignoreTriggers);
  }

  /**
   * Casts a ray against all active colliders and returns all hits sorted by distance ascending.
   * @param ray The ray to cast.
   * @param maxDistance Maximum travel distance.
   * @param mask 32-bit collision layer mask filter.
   * @param outHits Optional array receiving the results.
   * @param ignoreTriggers If true, ignores sensor/trigger colliders.
   * @returns Array of RaycastHit objects sorted by distance ascending.
   */
  public raycastAll(
    ray: Ray,
    maxDistance: number = Infinity,
    mask: number = 0xffffffff,
    outHits?: RaycastHit[],
    ignoreTriggers: boolean = true,
  ): RaycastHit[] {
    return this._spatialQueries.raycastAll(ray, maxDistance, mask, outHits, ignoreTriggers);
  }

  /**
   * Sweeps a sphere along a direction vector against all active colliders in the scene.
   * @param origin Starting center position of the swept sphere.
   * @param radius Radius of the sphere.
   * @param direction Direction vector of the sweep.
   * @param maxDistance Maximum travel distance along direction.
   * @param mask 32-bit collision layer mask filter (default: 0xFFFFFFFF).
   * @param outHit Optional RaycastHit object receiving the hit details.
   * @param ignoreTriggers If true, ignores sensor/trigger colliders (default: true).
   * @returns RaycastHit or null if no obstacle was struck.
   */
  public sphereCast(
    origin: Vector3D,
    radius: number,
    direction: Vector3D,
    maxDistance: number = Infinity,
    mask: number = 0xffffffff,
    outHit?: RaycastHit,
    ignoreTriggers: boolean = true,
  ): RaycastHit | null {
    return this._spatialQueries.sphereCast(
      origin,
      radius,
      direction,
      maxDistance,
      mask,
      outHit,
      ignoreTriggers,
    );
  }
}
