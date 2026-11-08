import {
  AbstractShowcase,
  AmbientLight,
  Color,
  DirectionalLight,
  Fog,
  FogMode,
  GltfLoader,
  GltfMaterialParser,
  Ground,
  MathUtils,
  mulberry32,
  Object3D,
  RendererType,
  StandardMaterial,
  Vector3D,
} from "@small-world-machine/engine";
import type {
  EngineOptions,
  GeometryDataInterface,
  AbstractMaterial,
} from "@small-world-machine/engine";
import { applyFoliageLook, FOLIAGE_LOOKS } from "@small-world-machine/vegetation-extras";
import type { FoliageLook } from "@small-world-machine/vegetation-extras";
import { Hud, LOOK_KEYS, SUN_KEYS } from "./Hud.js";
import type { LookKey, LookLabState, SunKey } from "./Hud.js";

/** One mesh-bearing node of a loaded prop, shared by every placed copy (auto-instancing runs). */
interface PropPart {
  geometry: GeometryDataInterface;
  material: AbstractMaterial;
  offset: Vector3D;
}

interface Prop {
  parts: PropPart[];
  /** Uniform scale that maps the source model to its target height. */
  baseScale: number;
}

interface Placement {
  prop: Prop;
  x: number;
  z: number;
  yaw: number;
  scale: number;
}

interface SunSituation {
  direction: Vector3D;
  sunColor: Color;
  sunIntensity: number;
  ambientColor: Color;
  ambientIntensity: number;
  sky: Color;
  fogNear: number;
  fogFar: number;
}

interface QaSwm52Hook {
  sample(): { look: LookKey; sun: SunKey; abReference: boolean; objects: number; renderer: string };
  setLook(look: LookKey): void;
  setSun(sun: SunKey): void;
  setReference(on: boolean): void;
  /** Live tuning: applies the current preset overridden by `patch` (not persisted). */
  tune(patch: Partial<FoliageLook>): void;
}

declare global {
  interface Window {
    __qaSwm52?: QaSwm52Hook;
  }
}

/** Assets are shared with showcase 51 (Kenney CC0, see its `assets/README.md`); not duplicated. */
const ASSET_BASE = "../51/assets/";
const SEED = 52;
const MEADOW_RADIUS = 26;
const FOREST_RADIUS = 95;
const TREE_COUNT = 650;
const GRASS_COUNT = 2600;
const FLOWER_COUNT = 520;
const FLOOR_DEBRIS_COUNT = 420;

/** Target heights in metres; Kenney models are unit-sized, so they are rescaled on load. */
const PROPS: Record<string, number> = {
  "tree_pineTallA.glb": 15,
  "tree_oak.glb": 10,
  "tree_detailed.glb": 9,
  "grass.glb": 0.45,
  "grass_large.glb": 0.7,
  "grass_leafs.glb": 0.35,
  "flower_yellowA.glb": 0.45,
  "flower_redA.glb": 0.45,
  "flower_purpleA.glb": 0.45,
  "log.glb": 0.5,
  "mushroom_red.glb": 0.18,
  "rock_smallA.glb": 0.35,
};

/**
 * The Kenney palette is stylized (teal leaves, salmon bark); a look can only be judged on
 * plausible albedo, so the lab swaps the palette entries (keyed by the glTF-linear
 * `baseColorFactor`; the loader keeps no material names) for measured-foliage sRGB ballparks.
 */
const REALISTIC_ALBEDO: Record<string, readonly [number, number, number]> = {
  "0.17,0.85,0.72": [0.3, 0.42, 0.13], // grass
  "0.16,0.79,0.67": [0.26, 0.38, 0.11], // leafsGreen
  "0.17,0.65,0.67": [0.14, 0.24, 0.11], // leafsDark
  "0.89,0.51,0.34": [0.32, 0.24, 0.17], // woodBark / dirt
  "0.80,0.46,0.37": [0.24, 0.19, 0.14], // woodBarkDark
};

const paletteKey = (c: Color): string =>
  [c.r, c.g, c.b].map((v) => GltfMaterialParser.engineSRGBToLinear(v).toFixed(2)).join(",");

const SUNS: Record<SunKey, SunSituation> = {
  noon: {
    direction: new Vector3D(-0.35, -1, -0.3).normalize(),
    sunColor: new Color(1, 0.97, 0.9),
    sunIntensity: 2.6,
    ambientColor: new Color(0.56, 0.64, 0.74),
    ambientIntensity: 0.55,
    sky: new Color(0.46, 0.64, 0.88),
    fogNear: 120,
    fogFar: 340,
  },
  backlight: {
    direction: new Vector3D(0.2, -0.32, 1).normalize(),
    sunColor: new Color(1, 0.84, 0.62),
    sunIntensity: 2.3,
    ambientColor: new Color(0.5, 0.56, 0.68),
    ambientIntensity: 0.45,
    sky: new Color(0.62, 0.66, 0.74),
    fogNear: 90,
    fogFar: 300,
  },
  overcast: {
    direction: new Vector3D(0.15, -1, 0.1).normalize(),
    sunColor: new Color(0.85, 0.87, 0.9),
    sunIntensity: 0.55,
    ambientColor: new Color(0.74, 0.77, 0.8),
    ambientIntensity: 1.05,
    sky: new Color(0.68, 0.7, 0.73),
    fogNear: 60,
    fogFar: 240,
  },
};

const CAMERA_POSITION = new Vector3D(0, 1.7, 22);
const CAMERA_TARGET = new Vector3D(0, 4, -30);

/**
 * Showcase 52 — Foliage Look Lab.
 *
 * Meadow ringed by forest (Kenney CC0 props from showcase 51) under three sun situations, viewed
 * through the `FOLIAGE_LOOKS` presets of `@small-world-machine/vegetation-extras`. `B` flips to the
 * neutral engine default as A/B reference so every preset is judged against the same frame.
 */
export class Showcase extends AbstractShowcase {
  private _hud?: Hud;
  private _sun?: DirectionalLight;
  private _ambient?: AmbientLight;
  private _look: LookKey = "SUNNY_MEADOW";
  private _sunKey: SunKey = "noon";
  private _abReference: boolean = false;
  private _objects: number = 0;

  constructor(options: EngineOptions = {}) {
    super({
      fullscreen: true,
      rendererType: RendererType.BEST,
      postProcessing: { enabled: true },
      quality: { maxPixelRatio: 1.5 },
      ...options,
    });
    this.defaultCameraController = "orbit";
    this.defaultFov = MathUtils.degToRad(55);
    this.defaultFar = 600;
  }

  protected override async setupScene(): Promise<void> {
    this.configureCamera();
    this.setInitialCamera(CAMERA_POSITION.clone(), CAMERA_TARGET.clone());

    this._ambient = new AmbientLight({ color: new Color(1, 1, 1), intensity: 0.5 });
    this.scene.add(this._ambient);
    this._sun = new DirectionalLight({
      direction: new Vector3D(0, -1, 0),
      color: new Color(1, 1, 1),
      intensity: 1,
      numCascades: 3,
      cascadeSplitLambda: 0.6,
    });
    this._sun.castShadow = true;
    this._sun.shadowBias = 0.002;
    this._sun.shadowResolution = 2048;
    this.scene.add(this._sun);
    this.scene.fog = new Fog({
      mode: FogMode.LINEAR,
      color: new Color(1, 1, 1),
      near: 100,
      far: 300,
    });

    const ground = new Object3D("Meadow");
    ground.geometry = new Ground({ width: 400, depth: 400 }).getGeometryData();
    ground.material = new StandardMaterial({
      color: new Color(0.2, 0.3, 0.13),
      roughness: 0.95,
      metallic: 0,
    });
    ground.receiveShadow = true;
    this.scene.add(ground);

    await this._buildVegetation();
    this._applySun();
    this._applyLook();
    this._installQaHook();
    this._createHud();
  }

  public override destroy(): void {
    this._hud?.dispose();
    delete window.__qaSwm52;
    super.destroy();
  }

  protected override onKeyDown(event: KeyboardEvent): void {
    super.onKeyDown(event);
    if (event.altKey || event.metaKey || event.ctrlKey) return;
    if (this._hud?.handleKey(event)) return;
    const index = Number(event.key) - 1;
    if (Number.isInteger(index) && index >= 0 && index < LOOK_KEYS.length) {
      this._setLook(LOOK_KEYS[index]!);
      return;
    }
    switch (event.code) {
      case "KeyB":
        this._setReference(!this._abReference);
        break;
      case "KeyL":
        this._setSun(SUN_KEYS[(SUN_KEYS.indexOf(this._sunKey) + 1) % SUN_KEYS.length]!);
        break;
      case "KeyR":
        this.resetCamera();
        break;
    }
  }

  private _setLook(look: LookKey): void {
    this._look = look;
    this._abReference = false;
    this._applyLook();
  }

  private _setReference(on: boolean): void {
    this._abReference = on;
    this._applyLook();
  }

  private _setSun(sun: SunKey): void {
    this._sunKey = sun;
    this._applySun();
    this._syncHud();
  }

  private _applyLook(): void {
    const look = this._abReference ? FOLIAGE_LOOKS.NEUTRAL : FOLIAGE_LOOKS[this._look];
    applyFoliageLook(this.renderer.postProcessing, look);
    this._syncHud();
  }

  private _applySun(): void {
    const s = SUNS[this._sunKey];
    if (this._sun) {
      this._sun.direction.copyFrom(s.direction);
      this._sun.color.copyFrom(s.sunColor);
      this._sun.intensity = s.sunIntensity;
    }
    if (this._ambient) {
      this._ambient.color.copyFrom(s.ambientColor);
      this._ambient.intensity = s.ambientIntensity;
    }
    this.renderer.setClearColor(s.sky);
    if (this.scene.fog) {
      this.scene.fog.color.copyFrom(s.sky);
      this.scene.fog.near = s.fogNear;
      this.scene.fog.far = s.fogFar;
    }
  }

  private _syncHud(): void {
    if (!this._hud) return;
    this._hud.sync(this._state());
    const look = this._abReference ? FOLIAGE_LOOKS.NEUTRAL : FOLIAGE_LOOKS[this._look];
    this._hud.setReadout(
      `Look:       ${look.name}${this._abReference ? "  (A/B reference)" : ""}\n` +
        `Exposure:   ${look.exposure.toFixed(2)}\n` +
        `Contrast:   ${look.contrast.toFixed(2)}   Saturation: ${look.saturation.toFixed(2)}\n` +
        `Temp/Tint:  ${look.temperature.toFixed(2)} / ${look.tint.toFixed(2)}\n` +
        `Sun:        ${this._sunKey}\n` +
        `Objects:    ${this._objects}   Renderer: ${this.renderer.type}`,
    );
  }

  private _state(): LookLabState {
    return { look: this._look, sun: this._sunKey, abReference: this._abReference };
  }

  private async _buildVegetation(): Promise<void> {
    const loader = new GltfLoader({ basePath: ASSET_BASE });
    const props = new Map<string, Prop>();
    for (const [file, height] of Object.entries(PROPS)) {
      try {
        props.set(file, this._toProp(await loader.load(file), height));
      } catch (error) {
        console.warn(`[Showcase52] ${file} unavailable:`, error);
      }
    }
    const pick = (files: readonly string[], r: number): Prop | undefined =>
      props.get(files[Math.floor(r * files.length)]!);

    const rng = mulberry32(SEED);
    const placements: Placement[] = [];
    const scatter = (
      count: number,
      files: readonly string[],
      minRadius: number,
      maxRadius: number,
      scaleJitter: number,
    ): void => {
      for (let i = 0; i < count; i++) {
        const prop = pick(files, rng());
        const angle = rng() * Math.PI * 2;
        const radius = Math.sqrt(
          MathUtils.lerp(minRadius * minRadius, maxRadius * maxRadius, rng()),
        );
        if (!prop) continue;
        placements.push({
          prop,
          x: Math.cos(angle) * radius,
          z: Math.sin(angle) * radius,
          yaw: rng() * Math.PI * 2,
          scale: 1 + (rng() * 2 - 1) * scaleJitter,
        });
      }
    };
    scatter(
      TREE_COUNT,
      ["tree_pineTallA.glb", "tree_oak.glb", "tree_detailed.glb"],
      MEADOW_RADIUS,
      FOREST_RADIUS,
      0.25,
    );
    scatter(
      GRASS_COUNT,
      ["grass.glb", "grass_large.glb", "grass_leafs.glb"],
      0,
      FOREST_RADIUS * 0.6,
      0.3,
    );
    scatter(
      FLOWER_COUNT,
      ["flower_yellowA.glb", "flower_redA.glb", "flower_purpleA.glb"],
      0,
      MEADOW_RADIUS,
      0.25,
    );
    scatter(
      FLOOR_DEBRIS_COUNT,
      ["log.glb", "mushroom_red.glb", "rock_smallA.glb", "grass_leafs.glb"],
      MEADOW_RADIUS * 0.8,
      FOREST_RADIUS * 0.7,
      0.3,
    );

    // Part-major order keeps identical geometry/material consecutive (ADR 0046 auto-instancing).
    for (const prop of props.values()) {
      for (const part of prop.parts) {
        for (const p of placements) {
          if (p.prop !== prop) continue;
          const node = new Object3D();
          const s = prop.baseScale * p.scale;
          node.geometry = part.geometry;
          node.material = part.material;
          node.position.set(p.x + part.offset.x * s, part.offset.y * s, p.z + part.offset.z * s);
          node.rotation.set(0, p.yaw, 0);
          node.scale.set(s, s, s);
          node.castShadow = true;
          node.receiveShadow = true;
          this.scene.add(node);
          this._objects++;
        }
      }
    }
  }

  /** Flattens a loaded model into shared parts and derives the scale for the target height. */
  private _toProp(root: Object3D, targetHeight: number): Prop {
    root.updateMatrixWorld(true);
    const origin = root.getWorldPosition().clone();
    const parts: PropPart[] = [];
    let minY = Infinity;
    let maxY = -Infinity;
    root.traverse((node) => {
      if (!node.geometry || !node.material) return;
      const offset = node.getWorldPosition(new Vector3D()).sub(origin);
      const albedo =
        node.material instanceof StandardMaterial
          ? REALISTIC_ALBEDO[paletteKey(node.material.color)]
          : undefined;
      if (albedo !== undefined && node.material instanceof StandardMaterial) {
        node.material.color.set(albedo[0], albedo[1], albedo[2]);
      }
      parts.push({ geometry: node.geometry, material: node.material, offset });
      const v = node.geometry.vertices;
      for (let i = 1; i < v.length; i += 3) {
        minY = Math.min(minY, v[i]! + offset.y);
        maxY = Math.max(maxY, v[i]! + offset.y);
      }
    });
    const height = Math.max(maxY - minY, 1e-3);
    return { parts, baseScale: targetHeight / height };
  }

  private _installQaHook(): void {
    window.__qaSwm52 = {
      sample: (): ReturnType<QaSwm52Hook["sample"]> => ({
        ...this._state(),
        objects: this._objects,
        renderer: String(this.renderer.type),
      }),
      setLook: (look: LookKey): void => this._setLook(look),
      setSun: (sun: SunKey): void => this._setSun(sun),
      setReference: (on: boolean): void => this._setReference(on),
      tune: (patch: Partial<FoliageLook>): void =>
        applyFoliageLook(this.renderer.postProcessing, { ...FOLIAGE_LOOKS[this._look], ...patch }),
    };
  }

  private _createHud(): void {
    this._hud = new Hud(this, {
      setLook: (look: LookKey): void => this._setLook(look),
      setSun: (sun: SunKey): void => this._setSun(sun),
      toggleReference: (): void => this._setReference(!this._abReference),
      resetView: (): void => this.resetCamera(),
    });
    this._syncHud();
  }
}

const app = new Showcase();
app.start().catch((err: unknown) => console.error("[Showcase52] Failed to start:", err));
