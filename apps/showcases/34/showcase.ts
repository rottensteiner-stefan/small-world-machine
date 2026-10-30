import type { EngineOptions, SpriteMaterial } from "@small-world-machine/engine";
import {
  AbstractShowcase,
  AmbientLight,
  bakeImposter,
  BillboardInstancer,
  CameraStrategyType,
  Color,
  Cylinder,
  DirectionalLight,
  Fog,
  FogMode,
  Ground,
  ImposterSprite,
  Object3D,
  OrbitController,
  RendererType,
  Sphere,
  StandardMaterial,
  Texture,
  Vector3D,
} from "@small-world-machine/engine";
import { attachDevTools } from "@small-world-machine/tools";
import { Hud, type MoodPreset } from "./Hud.js";

/** A simple procedural tree with multiple shape variants:
 * 0 = classic oak/deciduous, 1 = tall slender birch/aspen, 2 = broad rounded canopy.
 * Built fresh for every instance -- shared, mutable geometry/material would be wrong here since bake
 * targets must not be part of the live scene while real comparison trees must be. */
function buildTree(variant = 0): Object3D {
  const trunkMats = [
    new StandardMaterial({ color: new Color(0.32, 0.21, 0.12), roughness: 0.9, metallic: 0.0 }),
    new StandardMaterial({ color: new Color(0.38, 0.26, 0.16), roughness: 0.9, metallic: 0.0 }),
    new StandardMaterial({ color: new Color(0.26, 0.17, 0.1), roughness: 0.95, metallic: 0.0 }),
  ];
  const leafMats = [
    new StandardMaterial({ color: new Color(0.15, 0.4, 0.14), roughness: 0.85, metallic: 0.0 }),
    new StandardMaterial({ color: new Color(0.18, 0.45, 0.16), roughness: 0.85, metallic: 0.0 }),
    new StandardMaterial({ color: new Color(0.12, 0.35, 0.12), roughness: 0.85, metallic: 0.0 }),
  ];

  const tree = new Object3D(`Tree_Archetype_${variant}`);

  if (variant === 1) {
    // Taller, slender tree
    const trunk = new Object3D("Trunk");
    trunk.geometry = new Cylinder({
      radiusTop: 0.11,
      radiusBottom: 0.18,
      height: 2.8,
      radialSegments: 8,
    }).getGeometryData();
    trunk.position.y = 1.4;
    trunk.material = trunkMats[1]!;
    trunk.castShadow = true;
    trunk.receiveShadow = true;
    tree.add(trunk);

    const foliageSpecs = [
      { r: 0.9, y: 2.9, x: -0.2, z: 0.1 },
      { r: 0.95, y: 3.5, x: 0.2, z: -0.15 },
      { r: 0.75, y: 4.1, x: 0.0, z: 0.1 },
    ];
    for (let i = 0; i < foliageSpecs.length; i++) {
      const f = foliageSpecs[i]!;
      const foliage = new Object3D(`Foliage_${i}`);
      foliage.geometry = new Sphere({
        radius: f.r,
        widthSegments: 10,
        heightSegments: 8,
      }).getGeometryData();
      foliage.position.set(f.x, f.y, f.z);
      foliage.material = leafMats[1]!;
      foliage.castShadow = true;
      tree.add(foliage);
    }
  } else if (variant === 2) {
    // Broader, rounder canopy tree
    const trunk = new Object3D("Trunk");
    trunk.geometry = new Cylinder({
      radiusTop: 0.16,
      radiusBottom: 0.25,
      height: 1.9,
      radialSegments: 8,
    }).getGeometryData();
    trunk.position.y = 0.95;
    trunk.material = trunkMats[2]!;
    trunk.castShadow = true;
    trunk.receiveShadow = true;
    tree.add(trunk);

    const foliageSpecs = [
      { r: 1.15, y: 2.2, x: -0.3, z: 0.2 },
      { r: 1.2, y: 2.7, x: 0.35, z: -0.2 },
      { r: 0.95, y: 3.3, x: 0.0, z: 0.1 },
    ];
    for (let i = 0; i < foliageSpecs.length; i++) {
      const f = foliageSpecs[i]!;
      const foliage = new Object3D(`Foliage_${i}`);
      foliage.geometry = new Sphere({
        radius: f.r,
        widthSegments: 10,
        heightSegments: 8,
      }).getGeometryData();
      foliage.position.set(f.x, f.y, f.z);
      foliage.material = leafMats[2]!;
      foliage.castShadow = true;
      tree.add(foliage);
    }
  } else {
    // Variant 0: Classic deciduous tree
    const trunk = new Object3D("Trunk");
    trunk.geometry = new Cylinder({
      radiusTop: 0.14,
      radiusBottom: 0.22,
      height: 2.2,
      radialSegments: 8,
    }).getGeometryData();
    trunk.position.y = 1.1;
    trunk.material = trunkMats[0]!;
    trunk.castShadow = true;
    trunk.receiveShadow = true;
    tree.add(trunk);

    for (let i = 0; i < 3; i++) {
      const foliage = new Object3D(`Foliage_${i}`);
      foliage.geometry = new Sphere({
        radius: 1.05 - i * 0.15,
        widthSegments: 10,
        heightSegments: 8,
      }).getGeometryData();
      foliage.position.set((i - 1) * 0.3, 2.5 + i * 0.5, (i - 1) * 0.2);
      foliage.material = leafMats[0]!;
      foliage.castShadow = true;
      tree.add(foliage);
    }
  }

  return tree;
}

/** Seeded PRNG for reproducible layouts and golden tests. */
function mulberry32(seed: number): () => number {
  return function (): number {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface TreePlacement {
  pos: [number, number];
  scale: [number, number];
  variant: number;
}

/** Generates up to `totalCount` tree positions within the 40x40 glade, preserving the original
 * 5 billboard trees at indices 0..4 and filling the flanks and deep backdrop with minimum clearance. */
function generateTreePlacements(totalCount: number, rng: () => number): TreePlacement[] {
  const original: TreePlacement[] = [
    { pos: [-4, -11], scale: [2.5, 3.3], variant: 0 },
    { pos: [-1, -13], scale: [2.7, 3.5], variant: 0 },
    { pos: [2, -11.5], scale: [2.4, 3.1], variant: 0 },
    { pos: [4.5, -12], scale: [2.8, 3.6], variant: 0 },
    { pos: [0, -14], scale: [2.6, 3.4], variant: 0 },
  ];

  const result: TreePlacement[] = [...original];
  const occupied: Array<[number, number]> = [
    ...original.map((t) => t.pos),
    [-2.2, -3], // real comparison tree 1
    [2.6, -4.5], // real comparison tree 2
  ];

  let attempts = 0;
  while (result.length < totalCount && attempts < 2000) {
    attempts++;
    const region = rng();
    let x: number;
    let z: number;

    if (region < 0.42) {
      // Left flank
      x = -5.5 - rng() * 12.5; // -5.5 to -18.0
      z = -18.0 + rng() * 19.5; // -18.0 to 1.5
    } else if (region < 0.84) {
      // Right flank
      x = 5.5 + rng() * 12.5; // 5.5 to 18.0
      z = -18.0 + rng() * 19.5; // -18.0 to 1.5
    } else {
      // Back center
      x = -5.0 + rng() * 10.0; // -5.0 to 5.0
      z = -12.5 - rng() * 5.8; // -12.5 to -18.3
    }

    // Min distance check to prevent trunk overlapping
    let tooClose = false;
    for (const [ox, oz] of occupied) {
      const dx = x - ox;
      const dz = z - oz;
      if (dx * dx + dz * dz < 1.6 * 1.6) {
        tooClose = true;
        break;
      }
    }
    if (tooClose) continue;

    const width = 2.3 + rng() * 0.9; // 2.3 .. 3.2
    const height = 3.0 + rng() * 1.2; // 3.0 .. 4.2
    const variant = Math.floor(rng() * 3);

    result.push({ pos: [x, z], scale: [width, height], variant });
    occupied.push([x, z]);
  }

  return result;
}

interface CameraPreset {
  name: string;
  position: Vector3D;
  target: Vector3D;
}

const CAMERA_PRESETS: readonly CameraPreset[] = [
  {
    name: "Lichtung",
    position: new Vector3D(0, 2.2, 8),
    target: new Vector3D(0, 1.5, -10),
  },
  {
    name: "3D vs Billboard",
    position: new Vector3D(-0.6, 1.8, -1.2),
    target: new Vector3D(-2.2, 1.8, -6.5),
  },
  {
    name: "Vogelperspektive",
    position: new Vector3D(0, 16, 6),
    target: new Vector3D(0, 0, -8),
  },
  {
    name: "Im Dickicht",
    position: new Vector3D(-7.5, 1.8, -9.0),
    target: new Vector3D(3.0, 1.8, -11.0),
  },
];

interface MoodConfig {
  clearColor: Color;
  fogColor: Color;
  sunColor: Color;
  sunIntensity: number;
  ambientColor: Color;
  ambientIntensity: number;
  spriteTint: Color;
}

const MOOD_CONFIGS: Record<MoodPreset, MoodConfig> = {
  day: {
    clearColor: new Color(0.55, 0.72, 0.85),
    fogColor: new Color(0.6, 0.76, 0.9),
    sunColor: new Color(1.0, 0.991, 0.953),
    sunIntensity: 1.6,
    ambientColor: new Color(0.621, 0.659, 0.596),
    ambientIntensity: 0.6,
    spriteTint: Color.WHITE,
  },
  golden: {
    clearColor: new Color(0.85, 0.6, 0.42),
    fogColor: new Color(0.82, 0.58, 0.4),
    sunColor: new Color(1.0, 0.62, 0.3),
    sunIntensity: 1.9,
    ambientColor: new Color(0.65, 0.48, 0.38),
    ambientIntensity: 0.55,
    spriteTint: new Color(1.05, 0.95, 0.88),
  },
  foggy: {
    clearColor: new Color(0.7, 0.76, 0.8),
    fogColor: new Color(0.72, 0.78, 0.82),
    sunColor: new Color(0.92, 0.94, 0.96),
    sunIntensity: 1.0,
    ambientColor: new Color(0.62, 0.66, 0.72),
    ambientIntensity: 0.7,
    spriteTint: new Color(0.95, 0.98, 1.0),
  },
  dusk: {
    clearColor: new Color(0.12, 0.16, 0.28),
    fogColor: new Color(0.14, 0.18, 0.3),
    sunColor: new Color(0.4, 0.52, 0.8),
    sunIntensity: 0.9,
    ambientColor: new Color(0.22, 0.26, 0.38),
    ambientIntensity: 0.45,
    spriteTint: new Color(0.7, 0.75, 0.9),
  },
};

/**
 * Showcase 34: "Billboard Grove"
 *
 * A forest glade demonstrating AAA research item #15 (Billboards/Imposter): a dense
 * `BillboardInstancer` grass field (Y-axis-locked, camera-facing quads, one instanced draw
 * call), plus a row of `ImposterSprite` trees -- baked once at startup via `bakeImposter()` --
 * standing right next to real 3D comparison trees so the swap is visible up close.
 */
export class Showcase extends AbstractShowcase {
  private _grass!: BillboardInstancer;
  private _imposterTrees: ImposterSprite[] = [];
  private _treeBasePositions: Vector3D[] = [];
  private _realTrees: Object3D[] = [];
  private _sun!: DirectionalLight;
  private _ambientLight!: AmbientLight;
  private _fog!: Fog;
  private _hud?: Hud;

  // Scene state
  private _impostersVisible = true;
  private _treeCount = 100;
  private _realTreesVisible = true;
  private _grassVisible = true;
  private _windEnabled = true;
  private _windTime = 0;
  private _mood: MoodPreset = "day";
  private _fogEnabled = true;
  private _fogFar = 40.0;
  private _sunIntensity = 1.6;
  private _autoOrbit = false;
  private _orbitAngle = 0;
  private _activeCameraPreset = 0;

  constructor(options: EngineOptions = {}) {
    super({
      canvasId: "SmallWorldMachine",
      rendererType: RendererType.BEST,
      fullscreen: true,
      ...options,
    });
  }

  protected override async setupScene(): Promise<void> {
    // Post-processing deliberately stays off in this showcase: `bakeImposter()` renders into
    // offscreen `RenderTarget`s, which `WebGPURenderer` always creates in the canvas's swapchain
    // format (`this._format`) regardless of `postProcessing.enabled` -- but with post-processing
    // on, the *live* scene renders into an `rgba16float` HDR buffer instead, and this engine's
    // pipeline cache isn't keyed by target format. Whichever render call (bake or live) happens
    // first "wins" that pipeline for every later draw using the same shader/material variant,
    // and every subsequent draw targeting the other format then fails validation. Baking before
    // the first live frame (as this showcase does, from `setupScene()`) means the bake would
    // poison the live scene's pipelines if post-processing pulled it onto a different format --
    // so this showcase stays on the swapchain format throughout instead, which sidesteps the
    // mismatch entirely without touching renderer internals. A real fix belongs in the renderer's
    // pipeline cache (key it by target format too), not here.
    this.defaultFov = (55 * Math.PI) / 180;
    this.defaultFar = 100;
    this.configureCamera();
    this.camera.setStrategy(CameraStrategyType.HYBRID_SYNC);
    this.camera.position.set(0, 2.2, 8);
    this.camera.target.set(0, 1.5, -10);
    this.camera.addBehavior(new OrbitController({ input: this.input }));

    // No skybox in this glade -- match the clear color to a soft sky tone instead of black.
    this.renderer.setClearColor(new Color(0.55, 0.72, 0.85));

    // Horizon haze: a gentle LINEAR fog that stays off the foreground comparison trees (~13
    // units) and fades only the far back of the glade -- the imposter row gets a soft graded
    // aerial-perspective fade while the grass band behind it stays readable green, so nothing
    // reads as a razor-sharp billboard against a hazed backdrop. Sprites honor the exact same
    // `scene.fog` as every lit surface (Sprite.frag.*), so the billboard tree line never pops.
    this._fog = new Fog({
      mode: FogMode.LINEAR,
      color: new Color(0.6, 0.76, 0.9),
      near: 18.0,
      far: 40.0,
    });
    this.scene.fog = this._fog;

    // The imposter bake reuses exactly the same light rig as the live scene (color, intensity,
    // direction) -- bakeImposter defaults to a neutral grey/white rig, and mismatched lighting
    // would make the billboards read as cut-outs lit by another sun instead of as same-lit trees.
    const ambientColor = new Color(0.621, 0.659, 0.596);
    const ambientIntensity = 0.6;
    const sunColor = new Color(1, 0.991, 0.953);
    const sunIntensity = 1.6;
    const sunDirection: [number, number, number] = [-0.5, -1.0, -0.4];

    this._ambientLight = new AmbientLight({ color: ambientColor, intensity: ambientIntensity });
    this.scene.add(this._ambientLight);

    const sun = new DirectionalLight({ color: sunColor, intensity: sunIntensity });
    sun.position.set(10, 20, 12);
    sun.direction.set(sunDirection[0], sunDirection[1], sunDirection[2]);
    sun.castShadow = true;
    sun.shadowBias = 0.001;
    sun.shadowResolution = 2048;
    this.scene.add(sun);
    this._sun = sun;

    const ground = new Object3D("Ground");
    ground.geometry = new Ground({ width: 40, depth: 40 }).getGeometryData();
    ground.material = new StandardMaterial({
      color: new Color(0.22, 0.32, 0.15),
      roughness: 0.95,
      metallic: 0.0,
    });
    ground.receiveShadow = true;
    this.scene.add(ground);

    // Real, close-up comparison trees.
    const realTreePositions: Array<[number, number]> = [
      [-2.2, -3],
      [2.6, -4.5],
    ];
    this._realTrees = [];
    for (const [x, z] of realTreePositions) {
      const tree = buildTree(0);
      tree.position.set(x, 0, z);
      this.scene.add(tree);
      this._realTrees.push(tree);
    }

    // Pre-bake 3 tree shape archetypes once at startup. Each ImposterSprite shares these pre-baked
    // 8-angle texture sets, keeping startup instantaneous and GPU memory minuscule while providing
    // organic silhouette variety across the 100 grove trees.
    const bakedArchetypes: Texture[][] = [];
    for (let v = 0; v < 3; v++) {
      const bakeTarget = buildTree(v);
      const textures = bakeImposter(this.renderer, bakeTarget, {
        angleCount: 8,
        resolution: 256,
        groundAtBottom: true,
        ambientColor,
        ambientIntensity,
        lightColor: sunColor,
        lightIntensity: sunIntensity,
        lightDirection: sunDirection,
      });
      bakedArchetypes.push(textures);
    }

    // Place 100 imposter trees. The first 5 retain the exact legacy positions and scales of the
    // original Showcase 34 layout; trees 5..99 encircle the glade in natural flanks and deep background,
    // all firmly grounded via `y = sy / 2` and within the 40x40 floor boundary.
    const rng = mulberry32(34);
    const placements = generateTreePlacements(100, rng);
    this._imposterTrees = [];
    this._treeBasePositions = [];

    for (let i = 0; i < placements.length; i++) {
      const {
        pos: [x, z],
        scale: [sx, sy],
        variant,
      } = placements[i]!;
      const textures = bakedArchetypes[variant]!;
      const imposter = new ImposterSprite(
        `ImposterTree_${i}_${x.toFixed(1)}_${z.toFixed(1)}`,
        textures,
      );
      imposter.position.set(x, sy / 2, z);
      imposter.scale.set(sx, sy, 1);
      this.scene.add(imposter);
      this._imposterTrees.push(imposter);
      this._treeBasePositions.push(new Vector3D(x, sy / 2, z));
    }

    // Dense grass field across the whole glade. Uses the alpha-cutout tuft atlas (same asset as
    // Showcase 10) -- an alphaTest on a solid-color material can never cut anything out, so plain
    // green cards would read as a flat poster field instead of blades.
    const grassTuft = await Texture.fromUrl("./assets/grass_tuft.webp", {
      generateMipmaps: true,
      flipY: true,
    });
    this._grass = new BillboardInstancer("Grass", {
      count: 360,
      seed: 34, // fixed field, so capture mode and goldens see the same grass
      scatterArea: { width: 34, depth: 24, center: new Vector3D(0, 0, -7) },
      size: [0.35, 0.65],
      axisLocked: true,
      material: new StandardMaterial({
        diffuseMap: grassTuft,
        color: Color.WHITE,
        roughness: 0.85,
        metallic: 0.0,
        transparent: true,
        alphaTest: 0.35,
      }),
    });
    this._grass.mesh.position.y = 0.25;
    this._grass.mesh.receiveShadow = true;
    this.scene.add(this._grass.mesh);

    this._createHud();
  }

  protected override update(deltaTime: number): void {
    // 1. Auto-Orbit Camera
    if (this._autoOrbit) {
      this._orbitAngle += deltaTime * 0.25;
      const radius = 18;
      const targetCenter = new Vector3D(0, 1.5, -8);
      this.camera.position.x = targetCenter.x + Math.sin(this._orbitAngle) * radius;
      this.camera.position.z = targetCenter.z + Math.cos(this._orbitAngle) * radius;
      this.camera.target.copyFrom(targetCenter);
    }

    // 2. Wind Animation (gentle lateral sway)
    if (this._windEnabled) {
      this._windTime += deltaTime * 2.2;
      for (let i = 0; i < this._imposterTrees.length; i++) {
        const imposter = this._imposterTrees[i]!;
        if (!imposter.isVisible) continue;
        const base = this._treeBasePositions[i]!;
        const sway = Math.sin(this._windTime + i * 0.65) * 0.04;
        imposter.position.x = base.x + sway;
      }
    }

    // 3. Update Billboards & Imposters
    if (this._grassVisible) {
      this._grass.update(this.camera);
    }
    for (const imposter of this._imposterTrees) {
      if (imposter.isVisible) {
        imposter.update(this.camera);
      }
    }
  }

  protected override onKeyDown(event: KeyboardEvent): void {
    super.onKeyDown(event);
    if (this._hud?.handleKey(event)) {
      event.preventDefault();
    }
  }

  private _createHud(): void {
    this._hud?.dispose();
    this._hud = new Hud({
      onImpostersVisible: (v: boolean): void => this.setImpostersVisible(v),
      onTreeCount: (c: number): void => this.setTreeCount(c),
      onRealTreesVisible: (v: boolean): void => this.setRealTreesVisible(v),
      onGrassVisible: (v: boolean): void => this.setGrassVisible(v),
      onWindEnabled: (e: boolean): void => this.setWindEnabled(e),
      onMood: (m: MoodPreset): void => this.setMood(m),
      onFogEnabled: (e: boolean): void => this.setFogEnabled(e),
      onFogFar: (d: number): void => this.setFogFar(d),
      onSunIntensity: (i: number): void => this.setSunIntensity(i),
      onAutoOrbit: (o: boolean): void => this.setAutoOrbit(o),
      onCameraPreset: (idx: number): void => this.applyCameraPreset(idx),
    });
    this._syncHud();
  }

  private _syncHud(): void {
    this._hud?.sync({
      impostersVisible: this._impostersVisible,
      treeCount: this._treeCount,
      realTreesVisible: this._realTreesVisible,
      grassVisible: this._grassVisible,
      windEnabled: this._windEnabled,
      mood: this._mood,
      fogEnabled: this._fogEnabled,
      fogFar: this._fogFar,
      sunIntensity: this._sunIntensity,
      autoOrbit: this._autoOrbit,
      activeCameraPreset: this._activeCameraPreset,
    });
  }

  public setImpostersVisible(visible: boolean): void {
    this._impostersVisible = visible;
    this._applyTreeVisibility();
    this._syncHud();
  }

  public setTreeCount(count: number): void {
    this._treeCount = Math.max(0, Math.min(count, this._imposterTrees.length));
    this._applyTreeVisibility();
    this._syncHud();
  }

  private _applyTreeVisibility(): void {
    for (let i = 0; i < this._imposterTrees.length; i++) {
      this._imposterTrees[i]!.isVisible = this._impostersVisible && i < this._treeCount;
    }
  }

  public setRealTreesVisible(visible: boolean): void {
    this._realTreesVisible = visible;
    for (const tree of this._realTrees) {
      tree.isVisible = visible;
    }
    this._syncHud();
  }

  public setGrassVisible(visible: boolean): void {
    this._grassVisible = visible;
    this._grass.mesh.isVisible = visible;
    this._syncHud();
  }

  public setWindEnabled(enabled: boolean): void {
    this._windEnabled = enabled;
    if (!enabled) {
      for (let i = 0; i < this._imposterTrees.length; i++) {
        const base = this._treeBasePositions[i];
        if (base) {
          this._imposterTrees[i]!.position.x = base.x;
        }
      }
    }
    this._syncHud();
  }

  public setMood(mood: MoodPreset): void {
    this._mood = mood;
    const cfg = MOOD_CONFIGS[mood];
    this.renderer.setClearColor(cfg.clearColor);
    this._fog.color.copyFrom(cfg.fogColor);
    this._sun.color.copyFrom(cfg.sunColor);
    this._sun.intensity = cfg.sunIntensity * (this._sunIntensity / 1.6);
    this._ambientLight.color.copyFrom(cfg.ambientColor);
    this._ambientLight.intensity = cfg.ambientIntensity;

    for (const imposter of this._imposterTrees) {
      (imposter.material as SpriteMaterial).color.copyFrom(cfg.spriteTint);
    }
    this._syncHud();
  }

  public setFogEnabled(enabled: boolean): void {
    this._fogEnabled = enabled;
    if (enabled) {
      this.scene.fog = this._fog;
    } else {
      delete this.scene.fog;
    }
    this._syncHud();
  }

  public setFogFar(distance: number): void {
    this._fogFar = distance;
    this._fog.far = distance;
    this._syncHud();
  }

  public setSunIntensity(intensity: number): void {
    this._sunIntensity = intensity;
    const baseSun = MOOD_CONFIGS[this._mood].sunIntensity;
    this._sun.intensity = baseSun * (intensity / 1.6);
    this._syncHud();
  }

  public setAutoOrbit(orbit: boolean): void {
    this._autoOrbit = orbit;
    if (orbit) {
      const targetCenter = new Vector3D(0, 1.5, -8);
      this._orbitAngle = Math.atan2(
        this.camera.position.x - targetCenter.x,
        this.camera.position.z - targetCenter.z,
      );
    }
    this._syncHud();
  }

  public applyCameraPreset(index: number): void {
    const preset = CAMERA_PRESETS[index];
    if (!preset) return;
    this._activeCameraPreset = index;
    this._autoOrbit = false;

    this.camera.cancelFlight?.();
    this.camera.flyTo?.({
      position: preset.position,
      target: preset.target,
      duration: 1.2,
    });
    this._syncHud();
  }

  public override destroy(): void {
    this._hud?.dispose();
    super.destroy();
  }
}

// ----------------------------------------------------------------------------
// Bootstrap the example
// ----------------------------------------------------------------------------
const app = new Showcase();
attachDevTools(app);
app.start().catch((err: unknown) => console.error("[Showcase34] Failed to start:", err));
