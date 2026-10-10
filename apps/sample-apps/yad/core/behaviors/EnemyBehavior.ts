import { Behavior } from "@small-world-machine/engine/core/behaviors/index.js";
import { Object3D, Scene } from "@small-world-machine/engine/core/index.js";
import { CameraInterfaceData, Collidable } from "@small-world-machine/engine/interfaces/index.js";
import {
  BoundingBox,
  BoundingSphere,
  Collision,
} from "@small-world-machine/engine/physix/index.js";
import { MathPool } from "@small-world-machine/engine/math/index.js";
import { AudioSystem } from "@small-world-machine/engine/audio/index.js";
import { BoundingType } from "@small-world-machine/engine/enums/index.js";
import { ObjectTags } from "../../enums/ObjectTags.js";

export interface EnemyBehaviorOptions {
  player: CameraInterfaceData;
  scene: Scene;
  audio?: AudioSystem | undefined;
  speed?: number;
  detectionRange?: number;
}

export class EnemyBehavior extends Behavior {
  private _player: CameraInterfaceData;
  private _scene: Scene;
  private _speed: number;
  private _detectionRange: number;
  private _collider?: BoundingSphere;
  private _potentialHits: Collidable[] = [];
  private _audio?: AudioSystem | undefined;
  private _gruntTimer: number = 0;

  constructor(options: EnemyBehaviorOptions) {
    super();
    this._player = options.player;
    this._scene = options.scene;
    this._audio = options.audio;
    this._speed = options.speed ?? 3.0;
    this._detectionRange = options.detectionRange ?? 20.0;
  }

  public override onAttach(target: Object3D): void {
    super.onAttach(target);
    this._collider = new BoundingSphere(target.position.clone(), 0.5);
  }

  public override update(deltaTime: number): void {
    if (!this.target || (this.target as Object3D).tag === ObjectTags.DEAD_ENEMY) return;

    const dx = this._player.position.x - this.target.position.x;
    const dz = this._player.position.z - this.target.position.z;
    const distance = Math.sqrt(dx * dx + dz * dz);

    if (distance > this._detectionRange || distance < 1.5) {
      return; // Too far away or already close enough to attack
    }

    // Play random grunt sound spatially
    this._gruntTimer -= deltaTime;
    if (this._gruntTimer <= 0) {
      if (this._audio)
        this._audio.playSpatial("enemy_grunt", this.target.position, false, 0.5, 2.0, 25.0);
      this._gruntTimer = 3.0 + Math.random() * 5.0; // Grunt every 3-8 seconds
    }

    // Move towards player
    const nx = dx / distance;
    const nz = dz / distance;

    this.target.position.x += nx * this._speed * deltaTime;
    this.target.position.z += nz * this._speed * deltaTime;

    // Resolve collisions
    this._resolveCollisions();
  }

  private _resolveCollisions(): void {
    if (!this.target || !this._collider) return;
    this._collider.center.copyFrom(this.target.position);
    this._collider.center.y += 0.5; // Offset slightly up

    this._potentialHits.length = 0;
    if (this._scene.staticOctree)
      this._scene.staticOctree.queryVolume(this._collider, this._potentialHits);
    if (this._scene.spatialHash) this._scene.spatialHash.query(this._collider, this._potentialHits);

    const correction = MathPool.acquireVector().set(0, 0, 0);
    const hitCorrection = MathPool.acquireVector();

    for (const obj of this._potentialHits) {
      if (!obj.bounds || obj === this.target) continue;
      let resolved: boolean;
      if (BoundingType.SPHERE === obj.bounds.type) {
        resolved = Collision.resolveSphereSphere(
          this._collider,
          obj.bounds as BoundingSphere,
          hitCorrection,
        );
      } else {
        resolved = Collision.resolveSphereBox(
          this._collider,
          obj.bounds as BoundingBox,
          hitCorrection,
        );
      }

      if (resolved) {
        correction.add(hitCorrection);
        this._collider.center.add(hitCorrection); // update sphere center iteratively
      }
    }

    this.target.position.add(correction);
    MathPool.releaseVector(correction);
    MathPool.releaseVector(hitCorrection);
  }
}
