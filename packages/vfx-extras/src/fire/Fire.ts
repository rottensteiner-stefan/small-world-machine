import {
  Color,
  Decal,
  DecalMaterial,
  Object3D,
  Plane,
  PointLight,
  Vector3D,
} from "@small-world-machine/engine";
import { EmberBed } from "./EmberBed.js";
import { FireEmberEmitter } from "./FireEmberEmitter.js";
import { FireLightBehavior } from "./FireLightBehavior.js";
import { FireMaterial } from "./FireMaterial.js";
import type { FlamePalette } from "./FireMaterial.js";
import { FireSmokeEmitter } from "./FireSmokeEmitter.js";
import { FlameGlowMaterial } from "./FlameGlowMaterial.js";
import { createFlameCardGeometry } from "./createFlameCardGeometry.js";
import { createSootDecalTexture } from "./soot.js";

/** Named fire presets; every layer of a `Fire` is authored from one of these base data sets. */
export type FirePreset = "candle" | "torch" | "campfire";

/**
 * Pure preset data for one fire silhouette (ADR 0001): the authored shape, the light budget and
 * which layers exist. Consumers override individual fields (`FireOptions.data`) instead of
 * re-deriving values; the point is honest defaults that never need copy/paste tuning.
 */
export interface FirePresetData {
  /** Vertical crossed flame cards. */
  readonly cards: number;
  /** Flame base width in meters. */
  readonly width: number;
  /** Flame height in meters. */
  readonly height: number;
  /** Soot/ember-bed emitter density is derived from `height`/`width` at construction; the presets
   *  only gate which particle layers exist and carry their authored base tuning. */
  readonly flameIntensity: number;
  readonly turbulence: number;
  readonly flowSpeed: number;
  /** Point-light budget. */
  readonly lightIntensity: number;
  readonly lightDistance: number;
  /** Horizontal position-jitter radius in meters (shadow sway). */
  readonly jitter: number;
  readonly glowSize: number;
  readonly glowIntensity: number;
  /** Layer presence flags. */
  readonly embers: boolean;
  readonly smoke: boolean;
  readonly emberBed: boolean;
  readonly soot: boolean;
}

/** Ready-made preset table — the single source of silhouette data for every fire consumer. */
export const FIRE_PRESETS: Readonly<Record<FirePreset, FirePresetData>> = {
  candle: {
    cards: 1,
    width: 0.035,
    height: 0.09,
    flameIntensity: 1.8,
    turbulence: 0.6,
    flowSpeed: 1,
    lightIntensity: 0.4,
    lightDistance: 2,
    jitter: 0.004,
    glowSize: 0.25,
    glowIntensity: 0.4,
    embers: false,
    smoke: false,
    emberBed: false,
    soot: false,
  },
  torch: {
    cards: 2,
    width: 0.15,
    height: 0.45,
    flameIntensity: 2.5,
    turbulence: 1,
    flowSpeed: 1,
    lightIntensity: 3,
    lightDistance: 8,
    jitter: 0.015,
    glowSize: 0.9,
    glowIntensity: 0.5,
    embers: true,
    smoke: true,
    emberBed: true,
    soot: false,
  },
  campfire: {
    cards: 3,
    width: 0.5,
    height: 0.8,
    flameIntensity: 3,
    turbulence: 1.3,
    flowSpeed: 1,
    lightIntensity: 5,
    lightDistance: 14,
    jitter: 0.035,
    glowSize: 1.8,
    glowIntensity: 0.6,
    embers: true,
    smoke: true,
    emberBed: true,
    soot: true,
  },
};

/** Composition options for {@link Fire}. */
export interface FireOptions {
  /** Optional label for the prefab's parts. */
  name?: string;
  /** Named silhouette preset; defaults to "torch". */
  preset?: FirePreset;
  /** Per-field overrides merged over the preset data. */
  data?: Partial<FirePresetData>;
  /** World/base position for the flame root. The consumer may reparent `root` and reposition it
   *  afterwards (e.g. a carried torch); `embers`/`smoke` anchors then follow the live root. */
  position?: Vector3D;
  /** Deterministic per-fire seed; give every fire its own. Defaults to 0. */
  seed?: number;
  /** Explicit colour ramp; overrides `temperatureK`. */
  palette?: FlamePalette | undefined;
  /** Body temperature in Kelvin. Defaults to 2000 (torch / campfire). */
  temperatureK?: number;
  /** Keeps the light's own authored colour (no temperature flicker) while the flame still uses
   *  `temperatureK` — for an injected scene light whose colour the consumer owns (e.g. a carried
   *  torch re-using the scene's warm light). Defaults to false. */
  preserveLightColor?: boolean;
  /** Final world-space lean of the flame tip. Defaults to none. */
  lean?: Vector3D;
  /** External point light to drive instead of a prefab-owned one (e.g. a carried torch re-using
   *  the scene's lantern light). Position it and parent it before construction — the fire light
   *  behavior captures its local base position on attach. Defaults to a prefab-built light. */
  light?: PointLight | undefined;
}

/** Fire layers that {@link Fire.setLayerEnabled} can switch individually. */
export type FireLayer = "flame" | "glow" | "light" | "embers" | "smoke" | "emberBed" | "soot";

/**
 * Composable fire prefab (plan P-compose): one `Fire` bundles the full layer stack — flame cards,
 * glow halo, flickering point light, world-anchored embers and smoke, ember bed and soot decal —
 * authored from a named preset (`FIRE_PRESETS`) with per-field overrides. It is a composition of
 * the existing fire classes, never a monolithic effect: every layer stays individually switchable
 * (`setLayerEnabled`) and every part stays reachable as a public property, so a consumer can take
 * over a single layer without fighting the prefab.
 *
 * Runtime contracts are inherited from every layer:
 * - **Driven externally.** Call {@link update} from the app frame loop with the scaled `dt` (pause
 *   and slow-motion reach the flame); `dt = 0` freezes every layer.
 * - **Deterministic.** Seeded PRNG on every animated layer; identical seed → identical fire.
 * - **World-anchored trails.** `embers`/`smoke` are simulated in world space and their meshes must
 *   be added to the SCENE ROOT by the consumer (instance matrices are world-space). Their spawn
 *   anchor is derived from `root.getWorldPosition()` every frame, so a moving root (a carried
 *   torch) spawns particles at the live position and leaves them behind — world-anchored.
 * - **Zero-GC.** `update` allocates nothing.
 *
 * Three semantically different consumers (showcase 37 chimney, showcase 38 torches, the-whisper
 * carried torch) justify the shared abstraction (ADR 0047 Rule of Three).
 */
export class Fire {
  /** Flame cards + glow + light parent. Consumer adds it to a scene or a moving container. */
  public readonly root: Object3D;
  /** Flame body material; `time`/`intensity`/`lean` are written by {@link update}. */
  public readonly flame: FireMaterial;
  /** Billboard glow halo. */
  public readonly glow: FlameGlowMaterial;
  /** The fire's point light (the external light when one was injected). */
  public readonly light: PointLight;
  /** Flicker + temperature + jitter driver, register with a `FireLightBudget` for crowds. */
  public readonly lightBehavior: FireLightBehavior;
  /** World-anchored ember sparks; add `embers.mesh` to the scene root when the fire is lit. */
  public readonly embers: FireEmberEmitter | undefined;
  /** World-anchored smoke plume; add `smoke.mesh` to the scene root when the fire is lit. */
  public readonly smoke: FireSmokeEmitter | undefined;
  /** Glowing fuel bed under the fire, or undefined when the preset has none. */
  public readonly emberBed: EmberBed | undefined;
  /** Soot/ash decal, or undefined when the preset has none. Consumer adds it to the scene and
   *  runs the WEB_GL1 `bakeSceneDecals` path itself (it needs the fully-built scene, ADR 0029). */
  public readonly soot: Decal | undefined;
  /** The named preset this fire was authored from. */
  public readonly presetName: FirePreset;
  /** @fixed Authored flame base width in meters (silhouette constant per fire). */
  public readonly width: number;
  /** @fixed Authored flame base height in meters (silhouette constant per fire). */
  public readonly height: number;
  /** @domain flame body emission multiplier at rest (>=0); `update` breathes it with the light. */
  public flameIntensity: number;
  /** @domain glow halo emission multiplier at rest (>=0); `update` breathes it with the light. */
  public glowIntensity: number;
  /** @domain deterministic noise seed (any real number). */
  public seed: number;
  /** @domain master switch for the flame cards; while false they are hidden. */
  public flameEnabled: boolean = true;
  /** @domain master switch for the glow halo; while false it is hidden. */
  public glowEnabled: boolean = true;
  /** @domain master switch for the point light; while false it is hidden. */
  public lightEnabled: boolean = true;
  /** @domain master switch for the ember sparks; while false none spawn. */
  public embersEnabled: boolean = true;
  /** @domain master switch for the smoke plume; while false none spawn. */
  public smokeEnabled: boolean = true;
  /** @domain master switch for the ember bed; while false it is hidden and holds still. */
  public emberBedEnabled: boolean = true;
  /** @domain master switch for the soot decal; while false it is hidden. */
  public sootEnabled: boolean = true;

  private readonly _flameObject: Object3D;
  private readonly _glowObject: Object3D;
  private _time: number = 0;

  private readonly _scratchBase: Vector3D = new Vector3D(0, 0, 0);
  private readonly _scratchAnchor: Vector3D = new Vector3D(0, 0, 0);

  constructor(options: FireOptions = {}) {
    const presetName = options.preset ?? "torch";
    const preset = FIRE_PRESETS[presetName];
    const data: FirePresetData = { ...preset, ...options.data };

    this.presetName = presetName;
    this.width = Math.max(0, data.width);
    this.height = Math.max(0, data.height);
    this.flameIntensity = Math.max(0, data.flameIntensity);
    this.glowIntensity = Math.max(0, data.glowIntensity);
    this.seed = options.seed ?? this._seedFromName(options.name);

    const temperatureK = options.temperatureK ?? 2000;
    const rootName = options.name ? `${options.name}_Fire` : "Fire";
    this.root = new Object3D(rootName);
    if (options.position) {
      this.root.position.copyFrom(options.position);
    }

    // --- flame cards ---
    this.flame = new FireMaterial({
      palette: options.palette,
      temperatureK,
      seed: this.seed * 7.31,
      turbulence: data.turbulence,
      flowSpeed: data.flowSpeed,
    });
    this.flame.intensity = this.flameIntensity;
    this._flameObject = new Object3D(`${rootName}_Flame`);
    this._flameObject.geometry = createFlameCardGeometry({
      cards: Math.max(1, Math.floor(data.cards)),
      width: this.width,
      height: this.height,
    }).getGeometryData();
    this._flameObject.material = this.flame;
    if (options.lean) this.flame.lean.copyFrom(options.lean);
    this.root.add(this._flameObject);

    // --- glow halo ---
    this.glow = new FlameGlowMaterial(
      options.palette ? { tint: options.palette.body } : { temperatureK: temperatureK * 0.95 },
    );
    this.glow.intensity = this.glowIntensity;
    this._glowObject = new Object3D(`${rootName}_Glow`);
    this._glowObject.geometry = new Plane().getGeometryData();
    this._glowObject.material = this.glow;
    this._glowObject.scale.set(data.glowSize, data.glowSize, data.glowSize);
    this._glowObject.position.set(0, this.height * 0.4, 0);
    this.root.add(this._glowObject);

    // --- point light + fire light behavior ---
    if (options.light) {
      // Injected light: the consumer owns its position and parent (e.g. the carried torch that
      // re-uses the scene's lantern light) — never reparented here.
      this.light = options.light;
    } else {
      const light = new PointLight({
        name: `${rootName}_Light`,
        color: options.palette ? options.palette.body.clone() : Color.fromTemperature(temperatureK),
        intensity: data.lightIntensity,
        distance: data.lightDistance,
        decay: 2,
      });
      light.position.set(0, this.height * 0.5, 0);
      this.root.add(light);
      this.light = light;
    }
    this.lightBehavior = new FireLightBehavior({
      seed: this.seed * 1.31 + 1,
      jitter: data.jitter,
      // Palette fire keeps its own light colour; blackbody fire cools as it dims. An explicitly
      // injected scene light with `preserveLightColor` keeps its authored colour, too.
      temperatureK: options.palette || options.preserveLightColor ? undefined : temperatureK,
    });
    this.light.addBehavior(this.lightBehavior);
    // update() advances the light with the app's time scale instead; never the engine loop.
    this.lightBehavior.isActive = false;

    // --- world-anchored particle trails (meshes are added by the consumer to the scene root) ---
    if (data.embers) {
      this.embers = new FireEmberEmitter({
        name: `${rootName}_Embers`,
        seed: this.seed,
        rate: clamp(2, 24, this.height * 26 * 0.9),
        capacity: clamp(3, 24, Math.round(this.height * 26)),
        lifeRange: [0.4, Math.min(1.6, 0.4 + this.height * 1.4)],
        speedRange: [0.3, Math.min(2.4, 0.3 + this.height * 2.4)],
        sizeRange: [this.width * 0.05, this.width * 0.13],
        spawnRadius: Math.max(0.015, this.width * 0.18),
      });
    }
    if (data.smoke) {
      this.smoke = new FireSmokeEmitter({
        name: `${rootName}_Smoke`,
        seed: this.seed * 3.11 + 7,
        rate: clamp(1, 10, this.height * 11),
        capacity: clamp(3, 14, Math.round(this.height * 16)),
        lifeRange: [0.8, Math.min(2.4, 0.8 + this.height * 1.8)],
        speedRange: [0.3, Math.min(0.8, 0.3 + this.height * 0.6)],
        sizeRange: [this.width * 0.16, this.width * 0.32],
        spawnRadius: Math.max(0.02, this.width * 0.22),
        growthRate: 0.45,
        maxScale: Math.max(0.5, Math.min(2.4, this.height * 2.6)),
      });
    }

    // --- glowing fuel bed (ground-fixed; a moving fire leaves its bed behind) ---
    if (data.emberBed) {
      this.emberBed = new EmberBed({
        name: `${rootName}_EmberBed`,
        position: new Vector3D(
          this.root.position.x,
          this.root.position.y - 0.03,
          this.root.position.z,
        ),
        radius: Math.max(0.05, this.width * 0.72),
        height: Math.max(0.03, this.height * 0.05),
        emissiveIntensity: clamp(1, 2.2, this.height * 2.4),
        breathStrength: 0.2,
        seed: this.seed * 1.73 + 3,
      });
    }

    // --- soot / ash decal (consumer adds it to the scene and handles the WEB_GL1 bake) ---
    if (data.soot && data.emberBed) {
      const sootTexture = createSootDecalTexture();
      if (sootTexture) {
        const soot = new Decal(
          new DecalMaterial({ unlit: true, diffuseMap: sootTexture }),
          `${rootName}_Soot`,
        );
        soot.position.set(this.root.position.x, this.root.position.y + 0.02, this.root.position.z);
        // Scaled from the fire silhouette, not a fixed campfire-only size.
        soot.scale.set(this.width * 3.2, Math.max(0.15, this.width * 0.8), this.width * 3.2);
        this.soot = soot;
      }
    }

    // A moving flame (carried torch) has no stale AABB to cull against.
    this._flameObject.frustumCulled = false;
  }

  /**
   * Advances the whole fire by one frame. `dt = 0` freezes every layer (capture/pause support).
   * The flame always breathes with the light; the light itself is advanced unconditionally so a
   * hidden light still feeds a live flame envelope (`lightEnabled` only gates visibility).
   *
   * When `cameraPosition` is undefined the world-anchored `embers`/`smoke` are left to the
   * consumer (e.g. a carried torch whose game camera the rig does not see). When it is provided,
   * their spawn anchors are derived from the LIVE world position of `root`, so a moving fire
   * spawns particles at its current position and leaves them behind.
   *
   * @param deltaTime Seconds to advance; scale it with the app's pause/time-scale.
   * @param cameraPosition World camera position (spherical billboard facing), optional.
   * @param wind Optional world-space wind vector in m/s; tilts the smoke plume.
   * @param lean Optional world-space tip lean to impose THIS frame (e.g. derived from parent
   *   velocity). When omitted, the fire's own `flame.lean` is left untouched.
   */
  public update(
    deltaTime: number,
    cameraPosition?: Readonly<Vector3D>,
    wind?: Readonly<Vector3D>,
    lean?: Readonly<Vector3D>,
  ): void {
    // Advance the light first so the flame/glow envelope reads this frame's flicker value.
    this.lightBehavior.time += deltaTime;
    this.lightBehavior.apply();
    const value = this.lightBehavior.value;

    // Flame and glow writes are unconditional — the layer switches only gate visibility (instant
    // A/B), exactly like showcase 45.
    this._time += deltaTime;
    this.flame.time = this._time;
    this.flame.intensity = this.flameIntensity * (0.8 + 0.2 * value);
    if (lean) {
      this.flame.lean.copyFrom(lean);
    }
    this.glow.intensity = this.glowIntensity * (0.6 + 0.4 * value);

    this.emberBed?.update(deltaTime);

    if (cameraPosition && (this.embers || this.smoke)) {
      // World matrices may be stale (moving root, headless tests, pre-render update pass) — refresh
      // before deriving the world anchor; a no-op for untouched static roots.
      this.root.updateMatrixWorld();
      this.root.getWorldPosition(this._scratchBase);
      if (this.embers && this.embersEnabled) {
        this._scratchAnchor.set(
          this._scratchBase.x,
          this._scratchBase.y + this.height * 0.2,
          this._scratchBase.z,
        );
        this.embers.update(deltaTime, this._scratchAnchor, cameraPosition);
      }
      if (this.smoke && this.smokeEnabled) {
        this._scratchAnchor.set(
          this._scratchBase.x,
          this._scratchBase.y + this.height * 0.8,
          this._scratchBase.z,
        );
        this.smoke.update(deltaTime, this._scratchAnchor, cameraPosition, wind);
      }
    }
  }

  /**
   * Switches one layer off (hides it for instant Vorher/Nachher switches instead of waiting out
   * live particles) or back on. Individual layers stay reachable for finer control.
   */
  public setLayerEnabled(layer: FireLayer, enabled: boolean): void {
    switch (layer) {
      case "flame":
        this.flameEnabled = enabled;
        this._flameObject.isVisible = enabled;
        break;
      case "glow":
        this.glowEnabled = enabled;
        this._glowObject.isVisible = enabled;
        break;
      case "light":
        this.lightEnabled = enabled;
        this.light.isVisible = enabled;
        break;
      case "embers":
        this.embersEnabled = enabled;
        if (this.embers) {
          this.embers.enabled = enabled;
          this.embers.mesh.isVisible = enabled;
        }
        break;
      case "smoke":
        this.smokeEnabled = enabled;
        if (this.smoke) {
          this.smoke.enabled = enabled;
          this.smoke.mesh.isVisible = enabled;
        }
        break;
      case "emberBed":
        this.emberBedEnabled = enabled;
        if (this.emberBed) {
          this.emberBed.enabled = enabled;
          this.emberBed.mesh.isVisible = enabled;
        }
        break;
      case "soot":
        this.sootEnabled = enabled;
        if (this.soot) {
          this.soot.isVisible = enabled;
        }
        break;
    }
  }

  /** Removes every part from its parent. Safe to call twice. */
  public dispose(): void {
    this.root.parent?.remove(this.root);
    this.embers?.dispose();
    this.smoke?.dispose();
    this.emberBed?.dispose();
    if (this.soot) {
      this.soot.parent?.remove(this.soot);
    }
  }

  private _seedFromName(name: string | undefined): number {
    if (!name) return 0;
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = (hash * 31 + name.charCodeAt(i)) | 0;
    }
    return hash >>> 0;
  }
}

function clamp(min: number, max: number, value: number): number {
  return Math.min(max, Math.max(min, value));
}
