import {
  AbstractShowcase,
  AmbientLight,
  CameraStrategyType,
  Color,
  Cube,
  DirectionalLight,
  FPSController,
  Ground,
  MathUtils,
  Object3D,
  PerspectiveProjection,
  PhongMaterial,
  WireframeMaterial,
  ZoomController,
} from "@small-world-machine/engine";

/**
 * Showcase 2: Interactive camera (FPS-style) and keyboard input.
 * Shows how to move the camera with mouse and keyboard.
 */
export class Showcase2 extends AbstractShowcase {
  private _moveSpeed: number = 10.0;

  /** @inheritdoc */
  protected override async setupScene(): Promise<void> {
    // 1. Initialize input (Keyboard & Mouse)

    this.input.debug = true;

    // Attach event listener directly to the canvas to activate PointerLock (mouse capture)
    this.canvas.addEventListener("click", (): void => {
      if (!this.input.isPointerLocked) {
        this.input.requestPointerLock(this.canvas);
      }
    });

    // 2. Configure the camera (FPS mode) with forced perspective projection
    {
      const aspect: number = window.innerWidth / window.innerHeight;
      this.camera.projection = new PerspectiveProjection({
        fov: (75 * Math.PI) / 180,
        aspect,
        near: 0.1,
        far: 1000,
      });
      this.camera.updateProjectionMatrix();
    }
    // We switch to the First-Person strategy
    this.camera.setStrategy(CameraStrategyType.FPS);
    this.camera.position.set(0, 3, 6);
    this.camera.target.set(0, 0, 0);

    this.camera.addBehavior(
      new FPSController({
        input: this.input,
        audio: this.audio,
        moveSpeed: this._moveSpeed,
      }),
    );
    this.camera.addBehavior(new ZoomController({ input: this.input, audio: this.audio }));

    // 3. Add light
    const sun: DirectionalLight = new DirectionalLight({ color: Color.WHITE, intensity: 0.8 });
    sun.direction.set(-1, -1, -1).normalize();
    this.scene.add(sun);

    this.scene.add(new AmbientLight({ color: Color.WHITE, intensity: 0.2 }));

    // 4. Create a large floor (Plane)
    const floor: Object3D = new Object3D("Floor");
    floor.geometry = new Ground({
      width: 50,
      depth: 50,
      widthSegments: 10,
      depthSegments: 10,
    }).getGeometryData();

    // We use a wireframe material so that the movement is better perceived
    const floorMat: WireframeMaterial = new WireframeMaterial();
    floorMat.color = Color.fromName("darkslategray")!;
    floor.material = floorMat;

    this.scene.add(floor);

    // 5. Distribute some obstacles (cubes) with random colors
    for (let i: number = 0; 20 > i; i++) {
      const box: Object3D = new Object3D(`Box_${i}`);
      box.geometry = new Cube({ size: Math.random() * 2 + 1 }).getGeometryData();

      // Use the newly implemented HSL method to generate vibrant, random colors
      box.material = new PhongMaterial({
        color: Color.fromHSL(Math.random() * 360, 0.8, 0.5),
        shininess: 30,
      });

      // Random position on the floor
      const px: number = (Math.random() - 0.5) * 40;
      const pz: number = (Math.random() - 0.5) * 40;
      box.position.set(px, 1, pz);

      // Random rotation
      box.rotation.y = Math.random() * MathUtils.PI;

      this.scene.add(box);
    }
  }

  protected override onCanvasRecreated(): void {
    // Since we recreated the canvas, we must reattach the click listener!
    this.canvas.addEventListener("click", (): void => {
      if (!this.input.isPointerLocked) {
        this.input.requestPointerLock(this.canvas);
      }
    });
  }

  /** @inheritdoc */
  protected override update(): void {
    // Movement and looking is now handled by the FPSController registered in setupScene.
  }
}

// === START THE ENGINE ===
const app = new Showcase2();
app.start().catch((err: unknown) => console.error("[Showcase2] Failed to start:", err));
