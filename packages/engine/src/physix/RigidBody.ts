import { Vector3D, MathPool } from "../math/index.js";
import { sharedRigidBodyMath } from "./RigidBodyMath.js";

/**
 * A component that adds Newtonian physics capabilities to an Object3D.
 */
export class RigidBody {
  private _mass: number;
  private _inverseMass: number;

  /** The mass of the object. 0 means static/kinematic (infinite mass). */
  public get mass(): number {
    return this._mass;
  }

  public set mass(value: number) {
    this._mass = value;
    this._inverseMass = value > 0 ? 1.0 / value : 0;
  }

  /** Precalculated inverse mass for performance. */
  public get inverseMass(): number {
    return this._inverseMass;
  }

  /** If true, the body detects collisions/triggers but does not physically resolve them. */
  public isTrigger: boolean = false;

  /** Alias for isTrigger for backwards compatibility. */
  public get isSensor(): boolean {
    return this.isTrigger;
  }
  public set isSensor(value: boolean) {
    this.isTrigger = value;
  }

  /** Current velocity vector. */
  public velocity: Vector3D = new Vector3D();
  /** Current acceleration vector. */
  public acceleration: Vector3D = new Vector3D();
  /** Accumulated forces for the current integration step. */
  public forces: Vector3D = new Vector3D();

  /** Current angular velocity vector. */
  public angularVelocity: Vector3D = new Vector3D();
  /** Current angular acceleration vector. */
  public angularAcceleration: Vector3D = new Vector3D();
  /** Accumulated torque for the current integration step. */
  public torque: Vector3D = new Vector3D();

  /** 3D Principal moments of inertia (Ix, Iy, Iz). */
  public inertiaTensor: Vector3D = new Vector3D(1, 1, 1);
  /** Precalculated inverse principal inertia components (1/Ix, 1/Iy, 1/Iz). */
  public inverseInertiaTensor: Vector3D = new Vector3D(1, 1, 1);

  private readonly _math = sharedRigidBodyMath;

  private _inertia: number;
  private _inverseInertia: number;

  /** Scalar approximation of moment of inertia. */
  public get inertia(): number {
    return this._inertia;
  }

  public set inertia(value: number) {
    this._inertia = value;
    this._inverseInertia = value > 0 ? 1.0 / value : 0;
    this.inertiaTensor.set(value, value, value);
    this.inverseInertiaTensor.set(this._inverseInertia, this._inverseInertia, this._inverseInertia);
  }

  /** Precalculated inverse scalar inertia. */
  public get inverseInertia(): number {
    return this._inverseInertia;
  }

  /**
   * Sets the 3D principal moments of inertia for a cuboid / box of mass m with given dimensions.
   * @param width Size along X axis.
   * @param height Size along Y axis.
   * @param depth Size along Z axis.
   */
  public setInertiaForBox(width: number, height: number, depth: number): void {
    const m = this._mass;
    if (m <= 0) {
      this.inertiaTensor.set(0, 0, 0);
      this.inverseInertiaTensor.set(0, 0, 0);
      this._inertia = 0;
      this._inverseInertia = 0;
      return;
    }
    const c = m / 12.0;
    const ix = c * (height * height + depth * depth);
    const iy = c * (width * width + depth * depth);
    const iz = c * (width * width + height * height);

    this.inertiaTensor.set(ix, iy, iz);
    this.inverseInertiaTensor.set(
      ix > 0 ? 1.0 / ix : 0,
      iy > 0 ? 1.0 / iy : 0,
      iz > 0 ? 1.0 / iz : 0,
    );
    this._inertia = (ix + iy + iz) / 3.0;
    this._inverseInertia = this._inertia > 0 ? 1.0 / this._inertia : 0;
  }

  /**
   * Sets the moment of inertia for a solid sphere of mass m and given radius.
   * @param radius Sphere radius.
   */
  public setInertiaForSphere(radius: number): void {
    const m = this._mass;
    if (m <= 0) {
      this.inertiaTensor.set(0, 0, 0);
      this.inverseInertiaTensor.set(0, 0, 0);
      this._inertia = 0;
      this._inverseInertia = 0;
      return;
    }
    const i = 0.4 * m * radius * radius;
    const invI = i > 0 ? 1.0 / i : 0;
    this.inertiaTensor.set(i, i, i);
    this.inverseInertiaTensor.set(invI, invI, invI);
    this._inertia = i;
    this._inverseInertia = invI;
  }

  /**
   * Sets the principal moments of inertia for a solid cylinder oriented along the Y axis.
   * @param radius Cylinder radius in XZ plane.
   * @param height Cylinder height along Y axis.
   */
  public setInertiaForCylinder(radius: number, height: number): void {
    const m = this._mass;
    if (m <= 0) {
      this.inertiaTensor.set(0, 0, 0);
      this.inverseInertiaTensor.set(0, 0, 0);
      this._inertia = 0;
      this._inverseInertia = 0;
      return;
    }
    const iy = 0.5 * m * radius * radius;
    const ixz = (1.0 / 12.0) * m * (3 * radius * radius + height * height);

    this.inertiaTensor.set(ixz, iy, ixz);
    this.inverseInertiaTensor.set(
      ixz > 0 ? 1.0 / ixz : 0,
      iy > 0 ? 1.0 / iy : 0,
      ixz > 0 ? 1.0 / ixz : 0,
    );
    this._inertia = (ixz + iy + ixz) / 3.0;
    this._inverseInertia = this._inertia > 0 ? 1.0 / this._inertia : 0;
  }
  /** Linear damping factor for atmospheric drag in free motion (1.0 = no drag). */
  public linearDamping: number = 1.0;
  /** Angular damping, simulates rotational air resistance. */
  public angularDamping: number = 0.98;

  /** How much velocity is retained after a bounce (0.0 = clay, 1.0 = superball). */
  public restitution: number = 0.2;
  /** Coulomb contact friction coefficient (0.0 = ice, 1.0 = high grip). */
  public friction: number = 0.5;

  /** Whether the body is currently asleep (skipping integration and broadphase queries). */
  public isSleeping: boolean = false;
  /** If false, the body will never be put to sleep automatically. */
  public allowSleep: boolean = true;
  /** Linear velocity magnitude threshold below which the body may fall asleep (m/s). */
  public sleepLinearThreshold: number = 0.05;
  /** Angular velocity magnitude threshold below which the body may fall asleep (rad/s). */
  public sleepAngularThreshold: number = 0.05;
  /** How long (seconds) velocity must remain below thresholds before entering sleep. */
  public sleepTimeThreshold: number = 0.5;

  /** Internal timer tracking inactivity duration. */
  public _sleepTimer: number = 0;

  /**
   * Position at the start of the most recently completed fixed-timestep substep. Together with
   * the object's current (post-substep) position, this lets `PhysicsSystem.applyRenderInterpolation`
   * blend the rendered transform between the two, decoupling the render framerate from the fixed
   * physics tick instead of snapping to the latest substep every frame.
   */
  public prevPosition: Vector3D = new Vector3D();
  /** Rotation (Euler, radians) counterpart to `prevPosition` -- see its doc for details. */
  public prevRotation: Vector3D = new Vector3D();

  /**
   * @param mass The initial mass. Use 0 for static objects.
   * @param inertia The scalar moment of inertia. Defaults to mass.
   */
  constructor(mass: number = 1.0, inertia: number = mass) {
    this._mass = mass;
    this._inverseMass = mass > 0 ? 1.0 / mass : 0;
    this._inertia = inertia;
    this._inverseInertia = inertia > 0 ? 1.0 / inertia : 0;
    this.inertiaTensor.set(inertia, inertia, inertia);
    this.inverseInertiaTensor.set(this._inverseInertia, this._inverseInertia, this._inverseInertia);
  }

  /**
   * Wakes up the rigid body from sleeping state.
   */
  public wakeUp(): void {
    if (this.isSleeping) {
      this.isSleeping = false;
    }
    this._sleepTimer = 0;
  }

  /**
   * Puts the rigid body to sleep immediately.
   */
  public putToSleep(): void {
    if (this.allowSleep && this.inverseMass > 0) {
      this.isSleeping = true;
      this._sleepTimer = 0;
      this.velocity.set(0, 0, 0);
      this.angularVelocity.set(0, 0, 0);
      this.clearForces();
    }
  }

  /**
   * Applies a continuous force to the center of mass.
   * @param force The force vector to apply.
   */
  public applyForce(force: Vector3D): void {
    if (this.inverseMass === 0) return;
    if (this.isSleeping) {
      this.wakeUp();
    }
    this.forces.add(force);
  }

  /**
   * Applies a torque (rotational force).
   * @param torque The torque vector to apply.
   */
  public applyTorque(torque: Vector3D): void {
    if (this.inverseInertia === 0) return;
    if (this.isSleeping) {
      this.wakeUp();
    }
    this.torque.add(torque);
  }

  /**
   * Applies an instantaneous impulse to the center of mass, directly altering velocity.
   * @param impulse The impulse vector.
   */
  public applyImpulse(impulse: Vector3D): void {
    if (this.inverseMass === 0) return;
    if (this.isSleeping) {
      this.wakeUp();
    }
    const dv = MathPool.acquireVector().copyFrom(impulse).scale(this.inverseMass);
    this.velocity.add(dv);
    MathPool.releaseVector(dv);
  }

  /**
   * Applies an instantaneous impulse at an off-center world-space contact point, altering both linear and angular velocity.
   * @param impulse The impulse vector J.
   * @param worldPoint The world-space point where impulse is applied.
   * @param centerOfMass Center of mass in world space (e.g. obj.position or bounds.center).
   * @param rotation Optional world rotation (Euler radians) of the body. When given, the angular
   * response uses the world-rotated inverse inertia (`R·I⁻¹·Rᵀ`); when omitted the legacy
   * body-frame per-axis scaling is applied (bit-identical for non-rotated bodies).
   */
  public applyImpulseAtPoint(
    impulse: Vector3D,
    worldPoint: Vector3D,
    centerOfMass: Vector3D,
    rotation?: Vector3D,
  ): void {
    if (this.inverseMass === 0) return;
    if (this.isSleeping) {
      this.wakeUp();
    }
    // Linear velocity delta: dv = J / m
    const dv = MathPool.acquireVector().copyFrom(impulse).scale(this.inverseMass);
    this.velocity.add(dv);
    MathPool.releaseVector(dv);

    // Lever arm: r = worldPoint - centerOfMass
    const rx = worldPoint.x - centerOfMass.x;
    const ry = worldPoint.y - centerOfMass.y;
    const rz = worldPoint.z - centerOfMass.z;

    if (rotation) {
      // Physically correct angular response through the world-rotated inertia.
      const rVec = MathPool.acquireVector().set(rx, ry, rz);
      this._math.applyAngularImpulse(this, rotation, rVec, impulse);
      MathPool.releaseVector(rVec);
      return;
    }

    // Legacy body-frame response: torque in the local inertia frame.
    // Torque impulse: tau = r x J
    const tauX = ry * impulse.z - rz * impulse.y;
    const tauY = rz * impulse.x - rx * impulse.z;
    const tauZ = rx * impulse.y - ry * impulse.x;

    // Angular velocity delta: dw = I^-1 * tau
    this.angularVelocity.x += tauX * this.inverseInertiaTensor.x;
    this.angularVelocity.y += tauY * this.inverseInertiaTensor.y;
    this.angularVelocity.z += tauZ * this.inverseInertiaTensor.z;
  }

  /**
   * Applies a continuous force at an off-center world-space point, accumulating both linear force and torque.
   * @param force The force vector.
   * @param worldPoint The world-space point where force is applied.
   * @param centerOfMass Center of mass in world space.
   */
  public applyForceAtPoint(force: Vector3D, worldPoint: Vector3D, centerOfMass: Vector3D): void {
    if (this.inverseMass === 0) return;
    if (this.isSleeping) {
      this.wakeUp();
    }
    this.forces.add(force);

    const rx = worldPoint.x - centerOfMass.x;
    const ry = worldPoint.y - centerOfMass.y;
    const rz = worldPoint.z - centerOfMass.z;

    const tauX = ry * force.z - rz * force.y;
    const tauY = rz * force.x - rx * force.z;
    const tauZ = rx * force.y - ry * force.x;

    this.torque.x += tauX;
    this.torque.y += tauY;
    this.torque.z += tauZ;
  }

  /**
   * Clears all accumulated forces and torques. Called by the PhysicsSystem after integration.
   */
  public clearForces(): void {
    this.forces.set(0, 0, 0);
    this.torque.set(0, 0, 0);
  }
}
