import { Behavior, BoundingBox, BoundingSphere, Object3D } from "@small-world-machine/engine";

const HOME_STIFFNESS = 3.0; // 1/s^2, soft spring back to the pool column
const HOME_DAMPING = 1.6; // 1/s, calms horizontal drift
const BODY_YAW_SPEED = 0.25; // rad/s

const GRAVITY = 9.81;
const DROP_TUMBLE_X = 2.2; // rad/s while falling
const DROP_TUMBLE_Z = 1.5; // rad/s while falling
const BOB_STIFFNESS = 40.0; // 1/s^2, spring back to the surface after the splash
const BOB_DAMPING = 4.0; // 1/s
const BOB_DURATION = 4.0; // s until the dropper resets for the next drop

/** Volume of a physics body's bounds, the same measure the buoyancy solver displaces. */
function boundsVolume(bounds: BoundingBox | BoundingSphere | object): number {
  if (bounds instanceof BoundingBox) {
    return (
      (bounds.max.x - bounds.min.x) * (bounds.max.y - bounds.min.y) * (bounds.max.z - bounds.min.z)
    );
  }
  if (bounds instanceof BoundingSphere) {
    return (4 / 3) * Math.PI * bounds.radius ** 3;
  }
  return 0;
}

/**
 * Keeps a floating physics body inside its pool: a soft spring pulls it back towards its home
 * column and light damping calms the drift, while the vertical motion stays purely buoyancy.
 * The mass is derived from the body's volume once its bounds exist, so `submersion` is the
 * fraction of the volume that sits below the surface at rest in fluid of density 1.
 */
export class PoolHomeBehavior extends Behavior {
  private _massAssigned = false;

  constructor(
    private readonly _homeX: number,
    private readonly _homeZ: number,
    private readonly _submersion: number,
  ) {
    super();
  }

  public override update(): void {
    const target = this.target;
    if (!(target instanceof Object3D) || !target.rigidBody || !target.bounds) return;
    const body = target.rigidBody;
    if (!this._massAssigned) {
      body.mass = this._submersion * boundsVolume(target.bounds);
      this._massAssigned = true;
    }
    body.angularVelocity.y = BODY_YAW_SPEED;
    const mass = body.mass;
    body.forces.x +=
      mass * (-HOME_STIFFNESS * (target.position.x - this._homeX) - HOME_DAMPING * body.velocity.x);
    body.forces.z +=
      mass * (-HOME_STIFFNESS * (target.position.z - this._homeZ) - HOME_DAMPING * body.velocity.z);
  }
}

/**
 * Periodically drops the attached object into the pool from above, lets it splash (impact +
 * tumble), then settles it into a damped bob at the liquid surface before resetting for the next
 * drop.
 */
export class SplashDropBehavior extends Behavior {
  private _state: "WAITING" | "FALLING" | "BOBBING" = "WAITING";
  private _velocityY = 0;
  private _waitTimer: number;
  private _bobTimer = 0;

  constructor(
    private readonly _surfaceY: number,
    private readonly _spawnY: number,
    private readonly _spawnDelay: number,
    private readonly _onImpact?: (x: number, z: number, speed: number) => void,
  ) {
    super();
    this._waitTimer = _spawnDelay;
  }

  public override update(deltaTime: number): void {
    const target = this.target;
    if (!(target instanceof Object3D)) return;

    if ("WAITING" === this._state) {
      this._waitTimer -= deltaTime;
      if (this._waitTimer <= 0) {
        target.position.y = this._spawnY;
        this._velocityY = 0;
        this._state = "FALLING";
      }
      return;
    }

    if ("FALLING" === this._state) {
      this._velocityY -= GRAVITY * deltaTime;
      target.position.y += this._velocityY * deltaTime;
      target.rotation.x += deltaTime * DROP_TUMBLE_X;
      target.rotation.z += deltaTime * DROP_TUMBLE_Z;
      if (target.position.y <= this._surfaceY) {
        target.position.y = this._surfaceY;
        this._state = "BOBBING";
        this._bobTimer = 0;
        if (this._onImpact) {
          this._onImpact(
            target.position.x,
            target.position.z,
            Math.min(Math.abs(this._velocityY) / GRAVITY, 1.0),
          );
        }
      }
      return;
    }

    // BOBBING: damped spring back to rest at the surface
    const displacement = target.position.y - this._surfaceY;
    const springForce = -BOB_STIFFNESS * displacement;
    const dampingForce = -BOB_DAMPING * this._velocityY;
    this._velocityY += (springForce + dampingForce) * deltaTime;
    target.position.y += this._velocityY * deltaTime;
    this._bobTimer += deltaTime;
    if (this._bobTimer > BOB_DURATION) {
      this._state = "WAITING";
      this._waitTimer = this._spawnDelay;
      target.rotation.set(0, target.rotation.y, 0);
    }
  }
}
