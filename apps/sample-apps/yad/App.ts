import { LevelBuilder } from "./core/LevelBuilder.js";
import { Controller } from "./core/behaviors/Controller.js";
import { Hud } from "./core/Hud.js";
import {
  SmallWorldMachine,
  getRendererTypeFromQuery,
} from "@small-world-machine/engine/core/index.js";
import type { PointLight } from "@small-world-machine/engine/core/lights/index.js";
import { AmbientLight, DirectionalLight } from "@small-world-machine/engine/core/lights/index.js";
import { CameraStrategyType } from "@small-world-machine/engine/enums/index.js";
import { Color } from "@small-world-machine/engine/core/colors/index.js";
import { MathUtils, Vector3D } from "@small-world-machine/engine/math/index.js";
import { PerspectiveProjection } from "@small-world-machine/engine/math/projections/index.js";
import { Texture } from "@small-world-machine/engine/core/textures/index.js";
import { ZoomController } from "@small-world-machine/engine/core/controllers/index.js";
import type { FluidSurfaceMaterial } from "@small-world-machine/engine/core/materials/index.js";
import { QuantizeElement } from "@small-world-machine/engine/renderers/post/elements/index.js";
import { TextLoader } from "@small-world-machine/engine/loaders/index.js";
import { BoundingBox } from "@small-world-machine/engine/physix/index.js";

/**
 * YAD (Yet Another Dungeon)
 * Building a grid-based level from a text file.
 */
export class App extends SmallWorldMachine {
  constructor() {
    // Same `?rendererType=` override as every showcase, so the smoke test can pin the backend (CI has no GPU).
    const rendererType = getRendererTypeFromQuery();
    super(rendererType ? { fullscreen: false, rendererType } : { fullscreen: false });
  }

  private _time: number = 0;
  private _lavaMaterials: FluidSurfaceMaterial[] = [];
  private _lavaLights: PointLight[] = [];
  private _hud!: Hud;
  private _playerController!: Controller;

  public get hud(): Hud {
    return this._hud;
  }

  /** @inheritdoc */
  protected override async setupScene(): Promise<void> {
    // 0. Force Exact 320x200 Retro Resolution with Pillarboxing
    const resizeCanvas = (): void => {
      this.camera.aspect = 320 / 200;
      this.camera.updateProjectionMatrix();

      if (this.renderer) {
        const maxRatio = this.renderer.quality.maxPixelRatio ?? 2;
        const d = Math.min(window.devicePixelRatio || 1, maxRatio);
        this.renderer.setSize(320 / d, 200 / d);
      }

      this.canvas.style.width = "100%";
      this.canvas.style.height = "100%";
      this.canvas.style.objectFit = "fill";
      this.canvas.style.imageRendering = "pixelated";
      this.canvas.style.backgroundColor = "transparent";

      const retroScreen = document.getElementById("retro-screen");
      if (retroScreen) {
        const scale = Math.min(window.innerWidth / 320, window.innerHeight / 200);
        retroScreen.style.width = "320px";
        retroScreen.style.height = "200px";
        retroScreen.style.transform = `translate(-50%, -50%) scale(${scale})`;
        retroScreen.style.transformOrigin = "center center";
      }
    };

    window.addEventListener("resize", resizeCanvas);
    resizeCanvas(); // Trigger immediately to scale the view

    // 1. Camera Setup
    this.camera.projection = new PerspectiveProjection({
      fov: MathUtils.degToRad(75),
      aspect: this.camera.aspect,
      near: 0.1,
      far: 500,
    });
    this.camera.updateProjectionMatrix();
    this.camera.setStrategy(CameraStrategyType.FPS);
    this.camera.phi = 0; // Look straight ahead

    // 1.5 Global Lights
    this.scene.add(new AmbientLight({ color: Color.WHITE, intensity: 0.5 }));
    const sun: DirectionalLight = new DirectionalLight({ color: Color.WHITE, intensity: 0.6 });
    sun.direction.set(-1, -1, -1).normalize();
    this.scene.add(sun);

    // 2. Load Textures
    const wallTex: Texture = await Texture.fromUrl("./assets/dungeon_pack/textures/brbrick.webp", {
      flipY: true,
    });
    const floorTex: Texture = await Texture.fromUrl("./assets/dungeon_pack/textures/flat1_1.webp", {
      flipY: true,
    });
    const ceilTex: Texture = await Texture.fromUrl("./assets/dungeon_pack/textures/ceil3_5.webp", {
      flipY: true,
    });
    const slimeTex: Texture = await Texture.fromUrl("./assets/dungeon_pack/textures/slime01.webp", {
      flipY: true,
    });
    const secretFloorTex: Texture = await Texture.fromUrl(
      "./assets/dungeon_pack/textures/flat5_4.webp",
      {
        flipY: true,
      },
    );
    const secretCeilTex: Texture = await Texture.fromUrl(
      "./assets/dungeon_pack/textures/ceil1_1.webp",
      {
        flipY: true,
      },
    );

    const lavaNoise: Texture = await Texture.fromUrl("./assets/textures/lava.webp", {
      flipY: true,
    });
    const lavaNorm: Texture = await Texture.fromUrl("./assets/textures/lava_normal.webp", {
      generateMipmaps: true,
    });

    // Use proper Dungeon sprites
    const barrelTex: Texture = await Texture.fromUrl("./assets/dungeon_pack/sprites/bar1a0.webp", {
      flipY: true,
    });
    const torchTex: Texture = await Texture.fromUrl("./assets/dungeon_pack/sprites/firea0.webp", {
      flipY: true,
    });
    const doorTex: Texture = await Texture.fromUrl("./assets/dungeon_pack/textures/door9_1.webp", {
      flipY: true,
    });
    const secretDoorTex: Texture = await Texture.fromUrl(
      "./assets/dungeon_pack/textures/brbrick.webp",
      {
        // Looks like wall
        flipY: true,
      },
    );
    const enemyTex: Texture = await Texture.fromUrl("./assets/dungeon_pack/sprites/possa1.webp", {
      flipY: true,
    });
    const itemTexArmor: Texture = await Texture.fromUrl(
      "./assets/dungeon_pack/sprites/bon2a0.webp",
      {
        flipY: true,
      },
    );
    const itemTexHealth: Texture = await Texture.fromUrl(
      "./assets/dungeon_pack/sprites/bon1a0.webp",
      {
        flipY: true,
      },
    );
    const itemTexWeapon: Texture = await Texture.fromUrl(
      "./assets/dungeon_pack/sprites/pista0.webp",
      {
        flipY: true,
      },
    );

    // 2.5 Load Audio
    const audio = this.audio;
    await audio.load("./assets/sounds/door.wav", "door");
    await audio.load("./assets/sounds/secret.wav", "secret_door");
    await audio.load("./assets/sounds/enemy_grunt.wav", "enemy_grunt");
    await audio.load("./assets/sounds/enemy_death.wav", "enemy_death");
    await audio.load("./assets/sounds/shoot.wav", "shoot");
    await audio.load("./assets/sounds/footstep.wav", "footstep");
    await audio.load("./assets/sounds/hurt.wav", "hurt");
    await audio.load("./assets/sounds/pickup.wav", "pickup");

    // 3. Load Level Data
    let mapData = localStorage.getItem("yad_custom_map");
    if (!mapData) {
      const loader: TextLoader = new TextLoader();
      mapData = await loader.load("./assets/levels/level1.txt");
    } else {
      // Custom map loaded
    }

    // 4. Build Level
    const builder: LevelBuilder = new LevelBuilder();
    const { playerStart, lavaMaterials, lavaLights } = await builder.build(this.scene, mapData, {
      floorTexture: floorTex,
      ceilingTexture: ceilTex,
      lavaNoiseMap: lavaNoise,
      lavaNormalMap: lavaNorm,
      playerCamera: this.camera,
      audio: this.audio,
      events: this.events,
      lavaFloorChars: ["T"], // Only T is lava now
      slimeFloorChars: ["~"],
      legend: {
        W: { type: "wall", texture: wallTex },
        G: { type: "wall", texture: wallTex },
        c: { type: "column", texture: wallTex },
        "+": { type: "door", texture: doorTex, doorSound: "door" },
        O: { type: "door", texture: secretDoorTex, doorSound: "secret_door" }, // Secret door looks like wall
        P: { type: "playerSpawn" },
        b: { type: "sprite", texture: barrelTex, spriteScale: 1.5, spriteY: 0.8 },
        E: { type: "sprite", texture: enemyTex, spriteScale: 2.0, spriteY: 0.85, isEnemy: true },
        // Items mapping
        1: {
          type: "sprite",
          texture: itemTexHealth,
          spriteScale: 0.8,
          spriteY: 0.6,
          isItem: true,
          itemType: "health",
          bobbing: true,
        },
        2: {
          type: "sprite",
          texture: itemTexArmor,
          spriteScale: 0.8,
          spriteY: 0.6,
          isItem: true,
          itemType: "armor",
          bobbing: true,
        },
        3: {
          type: "sprite",
          texture: itemTexWeapon,
          spriteScale: 1.0,
          spriteY: 0.6,
          isItem: true,
          itemType: "weapon",
          bobbing: true,
        },
        l: {
          type: "sprite",
          texture: torchTex,
          spriteScale: 1.0,
          spriteY: 1.5,
          lightColor: new Color(1, 0.793, 0.481),
          lightIntensity: 3.0,
        },
        S: { type: "lavaBall" },
        "~": { type: "floor", texture: slimeTex, ceilingTexture: ceilTex },
        X: { type: "floor", texture: secretFloorTex, ceilingTexture: secretCeilTex },
      },
    });

    this._lavaMaterials = lavaMaterials;
    this._lavaLights = lavaLights;
    this.camera.position.copyFrom(playerStart);

    // Start ambient creepy music
    document.addEventListener(
      "click",
      (): void => {
        audio.resume();
        audio.startDrone();
      },
      { once: true },
    );

    // 5. Controllers
    this._playerController = new Controller(this.events, {
      moveSpeed: 10.0,
      scene: this.scene,
      input: this.input,
      audio: this.audio,
    });
    this.camera.addBehavior(this._playerController);
    this.camera.addBehavior(new ZoomController({ input: this.input }));

    // 6. Final Scene Prep
    this.scene.update(); // Update all world matrices first
    this.scene.initOctrees(
      new BoundingBox(new Vector3D(-200, -50, -200), new Vector3D(200, 100, 200)),
    );
    this.scene.updateStaticOctree();
    this.debug = false; // Disable visual debugging for collisions by default

    // 7. Initialize HUD
    this._hud = new Hud(this.events);

    // 8. Apply Retro Color Banding (Quantization)
    if (this.renderer) {
      this.renderer.postProcessing.enabled = true;
      const quant = new QuantizeElement();
      quant.enabled = true;
      quant.steps = 8.0; // 8 levels per RGB channel (3-bit color approximation)
      this.renderer.postProcessing.add(quant);
    }
  }

  /** @inheritdoc */
  protected override update(deltaTime: number): void {
    this._time += deltaTime;
    for (const mat of this._lavaMaterials) {
      mat.time = this._time;
    }
    for (let l = 0; l < this._lavaLights.length; l++) {
      const light = this._lavaLights[l]!;
      const pulse = Math.sin(this._time * 2.1 + l) * 0.5 + 0.5;
      light.intensity = 3.0 + pulse * 2.0;
    }

    if (this._hud && this._playerController) {
      this._hud.update(deltaTime, this._playerController.bobPhase);
    }

    this.audio.updateListener(this.camera);
  }
}

if (typeof window !== "undefined") {
  const app: App = new App();
  app.start().catch((err: unknown) => console.error("[YAD] Failed to start:", err));
}
