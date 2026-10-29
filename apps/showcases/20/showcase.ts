import type { BloomElement, Camera } from "@small-world-machine/engine";
import {
  AbstractShowcase,
  AmbientLight,
  Behavior,
  BobbingBehavior,
  CameraStrategyType,
  CatmullRomSpline,
  Color,
  Cone,
  Cube,
  DirectionalLight,
  FlickerBehavior,
  Ground,
  LookAtBehavior,
  Object3D,
  Octahedron,
  OrbitController,
  PathFollowerBehavior,
  PostProcessingEffectType,
  RainbowBehavior,
  RotatorBehavior,
  Sphere,
  SpotLight,
  SpringLerpBehavior,
  StandardMaterial,
  Texture,
  TrailRendererBehavior,
  Vector3D,
} from "@small-world-machine/engine";
import { attachDevTools } from "@small-world-machine/tools";
import {
  BehaviorLabHud,
  defaultBehaviorLabSettings,
  type BehaviorLabSettings,
  type TrackingTarget,
} from "./Hud.js";

/**
 * Camera-relative follower that updates the SpringLerp target with zero per-frame GC allocations.
 */
class CompanionFollowBehavior extends Behavior {
  private readonly _forward: Vector3D = new Vector3D();
  private readonly _right: Vector3D = new Vector3D();
  private readonly _offset: Vector3D = new Vector3D();

  public distance: number = 5.0;
  public rightOffset: number = 2.0;

  constructor(
    private readonly _camera: Camera,
    private readonly _springLerp: SpringLerpBehavior,
  ) {
    super();
  }

  public override update(): void {
    // 1. Calculate camera forward and right vectors
    this._forward.copyFrom(this._camera.target).sub(this._camera.position).normalize();
    this._right.copyFrom(this._forward).cross(this._camera.up).normalize();

    // 2. Scale along both axes
    this._forward.scale(this.distance);
    this._right.scale(this.rightOffset);

    // 3. Assemble target position: camera position + forward + right
    this._offset.copyFrom(this._camera.position).add(this._forward).add(this._right);
    this._springLerp.targetPosition.copyFrom(this._offset);
  }
}

export class Showcase extends AbstractShowcase {
  private _bloom: BloomElement | undefined;
  private _bobbing!: BobbingBehavior;
  private _rotator!: RotatorBehavior;
  private _rainbow!: RainbowBehavior;
  private _pathFollower!: PathFollowerBehavior;
  private _flicker!: FlickerBehavior;
  private _thrusterMat!: StandardMaterial;
  private _trail!: TrailRendererBehavior;
  private _springLerp!: SpringLerpBehavior;
  private _companionFollow!: CompanionFollowBehavior;
  private _spotlight!: SpotLight;
  private _lookAt!: LookAtBehavior;

  private _ship!: Object3D;
  private _crystal!: Object3D;
  private _companion!: Object3D;
  private readonly _originTarget: Vector3D = new Vector3D(0, 0, 0);

  private _hud: BehaviorLabHud | undefined;

  protected async setupScene(): Promise<void> {
    // 0. Enable Post Processing for Tron Bloom!
    this.renderer.postProcessing.enabled = true;
    const bloom = this.renderer.postProcessing.get<BloomElement>(PostProcessingEffectType.BLOOM);
    if (bloom) {
      bloom.enabled = true;
      bloom.intensity = 2.5;
      bloom.threshold = 0.8;
      bloom.radius = 1.5;
      bloom.color = new Color(0.481, 0.904, 1.202);
      this._bloom = bloom;
    }

    // 1. Grid & Lighting
    const floor = new Object3D("Floor");
    floor.geometry = new Ground({ width: 50, depth: 50 }).getGeometryData();

    // Create a procedural grid texture using Canvas 2D to avoid 1px line aliasing
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#000000"; // Black background
    ctx.fillRect(0, 0, 512, 512);
    ctx.strokeStyle = "#ffffff"; // White lines (will be tinted by HDR color)
    ctx.lineWidth = 4; // Thick lines to prevent aliasing dropouts
    ctx.beginPath();
    // Draw top and left borders so when it repeats it forms a grid
    ctx.moveTo(0, 0);
    ctx.lineTo(512, 0);
    ctx.moveTo(0, 0);
    ctx.lineTo(0, 512);
    // Draw bottom and right borders (half thickness to merge nicely)
    ctx.moveTo(512, 0);
    ctx.lineTo(512, 512);
    ctx.moveTo(0, 512);
    ctx.lineTo(512, 512);
    ctx.stroke();

    const gridBitmap = await createImageBitmap(canvas);
    const gridTexture = Texture.fromImage(gridBitmap);
    gridTexture.repeat = { x: 10, y: 10 }; // 10x10 grid tiles

    const gridMat = new StandardMaterial({
      color: new Color(0.02, 0.02, 0.03),
      diffuseMap: gridTexture,
      emissiveMap: gridTexture,
      emissiveColor: new Color(0.6, 1.8, 3.0), // HDR Blue for heavy Bloom! (sRGB-authored HDR, decodes to ~11 in blue)
      roughness: 0.6,
      metallic: 0.1,
    });
    floor.material = gridMat;
    floor.receiveShadow = true;
    this.scene.add(floor);

    this.scene.add(new AmbientLight({ color: Color.WHITE, intensity: 0.4 }));

    const dirLight = new DirectionalLight({
      color: new Color(1, 1, 1),
      intensity: 0.2,
      castShadow: true,
      direction: new Vector3D(-1, -1, -0.5).normalize(),
    });
    this.scene.add(dirLight);

    // 2. The "Magic Crystal" (Bobbing, Rotating, Rainbow)
    this._crystal = new Object3D("Crystal");
    this._crystal.geometry = new Octahedron({ radius: 1.5 }).getGeometryData();
    this._crystal.material = new StandardMaterial({
      color: Color.RED,
      metallic: 0.8,
      roughness: 0.2,
    });
    this._crystal.position.set(0, 3, 0);

    this._bobbing = new BobbingBehavior(1.0, 2.0);
    this._rotator = new RotatorBehavior(new Vector3D(1.0, 1.5, 0.5));
    this._rainbow = new RainbowBehavior(0.2);

    this._crystal.addBehavior(this._bobbing);
    this._crystal.addBehavior(this._rotator);
    this._crystal.addBehavior(this._rainbow);
    this._crystal.castShadow = true;
    this._crystal.receiveShadow = true;
    this.scene.add(this._crystal);

    // 3. The "Companion Sphere" (SpringLerpBehavior following the camera)
    this._companion = new Object3D("Companion");
    this._companion.geometry = new Sphere({ radius: 0.5 }).getGeometryData();
    this._companion.material = new StandardMaterial({
      color: Color.fromName("cornflowerblue")!,
      metallic: 0.2,
      roughness: 0.8,
    });

    this._springLerp = new SpringLerpBehavior(new Vector3D(), 0.05);
    this._companion.addBehavior(this._springLerp);

    this._companionFollow = new CompanionFollowBehavior(this.camera, this._springLerp);
    this._companion.addBehavior(this._companionFollow);
    this._companion.castShadow = true;
    this._companion.receiveShadow = true;
    this.scene.add(this._companion);

    // 4. The Patrolling Spaceship (PathFollowerBehavior)
    const spline = new CatmullRomSpline(
      [
        new Vector3D(10, 5, 10),
        new Vector3D(-10, 2, 10),
        new Vector3D(-15, 8, 0),
        new Vector3D(-10, 4, -10),
        new Vector3D(10, 5, -10),
        new Vector3D(15, 8, 0),
      ],
      true,
    ); // Closed loop

    this._ship = new Object3D("Ship");

    // Spaceship body (Cone)
    const body = new Object3D("ShipBody");
    body.geometry = new Cone({ radius: 0.8, height: 3.0 }).getGeometryData();
    body.material = new StandardMaterial({
      color: Color.fromName("hotpink")!,
      metallic: 1.0,
      roughness: 0.1,
    });
    // Point the cone forward (-Z) instead of backward (+Z)
    body.rotation.x = -Math.PI / 2;
    body.castShadow = true;
    body.receiveShadow = true;
    this._ship.add(body);

    // Spaceship wings (Cube)
    const wings = new Object3D("ShipWings");
    wings.geometry = new Cube({ size: 1 }).getGeometryData();
    wings.material = new StandardMaterial({ color: Color.WHITE, metallic: 0.8, roughness: 0.2 });
    wings.scale.set(3.5, 0.2, 1.0);
    wings.position.set(0, -0.2, 0.5); // slightly below and towards the back
    wings.castShadow = true;
    wings.receiveShadow = true;
    this._ship.add(wings);

    // Flickering Thrusters
    const thruster = new Object3D("Thruster");
    thruster.geometry = new Sphere({ radius: 0.3 }).getGeometryData();
    this._thrusterMat = new StandardMaterial({
      color: new Color(0, 0, 0),
      emissiveColor: new Color(0, 2.078, 2.078),
      metallic: 0.0,
      roughness: 1.0,
    });
    thruster.material = this._thrusterMat;
    thruster.position.set(0, 0, 1.5); // back of the ship
    this._flicker = new FlickerBehavior({
      minStableTime: 0.0,
      maxStableTime: 0.2,
      minFlickerTime: 0.1,
      maxFlickerTime: 0.4,
      minMultiplier: 0.2,
      smoothness: 0.2,
      onUpdate: (multiplier: number): void => {
        // Modulate the HDR emissive brightness based on flicker multiplier
        // Emissive colours are sRGB-authored (ADR 0049): encode the linear HDR level.
        const level = Math.pow(multiplier * 5.0, 1 / 2.2);
        this._thrusterMat.emissiveColor.set(0, level, level);
      },
    });
    thruster.addBehavior(this._flicker);
    this._ship.add(thruster);

    // Ribbon Trail behind the ship
    const trailGeom = new Sphere({
      radius: 0.15,
      widthSegments: 8,
      heightSegments: 6,
    }).getGeometryData();
    const trailMat = new StandardMaterial({
      color: new Color(0, 0, 0),
      emissiveColor: new Color(0, 2.078, 2.078),
      metallic: 0.0,
      roughness: 1.0,
    });
    this._trail = new TrailRendererBehavior({
      scene: this.scene,
      geometry: trailGeom,
      material: trailMat,
      poolSize: 30,
      spawnInterval: 0.06,
      shrinkRate: 2.5,
    });
    this._ship.addBehavior(this._trail);

    // Ship flies along the spline, completes loop every 10 seconds, and always looks forward
    this._pathFollower = new PathFollowerBehavior(spline, 10.0, true, false);
    this._ship.addBehavior(this._pathFollower);
    this.scene.add(this._ship);

    // 5. The Surveillance Spotlight (LookAtBehavior)
    this._spotlight = new SpotLight({
      color: Color.YELLOW,
      distance: 50.0,
      angle: Math.PI / 8,
      intensity: 100.0,
      castShadow: true,
    });
    this._spotlight.position.set(0, 15, 0); // High up in the center
    this._lookAt = new LookAtBehavior(this._ship);
    this._spotlight.addBehavior(this._lookAt);

    this.scene.add(this._spotlight);

    this.camera.setStrategy(CameraStrategyType.SMOOTH);
    this.camera.position.set(0, 8, 20);
    this.camera.target.set(0, 3, 0);
    this.camera.addBehavior(new OrbitController({ input: this.input }));

    // 6. Behavior Lab Inspector HUD
    this._hud = new BehaviorLabHud(defaultBehaviorLabSettings(), (settings) => {
      this._applySettings(settings);
    });

    window.addEventListener("keydown", (event: KeyboardEvent) => {
      this._hud?.handleKey(event);
    });
  }

  private _applySettings(settings: BehaviorLabSettings): void {
    // 1. Crystal
    this._bobbing.isActive = settings.bobbing;
    this._bobbing.amplitude = settings.bobbingAmp;
    this._bobbing.frequency = settings.bobbingFreq;
    if (!settings.bobbing) {
      this._crystal.position.y = 3.0; // Return to rest height
    }

    this._rotator.isActive = settings.rotator;
    this._rotator.speed.set(1.0, 1.5, 0.5).scale(settings.rotatorSpeed);

    this._rainbow.isActive = settings.rainbow;
    this._rainbow.speed = settings.rainbowSpeed;
    if (!settings.rainbow && this._crystal.material instanceof StandardMaterial) {
      this._crystal.material.color.copyFrom(Color.RED);
    }

    // 2. Spaceship
    this._pathFollower.isActive = settings.patrol;
    this._pathFollower.duration = settings.patrolDuration;
    this._pathFollower.lookForward = settings.patrolLookForward;
    this._pathFollower.pingPong = settings.patrolPingPong;

    this._flicker.isActive = settings.flicker;
    if (!settings.flicker) {
      this._thrusterMat.emissiveColor.set(0, 2.078, 2.078); // Full steady thrust
    }

    this._trail.isActive = settings.trail;
    if (!settings.trail) {
      this._trail.clear();
    }

    // 3. Companion
    this._companion.isVisible = settings.companion;
    this._companionFollow.isActive = settings.companion;
    this._springLerp.isActive = settings.companion;
    this._springLerp.lerpFactor = settings.companionLerp;
    this._companionFollow.distance = settings.companionDistance;

    // 4. Spotlight
    this._spotlight.isVisible = settings.spotlight;
    this._lookAt.isActive = settings.spotlight;
    this._spotlight.angle = settings.spotlightAngle;
    this._spotlight.intensity = settings.spotlightIntensity;

    const targetMap: Record<TrackingTarget, Object3D | Vector3D> = {
      ship: this._ship,
      crystal: this._crystal,
      companion: this._companion,
      origin: this._originTarget,
    };
    this._lookAt.targetPoint = targetMap[settings.spotlightTarget];

    // 5. Bloom
    if (this._bloom) {
      this._bloom.enabled = settings.bloom;
      this._bloom.intensity = settings.bloomIntensity;
    }
  }

  protected override update(): void {
    // Logic is entirely handled by the behaviors!
  }
}

const app = new Showcase();
attachDevTools(app);
app.start().catch((err: unknown) => console.error("[Showcase20] Failed to start:", err));
