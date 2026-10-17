import {
  AbstractShowcase,
  AmbientLight,
  BloomElement,
  BoundingBox,
  BoundingSphere,
  Color,
  ColorUtils,
  Cube,
  DirectionalLight,
  EngineOptions,
  GeometryDataInterface,
  GlassMaterial,
  Object3D,
  OrbitController,
  PhysicsSystem,
  PostProcessingEffectType,
  RigidBody,
  Sphere,
  StandardMaterial,
  Vector3D,
} from "@small-world-machine/engine";

/**
 * A pentatonic scale for musical physical collisions.
 */
const PENTATONIC_SCALE = [
  130.81, // C3
  146.83, // D3
  164.81, // E3
  196.0, // G3
  220.0, // A3
  261.63, // C4
  293.66, // D4
  329.63, // E4
  392.0, // G4
  440.0, // A4
  523.25, // C5
  587.33, // D5
  659.25, // E5
  783.99, // G5
  880.0, // A5
];

class Showcase21 extends AbstractShowcase {
  private _spheres: Object3D[] = [];
  private _spherePool: Object3D[] = [];
  private _spawnTimer: number = 0;
  private _sphereGeo!: GeometryDataInterface;
  private _physics: PhysicsSystem;

  constructor(options: EngineOptions = {}) {
    super(options);
    this._physics = new PhysicsSystem(this.events);
  }

  protected async setupScene(): Promise<void> {
    // 0. Enable Post Processing for glowing bloom
    this.renderer.postProcessing.enabled = true;
    const bloom = this.renderer.postProcessing.get<BloomElement>(PostProcessingEffectType.BLOOM);
    if (bloom) {
      bloom.enabled = true;
      bloom.intensity = 2.0;
      bloom.threshold = 0.5;
      bloom.radius = 1.0;
    }

    // 1. Lighting Setup
    const ambient = new AmbientLight({ color: new Color(0.1, 0.1, 0.2), intensity: 1.0 });
    const dirLight = new DirectionalLight({ color: new Color(0.8, 0.9, 1.0), intensity: 2.0 });
    dirLight.position.set(10, 20, 10);
    dirLight.direction.set(-10, -20, -10).normalize();
    this.scene.add(ambient, dirLight);

    // 2. Camera Setup
    this.camera.position.set(0, 15, 30);
    this.camera.target.set(0, 5, 0);
    this.camera.addBehavior(new OrbitController({ input: this.input }));

    // 3. Environment: The Plinko/Galton Board
    const glassMaterial = new GlassMaterial({
      color: new Color(0.1, 0.1, 0.1),
      metallic: 0.1,
      roughness: 0.1,
      transmission: 0.9, // Refractive Glass
      ior: 1.5,
      thickness: 1.0,
    });

    const boxGeo = new Cube({ size: 1 }).getGeometryData();

    // Create a pyramid of pegs
    const rows = 8;
    const spacing = 3.0;
    for (let r = 0; r < rows; r++) {
      const pegsInRow = r + 1;
      const startX = -((pegsInRow - 1) * spacing) / 2;
      for (let i = 0; i < pegsInRow; i++) {
        const peg = new Object3D(`Peg_${r}_${i}`);
        peg.geometry = boxGeo;
        peg.material = glassMaterial;

        // Tilt the pegs slightly to make bouncing chaotic
        peg.rotation.z = Math.PI / 4;

        const x = startX + i * spacing;
        const y = 15 - r * spacing;
        peg.position.set(x, y, 0);

        // Make it a STATIC rigid body (mass = 0)
        peg.rigidBody = new RigidBody(0);
        peg.rigidBody.restitution = 0.9; // Bouncy pegs

        // Scale it up
        peg.scale.set(1.5, 1.5, 1.5);
        peg.updateMatrixWorld();

        // Calculate world bounds
        peg.bounds = new BoundingBox(
          new Vector3D(-0.75, -0.75, -0.75),
          new Vector3D(0.75, 0.75, 0.75),
        );

        this.scene.add(peg);
      }
    }

    // Add boundaries to funnel them back
    const createWall = (x: number, rotZ: number): void => {
      const wall = new Object3D();
      wall.geometry = boxGeo;
      wall.material = glassMaterial;
      wall.position.set(x, 5, 0);
      wall.scale.set(1, 20, 3);
      wall.rotation.z = rotZ;
      wall.rigidBody = new RigidBody(0);
      wall.rigidBody.restitution = 0.5;
      wall.bounds = new BoundingBox(new Vector3D(-0.5, -10, -1.5), new Vector3D(0.5, 10, 1.5));
      this.scene.add(wall);
    };
    createWall(-15, -Math.PI / 8);
    createWall(15, Math.PI / 8);

    // 4. Pre-allocate sphere geometry and material
    this._sphereGeo = new Sphere({
      radius: 0.5,
      widthSegments: 16,
      heightSegments: 16,
    }).getGeometryData();

    // Pre-warm the sphere pool to prevent mid-simulation shader compilations and stuttering
    for (let i = 0; i < 100; i++) {
      const s = new Object3D();
      s.geometry = this._sphereGeo;

      const hue = Math.floor(Math.random() * 360);
      s.material = new StandardMaterial({
        color: ColorUtils.fromCSS(`hsl(${hue}, 100%, 50%)`),
        metallic: 0.9,
        roughness: 0.1,
        emissiveColor: new Color(0.2, 0.0, 0.2),
      });

      const rb = new RigidBody(1.0);
      rb.restitution = 0.8;
      rb.friction = 0.99; // Air resistance / damping. 0.1 was killing all velocity instantly!
      s.rigidBody = rb;
      s.bounds = new BoundingSphere(s.position, 0.5);

      this._spherePool.push(s);
    }

    // 5. Subscribe to Physics Collisions for Generative Audio
    this.events.addEventListener("physics:collision", (event: Record<string, unknown>): void => {
      const impulseMag = event["impulse"] as number;
      const objectA = event["objectA"] as Object3D;
      if (impulseMag > 0.5) {
        // Threshold to prevent micro-collision spam
        // Map Y position to a note in the pentatonic scale
        const yPos = Math.max(0, Math.min(15, objectA.position.y));
        const noteIndex = Math.floor((yPos / 15) * (PENTATONIC_SCALE.length - 1));
        const freq = PENTATONIC_SCALE[noteIndex]!;

        // Map impulse magnitude to volume (cap at 0.5)
        const volume = Math.min(0.5, impulseMag * 0.05);

        // Flash the sphere's color based on impact
        if (objectA.material instanceof StandardMaterial) {
          const origR = objectA.material.color.r;
          objectA.material.emissiveColor.set(origR * 2, origR, origR * 2);
        }

        // Play the generative synth tone
        this.audio.playTone(freq, 0.3, volume, "triangle");
      }
    });

    // Start audio context on first click
    window.addEventListener(
      "pointerdown",
      () => {
        if (this.audio.context.state === "suspended") {
          this.audio.context.resume();
        }
      },
      { once: true },
    );
  }

  private _spawnSphere(): void {
    let s: Object3D;

    if (this._spherePool.length > 0) {
      s = this._spherePool.pop()!;
      this.scene.add(s);
      this._spheres.push(s);
    } else {
      // Pool empty, recycle oldest active sphere
      s = this._spheres.shift()!;
      this._spheres.push(s);
    }

    s.position.set((Math.random() - 0.5) * 4, 22, Math.random() - 0.5);
    s.rigidBody!.velocity.set(0, -2, 0);
    s.rigidBody!.angularVelocity.set(0, 0, 0);
    s.rigidBody!.clearForces();
  }

  protected override update(dt: number): void {
    // 1. Step the physics simulation
    this._physics.step(this.scene, dt);

    this._spawnTimer += dt;
    if (this._spawnTimer > 0.25) {
      // Spawn 4 spheres per second
      this._spawnTimer = 0;
      this._spawnSphere();
    }

    // Cool down emissive colors
    for (const s of this._spheres) {
      if (s.material instanceof StandardMaterial) {
        const t = dt * 5.0;
        const c = s.material.emissiveColor;
        c.r += (0.0 - c.r) * t;
        c.g += (0.0 - c.g) * t;
        c.b += (0.0 - c.b) * t;
      }

      // Keep them in 2D plane for the Plinko effect
      s.position.z = 0;
      s.rigidBody!.velocity.z = 0;
      s.updateMatrixWorld();
    }
  }
}

const app = new Showcase21();
app.start().catch((err: unknown) => console.error("[Showcase21] Failed to start:", err));
