import {
  AbstractShowcase,
  AmbientLight,
  BasicMaterial,
  Behavior,
  BloomElement,
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
  Vector3D,
} from "@small-world-machine/engine";
import { attachDevTools } from "@small-world-machine/tools";

class Showcase20 extends AbstractShowcase {
  protected async setupScene(): Promise<void> {
    // 0. Enable Post Processing for Tron Bloom!
    this.renderer.postProcessing.enabled = true;
    const bloom = this.renderer.postProcessing.get<BloomElement>(PostProcessingEffectType.BLOOM);
    if (bloom) {
      bloom.enabled = true;
      bloom.intensity = 2.5;
      bloom.threshold = 0.8;
      bloom.radius = 1.5;
      bloom.color = new Color(0.2, 0.8, 1.5);
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

    const gridMat = new BasicMaterial({
      color: new Color(0.6, 1.8, 3.0), // HDR Blue for heavy Bloom!
      diffuseMap: gridTexture,
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
    const crystal = new Object3D("Crystal");
    crystal.geometry = new Octahedron({ radius: 1.5 }).getGeometryData();
    crystal.material = new StandardMaterial({ color: Color.RED, metallic: 0.8, roughness: 0.2 });
    crystal.position.set(0, 3, 0);

    crystal.addBehavior(new BobbingBehavior(1.0, 2.0));
    crystal.addBehavior(new RotatorBehavior(new Vector3D(1.0, 1.5, 0.5)));
    crystal.addBehavior(new RainbowBehavior(0.2));
    crystal.castShadow = true;
    crystal.receiveShadow = true;
    this.scene.add(crystal);

    // 3. The "Companion Sphere" (SpringLerpBehavior following the camera)
    const companion = new Object3D("Companion");
    companion.geometry = new Sphere({ radius: 0.5 }).getGeometryData();
    companion.material = new StandardMaterial({
      color: Color.fromName("cornflowerblue")!,
      metallic: 0.2,
      roughness: 0.8,
    });

    // We attach a custom behavior that constantly updates the SpringLerp target
    const springLerp = new SpringLerpBehavior(new Vector3D(), 0.05);
    companion.addBehavior(springLerp);

    // Quick custom behavior just to pipe the camera position into the spring lerp target
    const camera = this.camera;
    companion.addBehavior(
      new (class extends Behavior {
        public override update(): void {
          // Offset the companion relative to the camera
          const targetPos = new Vector3D().copyFrom(camera.position);
          // Put it slightly in front and to the right
          const forward = new Vector3D().copyFrom(camera.target).sub(camera.position).normalize();
          targetPos.add(forward.scale(5)).add(new Vector3D(2, 0, 0));
          springLerp.targetPosition.copyFrom(targetPos);
        }
      })(),
    );
    companion.castShadow = true;
    companion.receiveShadow = true;
    this.scene.add(companion);

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

    const ship = new Object3D("Ship");

    // Spaceship body (Cone)
    const body = new Object3D("ShipBody");
    body.geometry = new Cone({ radius: 0.8, height: 3.0 }).getGeometryData();
    body.material = new StandardMaterial({
      color: Color.fromName("hotpink")!,
      metallic: 1.0,
      roughness: 0.1,
    });
    // Point the cone forward (-Z) instead of up (+Y)
    body.rotation.x = Math.PI / 2;
    body.castShadow = true;
    body.receiveShadow = true;
    ship.add(body);

    // Spaceship wings (Cube)
    const wings = new Object3D("ShipWings");
    wings.geometry = new Cube({ size: 1 }).getGeometryData();
    wings.material = new StandardMaterial({ color: Color.WHITE, metallic: 0.8, roughness: 0.2 });
    wings.scale.set(3.5, 0.2, 1.0);
    wings.position.set(0, -0.2, 0.5); // slightly below and towards the back
    wings.castShadow = true;
    wings.receiveShadow = true;
    ship.add(wings);

    // Flickering Thrusters
    const thruster = new Object3D("Thruster");
    thruster.geometry = new Sphere({ radius: 0.3 }).getGeometryData();
    const thrusterMat = new StandardMaterial({
      color: new Color(0, 0, 0),
      emissiveColor: new Color(0, 5.0, 5.0),
      metallic: 0.0,
      roughness: 1.0,
    });
    thruster.material = thrusterMat;
    thruster.position.set(0, 0, 1.5); // back of the ship
    thruster.addBehavior(
      new FlickerBehavior({
        minStableTime: 0.0,
        maxStableTime: 0.2,
        minFlickerTime: 0.1,
        maxFlickerTime: 0.4,
        minMultiplier: 0.2,
        smoothness: 0.2,
        onUpdate: (multiplier: number): void => {
          // Modulate the HDR emissive brightness based on flicker multiplier
          thrusterMat.emissiveColor.set(0, multiplier * 5.0, multiplier * 5.0);
        },
      }),
    );
    ship.add(thruster);

    // Ship flies along the spline, completes loop every 10 seconds, and always looks forward
    ship.addBehavior(new PathFollowerBehavior(spline, 10.0, true, false));
    this.scene.add(ship);

    // 5. The Surveillance Spotlight (LookAtBehavior)
    const spot = new SpotLight({
      color: Color.YELLOW,
      distance: 50.0,
      angle: Math.PI / 8,
      intensity: 100.0, // Scheinwerfer etwas rauf
      castShadow: true,
    });
    spot.position.set(0, 15, 0); // High up in the center
    // Always look at the spaceship!
    spot.addBehavior(new LookAtBehavior(ship));

    this.scene.add(spot);

    this.camera.setStrategy(CameraStrategyType.SMOOTH);
    this.camera.position.set(0, 8, 20);
    this.camera.target.set(0, 3, 0);
    this.camera.addBehavior(new OrbitController({ input: this.input }));

    this.canvas.addEventListener("click", (): void => {
      if (!this.input.isPointerLocked) {
        this.input.requestPointerLock(this.canvas);
      }
    });
  }

  protected override update(): void {
    // Logic is entirely handled by the behaviors!
  }
}

const app = new Showcase20();
attachDevTools(app);
app.start().catch((err: unknown) => console.error("[Showcase20] Failed to start:", err));
