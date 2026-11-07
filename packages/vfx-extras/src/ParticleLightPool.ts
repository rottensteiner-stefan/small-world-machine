import { PointLight, Vector3D } from "@small-world-machine/engine";
import type { Object3D } from "@small-world-machine/engine";
import type { ParticleSystem } from "./ParticleSystem.js";

/** Hard ceiling for the pre-allocated light pool (dynamic-light budget, see class docs). */
const MAX_POOL_LIGHTS = 8;

/**
 * Configuration options for {@link ParticleLightPool}.
 */
export interface ParticleLightPoolOptions {
  /** How many pool lights may be lit at once (1..8). Defaults to 8. */
  maxActive?: number | undefined;
  /** Seconds a light takes to fade in or out (and converge on a retargeted position). Defaults to 0.5. */
  fadeTime?: number | undefined;
  /** Fixed attenuation distance of every pool light in meters. Defaults to 4. */
  lightDistance?: number | undefined;
  /** Fixed attenuation decay of every pool light. Defaults to 2 (physically correct). */
  lightDecay?: number | undefined;
  /** Maps a particle's combined hotness (heat * alpha) to light intensity. Defaults to 1. */
  intensityScale?: number | undefined;
  /** Particles with heat * alpha below this score never claim a light. Defaults to 0.25. */
  minScore?: number | undefined;
}

/**
 * Pool of pre-allocated `PointLight`s that follow the hottest live particles of one
 * `ParticleSystem`. The per-tick scan is strictly read-only over `ParticleSystem.arrays` (no new
 * system hooks) and allocates zero heap. Rank is the combined hotness `heat * alpha` -- designed
 * for systems that author heat (e.g. via `ThermalCoolingAffector`); pure-alpha systems must set
 * heat or no light is claimed. Lights fade in and out over {@link fadeTime}; when a slot retargets
 * to a different particle its position converges at the same rate instead of teleporting.
 *
 * Dynamic-light budget: WebGL1/WebGL2 shade only the first 16 point lights in scene order, so all
 * light sources -- fires via `FireLightBudget`, this pool, hand-placed lights -- draw from one
 * shared budget. `MAX_POOL_LIGHTS` caps the pool at 8, leaving 8 slots for a `FireLightBudget` at
 * its own default; consumers adding further lights must size `maxActive` (or the fire budget) so
 * the scene total stays within 16, exactly as `FireLightBudget` documents.
 *
 * Space: particle positions are written as the lights' LOCAL `position` under `root`, i.e. the
 * particle simulation space is `root`'s local space (same convention as `ParticleMeshRenderer`,
 * whose instance matrices live in its parent's space). A non-identity `root` therefore moves
 * lights and particles together; no world-space conversion is needed or applied.
 *
 * @invariant LIGHTPOOL-BUDGET-BOUND: lit pool lights <= min(maxActive, MAX_POOL_LIGHTS) <= 8.
 * @invariant LIGHTPOOL-FADE-ENVELOPE: per-slot fade stays in [0,1] and moves monotonically toward
 *   its target; `update` performs zero heap allocation.
 */
export class ParticleLightPool {
  /** @domain maximum simultaneously lit pool lights (1..8, hard-capped at 8). */
  public maxActive: number;
  /** @domain fade / position-convergence duration in seconds (>0). */
  public fadeTime: number;
  /** @fixed attenuation distance of every pool light, set once at construction. */
  public readonly lightDistance: number;
  /** @fixed attenuation decay of every pool light, set once at construction. */
  public readonly lightDecay: number;
  /** @domain particle hotness -> light intensity multiplier (>=0). */
  public intensityScale: number;
  /** @domain particles below this heat * alpha score never claim a light (>=0). */
  public minScore: number;

  private readonly _system: ParticleSystem;
  /** Pre-allocated, never resized or removed while the pool lives. */
  private readonly _lights: PointLight[];
  /** Particle slot index each pool light follows (-1 = idle). */
  private readonly _boundSlot: Int32Array;
  /** 0..1 visibility envelope per pool light. */
  private readonly _fades: Float32Array;
  /** 1 = ranked for a light this tick, indexed by particle slot. */
  private readonly _ranked: Uint8Array;
  /** 1 = particle already assigned to a slot this tick, indexed by particle slot. */
  private readonly _placed: Uint8Array;
  /** Ranked particle indices, hottest first (<= 8 entries). */
  private readonly _order: Int32Array;
  private readonly _scratchPos: Vector3D;

  constructor(system: ParticleSystem, root: Object3D, options: ParticleLightPoolOptions = {}) {
    this.maxActive = Math.max(1, Math.min(MAX_POOL_LIGHTS, Math.floor(options.maxActive ?? 8)));
    this.fadeTime = options.fadeTime ?? 0.5;
    this.lightDistance = options.lightDistance ?? 4;
    this.lightDecay = options.lightDecay ?? 2;
    this.intensityScale = options.intensityScale ?? 1;
    this.minScore = options.minScore ?? 0.25;

    this._system = system;
    this._boundSlot = new Int32Array(MAX_POOL_LIGHTS);
    this._fades = new Float32Array(MAX_POOL_LIGHTS);
    this._ranked = new Uint8Array(system.capacity);
    this._placed = new Uint8Array(system.capacity);
    this._order = new Int32Array(MAX_POOL_LIGHTS);
    this._scratchPos = new Vector3D(0, 0, 0);

    this._lights = [];
    for (let i = 0; i < MAX_POOL_LIGHTS; i++) {
      const light = new PointLight({
        name: `ParticleLightPool_${i}`,
        intensity: 0,
        distance: this.lightDistance,
        decay: this.lightDecay,
      });
      light.isVisible = false;
      this._lights.push(light);
      root.add(light);
    }
    this._boundSlot.fill(-1);
  }

  /** Number of pool lights currently lit (fade > 0). Read-only budget accounting. */
  public get activeCount(): number {
    let count = 0;
    for (let i = 0; i < MAX_POOL_LIGHTS; i++) {
      if (this._fades[i]! > 0) count++;
    }
    return count;
  }

  /**
   * Re-binds the pool to the hottest live particles and advances the fade/position envelopes.
   * @param deltaTime Seconds; 0 freezes the pool.
   */
  public update(deltaTime: number): void {
    const arrays = this._system.arrays;
    const total = this._system.activeCount;
    const budget = Math.min(this.maxActive, MAX_POOL_LIGHTS);

    this._ranked.fill(0);
    this._placed.fill(0);
    let orderCount = 0;
    // Repeated max-search instead of a sort: budget <= 8, so the alive prefix is scanned at most
    // 8 times and nothing is allocated.
    for (let pick = 0; pick < budget; pick++) {
      let best = -1;
      let bestScore = this.minScore;
      for (let i = 0; i < total; i++) {
        if (arrays.aliveFlags[i] === 0 || this._ranked[i] === 1) continue;
        const score = arrays.heats[i]! * arrays.alphas[i]!;
        if (score > bestScore) {
          best = i;
          bestScore = score;
        }
      }
      if (best < 0) break;
      this._ranked[best] = 1;
      this._order[pick] = best;
      orderCount++;
    }

    // Stability pass: a slot keeps its particle while that particle is still ranked.
    for (let s = 0; s < MAX_POOL_LIGHTS; s++) {
      const p = this._boundSlot[s]!;
      if (p >= 0 && p < total && this._ranked[p] === 1) {
        this._placed[p] = 1;
      }
    }
    // Assignment pass: every ranked particle that lost its slot (or is new) claims the first
    // freed slot, hottest first. Slot count (8) >= ranked count, so this always succeeds.
    for (let p = 0; p < orderCount; p++) {
      const particle = this._order[p]!;
      if (this._placed[particle] === 1) continue;
      for (let s = 0; s < MAX_POOL_LIGHTS; s++) {
        const current = this._boundSlot[s]!;
        if (current >= 0 && current < total && this._ranked[current] === 1) continue;
        this._boundSlot[s] = particle;
        this._placed[particle] = 1;
        break;
      }
    }

    const step = this.fadeTime > 0 ? Math.min(1, deltaTime / this.fadeTime) : 1;
    const pos = this._scratchPos;
    for (let s = 0; s < MAX_POOL_LIGHTS; s++) {
      const light = this._lights[s]!;
      const bound = this._boundSlot[s]!;
      // A slot stays lit only while its particle is ranked this tick; a particle that lost its
      // rank fades the light out (position/colour hold until a new particle claims the slot).
      const hasTarget = bound >= 0 && bound < total && this._ranked[bound] === 1;
      // Linear envelope, mirroring FireLightBudget: reaches 1 exactly after `fadeTime` and never
      // asymptotes below full intensity.
      const prevFade = this._fades[s]!;
      const fade = hasTarget ? Math.min(1, prevFade + step) : Math.max(0, prevFade - step);
      this._fades[s] = fade;

      if (hasTarget) {
        const o = bound * 3;
        const c = bound * 4;
        pos.set(arrays.positions[o]!, arrays.positions[o + 1]!, arrays.positions[o + 2]!);
        if (prevFade <= 0) {
          // idle -> bound: the light was dark, so snap to the particle. Chasing from the stale
          // (or initial 0,0,0) position would sweep a visible light through the scene.
          light.position.set(pos.x, pos.y, pos.z);
        } else {
          // Retarget while lit: converge at the same rate as the envelope (anti-teleport).
          light.position.x += (pos.x - light.position.x) * step;
          light.position.y += (pos.y - light.position.y) * step;
          light.position.z += (pos.z - light.position.z) * step;
        }
        light.color.set(arrays.colors[c]!, arrays.colors[c + 1]!, arrays.colors[c + 2]!, 1);
      }

      light.intensity = fade * this.intensityScale;
      light.isVisible = hasTarget && fade > 0 && this.intensityScale > 0;
    }
  }

  /** Removes the pool lights from the scene graph. Safe to call twice. */
  public dispose(): void {
    for (let i = 0; i < this._lights.length; i++) {
      const light = this._lights[i]!;
      light.isVisible = false;
      light.parent?.remove(light);
    }
    this._fades.fill(0);
    this._boundSlot.fill(-1);
  }
}
