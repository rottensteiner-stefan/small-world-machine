import type { BloomElement } from "@small-world-machine/engine";
import {
  AbstractShowcase,
  AmbientLight,
  Color,
  Cube,
  Cylinder,
  FlickerBehavior,
  Object3D,
  Plane,
  PointLight,
  PostProcessingEffectType,
  StandardMaterial,
  Vector3D,
} from "@small-world-machine/engine";
import type { FlamePalette } from "@small-world-machine/vfx-extras";
import {
  FireMaterial,
  FlameGlowMaterial,
  FlamePalettes,
  createFlameCardGeometry,
} from "@small-world-machine/vfx-extras";

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
}

/**
 * Showcase 45: Fire VFX lab. Procedural crossed-card flames (FireMaterial) with a billboard glow
 * (FlameGlowMaterial) and a flickering point light: blackbody torch, spectral and wisp torches, a
 * small campfire and a candle, at night against a stone wall.
 */
export class Showcase45 extends AbstractShowcase {
  private readonly _fireMaterials: FireMaterial[] = [];
  private _time: number = 0;

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

    const stone = new StandardMaterial({ color: new Color(0.42, 0.4, 0.37), roughness: 0.9 });
    const wood = new StandardMaterial({ color: new Color(0.25, 0.16, 0.1), roughness: 0.85 });

    this._addBox("Ground", stone, new Vector3D(0, -0.05, 0), new Vector3D(14, 0.1, 10));
    this._addBox("Wall", stone, new Vector3D(0, 1.75, -1.6), new Vector3D(10, 3.5, 0.4));

    const torchX = [-2.6, 0, 2.6];
    const palettes: Array<FlamePalette | undefined> = [
      undefined,
      FlamePalettes.SPECTRAL,
      FlamePalettes.WISP,
    ];
    for (let i = 0; i < torchX.length; i++) {
      const x = torchX[i]!;
      this._addCylinder(`TorchShaft${i}`, wood, new Vector3D(x, 1.55, -1.25), 0.035, 0.6);
      this._addFlame({
        name: `Torch${i}`,
        position: new Vector3D(x, 1.86, -1.25),
        cards: 2,
        width: 0.15,
        height: 0.45,
        palette: palettes[i],
        lightIntensity: 3,
        lightDistance: 8,
        glowSize: 0.9,
      });
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
    });
  }

  protected override update(deltaTime: number): void {
    this._time += deltaTime;
    for (let i = 0; i < this._fireMaterials.length; i++) {
      this._fireMaterials[i]!.time = this._time;
    }
  }

  private _addFlame(spec: FlameSpec): void {
    const fire = new FireMaterial({
      palette: spec.palette,
      seed: this._fireMaterials.length * 7.31,
      turbulence: spec.cards > 2 ? 1.3 : 1,
    });
    this._fireMaterials.push(fire);

    const flame = new Object3D(`${spec.name}_Flame`);
    flame.geometry = createFlameCardGeometry(spec).getGeometryData();
    flame.material = fire;
    flame.position.copyFrom(spec.position);
    this.scene.add(flame);

    const glowColor = spec.palette?.body;
    const glowMat = new FlameGlowMaterial(glowColor ? { tint: glowColor } : {});
    const glow = new Object3D(`${spec.name}_Glow`);
    glow.geometry = new Plane().getGeometryData();
    glow.material = glowMat;
    glow.scale.set(spec.glowSize, spec.glowSize, spec.glowSize);
    glow.position.set(spec.position.x, spec.position.y + spec.height * 0.4, spec.position.z);
    this.scene.add(glow);

    const light = new PointLight({
      name: `${spec.name}_Light`,
      color: glowColor ?? Color.fromTemperature(2000),
      intensity: spec.lightIntensity,
      distance: spec.lightDistance,
      decay: 2,
    });
    light.position.set(spec.position.x, spec.position.y + spec.height * 0.5, spec.position.z);
    this.scene.add(light);

    // Interim flicker until FireLightBehavior (plan P2) replaces it.
    const baseIntensity = spec.lightIntensity;
    const baseGlow = glowMat.intensity;
    flame.addBehavior(
      new FlickerBehavior({
        minStableTime: 0.05,
        maxStableTime: 0.3,
        minFlickerTime: 0.5,
        maxFlickerTime: 2,
        minMultiplier: 0.6,
        smoothness: 0.6,
        frequency: 12,
        noiseOffset: this._fireMaterials.length * 1000,
        onUpdate: (multiplier: number): void => {
          light.intensity = baseIntensity * multiplier;
          glowMat.intensity = baseGlow * (0.7 + 0.3 * multiplier);
        },
      }),
    );
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
