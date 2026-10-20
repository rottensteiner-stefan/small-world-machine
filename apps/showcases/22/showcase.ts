import type {
  BloomElement,
  EngineOptions,
  GravitationalLensingElement,
} from "@small-world-machine/engine";
import {
  AbstractShowcase,
  AmbientLight,
  BasicMaterial,
  CameraStrategyType,
  Color,
  DirectionalLight,
  FollowCameraBehavior,
  Object3D,
  OrbitController,
  PerformanceTier,
  PostProcessingEffectType,
  Skydome,
  Sphere,
  Texture,
} from "@small-world-machine/engine";
import {
  AccretionDiskEmitter,
  ParticleMeshRenderer,
  TurbulenceAffector,
} from "@small-world-machine/vfx-extras";

class Showcase22 extends AbstractShowcase {
  private _accretionDisk!: AccretionDiskEmitter;
  private _particleRenderer!: ParticleMeshRenderer;

  constructor(options: EngineOptions = {}) {
    super(options);
  }

  protected async setupScene(): Promise<void> {
    let droneStarted = false;
    // Use pointerdown to support both mouse clicks and mobile touch
    this.canvas.addEventListener("pointerdown", () => {
      if (!droneStarted) {
        this.audio.startDrone();
        droneStarted = true;
      }
      if (!this.context.deviceCaps.isMobile() && !this.input.isPointerLocked) {
        this.input.requestPointerLock(this.canvas);
      }
    });

    const tier = this.context.deviceCaps.getPerformanceTier();

    // 0. Enable Bloom & Gravitational Lensing!
    this.renderer.postProcessing.enabled = true;
    this.renderer.postProcessing.filterMode = 8; // Black Hole Shader (Gravitational Lensing)

    const bloom = this.renderer.postProcessing.get<BloomElement>(PostProcessingEffectType.BLOOM);
    if (bloom) {
      if (tier === PerformanceTier.LOW) {
        bloom.enabled = false;
      } else {
        bloom.enabled = true;
        bloom.intensity = tier === PerformanceTier.MEDIUM ? 1.0 : 2.2;
        bloom.threshold = 0.15;
        bloom.radius = 1.0;
      }
    }

    const lensing = this.renderer.postProcessing.get<GravitationalLensingElement>(
      PostProcessingEffectType.GRAVITATIONAL_LENSING,
    );
    if (lensing) {
      lensing.enabled = true;
      lensing.eventHorizonRadius = 0.032;
      lensing.strength = 0.28;
      lensing.spaghettification = 0.18;
      lensing.relativisticBeaming = 1.3;
      lensing.ringGlowIntensity = 2.8;
    }

    // 1. Lighting Setup
    const ambient = new AmbientLight({ color: new Color(0.1, 0.1, 0.2), intensity: 1.0 });
    const dirLight = new DirectionalLight({ color: new Color(0.8, 0.9, 1.0), intensity: 2.0 });
    dirLight.position.set(10, 20, 10);
    this.scene.add(ambient, dirLight);

    // 2. Camera Setup
    this.camera.setStrategy(CameraStrategyType.HYBRID_SYNC);
    this.camera.position.set(0, 20, 40);
    this.camera.target.set(0, 0, 0);
    this.camera.addBehavior(new OrbitController({ input: this.input }));

    // 3. Environment: The Magnetic Singularity & Milky Way Skydome
    const skyTexture = await Texture.fromUrl("./assets/milkyway.webp", { flipY: false });
    const skydome = new Skydome({
      texture: skyTexture,
      radius: 1000,
      widthSegments: 32,
      heightSegments: 32,
    });
    skydome.name = "Skydome";
    skydome.addBehavior(new FollowCameraBehavior({ camera: this.camera }));
    this.scene.add(skydome);

    // Visual marker for the black hole core
    const singularity = new Object3D("Singularity");
    singularity.geometry = new Sphere({
      radius: 0.22,
      widthSegments: 16,
      heightSegments: 16,
    }).getGeometryData();
    singularity.material = new BasicMaterial({
      color: new Color(0.0, 0.0, 0.0, 1.0),
    });
    this.scene.add(singularity);

    // 4. High-Density Accretion Disk Simulation (via @small-world-machine/vfx-extras)
    let particleCount = 3000;
    if (tier === PerformanceTier.LOW) particleCount = 800;
    else if (tier === PerformanceTier.MEDIUM) particleCount = 1600;

    this._accretionDisk = new AccretionDiskEmitter({
      particleCount,
      innerRadius: 0.6,
      outerRadius: 3.2,
      eventHorizonRadius: 0.35,
      fadeStartRadius: 0.55,
      mass: 800,
      diskThickness: 0.18,
      driftFactor: 0.985,
    });

    // Add mild plasma curl turbulence
    this._accretionDisk.system.addAffector(
      new TurbulenceAffector({
        frequency: 0.8,
        strength: 2.0,
        evolutionSpeed: 0.5,
      }),
    );

    // 5. High-Performance Instanced Mesh Renderer (1 Draw Call for thousands of particles)
    const particleGeo = new Sphere({
      radius: 0.06,
      widthSegments: 6,
      heightSegments: 6,
    }).getGeometryData();

    const particleMat = new BasicMaterial({
      color: new Color(1.0, 0.5, 0.1, 1.0),
    });

    this._particleRenderer = new ParticleMeshRenderer({
      name: "AccretionDiskMesh",
      system: this._accretionDisk.system,
      geometry: particleGeo,
      material: particleMat,
      enableColorBuffer: true,
    });

    this.scene.add(this._particleRenderer.mesh);
  }

  protected override update(dt: number): void {
    if (this._accretionDisk && this._particleRenderer) {
      // Step simulation and sync GPU instance matrix buffers
      this._accretionDisk.update(dt);
      this._particleRenderer.sync();
    }
  }
}

const app = new Showcase22();
app.start().catch((err: unknown) => console.error("[Showcase22] Failed to start:", err));
