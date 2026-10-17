import {
  FirstPersonController,
  FirstPersonControllerOptions,
  Object3D,
  EventDispatcherImpl,
} from "@small-world-machine/engine/core/index.js";
import { CameraInterfaceData, Collidable } from "@small-world-machine/engine/interfaces/index.js";
import { Keys } from "@small-world-machine/engine/enums/index.js";
import { Events } from "../../Events.js";
import { Raycaster } from "@small-world-machine/engine/physix/index.js";
import { Vector2D } from "@small-world-machine/engine/math/index.js";
import { AudioSystem } from "@small-world-machine/engine/audio/index.js";
import { ObjectTags } from "../../enums/ObjectTags.js";

export interface ControllerOptions extends FirstPersonControllerOptions {
  /** Audio system for footstep, shot and hurt sounds. */
  audio?: AudioSystem;
}

/**
 * A retro style controller for forward/backward movement and left/right rotation.
 * It extends FirstPersonController and adds shooting, weapon selection, and damage logic.
 */
export class Controller extends FirstPersonController {
  private _lastShotTime: number = 0;
  private _lastHurtTime: number = 0;

  private _audio?: AudioSystem | undefined;
  private _raycaster: Raycaster = new Raycaster();
  private _screenCenter: Vector2D = new Vector2D(0, 0);
  private _queryHits: Collidable[] = [];

  /**
   * Creates a new Controller.
   * @param events The event bus
   * @param options The configuration options.
   */
  constructor(
    private events: EventDispatcherImpl,
    options: ControllerOptions = {},
  ) {
    // Force retro tank controls for Dungeon feel
    const { audio, ...baseOptions } = options;
    super({ ...baseOptions, retroTankControls: true });
    this._audio = audio;
    if (!options.input) throw new Error("Controller requires an 'input' option.");
  }

  public override update(deltaTime: number): void {
    if (!this.enabled || !this.target) {
      return;
    }

    // 1. Let the base FirstPersonController handle movement, rotation, bobbing, and collision
    super.update(deltaTime);

    const isCamera = "updateProjectionMatrix" in this.target;

    // 2. Play Footsteps (base class calculates distanceMoved)
    if (this.distanceMoved > 2.0) {
      // Play footstep every 2 units moved
      if (this._audio) this._audio.play("footstep", false, 0.4);
      this.distanceMoved = 0;
    }

    // 3. Weapon Selection (Keys 1-6)
    for (let i = 1; i <= 6; i++) {
      if (
        this._options.input.isPressed(i.toString() as Keys) ||
        this._options.input.isPressed(`Digit${i}` as Keys)
      ) {
        this.events.dispatchEvent(Events.WEAPON, { index: i });
      }
    }

    // 4. Shoot
    const now = performance.now();
    if (this._options.input.isPressed(Keys.SPACE) && now - this._lastShotTime > 500) {
      this._lastShotTime = now;
      if (this._audio) this._audio.play("shoot", false, 0.6);
      this.events.dispatchEvent(Events.SHOOT);

      // Raycast for Enemies
      if (this._options.scene && isCamera) {
        this._raycaster.setFromCamera(
          this._screenCenter,
          this.target as unknown as CameraInterfaceData,
        );

        const scene = this._options.scene;
        let candidates: Object3D[] = scene.objects;
        if (scene.staticOctree || scene.dynamicOctree || scene.spatialHash) {
          this._queryHits.length = 0;
          if (scene.staticOctree) {
            scene.staticOctree.queryRay(this._raycaster.ray, this._queryHits);
          }
          if (scene.dynamicOctree) {
            scene.dynamicOctree.queryRay(this._raycaster.ray, this._queryHits);
          }
          if (scene.spatialHash) {
            scene.spatialHash.queryRay(this._raycaster.ray, this._queryHits);
          }
          candidates = this._queryHits as Object3D[];
        }

        // intersectObjects sorts by distance closest to furthest by default
        const intersects = this._raycaster.intersectObjects(candidates, true);

        for (const intersect of intersects) {
          const obj = intersect.object;

          if (obj.tag === ObjectTags.ENEMY && obj.isVisible && obj.scale.y > 0.5) {
            // HIT AN ENEMY!
            obj.tag = ObjectTags.DEAD_ENEMY; // prevent shooting again
            obj.scale.y = 0.2; // squash to "dead"
            obj.position.y = 0.2; // drop to floor

            // Stop bobbing and other behaviors
            [...obj.behaviors].forEach((b) => obj.removeBehavior(b));

            if (this._audio)
              this._audio.playSpatial("enemy_death", obj.position, false, 0.8, 2.0, 20.0);
            break; // Bullet stops at the enemy
          }

          // If we hit a door first, the bullet stops! (Walls are a single merged
          // InstancedMesh, not individual collidable objects, so they can't be tagged here.)
          if (obj.tag === ObjectTags.DOOR) {
            break;
          }
        }
      }
    }

    // 5. Environment checks (Lava/Slime Damage -- item pickup is a ProximitySensorBehavior
    // attached directly to each item in LevelBuilder, the same idiom already used for doors)
    if (this._options.scene) {
      for (const obj of this._options.scene.objects) {
        // Damage (Lava / Slime)
        if (
          (obj.tag === ObjectTags.LAVA || obj.tag === ObjectTags.SLIME) &&
          now - this._lastHurtTime > 1000
        ) {
          const dx = obj.position.x - this.target.position.x;
          const dz = obj.position.z - this.target.position.z;
          if (dx * dx + dz * dz < 1.0) {
            // Standing right on it
            this._lastHurtTime = now;
            if (this._audio) this._audio.play("hurt", false, 0.8);

            // Dispatch custom event for HUD
            this.events.dispatchEvent(Events.DAMAGE, { amount: 10 });
          }
        }
      }
    }
  }
}
