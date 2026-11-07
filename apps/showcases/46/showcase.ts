import type { EngineOptions } from "@small-world-machine/engine";
import {
  AbstractShowcase,
  AmbientLight,
  BasicMaterial,
  CameraStrategyType,
  Color,
  Cube,
  DirectionalLight,
  FlyController,
  Object3D,
  RendererType,
  Vector3D,
  WeatherEmitter,
  WeatherHeightfieldCollider,
  WebGPURenderer,
} from "@small-world-machine/engine";
import { mulberry32 } from "@small-world-machine/engine/utils/SeededRandom.js";
import {
  CurlNoiseAffector,
  GravityAffector,
  GPUParticleSystem,
  ParticleLightPool,
  ParticleMeshRenderer,
  ParticleSystem,
  ParticleTrailRenderer,
  SdfColliderAffector,
  SmokeSpriteMaterial,
  SubEmitter,
} from "@small-world-machine/vfx-extras";
import { GoldenCapture, parseGoldenSpec, type GoldenCaptureOptions } from "./GoldenCapture.js";
import { Hud, defaultHudState, type HudState } from "./Hud.js";
import {
  cameraFor,
  cameraFrom,
  resolveVariant,
  type CameraPoolId,
  type ParticleVariant,
} from "./Variants.js";

/**
 * Showcase 46 — Particle Variant Lab.
 *
 * A fire-45-style variant lab over the S34 particle lanes: the viewer (or a golden capture) selects
 * one of the curated effect variants (`overview`/`forge`/`smoke`/`trails`/`weather`/`gpu`) and one
 * camera pool (`overview`/`closeup`/`budget`). Variants share the single lab scene; switching only
 * toggles lane visibility/emission + camera — no resource flips (zero-GC friendly, stable).
 *
 * Lanes (from the `particle-system-s34` campaign):
 *   - forge:   sparks (SoA, analytical SDF collision, impact sub-emitter) + pooled point lights
 *   - smoke:   smoke swirl (curl-noise) through the soft-particle + 6-way volume-lit material
 *   - trails:  ribbon trail tracking a live tracer spark running the real physics lane
 *   - weather: roof-aware rain (heightfield roof cull) + splash bursts on impact
 *   - gpu:     WebGPU compute lane (`GPUParticleSystem`), honest fallback to `forge` without a device
 *
 * Golden mode: `?__golden=<part46-<variant>-<pool>>&__goldenFrames=N` runs a deterministic capture
 * (see `GoldenCapture.ts`). Deterministic auto-emission (seed-pinned `mulberry32`, rate-based) keeps
 * every variant observable without keyboard input.
 */

/** Deterministic auto-emission rates (particles per second). Scaled by the live HUD sliders. */
const SPARK_EMIT_RATE = 30;
const SMOKE_EMIT_RATE = 6;
const GPU_EMIT_RATE = 64;
/** HUD readout refresh interval (seconds). Status text is cheap, not per-frame work. */
const READOUT_INTERVAL = 0.33;
/** Seed for the deterministic auto-emission stream (`mulberry32`); re-pinned at golden freeze. */
const EMISSION_SEED = 20260718;

export class Showcase extends AbstractShowcase {
  private _sparks!: ParticleSystem;
  private _sparkRenderer!: ParticleMeshRenderer;
  private _embers!: ParticleSystem;
  private _emberRenderer!: ParticleMeshRenderer;
  private _smoke!: ParticleSystem;
  private _smokeRenderer!: ParticleMeshRenderer;
  private _collider!: SdfColliderAffector;
  private _impactSubEmitter!: SubEmitter;
  private _lightPool!: ParticleLightPool;
  private _trailRenderer!: ParticleTrailRenderer;
  private _tracerSlot = -1;
  private _lastTracerPosition = new Vector3D(0, 2.4, 0.4);
  private _trailEmitterCooldown = 0;
  private _weather!: WeatherEmitter;
  private _roofCollider!: WeatherHeightfieldCollider;
  private _roofBakeCooldown = 0;
  private _splashSource!: ParticleSystem;
  private _splashRenderer!: ParticleMeshRenderer;
  private _burstCooldown = 0;

  // Variant lab state (fire-45 style): HUD settings, golden capture, deterministic emission.
  private readonly _settings: HudState = defaultHudState();
  private _hud: Hud | undefined = undefined;
  private _goldenCapture: GoldenCapture | undefined = undefined;
  /** WebGPU compute lane; only present when a live GPU device could be attached. */
  private _gpuSystem: GPUParticleSystem | undefined = undefined;
  // Scratch options for `_emitSparkBurst` (emit copies into the SoA arrays; no per-spark allocation).
  private readonly _burstOptions = {
    position: new Vector3D(),
    velocity: new Vector3D(),
    size: 0,
    maxLife: 0,
    heat: 0,
  };
  private _rng = mulberry32(EMISSION_SEED);
  private _autoSparksAcc = 0;
  private _autoSmokeAcc = 0;
  private _autoGpuAcc = 0;
  private _readoutTimer = 0;
  /** Last applied (variant|pool) combination; the camera re-positions only when it changed. */
  private _lastCamKey: string | undefined = undefined;

  constructor(options: EngineOptions = {}) {
    super(options);
  }

  protected async setupScene(): Promise<void> {
    this.camera.setStrategy(CameraStrategyType.FPS);
    this.camera.addBehavior(
      new FlyController({
        input: this.input,
        moveSpeed: 2.5,
        fastMultiplier: 2.0,
        slowMultiplier: 0.4,
        lookSensitivity: 0.0025,
        enableVertical: true,
        flyInLookDirection: true,
      }),
    );

    const ambient = new AmbientLight({
      color: new Color(0.35, 0.3, 0.28),
      intensity: 0.35,
    });
    this.scene.add(ambient);

    const forgeLight = new DirectionalLight({
      direction: new Vector3D(0.5, -0.7, -0.55).normalize(),
      color: new Color(1.0, 0.82, 0.6),
      intensity: 2.2,
      numCascades: 2,
      cascadeSplitLambda: 0.5,
    });
    forgeLight.castShadow = true;
    forgeLight.shadowBias = 0.0015;
    forgeLight.shadowResolution = 2048;
    this.scene.add(forgeLight);

    // Ground plate for visual grounding of the lab (no physics involvement).
    const floorMesh = new Cube({ size: 1 }).getGeometryData();
    const floor = new Object3D("labFloor");
    floor.geometry = floorMesh;
    floor.material = new BasicMaterial({ color: new Color(0.12, 0.11, 0.1) });
    floor.scale.set(14, 0.2, 10);
    floor.position.set(0, -0.2, 0);
    this.scene.add(floor);

    // Anvil simulation volume: sphere "hammering ball" + workbench box.
    this._collider = new SdfColliderAffector({
      restitution: 0.42,
      friction: 0.28,
      primitives: [
        { type: "sphere", center: new Vector3D(0, 0.9, 0), radius: 0.45 },
        {
          type: "box",
          center: new Vector3D(0, 0.1, 0),
          halfExtents: new Vector3D(1.0, 0.12, 0.75),
        },
      ],
    });

    // ---- Lane: forge sparks (CPU SoA, SDF collision, sub-emitter impact bursts) ----
    this._sparks = new ParticleSystem({
      capacity: 700,
      affectors: [new GravityAffector({ acceleration: new Vector3D(0, -9.0, 0) }), this._collider],
    });
    this._sparkRenderer = new ParticleMeshRenderer({
      name: "LabSparksMesh",
      billboard: "spherical",
      system: this._sparks,
      material: new BasicMaterial({ color: new Color(1.0, 0.78, 0.4, 1.0) }),
      geometryMode: "octagon",
      enableColorBuffer: true,
    });
    this.scene.add(this._sparkRenderer.mesh);

    // T1: pooled PointLights follow the hottest live sparks (heat * alpha score, zero-alloc).
    // Budget: pool caps at 8, all light sources in the scene share the 16-slot dynamic budget.
    this._lightPool = new ParticleLightPool(this._sparks, this.scene.root, {
      maxActive: 6,
      lightDistance: 2.6,
      intensityScale: 3.2,
      minScore: 0.2,
    });

    // Impact embers spawned by the SubEmitter ring buffer on collision.
    this._embers = new ParticleSystem({
      capacity: 360,
      affectors: [new GravityAffector({ acceleration: new Vector3D(0, -6.0, 0) })],
    });
    this._emberRenderer = new ParticleMeshRenderer({
      name: "LabEmbersMesh",
      billboard: "spherical",
      system: this._embers,
      material: new BasicMaterial({ color: new Color(1.0, 0.55, 0.25, 1.0) }),
      geometryMode: "octagon",
      enableColorBuffer: true,
    });
    this.scene.add(this._emberRenderer.mesh);

    this._impactSubEmitter = new SubEmitter({
      source: this._sparks,
      target: this._embers,
      trigger: "collision",
      collider: this._collider,
      burstCount: 3,
      coneHalfAngle: Math.PI / 3,
      speedRange: [0.5, 1.4],
      lifeRange: [0.2, 0.5],
      sizeRange: [0.03, 0.07],
    });

    // ---- Lane: obstacle-aware smoke swirl (curl noise, smoke material) ----
    this._smoke = new ParticleSystem({
      capacity: 260,
      affectors: [
        new CurlNoiseAffector({ frequency: 0.55, strength: 1.35 }),
        new GravityAffector({ acceleration: new Vector3D(0, 0.65, 0) }),
      ],
    });
    this._smokeRenderer = new ParticleMeshRenderer({
      name: "LabSmokeMesh",
      billboard: "spherical",
      system: this._smoke,
      // T2+T3: soft-particle depth fade (softFadeDistance > 0 activates the u_opaqueDepthMap
      // sampling, declared in the material layout) + procedural 6-way volume lighting
      // (lightIntensity > 0 switches the closed-form FBM-gradient self-shadow / HG rim lobe on).
      material: new SmokeSpriteMaterial({
        churn: 1.4,
        softFadeDistance: 0.55,
        lightDirection: new Vector3D(0.5, -0.7, -0.55).normalize(),
        lightIntensity: 1.6,
        ambientLight: 0.35,
        selfShadowStrength: 0.65,
        rimStrength: 1.1,
        forwardScatter: 0.55,
      }),
      geometryMode: "octagon",
      foldAlphaIntoScale: false,
      enableColorBuffer: true,
    });
    this.scene.add(this._smokeRenderer.mesh);

    // ---- Lane: ribbon trail behind a tracked tracer (zero-GC ring history) ----
    this._trailRenderer = new ParticleTrailRenderer({
      name: "LabTracerTrail",
      maxHistory: 384,
      width: 0.16,
      minStep: 0.06,
      fadeTime: 0.7,
      color: new Color(1.0, 0.62, 0.28, 1.0),
      alpha: 0.9,
    });
    this.scene.add(this._trailRenderer.mesh);

    // ---- Lane: roof-aware weather (rain/ash falling onto a baked roof) ----
    // The heightfield roof covers the lab platform: elevated over the anvil + workbench so
    // precipitation collides with the simulated "roof" and splashes there instead of falling
    // through. Bake cadence is governed here (a few times per second, never per frame).
    this._roofCollider = new WeatherHeightfieldCollider({
      resolution: 64,
      cellSize: 0.19,
      cullEpsilon: 0.02,
    });
    this._bakeRoof();

    // Splash particles spawned exactly on roof impact (`onRoofImpact` hook).
    this._splashSource = new ParticleSystem({
      capacity: 220,
      affectors: [new GravityAffector({ acceleration: new Vector3D(0, -8.0, 0) })],
    });
    this._splashRenderer = new ParticleMeshRenderer({
      name: "LabSplashMesh",
      billboard: "spherical",
      system: this._splashSource,
      material: new BasicMaterial({ color: new Color(0.62, 0.78, 0.92, 1.0) }),
      geometryMode: "octagon",
      enableColorBuffer: true,
    });
    this.scene.add(this._splashRenderer.mesh);

    this._weather = new WeatherEmitter("LabRain", {
      count: 420,
      spawnArea: { width: 9, depth: 7, height: 6 },
      center: new Vector3D(0, 3.2, 0),
      fallSpeed: [1.4, 2.6],
      wind: new Vector3D(0.35, 0, 0.15),
      windGustiness: 0.6,
      particleSize: [0.045, 0.08],
      roofCollider: this._roofCollider,
      // Fixed seed: the spawn/recycle sequence is byte-stable across golden captures.
      seed: 20260719,
      onRoofImpact: (x: number, y: number, z: number): void => {
        for (let i = 0; i < 3; i++) {
          const idx = this._splashSource.emit({
            position: new Vector3D(x, y + 0.05, z),
            velocity: new Vector3D(
              (this._rng() - 0.5) * 0.8,
              0.4 + this._rng() * 0.8,
              (this._rng() - 0.5) * 0.8,
            ),
            size: 0.02 + this._rng() * 0.025,
            maxLife: 0.35 + this._rng() * 0.35,
          });
          if (idx >= 0) {
            const c = idx * 4;
            this._splashSource.arrays.colors[c] = 0.62;
            this._splashSource.arrays.colors[c + 1] = 0.78;
            this._splashSource.arrays.colors[c + 2] = 0.92;
            this._splashSource.arrays.colors[c + 3] = 0.85;
          }
        }
      },
    });
    this.scene.add(this._weather.mesh);

    // Deterministic warm-up: seed the smoke plume and a first tracer so variants are observable
    // immediately and golden captures start from a non-empty lane state.
    this._emitSmokePuffs(40);
    this._emitTracer();

    // WebGPU compute lane: attach only when a live device exists; otherwise this lane stays
    // absent and the `gpu` variant honestly falls back to `forge` (see `_applyVariant`).
    this._mountGpuLane();
  }

  public override async start(): Promise<void> {
    const golden = parseGoldenSpec();
    if (golden) {
      // Golden mode is deterministic-by-construction: freeze the lab BEFORE the realtime loop
      // starts. `super.start()` waits for a first painted frame whose real raf timing is not
      // deterministic across captures; with the lab paused every such warm-up frame runs with
      // dt = 0 and touches neither system state nor the RNG stream. `GoldenCapture.run()` then
      // stops the loop and freezes explicitly before stepping the fixed frame count.
      this._settings.paused = true;
      this._settings.timeScale = 1;
      this._settings.burstScale = 1;
      this._settings.smokeScale = 1;
      this._settings.weatherScale = 1;
    }
    await super.start();
    if (golden) {
      this._goldenCapture = new GoldenCapture(this, this._captureOptions());
      await this._goldenCapture.run(golden);
    } else {
      this._hud = new Hud(this._settings, () => this._applySettings());
      this._applySettings();
    }
  }

  public override destroy(): void {
    this._goldenCapture?.dispose();
    this._hud?.dispose();
    if (this._gpuSystem) {
      if (this.renderer instanceof WebGPURenderer) {
        // Detaches from the dispatch list AND disposes the system.
        this.renderer.unregisterGpuParticleSystem(this._gpuSystem);
      } else {
        this._gpuSystem.dispose();
      }
    }
    super.destroy();
  }

  protected override onKeyDown(event: KeyboardEvent): void {
    super.onKeyDown(event);
    if (event.altKey || event.metaKey || event.ctrlKey) return;
    if (document.activeElement?.tagName === "INPUT") return;
    if (this._hud?.handleKey(event)) {
      event.preventDefault();
    }
  }

  private _captureOptions(): GoldenCaptureOptions {
    return {
      freezeForCapture: (): void => this._freezeForCapture(),
      applyVariant: (variant: ParticleVariant): void => this._applyVariant(variant),
      applyCameraPool: (pool: CameraPoolId): void => this._applyCameraPool(pool),
    };
  }

  private _freezeForCapture(): void {
    this._settings.paused = false;
    this._settings.timeScale = 1;
    this._settings.burstScale = 1;
    this._settings.smokeScale = 1;
    this._settings.weatherScale = 1;
    // Re-pin the emission RNG and all accumulators so the deterministic stepping phase always
    // starts from the same stream position regardless of what happened before `stop()`.
    this._rng = mulberry32(EMISSION_SEED);
    this._autoSparksAcc = 0;
    this._autoSmokeAcc = 0;
    this._autoGpuAcc = 0;
    this._burstCooldown = 0;
    this._trailEmitterCooldown = 0;
    this._applySettings();
  }

  /**
   * Applies one effect variant: toggles lane visibility + emission. Deliberately NO system
   * create/dispose — lanes that are not part of the variant stay simulated but hidden, so
   * switching is instant and allocation-free (zero-GC contract preserved).
   */
  private _applyVariant(variant: ParticleVariant): void {
    const l = variant.lanes;
    this._sparkRenderer.mesh.isVisible = l.sparks;
    this._emberRenderer.mesh.isVisible = l.sparks;
    this._smokeRenderer.mesh.isVisible = l.smoke;
    this._trailRenderer.mesh.isVisible = l.trails;
    this._weather.mesh.isVisible = l.weather;
    this._splashRenderer.mesh.isVisible = l.weather;
    // The GPU lane is only meaningful when a live device is mounted AND the viewer enables it
    // (HUD switch); otherwise the `gpu` variant honestly degrades to `forge` (visible CPU sparks).
    if (variant.id === "gpu" && !(this._settings.gpuAllowed && this._gpuSystem)) {
      this._settings.variant = "forge";
      this._applyVariant(resolveVariant("forge"));
      return;
    }
    this._settings.variant = variant.id;
  }

  /**
   * Applies one camera pool (mirrors the fire45 `setInitialCamera` path; zero allocation after
   * the two vectors are materialized). A per-variant override replaces the base pool camera —
   * the active variant owns its composed framing (see `cameraFor`).
   */
  private _applyCameraPool(pool: CameraPoolId): void {
    const effective = cameraFor(resolveVariant(this._settings.variant).id, pool);
    const cam = cameraFrom(effective);
    this.setInitialCamera(cam.position, cam.target);
    this._settings.pool = pool;
  }

  /**
   * Pushes the current HUD settings into the scene: variant, camera pool, live scales.
   * Call a few times per second from `update`, not every frame — this is the interactive
   * counterpart of `_freezeForCapture` (constants) for the golden path.
   */
  private _applySettings(): void {
    this._applyVariant(resolveVariant(this._settings.variant));
    // The camera re-positions only when variant or pool actually changed (never per slider drag);
    // a variant switch can change the composed framing via `cameraFor` even with a fixed pool.
    const camKey = `${this._settings.variant}|${this._settings.pool}`;
    if (camKey !== this._lastCamKey) {
      this._applyCameraPool(this._settings.pool);
      this._lastCamKey = camKey;
    }
  }

  /** Honest live status for the HUD readout (variant, pool, scales, renderer, GPU lane). */
  private _readoutText(): string {
    const s = this._settings;
    const variant = resolveVariant(s.variant);
    const speed = s.paused ? "frozen" : `×${s.timeScale}`;
    let gpu = "unavailable (fallback: forge)";
    if (this._gpuSystem && s.gpuAllowed) {
      gpu = "live";
    } else if (this._gpuSystem) {
      gpu = "disabled (fallback: forge)";
    }
    return (
      `Variant:    ${variant.icon} ${variant.title} (${variant.id})\n` +
      `Camera:     ${s.pool}\n` +
      `Sparks ×${s.burstScale.toFixed(2)}  Smoke ×${s.smokeScale.toFixed(2)}  Weather ×${s.weatherScale.toFixed(2)}\n` +
      `Time:       ${speed}\n` +
      `GPU-Lane:   ${gpu}\n` +
      `Renderer:   ${this.renderer.type}`
    );
  }

  /**
   * Mounts the WebGPU compute particle lane when a live device is present. Registration is
   * idempotent on the renderer side (`registerGpuParticleSystem`), so a duplicated call never
   * double-attaches. Gated on `navigator.gpu` + a `WebGPURenderer` instance (S34-GPU-CPU-PARITY
   * covered by the parity suite; this is the live-device hinge).
   */
  private _mountGpuLane(): void {
    const renderer = this.renderer;
    if (renderer.type !== RendererType.WEB_GPU || !(renderer instanceof WebGPURenderer)) {
      return;
    }
    if (typeof navigator === "undefined" || !navigator.gpu) {
      return;
    }
    this._gpuSystem = new GPUParticleSystem({
      capacity: 8192,
      spawnBox: {
        min: { x: -0.15, y: 2.2, z: -0.15 },
        max: { x: 0.15, y: 2.35, z: 0.15 },
      },
      sizeRange: { min: 0.02, max: 0.06 },
      lifeRange: { min: 1.2, max: 3.2 },
      gravity: { x: 0, y: -9.0, z: 0 },
      speedFactor: 2.4,
      collisionThickness: 0.03,
      bounce: 0.42,
      baseColor: { x: 1.0, y: 0.78, z: 0.4, w: 1.0 },
      alphaMul: 1,
      seed: 42,
    });
    renderer.registerGpuParticleSystem(this._gpuSystem);
  }

  /**
   * Re-bakes the roof heightfield around the current lab area. Procedural source: a low
   * platform edge plus an elevated band over the anvil/workbench, so rain collides with a
   * plausible catchment instead of the bare floor. Zero-allocation grid reuse.
   */
  private _bakeRoof(): void {
    this._roofCollider.bake(
      (x: number, z: number) => {
        const onPlatform = Math.abs(x) < 5.5 && Math.abs(z) < 4.5;
        if (!onPlatform) return -5;
        // Elevated workbench band over the anvil cluster.
        const nearAnvil = Math.abs(x) < 1.6 && Math.abs(z) < 1.2;
        return nearAnvil ? 1.25 : 0.0;
      },
      0,
      0,
    );
  }

  private _emitSparkBurst(count: number): void {
    for (let i = 0; i < count; i++) {
      const a = this._rng() * Math.PI * 2;
      const r = this._rng() * 0.28;
      const vx = Math.cos(a) * r;
      const vz = Math.sin(a) * r;
      const heat = this._rng();
      const o = this._burstOptions;
      o.position.set(vx, 2.3, vz);
      o.velocity.set(vx * 3.2, 1.6 + this._rng() * 1.8, vz * 3.2);
      o.size = 0.035 + this._rng() * 0.03;
      o.maxLife = 1.6 + this._rng() * 1.6;
      o.heat = heat;
      const idx = this._sparks.emit(o);
      if (idx >= 0) {
        const c = idx * 4;
        this._sparks.arrays.colors[c] = 1.0;
        this._sparks.arrays.colors[c + 1] = 0.55 + heat * 0.4;
        this._sparks.arrays.colors[c + 2] = 0.18 + heat * 0.3;
        this._sparks.arrays.colors[c + 3] = 1.0;
      }
    }
  }

  /**
   * Emits one long-lived, collision-participating tracer spark into the shared `_sparks` system.
   * Its live position is read back from the SoA arrays every frame to drive the ribbon trail —
   * the tracer undergoes the exact same gravity + SDF collision as every other spark.
   */
  private _emitTracer(): void {
    const heat = 1.0;
    const idx = this._sparks.emit({
      position: new Vector3D(0, 2.4, 0.4),
      velocity: new Vector3D(
        (this._rng() - 0.5) * 1.6,
        3.4 + this._rng() * 1.2,
        (this._rng() - 0.5) * 1.6,
      ),
      size: 0.05,
      maxLife: 4.0,
      heat,
    });
    if (idx >= 0) {
      const c = idx * 4;
      this._sparks.arrays.colors[c] = 1.0;
      this._sparks.arrays.colors[c + 1] = 0.68;
      this._sparks.arrays.colors[c + 2] = 0.3;
      this._sparks.arrays.colors[c + 3] = 1.0;
      this._tracerSlot = idx;
    }
  }

  private _emitSmokePuffs(count: number): void {
    for (let i = 0; i < count; i++) {
      const idx = this._smoke.emit({
        position: new Vector3D(
          (this._rng() - 0.5) * 0.5,
          0.06 + this._rng() * 0.2,
          (this._rng() - 0.5) * 0.4,
        ),
        velocity: new Vector3D(
          (this._rng() - 0.5) * 0.15,
          0.35 + this._rng() * 0.3,
          (this._rng() - 0.5) * 0.15,
        ),
        size: 0.35 + this._rng() * 0.45,
        maxLife: 2.4 + this._rng() * 2.0,
      });
      if (idx >= 0) {
        const c = idx * 4;
        this._smoke.arrays.colors[c] = 0.5;
        this._smoke.arrays.colors[c + 1] = 0.47;
        this._smoke.arrays.colors[c + 2] = 0.54;
        this._smoke.arrays.colors[c + 3] = 0.55 + this._rng() * 0.3;
      }
    }
  }

  protected override update(deltaTime: number): void {
    const s = this._settings;
    const dt = s.paused ? 0 : deltaTime * s.timeScale;
    const lanes = resolveVariant(s.variant).lanes;

    // Manual lab input (Space burst / Shift tracer) plays only in variants owning the lane —
    // a variant is a focused composition, not a random toy box.
    this._burstCooldown = Math.max(0, this._burstCooldown - dt);
    if (lanes.sparks && this.input.isPressed("Space") && this._burstCooldown <= 0) {
      this._emitSparkBurst(220);
      this._burstCooldown = 0.25;
    }

    // Rate-based deterministic auto-emission (seed-pinned RNG): keeps every variant observable
    // without keyboard input and gives golden captures a stable non-empty lane state. Emission is
    // gated by the active variant's lanes; hidden lanes stay simulated but are not fed.
    if (lanes.sparks && dt > 0) {
      this._autoSparksAcc += dt * SPARK_EMIT_RATE * s.burstScale;
      const n = Math.floor(this._autoSparksAcc);
      if (n >= 1) {
        this._autoSparksAcc -= n;
        this._emitSparkBurst(n);
      }
    }
    if (lanes.smoke && dt > 0) {
      this._autoSmokeAcc += dt * SMOKE_EMIT_RATE * s.smokeScale;
      const n = Math.floor(this._autoSmokeAcc);
      if (n >= 1) {
        this._autoSmokeAcc -= n;
        this._emitSmokePuffs(n);
      }
    }

    // Tracer upkeep (trails lane): manual Shift respawn + automatic re-fire after expiry.
    this._trailEmitterCooldown = Math.max(0, this._trailEmitterCooldown - dt);
    if (lanes.trails && (this.input.isPressed("ShiftLeft") || this.input.isPressed("ShiftRight"))) {
      this._emitTracer();
      this._trailEmitterCooldown = 0.5;
    }
    if (lanes.trails && this._tracerSlot < 0 && this._trailEmitterCooldown <= 0) {
      this._emitTracer();
      this._trailEmitterCooldown = 1.2;
    }

    // Simulation: every lane stays simulated even when hidden — switching variants is instant and
    // allocation-free (zero-GC contract, no resource flips).
    this._sparks.update(dt);
    this._embers.update(dt);
    this._smoke.update(dt);
    this._impactSubEmitter.flush();

    // T1: update the pooled lights before rendering (heat/alpha ranking, fade envelope).
    this._lightPool.update(dt);

    // Weather: the update speed carries the live "Niederschlag" scale (WeatherEmitter exposes no
    // density mutator; scale > 0 intensifies the perceived precipitation, 0 freezes it). The roof
    // re-bake cadence uses raw time so culling never stalls for long.
    this._roofBakeCooldown -= deltaTime;
    if (this._roofBakeCooldown <= 0) {
      this._bakeRoof();
      this._roofBakeCooldown = 2.0;
    }
    if (lanes.weather) {
      this._weather.update(dt * s.weatherScale);
    }
    this._splashSource.update(dt);
    this._splashRenderer.sync(this.camera.position);

    // T4: follow the live tracer slot; when the tracer expires, keep advancing the trail with the
    // last known position so the ring naturally ages/fades out (never a frozen ribbon), then mark
    // the slot dead so the auto-refire can spawn a fresh tracer.
    if (this._tracerSlot >= 0 && this._sparks.arrays.aliveFlags[this._tracerSlot] === 1) {
      const o = this._tracerSlot * 3;
      const p = this._sparks.arrays.positions;
      this._lastTracerPosition.set(p[o]!, p[o + 1]!, p[o + 2]!);
    } else if (this._tracerSlot >= 0) {
      this._tracerSlot = -1;
    }
    this._trailRenderer.update(dt, this._lastTracerPosition, this.camera.position);

    // WebGPU compute lane: while mounted AND enabled it drains every frame so the sim clock stays
    // honest (the renderer records the compute pass each frame); emission is gated to the `gpu`
    // lane. Disabling the lane (HUD switch) freezes it and remaps the variant to `forge`.
    if (this._gpuSystem && s.gpuAllowed) {
      if (lanes.gpu && dt > 0) {
        this._autoGpuAcc += dt * GPU_EMIT_RATE;
        const n = Math.floor(this._autoGpuAcc);
        if (n >= 1) {
          this._autoGpuAcc -= n;
          this._gpuSystem.emit(n);
        }
      }
      this._gpuSystem.update(dt);
    }

    this._sparkRenderer.sync(this.camera.position);
    this._emberRenderer.sync(this.camera.position);
    this._smokeRenderer.sync(this.camera.position);

    // HUD readout on a steady ~3 Hz cadence (raw deltaTime, so pause never freezes the UI).
    this._readoutTimer -= deltaTime;
    if (this._hud && this._readoutTimer <= 0) {
      this._readoutTimer = READOUT_INTERVAL;
      this._hud.setReadout(this._readoutText());
    }
  }
}

const app = new Showcase();
app.start().catch((err: unknown) => console.error("[Showcase46] Failed to start:", err));
