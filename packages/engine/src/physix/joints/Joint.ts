import type { Object3D } from "../../core/Object3D.js";
import { Vector3D } from "../../math/Vector3D.js";

/**
 * Common configuration options for all Physics Joints / Constraints.
 */
export interface JointOptions {
  /** The primary Object3D entity constrained by this joint. */
  bodyA: Object3D;
  /** The secondary Object3D entity, or null/undefined to anchor to a fixed point in world space. */
  bodyB?: Object3D | null | undefined;
  /** Local-space anchor offset attached to bodyA (defaults to (0, 0, 0)). */
  anchorA?: Vector3D | undefined;
  /** Local-space anchor offset attached to bodyB, or world-space anchor if bodyB is null (defaults to (0, 0, 0)). */
  anchorB?: Vector3D | undefined;
  /** Maximum impulse or force threshold before this joint breaks and disables itself (default: Infinity). */
  breakForce?: number | undefined;
  /** Whether the two connected bodies are allowed to collide with each other (default: false). */
  collideConnected?: boolean | undefined;
}

/**
 * Abstract base class for all physics constraints and articulated joint types.
 */
export abstract class Joint {
  /** The primary Object3D entity constrained by this joint. */
  public bodyA: Object3D;
  /** The secondary Object3D entity, or null to anchor bodyA to static world space. */
  public bodyB: Object3D | null;
  /** Local anchor offset on bodyA. */
  public anchorA: Vector3D;
  /** Local anchor offset on bodyB, or world-space anchor if bodyB is null. */
  public anchorB: Vector3D;
  /** Maximum force or impulse threshold before joint rupture. */
  public breakForce: number;
  /** Whether collision response between bodyA and bodyB is enabled. */
  public collideConnected: boolean;
  /** Whether the joint is actively evaluated during physics simulation ticks. */
  public enabled: boolean = true;
  /** Whether the joint has exceeded breakForce and ruptured. */
  public isBroken: boolean = false;

  constructor(options: JointOptions) {
    this.bodyA = options.bodyA;
    this.bodyB = options.bodyB ?? null;
    this.anchorA = options.anchorA ? options.anchorA.clone() : new Vector3D(0, 0, 0);
    this.anchorB = options.anchorB ? options.anchorB.clone() : new Vector3D(0, 0, 0);
    this.breakForce = options.breakForce ?? Infinity;
    this.collideConnected = options.collideConnected ?? false;
  }

  /**
   * Computes the current world-space position of anchorA.
   * @param out Vector receiving the world coordinates.
   * @returns out
   */
  public getWorldAnchorA(out: Vector3D): Vector3D {
    this.bodyA.worldMatrix.transformVector(this.anchorA, out);
    return out;
  }

  /**
   * Computes the current world-space position of anchorB.
   * @param out Vector receiving the world coordinates.
   * @returns out
   */
  public getWorldAnchorB(out: Vector3D): Vector3D {
    if (this.bodyB) {
      this.bodyB.worldMatrix.transformVector(this.anchorB, out);
    } else {
      out.copyFrom(this.anchorB);
    }
    return out;
  }

  /**
   * Optional pre-solve hook to accumulate continuous forces (e.g. Hookean spring tension).
   * @param dt Fixed substep delta time in seconds.
   */
  public applyForces?(dt: number): void;

  /**
   * True when every dynamic body connected by this joint is currently asleep (static bodies do
   * not count). A fully-asleep joint has nothing to solve: both endpoints are frozen, so the
   * solve can be skipped without waking them. This mirrors the collision solver, which only
   * applies impulses to approaching contacts and therefore never re-wakes settled bodies.
   */
  protected get isFullyAsleep(): boolean {
    const rbA = this.bodyA.rigidBody;
    const rbB = this.bodyB?.rigidBody;
    const dynamicA = rbA !== undefined && rbA.inverseMass > 0;
    const dynamicB = rbB !== undefined && rbB.inverseMass > 0;
    if (!dynamicA && !dynamicB) return true;
    if (dynamicA && !rbA!.isSleeping) return false;
    if (dynamicB && !rbB!.isSleeping) return false;
    return true;
  }

  /**
   * Solves velocity constraints using Projected Gauss-Seidel iterations.
   * @param dt Fixed substep delta time in seconds.
   */
  public abstract solveVelocity(dt: number): void;

  /**
   * Solves positional drift and geometric error projection to prevent numerical stretching.
   */
  public abstract solvePosition(): void;
}
