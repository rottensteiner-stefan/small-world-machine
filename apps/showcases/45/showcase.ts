import type { BloomElement } from "@small-world-machine/engine";
import {
  AbstractShowcase,
  AmbientLight,
  Color,
  Cube,
  Cylinder,
  Object3D,
  Plane,
  PointLight,
  PostProcessingEffectType,
  StandardMaterial,
  Texture,
  TextureWrap,
  Vector3D,
} from "@small-world-machine/engine";
import type { FlamePalette } from "@small-world-machine/vfx-extras";
import {
  FireLightBehavior,
  FireLightBudget,
  FireMaterial,
  FlameGlowMaterial,
  FlamePalettes,
  createFlameCardGeometry,
} from "@small-world-machine/vfx-extras";

/** Torch spacing along the long wall; with 19 fires the budget visibly hands lights over. */
const TORCH_ROW_X = [-20, -16, -12, -8, -5, 5, 8, 12, 16, 20];
const BLACKBODY_K = 2000;

interface FlameSpec {
  readonly name: string;
  readonly position: Vector3D;
  readonly cards: number;
  readonly width: number;
  readonly height: number;
  readonly palette?: FlamePalette | undefined;
  readonly lightIntensity: number;
  readonly lightDistance: number;
  readonly glowSize: number;
  readonly jitter: number;
  readonly temperatureK?: number | undefined;
  readonly turbulence?: number | undefined;
  readonly flowSpeed?: number | undefined;
}

/** Per-torch look so the row does not read as clones. */
interface TorchVariation {
  readonly temperatureK: number;
  readonly scale: number;
  readonly turbulence: number;
  readonly flowSpeed: number;
}

const DEFAULT_TORCH: TorchVariation = {
  temperatureK: BLACKBODY_K,
  scale: 1,
  turbulence: 1,
  flowSpeed: 1,
};

/** Deterministic 0..1 per (torch, channel), so golden captures see the same row every run. */
function variation01(index: number, channel: number): number {
  let h = Math.imul(index + 1, 0x9e3779b1) ^ Math.imul(channel + 1, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 15), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function rowTorchVariation(index: number): TorchVariation {
  return {
    temperatureK: 1850 + 350 * variation01(index, 0),
    scale: 0.85 + 0.3 * variation01(index, 1),
    turbulence: 0.8 + 0.45 * variation01(index, 2),
    flowSpeed: 0.85 + 0.35 * variation01(index, 3),
  };
}

/** One fire's parts the frame loop keeps in sync with its light flicker. */
interface FireRig {
  readonly flame: FireMaterial;
  readonly glow: FlameGlowMaterial;
  readonly light: FireLightBehavior;
  readonly flameIntensity: number;
  readonly glowIntensity: number;
}

/**
 * Showcase 45: Fire VFX lab. Procedural crossed-card flames (FireMaterial) with a billboard glow
 * (FlameGlowMaterial) and a FireLightBehavior-driven point light: blackbody, spectral, wisp and cursed
 * torches, a row of wall torches under a FireLightBudget, a small campfire and a candle, at night
 * on ashlar slabs against a masonry wall.
 */
export class Showcase45 extends AbstractShowcase {
  private readonly _fires: FireRig[] = [];
  private readonly _budget: FireLightBudget = new FireLightBudget({ maxActive: 10 });
  private _time: number = 0;

  public override async start(): Promise<void> {
    await super.start();
    // Only after start(): AbstractShowcase installs its fly controller solely on a camera that has
    // no behaviors yet, so attaching the budget earlier silently disables camera movement.
    this.camera.addBehavior(this._budget);
  }

  protected override async setupScene(): Promise<void> {
    this.configureCamera();
    this.setInitialCamera(new Vector3D(0, 1.6, 5.5), new Vector3D(0, 0.9, 0));

    this.renderer.postProcessing.enabled = true;
    const bloom = this.renderer.postProcessing.get<BloomElement>(PostProcessingEffectType.BLOOM);
    if (bloom) {
      bloom.enabled = true;
      bloom.intensity = 0.6;
      bloom.threshold = 0.85;
      bloom.radius = 0.6;
    }

    this.scene.add(new AmbientLight({ color: new Color(0.35, 0.4, 0.6), intensity: 0.08 }));

    const [ashlar, masonry, wood] = await Promise.all([
      this._loadSurface("stone_ashlar", 12, 3.5, 0.85),
      this._loadSurface("carved_masonry", 17, 1.4, 0.8),
      this._loadSurface("torch_wood", 1, 1, 0.8),
    ]);

    this._addBox("Ground", ashlar, new Vector3D(0, -0.05, 0), new Vector3D(48, 0.1, 14));
    this._addBox("Wall", masonry, new Vector3D(0, 1.75, -1.6), new Vector3D(44, 3.5, 0.4));

    for (let i = 0; i < TORCH_ROW_X.length; i++) {
      this._addWallTorch(`RowTorch${i}`, wood, TORCH_ROW_X[i]!, undefined, rowTorchVariation(i));
    }

    const torchX = [-3.3, -1.1, 1.1, 3.3];
    const palettes: Array<FlamePalette | undefined> = [
      undefined,
      FlamePalettes.SPECTRAL,
      FlamePalettes.WISP,
      FlamePalettes.CURSED,
    ];
    for (let i = 0; i < torchX.length; i++) {
      this._addWallTorch(`Torch${i}`, wood, torchX[i]!, palettes[i], DEFAULT_TORCH);
    }

    for (let log = 0; log < 5; log++) {
      const angle = (log / 5) * Math.PI * 2;
      const logObj = this._addCylinder(
        `Log${log}`,
        wood,
        new Vector3D(Math.cos(angle) * 0.18, 0.1, 1.2 + Math.sin(angle) * 0.18),
        0.05,
        0.55,
      );
      logObj.rotation.set(0, -angle, Math.PI / 2 - 0.35);
    }
    this._addFlame({
      name: "Campfire",
      position: new Vector3D(0, 0.08, 1.2),
      cards: 3,
      width: 0.5,
      height: 0.8,
      lightIntensity: 5,
      lightDistance: 14,
      glowSize: 1.8,
      jitter: 0.035,
    });

    this._addCylinder(
      "Candle",
      new StandardMaterial({ color: new Color(0.9, 0.86, 0.75) }),
      new Vector3D(1.6, 0.1, 1.6),
      0.03,
      0.2,
    );
    this._addFlame({
      name: "CandleFlame",
      position: new Vector3D(1.6, 0.2, 1.6),
      cards: 2,
      width: 0.035,
      height: 0.09,
      lightIntensity: 0.4,
      lightDistance: 2,
      glowSize: 0.25,
      jitter: 0.004,
    });
  }

  protected override update(deltaTime: number): void {
    this._time += deltaTime;
    const fires = this._fires;
    for (let i = 0; i < fires.length; i++) {
      const rig = fires[i]!;
      // The flame body breathes with the light, but far less: it is the light that should dance.
      const value = rig.light.value;
      rig.flame.time = this._time;
      rig.flame.intensity = rig.flameIntensity * (0.8 + 0.2 * value);
      rig.glow.intensity = rig.glowIntensity * (0.6 + 0.4 * value);
    }
  }

  private _addWallTorch(
    name: string,
    wood: StandardMaterial,
    x: number,
    palette: FlamePalette | undefined,
    look: TorchVariation,
  ): void {
    this._addCylinder(`${name}_Shaft`, wood, new Vector3D(x, 1.55, -1.25), 0.035, 0.6);
    this._addFlame({
      name,
      position: new Vector3D(x, 1.86, -1.25),
      cards: 2,
      width: 0.15 * look.scale,
      height: 0.45 * look.scale,
      palette,
      lightIntensity: 3 * look.scale,
      lightDistance: 8,
      glowSize: 0.9 * look.scale,
      jitter: 0.015,
      temperatureK: look.temperatureK,
      turbulence: look.turbulence,
      flowSpeed: look.flowSpeed,
    });
  }

  private async _loadSurface(
    name: string,
    repeatX: number,
    repeatY: number,
    roughness: number,
  ): Promise<StandardMaterial> {
    const wrap = { addressModeU: TextureWrap.REPEAT, addressModeV: TextureWrap.REPEAT };
    const [diffuseMap, normalMap, roughnessMap] = await Promise.all([
      Texture.fromUrl(`./assets/${name}_albedo.webp`, wrap),
      Texture.fromUrl(`./assets/${name}_normal.webp`, wrap),
      Texture.fromUrl(`./assets/${name}_roughness.webp`, wrap),
    ]);
    for (const map of [diffuseMap, normalMap, roughnessMap]) {
      map.repeat = { x: repeatX, y: repeatY };
    }
    return new StandardMaterial({ diffuseMap, normalMap, roughnessMap, metallic: 0, roughness });
  }

  private _addFlame(spec: FlameSpec): void {
    const seed = this._fires.length;
    const temperatureK = spec.temperatureK ?? BLACKBODY_K;
    const fire = new FireMaterial({
      palette: spec.palette,
      temperatureK,
      seed: seed * 7.31,
      turbulence: spec.turbulence ?? (spec.cards > 2 ? 1.3 : 1),
      flowSpeed: spec.flowSpeed ?? 1,
    });

    const flame = new Object3D(`${spec.name}_Flame`);
    flame.geometry = createFlameCardGeometry(spec).getGeometryData();
    flame.material = fire;
    flame.position.copyFrom(spec.position);
    this.scene.add(flame);

    const glowColor = spec.palette?.body;
    const glowMat = new FlameGlowMaterial(
      glowColor ? { tint: glowColor } : { temperatureK: temperatureK * 0.95 },
    );
    const glow = new Object3D(`${spec.name}_Glow`);
    glow.geometry = new Plane().getGeometryData();
    glow.material = glowMat;
    glow.scale.set(spec.glowSize, spec.glowSize, spec.glowSize);
    glow.position.set(spec.position.x, spec.position.y + spec.height * 0.4, spec.position.z);
    this.scene.add(glow);

    const light = new PointLight({
      name: `${spec.name}_Light`,
      color: glowColor ?? Color.fromTemperature(temperatureK),
      intensity: spec.lightIntensity,
      distance: spec.lightDistance,
      decay: 2,
    });
    light.position.set(spec.position.x, spec.position.y + spec.height * 0.5, spec.position.z);
    this.scene.add(light);

    const lightBehavior = new FireLightBehavior({
      seed,
      jitter: spec.jitter,
      // Palette fire keeps its own light colour; blackbody fire cools as it dims.
      temperatureK: spec.palette ? undefined : temperatureK,
    });
    light.addBehavior(lightBehavior);
    this._budget.register(lightBehavior);

    this._fires.push({
      flame: fire,
      glow: glowMat,
      light: lightBehavior,
      flameIntensity: fire.intensity,
      glowIntensity: glowMat.intensity,
    });
  }

  private _addBox(name: string, mat: StandardMaterial, pos: Vector3D, size: Vector3D): Object3D {
    const obj = new Object3D(name);
    obj.geometry = new Cube({ size: 1 }).getGeometryData();
    obj.material = mat;
    obj.position.copyFrom(pos);
    obj.scale.copyFrom(size);
    this.scene.add(obj);
    return obj;
  }

  private _addCylinder(
    name: string,
    mat: StandardMaterial,
    pos: Vector3D,
    radius: number,
    height: number,
  ): Object3D {
    const obj = new Object3D(name);
    obj.geometry = new Cylinder({
      radiusTop: radius,
      radiusBottom: radius,
      height,
    }).getGeometryData();
    obj.material = mat;
    obj.position.copyFrom(pos);
    this.scene.add(obj);
    return obj;
  }
}

const app = new Showcase45();
app.start().catch((err: unknown) => console.error("[Showcase45] Failed to start:", err));
