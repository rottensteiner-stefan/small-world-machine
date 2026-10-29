import type { AbstractMaterial, InstancedMesh } from "@small-world-machine/engine";
import { Color, Plane, Vector3D } from "@small-world-machine/engine";
import { ParticleMeshRenderer } from "../ParticleMeshRenderer.js";
import type { ParticleBillboardMode } from "../ParticleMeshRenderer.js";
import { ParticleSystem } from "../ParticleSystem.js";
import { ColorOverLifeAffector } from "../affectors/ColorOverLifeAffector.js";
import { DragAffector } from "../affectors/DragAffector.js";
import { GravityAffector } from "../affectors/GravityAffector.js";
import { SizeGrowthAffector } from "../affectors/SizeGrowthAffector.js";
import { SmokeSpriteMaterial } from "./SmokeSpriteMaterial.js";

/**
 * Configuration options for {@link FireSmokeEmitter}.
 */
export interface FireSmokeEmitterOptions {
  /** Optional label for the underlying InstancedMesh. Defaults to "FireSmokeEmitter". */
  name?: string;
  /** Smoke puffs emitted per second. Defaults to 6. */
  rate?: number | undefined;
  /** Particle pool slots. Defaults to 18. */
  capacity?: number | undefined;
  /** Particle lifetime range in seconds. Defaults to [1.0, 2.2]. */
  lifeRange?: readonly [number, number] | undefined;
  /** Initial speed range in m/s. Defaults to [0.3, 0.7]. */
  speedRange?: readonly [number, number] | undefined;
  /** Spawn disc radius around the anchor in meters. Defaults to 0.1. */
  spawnRadius?: number | undefined;
  /** Sprite size range in meters. Defaults to [0.12, 0.28]. */
  sizeRange?: readonly [number, number] | undefined;
  /** Per-second multiplicative growth; bigger puffs need smaller rates (1.0 ≈ ×e per second). Defaults to 0.5. */
  growthRate?: number | undefined;
  /** Absolute size ceiling any puff may reach, in meters. Defaults to 2.5. */
  maxScale?: number | undefined;
  /** Buoyancy acceleration in m/s². Defaults to (0, 0.55, 0) — slow rise, no fireball launch. */
  buoyancy?: Vector3D | undefined;
  /** Linear drag coefficient. Defaults to 0.55. */
  drag?: number | undefined;
  /** sRGB tint at birth: smoke still catching the fire light. Defaults to a warm-lit gray. */
  startColor?: Color | undefined;
  /** sRGB tint at death: cold smoke drifting into the dark. Defaults to a deep gray, alpha 0. */
  endColor?: Color | undefined;
  /** Horizontal drift picked up from the world wind vector passed to {@link FireSmokeEmitter.update}. Defaults to 0.35. */
  windInfluence?: number | undefined;
  /** Deterministic seed: identical seeds reproduce identical plumes. Defaults to 0. */
  seed?: number | undefined;
  /** Per-instance facing mode. Defaults to "spherical" (puffs stay visible from every angle). */
  billboard?: Exclude<ParticleBillboardMode, "none"> | undefined;
  /** Shared material override; defaults to an alpha-blended {@link SmokeSpriteMaterial}. */
  material?: AbstractMaterial | undefined;
}

/**
 * World-space smoke plume for a fire, on the same `ParticleSystem` chain as {@link FireEmberEmitter}
 * but for drifting, dissolving smoke: strong drag and buoyancy pull the puffs up, every puff grows
 * multiplicatively (base size preserved, `SizeGrowthAffector`) and is rendered through the
 * alpha-blended {@link SmokeSpriteMaterial}, which reads the per-instance alpha as pure opacity
 * (the renderer therefore runs with `foldAlphaIntoScale = false`). The tint is authored as
 * warm-lit near the flame and cold dark as the puff ages — smoke is not lit by the light loop.
 *
 * Drive it externally from the frame loop (`update`) so pause and slow-motion reach it — the same
 * pattern as `FireEmberEmitter` and `FireLightBehavior`. Add `mesh` to the scene root (instance
 * matrices are world-space). World-anchored: a moving torch (P4) leaves its smoke behind.
 */
export class FireSmokeEmitter {
  public readonly system: ParticleSystem;
  /** The instanced billboard mesh; add it to the scene root. */
  public readonly mesh: InstancedMesh;
  /** Master switch; while false no puffs spawn and the mesh stays where it is. */
  public enabled: boolean = true;

  private readonly _renderer: ParticleMeshRenderer;
  private readonly _material: SmokeSpriteMaterial;
  private readonly _rng: () => number;
  private readonly _rate: number;
  private readonly _lifeMin: number;
  private readonly _lifeSpan: number;
  private readonly _speedMin: number;
  private readonly _speedSpan: number;
  private readonly _spawnRadius: number;
  private readonly _sizeMin: number;
  private readonly _sizeSpan: number;
  private readonly _windInfluence: number;
  private readonly _startColor: Color;
  private _acc: number = 0;
  private _time: number = 0;

  private readonly _scratchPos = new Vector3D(0, 0, 0);
  private readonly _scratchVel = new Vector3D(0, 0, 0);

  constructor(options: FireSmokeEmitterOptions = {}) {
    const {
      name = "FireSmokeEmitter",
      rate = 6,
      capacity = 18,
      lifeRange = [1.0, 2.2],
      speedRange = [0.3, 0.7],
      spawnRadius = 0.1,
      sizeRange = [0.12, 0.28],
      growthRate = 0.5,
      maxScale = 2.5,
      buoyancy = new Vector3D(0, 0.55, 0),
      drag = 0.55,
      startColor = new Color(0.62, 0.58, 0.55, 0.36),
      endColor = new Color(0.16, 0.15, 0.14, 0),
      windInfluence = 0.35,
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
    this._windInfluence = Math.max(0, windInfluence);
    this._startColor = startColor.clone();

    this._rng = mulberry32Relative(seed);

    this.system = new ParticleSystem({ capacity: Math.max(0, Math.floor(capacity)) });
    this.system.addAffector(new GravityAffector({ acceleration: buoyancy }));
    this.system.addAffector(new DragAffector({ drag }));
    this.system.addAffector(new SizeGrowthAffector({ rate: growthRate, maxScale }));
    this.system.addAffector(new ColorOverLifeAffector({ startColor: this._startColor, endColor }));

    this._material = new SmokeSpriteMaterial();
    this._renderer = new ParticleMeshRenderer({
      name,
      system: this.system,
      geometry: new Plane({ width: 1, height: 1 }).getGeometryData(),
      material: material ?? this._material,
      billboard,
      // Smoke alpha is opacity (read by SmokeSpriteMaterial), not a size fold.
      foldAlphaIntoScale: false,
    });
    this.mesh = this._renderer.mesh;
    // Particles are dynamic world-space quads; object culling against a stale AABB would drop them.
    this.mesh.frustumCulled = false;
  }

  /**
   * Advances simulation and rendering by one frame.
   * @param deltaTime Seconds; 0 freezes the plume (no spawn, no motion, no churn).
   * @param anchor World position where new puffs spawn (usually the flame tip region).
   * @param cameraPosition World position of the camera (billboard facing).
   * @param wind Optional world-space wind vector in m/s; its horizontal parts tilt the plume.
   */
  public update(
    deltaTime: number,
    anchor: Vector3D,
    cameraPosition: Vector3D,
    wind?: Readonly<Vector3D>,
  ): void {
    if (!this.enabled || deltaTime <= 0) {
      return;
    }
    this._time += deltaTime;
    this._material.time = this._time;
    this._acc += this._rate * deltaTime;
    while (this._acc >= 1) {
      this._acc -= 1;
      this._spawnOne(anchor, wind);
    }
    this.system.update(deltaTime);
    this._renderer.sync(cameraPosition);
  }

  /** Removes the mesh from its parent. Safe to call twice. */
  public dispose(): void {
    this.mesh.parent?.remove(this.mesh);
  }

  private _spawnOne(anchor: Vector3D, wind: Readonly<Vector3D> | undefined): void {
    const angle = this._rng() * Math.PI * 2;
    const radius = Math.sqrt(this._rng()) * this._spawnRadius;

    this._scratchPos.set(
      anchor.x + Math.cos(angle) * radius,
      anchor.y,
      anchor.z + Math.sin(angle) * radius,
    );

    const speed = this._speedMin + this._rng() * this._speedSpan;
    const lateral = speed * (0.25 + 0.35 * this._rng());
    const vertical = speed * (0.9 + 0.5 * this._rng());
    this._scratchVel.set(
      Math.cos(angle) * lateral + (wind ? wind.x * this._windInfluence : 0),
      vertical,
      Math.sin(angle) * lateral + (wind ? wind.z * this._windInfluence : 0),
    );

    const life = this._lifeMin + this._rng() * this._lifeSpan;
    const size = this._sizeMin + this._rng() * this._sizeSpan;

    this.system.emit({
      position: this._scratchPos,
      velocity: this._scratchVel,
      life: 0,
      maxLife: life,
      alpha: this._startColor.a,
      size,
      mass: 1,
      color: this._startColor,
    });
  }
}

/**
 * Deterministic 32-bit PRNG (mulberry32) — same seed, same sequence, integer-only so it is
 * identical across JS engines. The engine's `SeededRandom.ts` is not part of the public API, so
 * the two-line core is repeated here (keep both in sync with `FireEmberEmitter`); the smoke path
 * needs reproducibility for golden captures and freeze-frame tests, exactly like the embers.
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
