import type { AbstractMaterial, InstancedMesh } from "@small-world-machine/engine";
import { Color, Plane, Vector3D } from "@small-world-machine/engine";
import { ParticleMeshRenderer } from "../ParticleMeshRenderer.js";
import type { ParticleBillboardMode } from "../ParticleMeshRenderer.js";
import { ParticleSystem } from "../ParticleSystem.js";
import { ColorOverLifeAffector } from "../affectors/ColorOverLifeAffector.js";
import { DragAffector } from "../affectors/DragAffector.js";
import { GravityAffector } from "../affectors/GravityAffector.js";
import { EmberSpriteMaterial, createEmberSpriteTexture } from "./EmberSpriteMaterial.js";

/**
 * Configuration options for {@link FireEmberEmitter}.
 */
export interface FireEmberEmitterOptions {
  /** Optional label for the underlying InstancedMesh. Defaults to "FireEmberEmitter". */
  name?: string;
  /** Sparks emitted per second. Defaults to 10. */
  rate?: number | undefined;
  /** Particle pool slots. Defaults to 32. */
  capacity?: number | undefined;
  /** Particle lifetime range in seconds. Defaults to [0.6, 1.6]. */
  lifeRange?: readonly [number, number] | undefined;
  /** Initial speed range in m/s. Defaults to [0.6, 1.8]. */
  speedRange?: readonly [number, number] | undefined;
  /** Spawn disc radius around the anchor in meters. Defaults to 0.12. */
  spawnRadius?: number | undefined;
  /** Sprite size range in meters. Defaults to [0.02, 0.06]. */
  sizeRange?: readonly [number, number] | undefined;
  /** Constant acceleration in m/s². Defaults to (0, -1.4, 0) — embers sink gently. */
  gravity?: Vector3D | undefined;
  /** Linear drag coefficient. Defaults to 0.5. */
  drag?: number | undefined;
  /** sRGB colour at birth. Defaults to a hot ember orange-white. */
  hotColor?: Color | undefined;
  /** sRGB colour at death. Defaults to a deep ashen red, alpha 0. */
  coolColor?: Color | undefined;
  /** Deterministic seed: identical seeds reproduce identical motion. Defaults to 0. */
  seed?: number | undefined;
  /** Per-instance facing mode. Defaults to "spherical" (embers stay visible from above). */
  billboard?: Exclude<ParticleBillboardMode, "none"> | undefined;
  /** Shared material override; defaults to a soft additive `EmberSpriteMaterial`. */
  material?: AbstractMaterial | undefined;
}

/**
 * World-space ember/glutt sparks for a fire. Built on the engine's `ParticleSystem` (SoA, zero-GC)
 * with a gravity + drag + cooling pipeline, rendered as per-instance billboarded additive sprites
 * through the existing instanced-color path. The cooling colour interpolates alpha to 0, and the
 * renderer folds alpha into the instance scale, so each spark erodes away as it dies. Particles are
 * world-anchored: they stay where they were emitted, so a moving torch leaves sparks behind exactly
 * like a real flame.
 *
 * Drive it externally from the frame loop (`update`) so pause and slow-motion reach it — the same
 * pattern as `FireLightBehavior`. Add `mesh` to the scene root (instance matrices are world-space).
 */
export class FireEmberEmitter {
  public readonly system: ParticleSystem;
  /** The instanced billboard mesh; add it to the scene root. */
  public readonly mesh: InstancedMesh;
  /** Master switch; while false no particles spawn and the mesh stays where it is. */
  public enabled: boolean = true;

  private readonly _renderer: ParticleMeshRenderer;
  private readonly _rng: () => number;
  private readonly _rate: number;
  private readonly _lifeMin: number;
  private readonly _lifeSpan: number;
  private readonly _speedMin: number;
  private readonly _speedSpan: number;
  private readonly _spawnRadius: number;
  private readonly _sizeMin: number;
  private readonly _sizeSpan: number;
  private readonly _hotColor: Color;
  private _acc: number = 0;

  private readonly _scratchPos = new Vector3D(0, 0, 0);
  private readonly _scratchVel = new Vector3D(0, 0, 0);

  constructor(options: FireEmberEmitterOptions = {}) {
    const {
      name = "FireEmberEmitter",
      rate = 10,
      capacity = 32,
      lifeRange = [0.6, 1.6],
      speedRange = [0.6, 1.8],
      spawnRadius = 0.12,
      sizeRange = [0.02, 0.06],
      gravity = new Vector3D(0, -1.4, 0),
      drag = 0.5,
      hotColor = new Color(1, 0.85, 0.55, 1),
      coolColor = new Color(0.45, 0.12, 0.02, 0),
      seed = 0,
      billboard = "spherical",
      material,
    } = options;

    this._rate = Math.max(0, rate);
    this._lifeMin = Math.max(0, lifeRange[0]);
    this._lifeSpan = Math.max(0, lifeRange[1] - lifeRange[0]);
    this._speedMin = Math.max(0, speedRange[0]);
    this._speedSpan = Math.max(0, speedRange[1] - speedRange[0]);
    this._spawnRadius = Math.max(0, spawnRadius);
    this._sizeMin = Math.max(0, sizeRange[0]);
    this._sizeSpan = Math.max(0, sizeRange[1] - sizeRange[0]);
    this._hotColor = hotColor.clone();
    const cool = coolColor.clone();

    this._rng = mulberry32Relative(seed);

    this.system = new ParticleSystem({ capacity: Math.max(0, Math.floor(capacity)) });
    this.system.addAffector(new GravityAffector({ acceleration: gravity }));
    this.system.addAffector(new DragAffector({ drag }));
    this.system.addAffector(
      new ColorOverLifeAffector({ startColor: this._hotColor, endColor: cool }),
    );

    this._renderer = new ParticleMeshRenderer({
      name,
      system: this.system,
      geometry: new Plane({ width: 1, height: 1 }).getGeometryData(),
      material: material ?? new EmberSpriteMaterial({ sprite: createEmberSpriteTexture() }),
      billboard,
    });
    this.mesh = this._renderer.mesh;
    // Particles are dynamic world-space quads; object culling against a stale AABB would drop them.
    this.mesh.frustumCulled = false;
  }

  /**
   * Advances simulation and rendering by one frame.
   * @param deltaTime Seconds; 0 freezes the emitter (no spawn, no motion).
   * @param anchor World position of the flame origin where new sparks spawn.
   * @param cameraPosition World position of the camera (billboard facing).
   */
  public update(deltaTime: number, anchor: Vector3D, cameraPosition: Vector3D): void {
    if (!this.enabled || deltaTime <= 0) {
      return;
    }
    this._acc += this._rate * deltaTime;
    while (this._acc >= 1) {
      this._acc -= 1;
      this._spawnOne(anchor);
    }
    this.system.update(deltaTime);
    this._renderer.sync(cameraPosition);
  }

  /** Removes the mesh from its parent. Safe to call twice. */
  public dispose(): void {
    this.mesh.parent?.remove(this.mesh);
  }

  private _spawnOne(anchor: Vector3D): void {
    const angle = this._rng() * Math.PI * 2;
    const radius = Math.sqrt(this._rng()) * this._spawnRadius;

    this._scratchPos.set(
      anchor.x + Math.cos(angle) * radius,
      anchor.y,
      anchor.z + Math.sin(angle) * radius,
    );

    const speed = this._speedMin + this._rng() * this._speedSpan;
    // Up-biased cone: most of the momentum goes up, a fraction spills sideways.
    const lateral = speed * (0.3 + 0.3 * this._rng());
    const vertical = speed * (0.55 + 0.45 * this._rng());
    this._scratchVel.set(Math.cos(angle) * lateral, vertical, Math.sin(angle) * lateral);

    const life = this._lifeMin + this._rng() * this._lifeSpan;
    const size = this._sizeMin + this._rng() * this._sizeSpan;

    this.system.emit({
      position: this._scratchPos,
      velocity: this._scratchVel,
      life: 0,
      maxLife: life,
      alpha: 1,
      size,
      mass: 1,
      color: this._hotColor,
    });
  }
}

/**
 * Deterministic 32-bit PRNG (mulberry32) — same seed, same sequence, integer-only so it is
 * identical across JS engines. The engine's `SeededRandom.ts` is not part of the public API, so
 * the two-line core is repeated here (keep both in sync); the ember path needs reproducibility
 * for golden captures and tests, exactly like `FireFlickerProfile`.
 */
function mulberry32Relative(seed: number): () => number {
  let a: number = seed | 0;
  return (): number => {
    let t: number = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
