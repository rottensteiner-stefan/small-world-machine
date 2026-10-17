import type { EngineOptions } from "@small-world-machine/engine";
import {
  AbstractShowcase,
  AmbientLight,
  BobbingBehavior,
  Color,
  Cube,
  CustomShaderMaterial,
  Cylinder,
  EmissivePulseBehavior,
  HoverBehavior,
  MathUtils,
  Object3D,
  PhysicsSystem,
  PointLight,
  RigidBody,
  RotatorBehavior,
  Sphere,
  StandardMaterial,
  StandardWebGPULayout,
  Texture,
  Torus,
  Vector3D,
} from "@small-world-machine/engine";
import fragWGSL from "@small-world-machine/engine/core/materials/surface/shaders/Standard.frag.wgsl?raw";
import fragGLSL from "@small-world-machine/engine/core/materials/surface/shaders/Standard.frag.glsl?raw";
import fragGLSL100 from "@small-world-machine/engine/core/materials/surface/shaders/Standard.frag.glsl100?raw";
import { MarbleController } from "./MarbleController.js";
import { DroneController } from "./DroneController.js";

class Showcase23 extends AbstractShowcase {
  protected override defaultCameraController = "none" as const;

  private _marble: Object3D | null = null;
  private _ambientAudioStarted: boolean = false;
  private _gameActive: boolean = false;
  private _startButton!: Object3D;
  private _physics!: PhysicsSystem;
  private _score: number = 0;
  private _maxScore: number = 0;
  private _scoreElement!: HTMLDivElement;
  private _timeElement!: HTMLDivElement;
  private _timeLeft: number = 30.0;
  private _gameWon: boolean = false;

  private _cameraRadius: number = 60.0;

  private _formatTime(t: number): string {
    const sec = Math.floor(t);
    const ms = Math.floor((t - sec) * 100);
    return `${sec.toString().padStart(2, "0")}:${ms.toString().padStart(2, "0")}`;
  }

  private _startGame(): void {
    if (this._gameActive) return;

    this._gameActive = true;
    this._gameWon = false;
    this._timeLeft = 30.0;
    this._score = 0;

    // Reset pickups
    for (const obj of this.scene.objects) {
      if (obj.name.startsWith("EnergyCell")) {
        obj.isVisible = true;
        obj.isCollidable = true;
      }
    }
    this._scoreElement.innerText = `SCORE: ${this._score} / ${this._maxScore}`;
    this._timeElement.innerText = `Time: 30:00`;
    this._timeElement.style.color = "#ff3b3b";
    this._timeElement.style.textShadow = "0 0 15px #ff3b3b";

    this._startButton.isVisible = false;
    this._startButton.isCollidable = false;

    // Reset marble position completely in case SPACE is held
    if (this._marble) {
      this._marble.position.set(0, 5, 30);
      this._marble.rigidBody!.velocity.set(0, 0, 0);
      this._marble.rigidBody!.angularVelocity.set(0, 0, 0);
    }

    if (!this._ambientAudioStarted) {
      this._ambientAudioStarted = true;
      this.audio.resume();
    }
  }

  constructor(options: EngineOptions = {}) {
    super({ canvasId: "SmallWorldMachine", ...options });
    this._physics = new PhysicsSystem(this.events);
  }

  protected async setupScene(): Promise<void> {
    // We must use this.scene instead of a local discarded variable
    const scene = this.scene;

    // Fetch UI Elements
    this._scoreElement = document.getElementById("scoreDisplay") as HTMLDivElement;
    this._timeElement = document.getElementById("timeDisplay") as HTMLDivElement;
    this._scoreElement.style.fontWeight = "bold";
    this._scoreElement.style.textShadow = "0 0 10px #00ffff";
    this._scoreElement.innerText = "SCORE: 0 / 0";

    // Camera setup
    this.camera.position.set(0, 35, 55);
    // OrbitController will be attached to the camera later, once the marble is created

    // Lighting (Cyberpunk Neon vibe)
    this.scene.add(new AmbientLight({ color: Color.WHITE, intensity: 0.2 }));

    const purpleLight = new PointLight({
      color: new Color(0.69, 0.0, 1.0),
      intensity: 5.0,
      distance: 50.0,
    });
    purpleLight.position.set(-10, 10, 0);
    scene.add(purpleLight);

    const blueLight = new PointLight({
      color: new Color(0.0, 0.8, 1.0),
      intensity: 3.0,
      distance: 50.0,
    });
    blueLight.position.set(10, 10, 10);
    scene.add(blueLight);

    // Textures
    const [floorTex, bumperTex] = await Promise.all([
      Texture.fromUrl("./assets/scifi_metal_floor.webp"),
      Texture.fromUrl("./assets/scifi_crate_cyan.webp"),
    ]);

    // Goal Zone (Plattform 3: Z=-20 to -40. Placement at the end of the track)
    const goalMat = new StandardMaterial({
      color: new Color(0, 1.0, 0),
      emissiveColor: new Color(0, 1.0, 0),
      emissiveIntensity: 2.0,
      roughness: 0.2,
      metallic: 0.1,
    });
    const goalZone = new Object3D("GoalZone");
    goalZone.geometry = new Cube({ size: 1 }).getGeometryData();
    goalZone.scale.set(10, 1, 10);
    goalZone.material = goalMat;
    goalZone.position.set(0, 0.5, -35); // Y=0.5 (Plat3 top is Y=0), Z=-35 (End of Plat3)
    goalZone.rigidBody = new RigidBody(0);
    goalZone.rigidBody.isSensor = true;
    scene.add(goalZone);

    // Drones (Enemies) - updated to spawn over the whole track

    // Floor Material using CustomShaderMaterial
    const floorMat = new CustomShaderMaterial({
      sources: {
        wgsl: `[WGSL_STRUCTS]\n[WGSL_PBR_MATH]\n[WGSL_VS]\n${fragWGSL.replace(
          "[WGSL_PBR_LIGHTING]",
          `[WGSL_PBR_LIGHTING]
          if (obj.time > 0.0) {
              let wave = sin(i.wp.z * 0.5 + obj.time * 5.0) * 0.5 + 0.5;
              let scanner = pow(max(0.0, wave), 10.0);
              let emissiveBase = sRGBToLinear(textureSample(u_emissiveMap, s, i.uv).rgb) * sRGBToLinear(obj.specColor.rgb);
              color += emissiveBase * (obj.specColor.a + scanner * 2.0);
          }`,
        )}`,
        glsl300: {
          vs: "[BASE_VERTEX_HEADER][BASE_VERTEX_MAIN]",
          fs: fragGLSL.replace(
            "[LIGHT_CALC_PBR]",
            `[LIGHT_CALC_PBR]
            if (u_time > 0.0) {
                float wave = sin(v_worldPos.z * 0.5 + u_time * 5.0) * 0.5 + 0.5;
                float scanner = pow(max(0.0, wave), 10.0);
                vec3 emissiveBase = sRGBToLinear(texture(u_emissiveMap, v_uv).rgb) * sRGBToLinear(u_specColor.rgb);
                fragColor.rgb += emissiveBase * (u_specColor.a + scanner * 2.0);
            }`,
          ),
        },
        glsl100: {
          vs: "[BASE_VS]",
          fs: fragGLSL100.replace(
            "[LIGHT_CALC_PBR]",
            `[LIGHT_CALC_PBR]
            if (u_time > 0.0) {
                float wave = sin(v_worldPos.z * 0.5 + u_time * 5.0) * 0.5 + 0.5;
                float scanner = pow(max(0.0, wave), 10.0);
                vec3 emissiveBase = sRGBToLinear(texture2D(u_emissiveMap, v_uv).rgb) * sRGBToLinear(u_specColor.rgb);
                gl_FragColor.rgb += emissiveBase * (u_specColor.a + scanner * 2.0);
            }`,
          ),
        },
      },
      layout: StandardWebGPULayout,
      properties: {
        u_model: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], // identity matrix fallback
        u_color: new Color(0.8, 0.8, 0.8),
        u_specColor: new Color(0.8, 0.1, 1.0, 2.0), // Neon Purple + Intensity 2.0
        u_texOffset: [0, 0],
        u_texRepeat: [1, 1],
        u_shininess: 32.0,
        u_isTerrain: 0.0,
        u_metallic: 0.6,
        u_roughness: 0.4,
        u_extraParams: [1.0, 0.0, 1.0, 1.0], // ao=1
        u_liquidParams: [0, 0, 0, 0],
        u_thresholds: [0, 0, 0, 0],
        u_useEnvMap: 0,
        u_useReflectionMap: 0,
        u_reflectivity: 1.0,
        u_time: 0.0,
      },
      textures: {
        u_diffuseMap: floorTex,
        u_emissiveMap: floorTex,
      },
    });
    this._floorMat = floorMat;

    // --- TRACK LAYOUT ---
    const buildPlatform = (name: string, w: number, d: number, y: number, z: number): void => {
      const p = new Object3D(name);
      p.geometry = new Cube({ size: 1 }).getGeometryData();
      p.setScale(w, 10, d);
      p.position.set(0, y - 5, z); // Top surface at y
      p.material = floorMat;
      p.rigidBody = new RigidBody(0);

      // We only need ONE object to drive the heartbeat of the shared CustomShaderMaterial
      if (name === "Plat1") {
        p.addBehavior(
          new EmissivePulseBehavior({ baseIntensity: 0.2, pulseAmplitude: 2.0, pulseSpeed: 4.0 }),
        );
      }
      scene.add(p);
    };

    buildPlatform("Plat1", 20, 20, 0, 30); // Z: 20 to 40
    buildPlatform("Plat2", 20, 20, -5, 0); // Z: -10 to 10
    buildPlatform("Plat3", 20, 20, 0, -30); // Z: -20 to -40

    // Stairs 1: Down from Plat1 to Plat2 (Z: -10 to -20)
    for (let i = 0; i < 10; i++) {
      const step = new Object3D("Stair1_" + i);
      step.geometry = new Cube({ size: 1 }).getGeometryData();
      step.setScale(10, 10, 1);
      const topY = -0.5 * (i + 1);
      step.position.set(0, topY - 5, 19.5 - i);
      step.material = floorMat;
      step.rigidBody = new RigidBody(0);
      scene.add(step);
    }

    // Stairs 2: Up from Plat2 to Plat3 (Z: -40 to -50)
    for (let i = 0; i < 10; i++) {
      const step = new Object3D("Stair2_" + i);
      step.geometry = new Cube({ size: 1 }).getGeometryData();
      step.setScale(10, 10, 1);
      const topY = -5 + 0.5 * (i + 1);
      step.position.set(0, topY - 5, -10.5 - i);
      step.material = floorMat;
      step.rigidBody = new RigidBody(0);
      scene.add(step);
    }

    // Marble Material (Glowing Cyberpunk Cyan)
    const marbleMat = new StandardMaterial({
      roughness: 0.2,
      metallic: 0.5,
      color: new Color(0.1, 0.8, 1.0), // Cyan
      emissiveColor: new Color(0.0, 0.4, 0.8), // Inner glow
      emissiveIntensity: 0.4, // Reduced so it doesn't become a 100% flat 2D circle!
    });

    // The Player Marble
    this._marble = new Object3D("Marble");
    this._marble.geometry = new Sphere({ radius: 1 }).getGeometryData();
    this._marble.position.set(0, 5, 30);
    this._marble.material = marbleMat;
    this._marble.rigidBody = new RigidBody(1);
    this._marble.rigidBody.restitution = 0.5; // Bouncy
    this._marble.rigidBody.friction = 0.999; // Less air resistance
    this._marble.addBehavior(new MarbleController(this.camera, this.input, 25.0));

    // Add a point light to the marble to create a true "glow" on the environment
    const marbleGlow = new PointLight({
      color: new Color(0.1, 0.8, 1.0),
      intensity: 100.0, // PBR needs high intensity to visibly illuminate the floor!
      distance: 30.0,
    });
    this._marble.add(marbleGlow);

    scene.add(this._marble);

    // Initial camera angles
    this.camera.theta = 0;
    this.camera.phi = 0.5;

    // Add some random bumpers
    const bumperMat = new StandardMaterial({
      diffuseMap: bumperTex,
      emissiveMap: bumperTex,
      emissiveColor: new Color(0.2, 0.2, 0.2), // Slight boost to the pink lines
      emissiveIntensity: 1.2,
      roughness: 0.3,
      metallic: 0.7,
      color: new Color(0.8, 0.8, 0.8),
    });

    const usedPositions: { x: number; z: number }[] = [];
    const getSafePos = (isBumper: boolean): { x: number; y: number; z: number } | null => {
      let attempts = 0;
      while (attempts < 50) {
        const plat = Math.floor(Math.random() * 3); // 0, 1, 2
        const x = Math.random() * 16 - 8;
        let z: number;
        let y: number;
        if (plat === 0) {
          z = 30 + (Math.random() * 16 - 8);
          y = 0;
        } else if (plat === 1) {
          z = 0 + (Math.random() * 16 - 8);
          y = -5;
        } else {
          z = -30 + (Math.random() * 16 - 8);
          y = 0;
        }

        // Avoid start button
        if (plat === 0 && Math.sqrt(x * x + (z - 30) * (z - 30)) < 6.0) {
          attempts++;
          continue;
        }

        let overlap = false;
        for (const p of usedPositions) {
          const dx = x - p.x;
          const dz = z - p.z;
          if (Math.sqrt(dx * dx + dz * dz) < 3.5) {
            overlap = true;
            break;
          }
        }
        if (!overlap) {
          usedPositions.push({ x, z });
          return { x, y: y + (isBumper ? 1 : 1.5), z };
        }
        attempts++;
      }
      return null;
    };

    for (let i = 0; i < 15; i++) {
      const pos = getSafePos(true);
      if (pos) {
        const bumper = new Object3D("Bumper" + i);
        if (Math.random() > 0.5) {
          bumper.geometry = new Cylinder({
            radiusTop: 1,
            radiusBottom: 1,
            height: 2,
            radialSegments: 16,
          }).getGeometryData();
        } else {
          bumper.geometry = new Cube({ size: 2 }).getGeometryData();
        }
        bumper.position.set(pos.x, pos.y, pos.z);
        bumper.material = bumperMat;
        bumper.rigidBody = new RigidBody(0);
        bumper.rigidBody.restitution = 1.5;
        scene.add(bumper);
      }
    }

    // --- ENERGY CELLS (Pickups) ---
    const cellGeo = new Sphere({ radius: 0.5 }).getGeometryData();
    const cellMat = new StandardMaterial({
      color: new Color(0, 1, 0.5),
      emissiveColor: new Color(0, 1, 0.5),
      emissiveIntensity: 2.0,
      roughness: 0.2,
      metallic: 0.8,
    });

    for (let i = 0; i < 10; i++) {
      const cell = new Object3D("EnergyCell" + i);
      cell.geometry = cellGeo;
      cell.material = cellMat;

      // Place on platforms
      const pos = getSafePos(false);
      if (pos) {
        cell.position.set(pos.x, pos.y, pos.z);
      } else {
        cell.position.set(0, 1.5, -30); // fallback to end platform
      }

      // Make it a physical sensor
      cell.rigidBody = new RigidBody(0);
      cell.rigidBody.isSensor = true;

      // Add behaviors for floating effect
      cell.addBehavior(new RotatorBehavior(new Vector3D(0, 2.0, 0)));
      cell.addBehavior(new BobbingBehavior(0.3, 3.0));

      scene.add(cell);
      this._maxScore++;
    }
    this._scoreElement.innerText = `SCORE: ${this._score} / ${this._maxScore}`;

    // --- START BUTTON (Invisible Box Hitbox + Visual Hexagon) ---
    this._startButton = new Object3D("StartButtonZone");
    // An invisible BOX as a pure collision body.
    // Since it has NO material, the renderer completely ignores it (0 draw calls).
    // But since isVisible=true, the Raycaster can hit its 12 triangles!
    this._startButton.geometry = new Cube({ size: 7.6 }).getGeometryData();
    this._startButton.setScale(1, 0.2, 1); // Flatten it to a disk-like box
    this._startButton.position.set(0, 5, 30);
    this._startButton.rigidBody = new RigidBody(0); // static platform

    // The visual Hexagon Ring
    const hexVisual = new Object3D("HexagonVisual");
    hexVisual.geometry = new Torus({
      radius: 3,
      tube: 0.5,
      tubularSegments: 6, // 6 segments = Hexagon
      radialSegments: 16,
    }).getGeometryData();
    hexVisual.material = new StandardMaterial({
      color: new Color(1, 0.8, 0),
      emissiveColor: new Color(1, 0.5, 0),
      emissiveIntensity: 1.5,
      metallic: 0.8,
      roughness: 0.2,
    });
    hexVisual.rotation.x = MathUtils.HALF_PI; // Lay flat
    this._startButton.add(hexVisual);

    // Animations & Logic on the parent
    this._startButton.addBehavior(new HoverBehavior(0.5));
    this._startButton.addBehavior(new RotatorBehavior(new Vector3D(0, 0.5, 0)));
    this._startButton.onPointerClick = (): void => this._startGame();
    scene.add(this._startButton);

    // --- DRONES ---
    const droneColors = [
      new Color(1, 0, 1), // Magenta
      new Color(0, 1, 1), // Cyan
      new Color(0.5, 1, 0), // Lime Green
      new Color(1, 0.5, 0), // Neon Orange
      new Color(1, 1, 1), // Bright White
    ];
    const droneMaterials = droneColors.map(
      (c) =>
        new StandardMaterial({
          color: c,
          emissiveColor: c,
          emissiveIntensity: 1.5,
          roughness: 1.0,
          metallic: 0.0,
        }),
    );
    const droneGeo = new Sphere({ radius: 0.15 }).getGeometryData();

    for (let i = 0; i < 120; i++) {
      const drone = new Object3D("Drone" + i);
      drone.geometry = droneGeo;
      drone.isCollidable = false; // Drones should NOT collide with anything.

      const randMat = droneMaterials[Math.floor(Math.random() * droneMaterials.length)]!;
      drone.material = randMat;
      drone.position.set(Math.random() * 200 - 100, Math.random() * 20, Math.random() * 200 - 100);
      drone.addBehavior(new DroneController(this.scene, randMat));
      // Give each drone a slightly randomized heartbeat so they look more "alive" and un-synchronized
      drone.addBehavior(
        new EmissivePulseBehavior({
          baseIntensity: 0.5,
          pulseAmplitude: 1.5,
          pulseSpeed: 3.0 + Math.random() * 2.0,
        }),
      );
      scene.add(drone);
    }

    // --- DRONE SPAWN MARKERS & VECTORS (Removed as requested) ---

    // Ensure all objects have their world matrices and bounds properly initialized for the first frame
    scene.update();
    for (const obj of scene.objects) {
      obj.computeBounds();
    }

    // Audio & Logic on collision
    this.events.addEventListener("physics:collision", (e: Record<string, unknown>): void => {
      // Play a generative synth note based on impulse strength
      const impulse = e["impulse"] as number;
      if (impulse > 1.0 && this._ambientAudioStarted) {
        this.audio.playTone(400 + Math.random() * 200, 0.5, 0.2, "sine");
      }

      // Pickup logic (impulse is 0 for sensors)
      const objA = e["objectA"] as Object3D;
      const objB = e["objectB"] as Object3D;

      const checkCell = (player: Object3D, other: Object3D): void => {
        if (player === this._marble && other.name.startsWith("EnergyCell") && other.isVisible) {
          other.isVisible = false; // "Collect" it
          other.isCollidable = false; // Stop checking collisions
          this._score++;
          this._scoreElement.innerText = `SCORE: ${this._score} / ${this._maxScore}`;

          if (this._ambientAudioStarted) {
            this.audio.playTone(1200, 0.1, 0.1, "square"); // Pickup sound
          }
        }
      };

      const checkGoal = (player: Object3D, other: Object3D): void => {
        if (
          player === this._marble &&
          other.name === "GoalZone" &&
          !this._gameWon &&
          this._gameActive
        ) {
          this._gameWon = true;
          this._gameActive = false;
          this._timeElement.innerText = `YOU WIN! Time: ${this._formatTime(this._timeLeft)}`;
          this._timeElement.style.color = "#00ff00";
          this._timeElement.style.textShadow = "0 0 15px #00ff00";
          if (this._ambientAudioStarted) {
            this.audio.playTone(600, 0.5, 0.1, "sine");
            setTimeout(() => this.audio.playTone(800, 0.5, 0.1, "sine"), 200);
            setTimeout(() => this.audio.playTone(1200, 1.0, 0.1, "sine"), 400);
          }
        }
      };

      checkCell(objA, objB);
      checkCell(objB, objA);
      checkGoal(objA, objB);
      checkGoal(objB, objA);
    });

    // Start Audio on first click or keypress
    const unlockAudio = (): void => {
      if (!this._ambientAudioStarted) {
        this._ambientAudioStarted = true;
        this.audio.resume();
      }
    };
    window.addEventListener("pointerdown", unlockAudio, { once: true });
    window.addEventListener("keydown", unlockAudio, { once: true });
  }

  private _floorMat!: CustomShaderMaterial;
  private _shaderTime: number = 0.0;

  public override update(dt: number): void {
    // Shader Animation Time update
    this._shaderTime += dt;
    if (this._floorMat) {
      this._floorMat.setProperty("u_time", this._shaderTime);
    }

    // Step the physics engine first
    this._physics.step(this.scene, dt);

    if (!this._marble) return;

    if (!this._gameActive) {
      // Start via SPACE key
      if (this.input.isPressed("Space")) {
        this._startGame();
      } else if (!this._gameWon) {
        // Freeze the marble in the center of the ring until the game starts
        this._marble.position.set(0, 5, 30);
        this._marble.rigidBody!.velocity.set(0, 0, 0);
      }
    } else {
      // Timer tick
      this._timeLeft -= dt;
      if (this._timeLeft <= 0) {
        this._timeLeft = 0;
        this._gameActive = false;
        this._startButton.isVisible = true;
        this._startButton.isCollidable = true;
        this._timeElement.innerText = "TIME UP!";
        this._timeElement.style.color = "#ff0000";
        if (this._ambientAudioStarted) {
          this.audio.playTone(200, 1.0, 0.1, "sawtooth");
        }
      } else {
        this._timeElement.innerText = `Time: ${this._formatTime(this._timeLeft)}`;
      }

      if (this._marble.position.y < -15) {
        // Marble fell off the map! Reset!
        console.warn("[Physics Debug] Kugel ist unter Y=-15 gefallen! Führe Reset aus...");
        this._gameActive = false;
        this._startButton.isVisible = true;
        this._startButton.isCollidable = true;
      }
    }

    // Mouse drag camera rotation
    if (this.input.mouse.left) {
      this.camera.theta -= this.input.mouse.dx * 0.005;
      this.camera.phi += this.input.mouse.dy * 0.005;
      // Clamp phi to avoid flipping
      const limit = Math.PI / 2 - 0.01;
      this.camera.phi = Math.max(-limit, Math.min(limit, this.camera.phi));
    }

    // Zoom (Pinch / Scroll)
    if (this.input.mouse.zoom !== 0) {
      // Zoom is accumulated across the frame. Small factor to make it smooth.
      this._cameraRadius += this.input.mouse.zoom * 20.0;
      // Clamp radius between 20 (close) and 120 (far)
      this._cameraRadius = Math.max(20, Math.min(120, this._cameraRadius));
    }

    // Die Kamera folgt der Murmel weich und behält den Orbit-Abstand bei
    this.camera.target.copyFrom(this._marble.position);
    this.camera.position.x =
      this.camera.target.x +
      this._cameraRadius * Math.sin(this.camera.theta) * Math.cos(this.camera.phi);
    this.camera.position.y = this.camera.target.y + this._cameraRadius * Math.sin(this.camera.phi);
    this.camera.position.z =
      this.camera.target.z +
      this._cameraRadius * Math.cos(this.camera.theta) * Math.cos(this.camera.phi);
  }
}

const app = new Showcase23();
app.start().catch((err: unknown) => console.error("[Showcase23] Failed to start:", err));
