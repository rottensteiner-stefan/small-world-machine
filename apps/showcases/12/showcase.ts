import type {
  AbstractMaterial,
  GearParameters,
  GrainElement,
  Scene,
  VignetteElement,
} from "@small-world-machine/engine";
import {
  AbstractShowcase,
  AmbientLight,
  Behavior,
  BoundingBox,
  CameraStrategyType,
  Color,
  Cube,
  CullMode,
  DirectionalLight,
  FlickerBehavior,
  Fog,
  FogMode,
  FPSController,
  Gear,
  GearMath,
  GlassMaterial,
  Ground,
  Object3D,
  PerspectiveProjection,
  PhongMaterial,
  Plane,
  PointLight,
  PostProcessingEffectType,
  ProjectionType,
  ProximitySensorBehavior,
  PulsatingBehavior,
  RendererType,
  Sphere,
  SpotLight,
  StandardMaterial,
  Texture,
  Torus,
  Vector2D,
  Vector3D,
} from "@small-world-machine/engine";
import { attachDevTools } from "@small-world-machine/tools";
import { WorkbenchTable } from "./assets/objects/WorkbenchTable.js";
import { ErlenmeyerFlask } from "./assets/objects/ErlenmeyerFlask.js";
import { ApothecaryBottle } from "./assets/objects/ApothecaryBottle.js";
import { TeqlerMeasuringCylinder } from "./assets/objects/TeqlerMeasuringCylinder.js";
import { OilPuddleMaterial } from "./assets/OilPuddleMaterial.js";

class SinkingBehavior extends Behavior {
  private _timer: number = 0;
  private _hasSplashed: boolean = false;
  private _material: OilPuddleMaterial;

  // Physics & Animation state
  private _state: "FALLING" | "BOBBING" | "SINKING" = "FALLING";
  private _velocityY: number = 0;

  // Randomized parameters per crate
  private _bobbingDamping: number;
  private _bobbingSpringK: number;
  private _surfaceY: number = 0.05;
  private _sinkSpeed: number;
  private _tipSpeedX: number;
  private _tipSpeedZ: number;
  private _scene: Scene;

  constructor(material: OilPuddleMaterial, scene: Scene) {
    super();
    this._material = material;
    this._scene = scene;

    // Randomize physical properties for natural variation
    this._bobbingDamping = 2.5 + Math.random() * 2.0; // How fast it settles
    this._bobbingSpringK = 30.0 + Math.random() * 20.0; // How "bouncy" the fluid is
    this._sinkSpeed = 0.05 + Math.random() * 0.1; // Slow sinking speed

    // Random tipping directions when sinking/bobbing
    this._tipSpeedX = (Math.random() - 0.5) * 0.4;
    this._tipSpeedZ = (Math.random() - 0.5) * 0.4;
  }

  public override update(deltaTime: number): void {
    const target = this.target as Object3D;
    if (!target) return;

    if (this._state === "FALLING") {
      this._velocityY -= 9.81 * deltaTime;
      target.position.y += this._velocityY * deltaTime;

      // Tumble while falling
      target.rotation.x += deltaTime * 0.5;
      target.rotation.y += deltaTime * 0.3;

      if (target.position.y <= this._surfaceY) {
        this._state = "BOBBING";
        if (!this._hasSplashed) {
          this._hasSplashed = true;
          this._material.addRipple(target.position.x, target.position.z, 0.4);
          this._spawnSplashDecals(target.position);
        }
      }
    } else if (this._state === "BOBBING") {
      // Spring-damper physics for buoyancy
      const displacement = target.position.y - this._surfaceY;
      const springForce = -this._bobbingSpringK * displacement;
      const dampingForce = -this._bobbingDamping * this._velocityY;
      const acceleration = springForce + dampingForce;

      this._velocityY += acceleration * deltaTime;
      target.position.y += this._velocityY * deltaTime;

      // Slight tipping as it settles based on its vertical velocity
      target.rotation.x += this._tipSpeedX * (Math.abs(this._velocityY) * 0.5) * deltaTime;
      target.rotation.z += this._tipSpeedZ * (Math.abs(this._velocityY) * 0.5) * deltaTime;

      this._timer += deltaTime;
      if (this._timer > 3.0) {
        this._state = "SINKING";
      }
    } else if (this._state === "SINKING") {
      // Slow, ominous sinking into the abyss
      target.position.y -= this._sinkSpeed * deltaTime;
      target.rotation.x += this._tipSpeedX * deltaTime;
      target.rotation.z += this._tipSpeedZ * deltaTime;
    }
  }

  private _spawnSplashDecals(pos: Vector3D): void {
    const numDrops = 3 + Math.floor(Math.random() * 4); // 3 to 6 drops
    for (let i = 0; i < numDrops; i++) {
      const drop = new Object3D("OilSplash_" + Date.now() + "_" + i);
      drop.geometry = new Plane({ width: 1, height: 1 }).getGeometryData();

      const mat = new StandardMaterial({
        color: new Color(0.01, 0.01, 0.01),
        roughness: 0.1,
        metallic: 0.9,
      });
      mat.transparent = true;
      mat.color.a = 0.8;
      drop.material = mat;

      // Lay flat on ground slightly above zero
      drop.rotation.set(-Math.PI / 2, 0, Math.random() * Math.PI);

      // Random position around the splash
      const angle = Math.random() * Math.PI * 2;
      const radius = 1.0 + Math.random() * 2.5; // Spread out 1 to 3.5 meters
      drop.position.set(pos.x + Math.cos(angle) * radius, 0.02, pos.z + Math.sin(angle) * radius);

      // Random size
      const s = 0.1 + Math.random() * 0.3;
      drop.scale.set(s, s, s);

      this._scene.add(drop);

      // Optional: fade out over time using a behavior
      drop.addBehavior(
        new (class extends Behavior {
          private _life = 0;
          private _maxLife = 10.0 + Math.random() * 5.0; // Stay for 10-15 seconds
          public override update(dt: number): void {
            this._life += dt;
            if (this._life > this._maxLife) {
              mat.color.a -= dt * 0.5;
              if (mat.color.a <= 0) drop.parent?.remove(drop);
            }
          }
        })(),
      );
    }
  }
}

class TeleportSpawnerBehavior extends Behavior {
  private _time = 0;
  private _state = 0; // 0: grow, 1: fade
  private _light: PointLight;
  private _glowMesh: Object3D;
  private _spawnFn: (pos: Vector3D) => void;
  private _scene: Scene;

  constructor(
    light: PointLight,
    glowMesh: Object3D,
    scene: Scene,
    spawnFn: (pos: Vector3D) => void,
  ) {
    super();
    this._light = light;
    this._glowMesh = glowMesh;
    this._scene = scene;
    this._spawnFn = spawnFn;
  }

  public override update(deltaTime: number): void {
    if (!this.target || !(this.target instanceof Object3D)) return;
    this._time += deltaTime;

    if (this._state === 0) {
      // Growing phase (1.2 seconds)
      const t = Math.min(this._time / 1.2, 1.0);
      const ease = 1.0 - Math.pow(1.0 - t, 3);
      const scale = ease * 2.0;

      this._glowMesh.scale.set(scale, scale, scale);
      this._glowMesh.rotation.y += deltaTime * 3.0;
      this._glowMesh.rotation.x += deltaTime * 2.5;

      this._light.intensity = ease * 10.0;

      if (t >= 1.0) {
        this._spawnFn(this.target.position);
        this._state = 1;
        this._time = 0;
      }
    } else {
      // Fading phase (0.4 seconds)
      const t = Math.min(this._time / 0.4, 1.0);
      const ease = 1.0 - t;

      this._glowMesh.scale.set(2.0 + t, 2.0 + t, 2.0 + t);
      this._glowMesh.rotation.y += deltaTime * 8.0;

      this._light.intensity = ease * 10.0;

      if (t >= 1.0) {
        this._scene.remove(this.target);
      }
    }
  }
}

class CrateSpawnerBehavior extends Behavior {
  private _timer = 0;
  private _interval = 4.5; // Spawn every 4.5 seconds
  private _scene: Scene;
  private _teleportGlowMaterial: AbstractMaterial;
  private _oilMaterial: OilPuddleMaterial;
  private _createCrateFn: (name: string, size: number, numBrandings: number) => Object3D;

  constructor(
    scene: Scene,
    teleportGlowMaterial: AbstractMaterial,
    oilMaterial: OilPuddleMaterial,
    createCrateFn: (name: string, size: number, numBrandings: number) => Object3D,
  ) {
    super();
    this._scene = scene;
    this._teleportGlowMaterial = teleportGlowMaterial;
    this._oilMaterial = oilMaterial;
    this._createCrateFn = createCrateFn;
  }

  public override update(deltaTime: number): void {
    this._timer += deltaTime;
    if (this._timer >= this._interval) {
      this._timer = 0;

      const spawnPos = new Vector3D(
        (Math.random() - 0.5) * 4,
        7.0,
        10.5 + (Math.random() - 0.5) * 4,
      );

      const teleporter = new Object3D("Teleporter_" + Date.now());
      teleporter.position.copyFrom(spawnPos);

      const glowMesh = new Object3D("TeleporterGlow");
      glowMesh.geometry = new Sphere({
        radius: 0.5,
        widthSegments: 32,
        heightSegments: 32,
      }).getGeometryData();
      glowMesh.material = this._teleportGlowMaterial;
      glowMesh.scale.set(0.1, 0.1, 0.1);
      teleporter.add(glowMesh);

      const spawnLight = new PointLight({
        color: new Color(0.2, 0.8, 1.0),
        intensity: 0.0,
        distance: 6.0,
      });
      spawnLight.position.set(0, 0, 0);
      teleporter.add(spawnLight);

      const behavior = new TeleportSpawnerBehavior(
        spawnLight,
        glowMesh,
        this._scene,
        (pos: Vector3D) => {
          const dropCrate = this._createCrateFn("DropCrate_" + Date.now(), 0.75, 1);
          dropCrate.position.copyFrom(pos);
          dropCrate.rotation.set(Math.random() * 0.5, Math.random(), Math.random() * 0.5);
          dropCrate.frustumCulled = false; // Never cull the parent group, let the engine cull its children!
          dropCrate.addBehavior(new SinkingBehavior(this._oilMaterial, this._scene));
          this._scene.add(dropCrate);

          // Fix invisibility without rebuilding the octree (which causes the fan to spin up):
          // Disable culling for all parts of this dynamic crate so it bypasses the Octree entirely.
          for (let i = 0; i < dropCrate.children.length; i++) {
            const child = dropCrate.children[i];
            if (child) {
              child.frustumCulled = false;
              for (let j = 0; j < child.children.length; j++) {
                const grandchild = child.children[j];
                if (grandchild) grandchild.frustumCulled = false;
              }
            }
          }

          // Use a Behavior for removal instead of setTimeout to avoid memory leaks
          dropCrate.addBehavior(
            new (class extends Behavior {
              private _life = 0;
              public override update(dt: number): void {
                this._life += dt;
                if (this._life > 15.0 && this.target) {
                  dropCrate.parent?.remove(dropCrate); // Safely remove
                }
              }
            })(),
          );
        },
      );

      teleporter.addBehavior(behavior);
      this._scene.add(teleporter);
    }
  }
}

class Showcase12 extends AbstractShowcase {
  private _portLight!: SpotLight;
  private _portLightBehavior!: FlickerBehavior;
  private _portLightBaseIntensity: number = 10.0;
  private _portLightBaseColor: Color = new Color(1.0, 0.8, 0.5);
  private _portMaterial?: StandardMaterial;
  private _time: number = 0;
  private _gears: { obj: Object3D; speed: number }[] = [];
  private _waterDrops: { obj: Object3D; velocityY: number; active: boolean }[] = [];
  private _oilMaterial?: OilPuddleMaterial;

  protected override async setupScene(): Promise<void> {
    attachDevTools(this); // Activate Forge
    // THE MAGIC SWITCH: Enable Post-Processing
    this.renderer.postProcessing.enabled = true;

    // Post-Processing configuration
    const vig = this.renderer.postProcessing.get<VignetteElement>(
      PostProcessingEffectType.VIGNETTE,
    );
    if (vig) {
      vig.offset = 0.55; // Etwas fetterer Rahmen
      vig.darkness = 1.0; // 100% Schwarz
      vig.roundness = 6.0; // Weiches Rechteck
    }

    const grain = this.renderer.postProcessing.get<GrainElement>(PostProcessingEffectType.GRAIN);
    if (grain) {
      grain.intensity = 0.15; // Wieder auf ein vernünftiges, atmosphärisches Level
    }

    if (ProjectionType.PERSPECTIVE === this.camera.projection.type) {
      const aspect: number = window.innerWidth / window.innerHeight;
      this.camera.projection = new PerspectiveProjection({
        fov: (75 * Math.PI) / 180,
        aspect,
        near: 0.1,
        far: 1000,
      });
      this.camera.updateProjectionMatrix();
    }
    // --- Fog Setup ---
    // A room length is 40. 1/5 of that is 8.
    this.scene.fog = new Fog({
      mode: FogMode.LINEAR,
      color: new Color(0.0, 0.1, 0.15), // Dark abyssal teal/blue
      near: 7.0, // Kein Nebel in der Mitte (ca. 1/3 der Distanz)
      far: 35.0, // Dichter Nebel an den Wänden (Wände sind ca bei Distanz 20)
      height: 0.0,
      heightFalloff: 0.0, // No falloff, pure distance fog
    });

    // 1. Textures & Materials
    let decoDiffuse: Texture | undefined;
    let decoNormal: Texture | undefined;
    let decoRoughness: Texture | undefined;

    let brassDiffuse: Texture | undefined;
    let brassNormal: Texture | undefined;
    let brassRoughness: Texture | undefined;

    let steelDiffuse: Texture | undefined;
    let steelNormal: Texture | undefined;
    let steelRoughness: Texture | undefined;

    let steamDiffuse: Texture | undefined;
    let steamNormal: Texture | undefined;
    let steamRoughness: Texture | undefined;

    let steamWallDiffuse: Texture | undefined;
    let steamWallNormal: Texture | undefined;
    let steamWallRoughness: Texture | undefined;

    let crateDiffuse: Texture | undefined;
    let crateNormal: Texture | undefined;
    let crateSpecular: Texture | undefined;

    let brandingDiffuse: Texture | undefined;
    let brandingNormal: Texture | undefined;
    let brandingSpecular: Texture | undefined;

    let rockDiffuse: Texture | undefined;
    let rockNormal: Texture | undefined;
    let rockRoughness: Texture | undefined;

    let portDiffuse: Texture | undefined;
    let portNormal: Texture | undefined;
    let portRoughness: Texture | undefined;
    let portEmissive: Texture | undefined;

    let glassAlbedo: Texture | undefined;
    let glassRoughness: Texture | undefined;
    let glassEmissive: Texture | undefined;

    let oakDiffuse: Texture | undefined;
    let oakNormal: Texture | undefined;
    let oakRoughness: Texture | undefined;

    try {
      decoDiffuse = await Texture.fromUrl("./assets/artdeco_diffuse.webp");
      decoNormal = await Texture.fromUrl("./assets/artdeco_normal.webp");
      decoRoughness = await Texture.fromUrl("./assets/artdeco_roughness.webp");

      brassDiffuse = await Texture.fromUrl("../shared/assets/rusty_brass_diffuse.webp");
      if (brassDiffuse) {
        brassDiffuse.repeat.x = 2;
        brassDiffuse.repeat.y = 2;
      }
      brassNormal = await Texture.fromUrl("../shared/assets/rusty_brass_normal.webp");
      if (brassNormal) {
        brassNormal.repeat.x = 2;
        brassNormal.repeat.y = 2;
      }
      brassRoughness = await Texture.fromUrl("../shared/assets/rusty_brass_roughness.webp");
      if (brassRoughness) {
        brassRoughness.repeat.x = 2;
        brassRoughness.repeat.y = 2;
      }

      glassAlbedo = await Texture.fromUrl("./assets/glass_albedo.webp");
      glassRoughness = await Texture.fromUrl("./assets/glass_roughness.webp");
      glassEmissive = await Texture.fromUrl("./assets/glass_emissive.webp");

      steelDiffuse = await Texture.fromUrl("../shared/assets/scratched_steel_diffuse.webp");
      if (steelDiffuse) {
        steelDiffuse.repeat.x = 2;
        steelDiffuse.repeat.y = 2;
      }
      steelNormal = await Texture.fromUrl("../shared/assets/scratched_steel_normal.webp");
      if (steelNormal) {
        steelNormal.repeat.x = 2;
        steelNormal.repeat.y = 2;
      }
      steelRoughness = await Texture.fromUrl("../shared/assets/scratched_steel_roughness.webp");
      if (steelRoughness) {
        steelRoughness.repeat.x = 2;
        steelRoughness.repeat.y = 2;
      }

      // Ceiling Textures
      steamDiffuse = await Texture.fromUrl("./assets/steampunk_diffuse.webp");
      steamNormal = await Texture.fromUrl("./assets/steampunk_normal.webp");
      steamRoughness = await Texture.fromUrl("./assets/steampunk_roughness.webp");

      // Side Wall Textures (need different repeat scale due to different geometry size)
      steamWallDiffuse = await Texture.fromUrl("./assets/steampunk_diffuse.webp");
      steamWallNormal = await Texture.fromUrl("./assets/steampunk_normal.webp");
      steamWallRoughness = await Texture.fromUrl("./assets/steampunk_roughness.webp");

      // Wooden Crate
      crateDiffuse = await Texture.fromUrl("./assets/crate_diffuse.webp");
      crateNormal = await Texture.fromUrl("./assets/crate_normal.webp");
      crateSpecular = await Texture.fromUrl("./assets/crate_specular.webp");
      if (crateDiffuse) crateDiffuse.repeat.y = -1;
      if (crateNormal) crateNormal.repeat.y = -1;
      if (crateSpecular) crateSpecular.repeat.y = -1;

      // Crate Branding
      brandingDiffuse = await Texture.fromUrl("./assets/crate_branded_diffuse.webp");
      brandingNormal = await Texture.fromUrl("./assets/crate_branded_normal.webp");
      brandingSpecular = await Texture.fromUrl("./assets/crate_branded_specular.webp");
      if (brandingDiffuse) brandingDiffuse.repeat.y = -1;
      if (brandingNormal) brandingNormal.repeat.y = -1;
      if (brandingSpecular) brandingSpecular.repeat.y = -1;

      // Rock Walls (Ends)
      rockDiffuse = await Texture.fromUrl("./assets/large_rock_diffuse.webp");
      rockNormal = await Texture.fromUrl("./assets/large_rock_normal.webp");
      rockRoughness = await Texture.fromUrl("./assets/large_rock_roughness.webp");

      // Baulicht (Construction Light)
      portDiffuse = await Texture.fromUrl("./assets/porthole_diffuse.webp");
      portNormal = await Texture.fromUrl("./assets/porthole_normal.webp");
      portRoughness = await Texture.fromUrl("./assets/porthole_roughness.webp");
      portEmissive = await Texture.fromUrl("./assets/porthole_emissive.webp");

      // Table Wood (Oak)
      oakDiffuse = await Texture.fromUrl("./assets/oak_diffuse.webp");
      oakNormal = await Texture.fromUrl("./assets/oak_normal.webp");
      oakRoughness = await Texture.fromUrl("./assets/oak_roughness.webp");

      // Texturen kacheln (1 Repeat pro 2 World-Units)
      if (decoDiffuse) {
        decoDiffuse.repeat.x = 10; // Floor width 20 -> 10 repeats
        decoDiffuse.repeat.y = 20; // Floor depth 40 -> 20 repeats
      }
      if (steamDiffuse) {
        steamDiffuse.repeat.x = 5; // Ceiling width 20
        steamDiffuse.repeat.y = 10; // Ceiling depth 40
      }
      // Seitliche Wände (40x8)
      if (steamWallDiffuse) {
        steamWallDiffuse.repeat.x = 20;
        steamWallDiffuse.repeat.y = 4;
        if (steamWallNormal) {
          steamWallNormal.repeat.x = 20;
          steamWallNormal.repeat.y = 4;
        }
        if (steamWallRoughness) {
          steamWallRoughness.repeat.x = 20;
          steamWallRoughness.repeat.y = 4;
        }
      }

      // Felswände vorne/hinten (20x8)
      if (rockDiffuse) {
        rockDiffuse.repeat.x = 5; // 20 units -> 5 repeats (1 per 4 units, for larger stones)
        rockDiffuse.repeat.y = 2;
        if (rockNormal) {
          rockNormal.repeat.x = 5;
          rockNormal.repeat.y = 2;
        }
        if (rockRoughness) {
          rockRoughness.repeat.x = 5;
          rockRoughness.repeat.y = 2;
        }
      }
    } catch (e) {
      console.warn("Could not load textures:", e);
    }

    const floorMaterial = new StandardMaterial({
      color: new Color(1.0, 1.0, 1.0),
      roughness: 1.0,
      diffuseMap: decoDiffuse,
      normalMap: decoNormal,
      roughnessMap: decoRoughness,
    });

    const brassMaterial = new StandardMaterial({
      color: new Color(1.0, 1.0, 1.0),
      diffuseMap: brassDiffuse,
      normalMap: brassNormal,
      roughnessMap: brassRoughness,
      metallic: 0.8,
      roughness: 0.6,
    });

    const steelMaterial = new StandardMaterial({
      color: new Color(1.0, 1.0, 1.0),
      diffuseMap: steelDiffuse,
      normalMap: steelNormal,
      roughnessMap: steelRoughness,
      metallic: 0.9,
      roughness: 0.4,
    });

    const ceilingMaterial = new StandardMaterial({
      color: new Color(1.0, 1.0, 1.0),
      metallic: 1.0,
      roughness: 0.6, // Low roughness to catch specular highlights
      diffuseMap: steamDiffuse,
      normalMap: steamNormal,
      roughnessMap: steamRoughness,
    });

    const sideWallMaterial = new StandardMaterial({
      color: new Color(1.0, 1.0, 1.0),
      metallic: 1.0,
      roughness: 0.6, // Low roughness for shiny steel
      diffuseMap: steamWallDiffuse,
      normalMap: steamWallNormal,
      roughnessMap: steamWallRoughness,
    });

    const rockMaterial = new StandardMaterial({
      diffuseMap: rockDiffuse,
      normalMap: rockNormal,
      roughnessMap: rockRoughness,
      roughness: 0.9,
      metallic: 0.0,
      color: new Color(0.8, 0.8, 0.8), // Slightly darken rocks
    });

    const portMaterial = new StandardMaterial({
      color: new Color(0.2, 0.2, 0.2), // Dark base
      diffuseMap: portDiffuse,
      normalMap: portNormal,
      roughnessMap: portRoughness,
      emissiveMap: portEmissive, // Use generated emissive map!
      emissiveColor: new Color(1.0, 0.8, 0.5), // Warm glow
      emissiveIntensity: 3.0, // Back to normal intensity
      transparent: true,
      alphaTest: 0.1,
      roughness: 0.3,
      metallic: 0.8,
    });
    this._portMaterial = portMaterial;

    const crateMaterial = new PhongMaterial({
      color: new Color(1.0, 1.0, 1.0),
      diffuseMap: crateDiffuse,
      normalMap: crateNormal,
      normalScale: new Vector2D(1, -1), // Fix for DirectX normal map
      specularMap: crateSpecular,
      shininess: 32.0,
    });

    const oakMaterial = new StandardMaterial({
      color: oakDiffuse ? new Color(1.0, 1.0, 1.0) : new Color(0.4, 0.25, 0.15),
      diffuseMap: oakDiffuse,
      normalMap: oakNormal,
      roughnessMap: oakRoughness,
      roughness: 0.85,
      metallic: 0.02,
    });

    const brandingMaterial = new PhongMaterial({
      color: new Color(1.0, 1.0, 1.0),
      diffuseMap: brandingDiffuse,
      normalMap: brandingNormal,
      normalScale: new Vector2D(1, -1), // Fix for DirectX normal map
      specularMap: brandingSpecular,
      shininess: 32.0,
    });

    // Helper to build a solid crate from 6 Plane geometries,
    // randomly assigning the branded texture to some faces.
    const createCrate = (name: string, size: number, numBrandings: number = 3): Object3D => {
      const crateGroup = new Object3D(name);
      const d = size / 2;
      const faces: Array<{
        name: string;
        pos: [number, number, number];
        rot: [number, number, number];
      }> = [
        { name: "Top", pos: [0, d, 0], rot: [0, 0, 0] },
        { name: "Bottom", pos: [0, -d, 0], rot: [Math.PI, 0, 0] },
        { name: "Right", pos: [d, 0, 0], rot: [Math.PI / 2, 0, -Math.PI / 2] },
        { name: "Left", pos: [-d, 0, 0], rot: [Math.PI / 2, 0, Math.PI / 2] },
        { name: "Front", pos: [0, 0, -d], rot: [Math.PI / 2, Math.PI, 0] },
        { name: "Back", pos: [0, 0, d], rot: [Math.PI / 2, 0, 0] },
      ];

      // Randomly pick which faces get the branding
      const shuffledIndices = [0, 1, 2, 3, 4, 5].sort(() => 0.5 - Math.random());
      const brandedIndices = new Set(shuffledIndices.slice(0, numBrandings));

      faces.forEach((face, index) => {
        const isBranded = brandedIndices.has(index);

        const container = new Object3D(`${name}_${face.name}_Container`);
        container.position.set(face.pos[0], face.pos[1], face.pos[2]);
        container.rotation.set(face.rot[0], face.rot[1], face.rot[2]);

        const faceObj = new Object3D(`${name}_${face.name}_Plane`);
        faceObj.geometry = new Ground({ width: size, depth: size }).getGeometryData();
        faceObj.material = isBranded ? brandingMaterial : crateMaterial;
        faceObj.castShadow = true;
        faceObj.receiveShadow = true;

        if (isBranded) {
          // Random 0, 90, 180, 270 degree clockwise rotation around the local normal (+Y axis)
          const randomTurns = Math.floor(Math.random() * 4);
          faceObj.rotation.y = -randomTurns * (Math.PI / 2);
        }

        container.add(faceObj);
        crateGroup.add(container);
      });

      return crateGroup;
    };

    // 1. Floor (Art Deco)
    const floor = new Object3D("Floor").setPosition(0, 0, 0);
    floor.geometry = new Ground({ width: 20, depth: 40 }).getGeometryData();
    floor.material = floorMaterial;
    floor.castShadow = false; // Floor usually doesn't cast shadow on itself, but receives
    floor.receiveShadow = true;
    this.scene.add(floor);

    // 2. Ceiling (Steampunk)
    const ceiling = new Object3D("Ceiling").setPosition(0, 8, 0);
    ceiling.geometry = new Ground({ width: 20, depth: 40 }).getGeometryData();
    ceiling.rotation.x = Math.PI; // Face downwards
    ceiling.material = ceilingMaterial;
    ceiling.castShadow = false;
    ceiling.receiveShadow = true;
    this.scene.add(ceiling);

    // 3. Walls (Left & Right) (Steampunk)
    const leftWall = new Object3D("LeftWall").setPosition(-10, 4, 0).setScale(1, 8, 40);
    leftWall.geometry = new Cube({ size: 1 }).getGeometryData();
    leftWall.material = sideWallMaterial;
    leftWall.castShadow = false;
    leftWall.receiveShadow = true;
    this.scene.add(leftWall);

    const rightWall = new Object3D("RightWall").setPosition(10, 4, 0).setScale(1, 8, 40);
    rightWall.geometry = new Cube({ size: 1 }).getGeometryData();
    rightWall.material = sideWallMaterial;
    rightWall.castShadow = false;
    rightWall.receiveShadow = true;
    this.scene.add(rightWall);

    // 3.5 Walls (Front & Back) (Rock)
    const frontWall = new Object3D("FrontWall").setPosition(0, 4, -20).setScale(20, 8, 1);
    frontWall.geometry = new Cube({ size: 1 }).getGeometryData();
    frontWall.material = rockMaterial;
    frontWall.castShadow = true;
    frontWall.receiveShadow = true;
    this.scene.add(frontWall);

    const backWall = new Object3D("BackWall").setPosition(0, 4, 20).setScale(20, 8, 1);
    backWall.geometry = new Cube({ size: 1 }).getGeometryData();
    backWall.material = rockMaterial;
    backWall.castShadow = true;
    backWall.receiveShadow = true;
    this.scene.add(backWall);

    // 3.8 Steampunk Gears (Composite with Spokes using GearMath)
    const createSpokedGear = (
      name: string,
      module: number,
      thickness: number,
      numTeeth: number,
      numSpokes: number,
      rimMaterial: StandardMaterial,
      spokeMaterial: StandardMaterial,
    ): { obj: Object3D; params: GearParameters } => {
      const gearGroup = new Object3D(name);

      const params = GearMath.getGearParams(module, numTeeth);

      const rimWidth = params.innerRadius * 0.2; // Width of the solid metal ring
      const holeRadius = params.innerRadius - rimWidth;

      // The Rim (Kranz)
      const rim = new Object3D(`${name}_Rim`);
      rim.geometry = new Gear({
        teeth: numTeeth,
        innerRadius: params.innerRadius,
        holeRadius: holeRadius,
        toothHeight: params.toothHeight,
        vRatio: 0.5,
        thickness: thickness,
      }).getGeometryData();
      rim.material = rimMaterial;
      rim.castShadow = true;
      rim.receiveShadow = true;
      gearGroup.add(rim);

      // 2. The Hub (Nabe)
      const hubRadius = params.innerRadius * 0.3;
      const hubHole = hubRadius * 0.4;
      const hub = new Object3D(`${name}_Hub`);
      hub.geometry = new Gear({
        teeth: 32,
        innerRadius: hubRadius,
        holeRadius: hubHole,
        toothHeight: 0,
        vRatio: 1.0,
        thickness: thickness * 1.2,
      }).getGeometryData();
      hub.material = rimMaterial;
      hub.castShadow = true;
      hub.receiveShadow = true;
      gearGroup.add(hub);

      // 3. The Spokes (Speichen)
      const spokeLength = holeRadius - hubRadius + 0.1;
      const spokeWidth = params.innerRadius * 0.12;
      const spokeThickness = thickness * 0.6;

      for (let i = 0; i < numSpokes; i++) {
        const angle = (i / numSpokes) * Math.PI * 2;
        const spoke = new Object3D(`${name}_Spoke_${i}`);
        spoke.geometry = new Cube({ size: 1 }).getGeometryData();
        spoke.setScale(spokeLength, spokeWidth, spokeThickness);

        const dist = hubRadius + spokeLength / 2 - 0.05;
        spoke.position.set(Math.cos(angle) * dist, Math.sin(angle) * dist, 0);
        spoke.rotation.z = angle;

        spoke.material = spokeMaterial;
        spoke.castShadow = true;
        spoke.receiveShadow = true;
        gearGroup.add(spoke);
      }

      return { obj: gearGroup, params };
    };

    const gearModule = 0.25;

    // Gear 1: Brass, large (16 teeth)
    const gear1Data = createSpokedGear(
      "Gear_Brass_Large",
      gearModule,
      0.4,
      16,
      5,
      brassMaterial,
      steelMaterial,
    );
    const gear1 = gear1Data.obj;
    gear1.position.set(-8.8, 4, -8); // Moved down by another 1 unit
    gear1.rotation.y = Math.PI / 2;
    // Initial rotation
    gear1.rotation.z = 0;
    this.scene.add(gear1);
    this._gears.push({ obj: gear1, speed: 0.5 }); // Base speed

    // Gear 2: Steel, medium (10 teeth)
    const gear2Data = createSpokedGear(
      "Gear_Steel_Medium",
      gearModule,
      0.3,
      10,
      4,
      steelMaterial,
      brassMaterial,
    );
    const gear2 = gear2Data.obj;
    const dist1to2 = GearMath.getCenterDistance(gearModule, 16, 10);
    const angle1to2 = -Math.PI / 6; // 30 degrees down and forward along Z
    gear2.position.set(
      -8.8,
      gear1.position.y + Math.sin(angle1to2) * dist1to2,
      gear1.position.z + Math.cos(angle1to2) * dist1to2,
    );
    gear2.rotation.y = Math.PI / 2;

    // Mathematically perfect meshing rotation
    const mapToXY = (v: Vector3D): Vector3D => new Vector3D(v.z, v.y, 0);
    gear2.rotation.z = GearMath.getMeshingRotation(
      mapToXY(gear1.position),
      gear1.rotation.z,
      gear1Data.params,
      mapToXY(gear2.position),
      gear2Data.params,
    );
    this.scene.add(gear2);
    this._gears.push({ obj: gear2, speed: GearMath.getDrivenSpeed(0.5, 16, 10) });

    // Gear 3: Steel, small (6 teeth)
    const gear3Data = createSpokedGear(
      "Gear_Steel_Small",
      gearModule,
      0.3,
      6,
      3,
      steelMaterial,
      steelMaterial,
    );
    const gear3 = gear3Data.obj;
    const dist2to3 = GearMath.getCenterDistance(gearModule, 10, 6);

    const angle2to3 = Math.PI / 8; // 22.5 degrees up and forward along Z
    gear3.position.set(
      -8.8,
      gear2.position.y + Math.sin(angle2to3) * dist2to3,
      gear2.position.z + Math.cos(angle2to3) * dist2to3,
    );
    gear3.rotation.y = Math.PI / 2;

    // Speed of gear3 driven by gear2
    const speed3 = GearMath.getDrivenSpeed(GearMath.getDrivenSpeed(0.5, 16, 10), 10, 6);

    gear3.rotation.z = GearMath.getMeshingRotation(
      mapToXY(gear2.position),
      gear2.rotation.z,
      gear2Data.params,
      mapToXY(gear3.position),
      gear3Data.params,
    );
    this.scene.add(gear3);
    this._gears.push({ obj: gear3, speed: speed3 });

    // 4. Large Wooden Crate (Center)
    const crate = createCrate("OldCrate", 3, 3);
    crate.setPosition(0, 1.5, 0); // Y=1.5 because size is 3 and center is 0
    // slightly rotate to look interesting
    crate.rotation.y = Math.PI / 6;
    this.scene.add(crate);

    // 5. Stack of 4 Small Crates (Corner -> moved 3 units diagonally)
    const s = 1.5; // Half size
    const y0 = s / 2; // Ground level center (0.75)
    const y1 = y0 + s; // Second layer center (2.25)

    // Three on the ground, slightly messy
    // Original positions + 2.1 on X and Z (approx 3 units diagonal distance)
    const c1 = createCrate("SmallCrate1", s, 1);
    c1.setPosition(-5.4, y0, -15.4);
    c1.rotation.y = 0.15;
    this.scene.add(c1);

    const c2 = createCrate("SmallCrate2", s, 1);
    c2.setPosition(-3.7, y0, -15.1);
    c2.rotation.y = -0.12;
    this.scene.add(c2);

    const c3 = createCrate("SmallCrate3", s, 1);
    c3.setPosition(-4.7, y0, -13.7);
    c3.rotation.y = 0.28;
    this.scene.add(c3);

    // One on top
    const c4 = createCrate("SmallCrate4", 1.5, 2);
    c4.setPosition(-4.5, y1, -14.7);
    c4.rotation.y = -0.25;
    this.scene.add(c4);

    // 5. Portholes (Bullaugen on the Rock Walls)
    const createPorthole = (name: string, radius: number): Object3D => {
      const group = new Object3D(name);

      // Frame
      const frame = new Object3D(`${name}_Frame`);
      frame.geometry = new Gear({
        teeth: 32,
        innerRadius: radius,
        holeRadius: radius * 0.8,
        toothHeight: 0,
        vRatio: 1.0,
        thickness: 0.4,
      }).getGeometryData();
      frame.material = brassMaterial;
      frame.castShadow = true;
      frame.receiveShadow = true;
      group.add(frame);

      // Glass (A flattened sphere inside the frame)
      const glass = new Object3D(`${name}_Glass`);
      glass.geometry = new Sphere({
        radius: radius * 0.85,
        widthSegments: 16,
        heightSegments: 16,
      }).getGeometryData();
      glass.setScale(1.0, 1.0, 0.2); // Flattened on Z axis

      const glassMaterial = new StandardMaterial({
        color: new Color(1.0, 1.0, 1.0), // Base color from texture
        diffuseMap: glassAlbedo, // Fake ocean color + dirt
        roughnessMap: glassRoughness, // Scratches and streaks
        roughness: 0.1, // Very smooth where there are no scratches
        metallic: 0.9, // Highly reflective
        emissiveColor: new Color(0.0, 0.8, 1.0), // Bright glow from the ocean outside
        emissiveMap: glassEmissive, // Glows only where there is no dirt
        emissiveIntensity: 4.0, // High intensity to fake looking outside
        transparent: false,
      });
      glass.material = glassMaterial;

      // Add pulsating behavior to the glass!
      glass.addBehavior(
        new PulsatingBehavior({
          min: 1.0,
          max: 4.0,
          minDuration: 2.0,
          maxDuration: 5.0,
          onUpdate: (val: number, target: Object3D): void => {
            if (target.material instanceof StandardMaterial) {
              target.material.emissiveIntensity = val;
            }
          },
        }),
      );

      group.add(glass);

      return group;
    };

    // Pair on Front Wall (Z = -19.5, faces +Z)
    const porthole1 = createPorthole("Porthole_Front1", 1.5);
    porthole1.position.set(-5, 5, -19.49);
    porthole1.rotation.y = 0;
    this.scene.add(porthole1);

    const porthole2 = createPorthole("Porthole_Front2", 1.5);
    porthole2.position.set(5, 5, -19.49);
    porthole2.rotation.y = 0;
    this.scene.add(porthole2);

    // Pair on Back Wall (Z = 19.5, faces -Z)
    const porthole3 = createPorthole("Porthole_Back1", 1.5);
    porthole3.position.set(-5, 5, 19.49);
    porthole3.rotation.y = Math.PI;
    this.scene.add(porthole3);

    const porthole4 = createPorthole("Porthole_Back2", 1.5);
    porthole4.position.set(5, 5, 19.49);
    porthole4.rotation.y = Math.PI;
    this.scene.add(porthole4);

    // 6. Dripping Water Particles
    const waterMaterial = new StandardMaterial({
      color: new Color(0.7, 0.8, 0.9),
      roughness: 0.0,
      metallic: 1.0,
    });

    for (let i = 0; i < 30; i++) {
      const drop = new Object3D(`WaterDrop_${i}`);
      drop.geometry = new Sphere({
        radius: 0.04,
        widthSegments: 8,
        heightSegments: 8,
      }).getGeometryData();
      drop.material = waterMaterial;
      drop.castShadow = true;
      drop.position.set(0, -4, 0); // Hide initially below ground
      this.scene.add(drop);
      this._waterDrops.push({ obj: drop, velocityY: 0, active: false });
    }

    // 6.5 The Oil Puddle
    // OilPuddleMaterial only has a WGSL implementation (no WebGL2/WebGL1 fallback shaders).
    // Check the renderer that actually got resolved (not just whether the browser's WebGPU API
    // exists) -- DeviceCaps.hasFeature(WEBGPU) can be true even when RendererFactory fell back
    // to WebGL2/WebGL1 (e.g. no real adapter, or an explicit ?rendererType= override), which
    // would otherwise try to compile this material's empty GLSL source and crash.
    if (this.renderer.type === RendererType.WEB_GPU) {
      const oilMaterial = new OilPuddleMaterial();
      this._oilMaterial = oilMaterial;

      // Teleporter Glow Material (Simplified to StandardMaterial for debugging)
      const teleportGlowMaterial = new StandardMaterial({
        color: new Color(0.1, 0.8, 1.0),
        emissiveColor: new Color(0.1, 0.8, 1.0),
        emissiveIntensity: 5.0,
        transparent: true,
      });
      teleportGlowMaterial.color.a = 0.8;
      teleportGlowMaterial.depthWrite = false;

      const puddle = new Object3D("OilPuddle");

      puddle.position.set(0, 0.05, 10.5);
      puddle.rotation.set(-Math.PI / 2, 0, 0); // Lay flat on the ground
      // High tessellation plane for ripples
      puddle.geometry = new Plane({
        width: 10,
        height: 10,
        widthSegments: 64,
        heightSegments: 64,
      }).getGeometryData();
      puddle.material = oilMaterial;
      puddle.receiveShadow = true;
      puddle.addBehavior(
        new CrateSpawnerBehavior(this.scene, teleportGlowMaterial, oilMaterial, createCrate),
      );
      this.scene.add(puddle);
    } else {
      console.warn("[Showcase12] WebGPU not available — skipping WGSL-only Oil Puddle feature.");
    }

    // 7. Baulicht (Construction Light) on the Right Wall
    const baulichtGroup = new Object3D("BaulichtGroup").setPosition(9.49, 4, -5);
    // Rotate entire group so +Z faces -X (towards the room)
    baulichtGroup.rotation.y = -Math.PI / 2;

    // Sockel (Base/Frame) connecting the light to the wall
    const baulichtSockel = new Object3D("Baulicht_Sockel");
    baulichtSockel.geometry = new Gear({
      teeth: 32,
      innerRadius: 1.7, // Made larger so it extends beyond the painted metal rim
      holeRadius: 0.0, // Solid base
      toothHeight: 0,
      vRatio: 1.0,
      thickness: 0.5,
    }).getGeometryData();
    baulichtSockel.material = brassMaterial;
    baulichtSockel.castShadow = true;
    baulichtSockel.receiveShadow = true;
    // The wall is at local Z = 0 (after group rotation).
    // The Sockel goes from -0.25 to 0.25.
    baulichtSockel.position.set(0, 0, 0.25); // Push it out so it starts at the wall
    baulichtGroup.add(baulichtSockel);

    // The Light Surface (Decal with Baugitter)
    const baulichtSurface = new Object3D("Baulicht_Surface");
    baulichtSurface.geometry = new Ground({ width: 2.8, depth: 2.8 }).getGeometryData();
    baulichtSurface.material = portMaterial;
    baulichtSurface.castShadow = false;
    // Plane is on XZ plane (+Y normal). Rotate X by 90deg to face +Z
    baulichtSurface.rotation.x = Math.PI / 2;
    // Place it exactly on top of the Sockel
    baulichtSurface.position.set(0, 0, 0.51);
    baulichtGroup.add(baulichtSurface);

    // Bezel (Torus) connecting the Plane smoothly to the Gear Sockel
    const baulichtBezel = new Object3D("Baulicht_Bezel");
    baulichtBezel.geometry = new Torus({
      radius: 1.55,
      tube: 0.2,
      radialSegments: 16,
      tubularSegments: 64,
    }).getGeometryData();
    baulichtBezel.material = brassMaterial;
    baulichtBezel.castShadow = true;
    baulichtBezel.receiveShadow = true;
    baulichtBezel.rotation.x = Math.PI / 2; // Flat against the wall
    baulichtBezel.position.set(0, 0, 0.51); // Sit exactly at the plane level
    baulichtGroup.add(baulichtBezel);

    this.scene.add(baulichtGroup);

    // Add the SpotLight back to the Baulicht
    const portLight = new SpotLight({
      color: new Color(1.0, 0.8, 0.5),
      intensity: 10.0,
      direction: new Vector3D(-1, -0.2, 0), // Pointing -X (from right wall to left wall)
      angle: Math.PI / 4,
      penumbra: 0.5,
      distance: 40.0,
    });
    portLight.position.set(9.4, 4, -5); // Positioned slightly in front of the decal
    portLight.castShadow = true;
    portLight.shadowResolution = 1024;
    portLight.shadowBias = 0.015;
    this._portLight = portLight;

    // Add our new Behavior to the light
    const flickerColor = new Color(1.0, 0.0, 0.0); // Deep red when it flickers/dims
    this._portLightBehavior = new FlickerBehavior({
      onUpdate: (multiplier: number, target: Object3D): void => {
        if (target instanceof SpotLight) {
          target.intensity = this._portLightBaseIntensity * multiplier;

          const blendFactor = 1.0 - multiplier;
          const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

          target.color.r = lerp(this._portLightBaseColor.r, flickerColor.r, blendFactor);
          target.color.g = lerp(this._portLightBaseColor.g, flickerColor.g, blendFactor);
          target.color.b = lerp(this._portLightBaseColor.b, flickerColor.b, blendFactor);
        }
      },
    });
    this._portLight.addBehavior(this._portLightBehavior);

    // Attach Proximity Sensor to increase flicker speed and intensity when player approaches
    this._portLight.addBehavior(
      new ProximitySensorBehavior({
        targetObj: this.camera, // The player
        radius: 15.0, // Start reacting at 15 units away so it's easier to notice
        minDistance: 2.0, // Max intensity at 2 unit distance
        onUpdate: (factor: number): void => {
          // factor is 0.0 (far) to 1.0 (very close)

          // Boost base intensity up to 250% (10.0 * 2.5) for extreme debugging visibility
          this._portLightBaseIntensity = 10.0 * (1.0 + 1.5 * factor);

          // Reduce stable time (0% at full proximity, i.e., constant flickering)
          this._portLightBehavior.options.minStableTime = 2.0 * (1.0 - factor);
          this._portLightBehavior.options.maxStableTime = 6.0 * (1.0 - factor);

          // Speed up the flickering itself
          this._portLightBehavior.options.minFlickerTime = 0.2 - 0.1 * factor;
        },
      }),
    );

    this.scene.add(portLight);

    // 6. Workbench Table under the Right Porthole (Front Wall)
    const table = new WorkbenchTable("MyWorkbench", {
      width: 3,
      depth: 1.2,
      height: 1,
      woodMaterial: oakMaterial,
      metalMaterial: steelMaterial,
    });
    table.position.set(5, 0, -18.8); // X=5 (under right porthole), Z=-18.8 (close to front wall at Z=-19.5)
    this.scene.add(table);

    // Add a small light to highlight the table in the dark corner
    const tableLight = new SpotLight({
      color: new Color(1.0, 0.9, 0.7),
      intensity: 3.0,
      direction: new Vector3D(0, -1, 0),
      angle: Math.PI / 3,
      distance: 10.0,
    });
    tableLight.position.set(5, 4, -18.8);
    tableLight.castShadow = true;
    this.scene.add(tableLight);

    // 6.b Laboratory Glassware on the Table -- 4 Erlenmeyer flasks, 4 apothecary bottles and
    // 4 Teqler measuring cylinders (12 total), each a unique color, 2 randomized-but-sensible
    // sizes per vessel type, scattered randomly across the tabletop with no footprint overlaps
    // and no overhang past the table edge.

    // 12 hues spaced 30 degrees apart at fixed saturation/lightness -- every color stays clearly
    // distinguishable from its neighbors by eye, not just numerically different.
    function hslToRgbTuple(
      hueDeg: number,
      saturation: number,
      lightness: number,
    ): [number, number, number] {
      const c = (1 - Math.abs(2 * lightness - 1)) * saturation;
      const x = c * (1 - Math.abs(((hueDeg / 60) % 2) - 1));
      const m = lightness - c / 2;
      let r = 0;
      let g = 0;
      let b = 0;
      if (60 > hueDeg) {
        r = c;
        g = x;
      } else if (120 > hueDeg) {
        r = x;
        g = c;
      } else if (180 > hueDeg) {
        g = c;
        b = x;
      } else if (240 > hueDeg) {
        g = x;
        b = c;
      } else if (300 > hueDeg) {
        r = x;
        b = c;
      } else {
        r = c;
        b = x;
      }
      return [r + m, g + m, b + m];
    }

    const glassColorPalette = Array.from({ length: 12 }, (_, i) => {
      const [r, g, b] = hslToRgbTuple(i * 30, 0.7, 0.45);
      const glass = new GlassMaterial({
        color: new Color(r, g, b, 1.0),
        roughness: 0.03,
        metallic: 0.0,
        ior: 1.52,
        thickness: 0.25,
        transmission: 0.95,
      });
      glass.cullMode = CullMode.NONE;
      return glass;
    });

    function shuffled<T>(arr: T[]): T[] {
      const out = [...arr];
      for (let i = out.length - 1; 0 < i; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [out[i], out[j]] = [out[j]!, out[i]!];
      }
      return out;
    }

    // Every vessel below draws from this shuffled, non-repeating pool -- guarantees each of the
    // 12 gets its own unique color.
    const colorPool = shuffled(glassColorPalette);
    let nextColorIndex = 0;
    const nextGlassColor = (): GlassMaterial => colorPool[nextColorIndex++]!;

    const randInRange = (min: number, max: number): number => min + Math.random() * (max - min);

    // Table surface bounds (matches WorkbenchTable width:3 / depth:1.2 / position above).
    const tableCenterX = 5;
    const tableCenterZ = -18.8;
    const tableHalfWidth = 1.5;
    const tableHalfDepth = 0.6;
    const tableEdgeMargin = 0.02;
    const vesselMinGap = 0.03;

    const placedVessels: { x: number; z: number; footprintRadius: number }[] = [];

    function placeVessel(footprintRadius: number): { x: number; z: number } {
      const maxOffsetX = tableHalfWidth - footprintRadius - tableEdgeMargin;
      const maxOffsetZ = tableHalfDepth - footprintRadius - tableEdgeMargin;
      for (let attempt = 0; 400 > attempt; attempt++) {
        const x = tableCenterX + randInRange(-maxOffsetX, maxOffsetX);
        const z = tableCenterZ + randInRange(-maxOffsetZ, maxOffsetZ);
        const overlaps = placedVessels.some(
          (v) => Math.hypot(x - v.x, z - v.z) < footprintRadius + v.footprintRadius + vesselMinGap,
        );
        if (!overlaps) {
          placedVessels.push({ x, z, footprintRadius });
          return { x, z };
        }
      }
      throw new Error("Could not place workbench glassware without overlap after 400 attempts.");
    }

    // 4 instances per vessel type: 2 randomly generated (but lab-glassware-sensible) sizes,
    // split 2/2 across the 4 instances in random order.
    interface VesselSize {
      radius: number;
      height: number;
    }
    const sizeAssignmentFor = (small: VesselSize, large: VesselSize): VesselSize[] =>
      shuffled([small, small, large, large]);

    // -- Erlenmeyer flasks --
    const flaskSizeAssignment = sizeAssignmentFor(
      { radius: randInRange(0.13, 0.17), height: randInRange(0.36, 0.46) },
      { radius: randInRange(0.19, 0.24), height: randInRange(0.5, 0.62) },
    );
    for (let i = 0; 4 > i; i++) {
      const size = flaskSizeAssignment[i]!;
      const { x, z } = placeVessel(size.radius);
      const flask = new ErlenmeyerFlask(`ErlenmeyerFlask_${i}`, {
        radius: size.radius,
        height: size.height,
        glassMaterial: nextGlassColor(),
      });
      flask.position.set(x, 1, z);
      this.scene.add(flask);
    }

    // -- Apothecary bottles --
    const bottleSizeAssignment = sizeAssignmentFor(
      { radius: randInRange(0.09, 0.12), height: randInRange(0.36, 0.44) },
      { radius: randInRange(0.14, 0.18), height: randInRange(0.52, 0.62) },
    );
    for (let i = 0; 4 > i; i++) {
      const size = bottleSizeAssignment[i]!;
      const { x, z } = placeVessel(size.radius);
      const bottle = new ApothecaryBottle(`ApothecaryBottle_${i}`, {
        radius: size.radius,
        height: size.height,
        glassMaterial: nextGlassColor(),
      });
      bottle.position.set(x, 1, z);
      this.scene.add(bottle);
    }

    // -- Teqler measuring cylinders -- the hexagonal foot flares out to radius * 1.7, so that
    // (not the tube radius) is the true footprint for placement/overlap purposes.
    const cylinderSizeAssignment = sizeAssignmentFor(
      { radius: randInRange(0.045, 0.06), height: randInRange(0.32, 0.42) },
      { radius: randInRange(0.065, 0.085), height: randInRange(0.5, 0.65) },
    );
    for (let i = 0; 4 > i; i++) {
      const size = cylinderSizeAssignment[i]!;
      const footprintRadius = size.radius * 1.7;
      const { x, z } = placeVessel(footprintRadius);
      const color = nextGlassColor();
      const cylinder = new TeqlerMeasuringCylinder(`TeqlerMeasuringCylinder_${i}`, {
        radius: size.radius,
        height: size.height,
        glassMaterial: color,
        footMaterial: color,
        scaleMarkMaterial: color,
      });
      cylinder.position.set(x, 1, z);
      this.scene.add(cylinder);
    }

    // 7. Lighting: Ambient (Increased to balance contrast and prevent pitch-black shadows)
    this.scene.add(new AmbientLight({ color: new Color(0.1, 0.1, 0.15), intensity: 0.4 }));

    // 7. Lighting: Moon/Ocean rays coming from above/side (Dimmed)
    const oceanLight = new DirectionalLight({ color: new Color(0.4, 0.7, 1.0), intensity: 1.0 }); // Increased for visibility
    oceanLight.direction.set(1, -1, 0);
    oceanLight.castShadow = true; // Enable CSM Shadows
    oceanLight.shadowBias = 0.005;
    this.scene.add(oceanLight);

    // 7. Camera & Controls (FPS)
    this.camera.setStrategy(CameraStrategyType.FPS);
    this.camera.position.set(0, 2, 10);
    this.camera.target.set(0, 2, 0);
    this.camera.updateViewMatrix();

    // Initialize collision octree (world boundaries: -30 to 30)
    this.scene.initOctrees(new BoundingBox(new Vector3D(-30, -5, -50), new Vector3D(30, 15, 50)));

    // Add WASD/Mouse controller with collisions
    const fpsController = new FPSController({
      input: this.input,
      moveSpeed: 5.0,
      enableCollision: true,
      scene: this.scene,
      collisionRadius: 0.8,
    });
    this.camera.addBehavior(fpsController);

    // Pointer Lock
    this.canvas.addEventListener("click", (): void => {
      if (!this.input.isPointerLocked) {
        this.input.requestPointerLock(this.canvas);
      }
    });
  }

  protected override update(deltaTime: number): void {
    this._time += deltaTime;

    if (this._portLight && this._portMaterial) {
      // Sync the light bulb's emissive intensity with the actual flickering light intensity
      this._portMaterial.emissiveIntensity = (this._portLight.intensity / 10.0) * 3.0;
    }

    // Adjust base porthole light intensity via NumpadAdd (+) and NumpadSubtract (-)
    if (
      this.input.isPressed("NumpadAdd") ||
      this.input.isPressed("Equal") ||
      this.input.isPressed("BracketRight")
    ) {
      this._portLightBaseIntensity += deltaTime * 5.0;
      console.log(`[Porthole] Base Intensity: ${this._portLightBaseIntensity.toFixed(2)}`);
    }
    if (
      this.input.isPressed("NumpadSubtract") ||
      this.input.isPressed("Minus") ||
      this.input.isPressed("Slash")
    ) {
      this._portLightBaseIntensity = Math.max(0.0, this._portLightBaseIntensity - deltaTime * 5.0);
      console.log(`[Porthole] Base Intensity: ${this._portLightBaseIntensity.toFixed(2)}`);
    }

    // Update gears
    // Rotate gears
    this._gears.forEach((g) => {
      g.obj.rotation.z += g.speed * deltaTime;
    });

    // Update oil material time
    if (this._oilMaterial) {
      this._oilMaterial.time = this._time;
    }

    // Update Water Drops
    for (const drop of this._waterDrops) {
      if (drop.active) {
        drop.velocityY -= 15.0 * deltaTime; // Gravity
        drop.obj.position.y += drop.velocityY * deltaTime;

        // Motion blur stretch
        const stretch = 1.0 + Math.abs(drop.velocityY) * 0.15;
        drop.obj.setScale(1.0, stretch, 1.0);

        if (drop.obj.position.y <= 0.1) {
          drop.active = false;
          drop.obj.position.y = -4; // Hide (but stay within Octree Y > -5)
        }
      } else {
        // Spawn chance based on time
        if (Math.random() < 1.0 * deltaTime) {
          // e.g. at 60 FPS, 1.6% chance per frame per drop
          drop.active = true;
          drop.velocityY = 0;
          // Random position on the ceiling
          const rx = (Math.random() - 0.5) * 16; // -8 to 8
          const rz = (Math.random() - 0.5) * 26 + 5; // -8 to 18
          drop.obj.position.set(rx, 9.8, rz);
          drop.obj.setScale(1.0, 1.0, 1.0);
        }
      }
    }
  }
}

// === START THE ENGINE ===
const app = new Showcase12();
app.start().catch((err: unknown) => console.error("[Showcase12] Failed to start:", err));
