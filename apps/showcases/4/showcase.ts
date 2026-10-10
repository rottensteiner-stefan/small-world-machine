import {
  AbstractShowcase,
  AmbientLight,
  BoundingBox,
  CameraStrategyType,
  Color,
  DirectionalLight,
  Object3D,
  ObjLoader,
  PerspectiveProjection,
  ProjectionType,
  TerrainManager,
  TerrainMaterial,
  Texture,
  TextureGenerator,
  Vector3D,
  WASDController,
} from "@small-world-machine/engine";

const CAR_SPEED: number = 10.0; // The car's speed

export class Showcase4 extends AbstractShowcase {
  private _targetPos: Vector3D = new Vector3D();
  private _car: Object3D | undefined = undefined; // The car object
  private _terrainManager: TerrainManager | undefined = undefined;

  protected override async setupScene(): Promise<void> {
    this.input.debug = true;
    this.canvas.addEventListener("click", (): void => {
      if (!this.input.isPointerLocked) {
        this.input.requestPointerLock(this.canvas);
      }
    });

    // Initialize Octrees for the scene
    // For this example, we define a large world area
    this.scene.initOctrees(
      new BoundingBox(new Vector3D(-500, -100, -500), new Vector3D(500, 100, 500)),
    );

    if (ProjectionType.PERSPECTIVE === this.camera.projection.type) {
      const aspect: number = window.innerWidth / window.innerHeight;
      // Correction: Convert 75 degrees to radians
      this.camera.projection = new PerspectiveProjection({
        fov: (75 * Math.PI) / 180,
        aspect,
        near: 0.1,
        far: 1000,
      });
      this.camera.updateProjectionMatrix();
    }

    this.camera.setStrategy(CameraStrategyType.SMOOTH);
    this.camera.position.set(0, 5, 15);

    const ambientLight: AmbientLight = new AmbientLight({ color: Color.WHITE, intensity: 0.3 });
    this.scene.add(ambientLight);

    const sun: DirectionalLight = new DirectionalLight({ color: Color.WHITE, intensity: 0.8 });
    sun.direction.set(-1, -1, -1);
    this.scene.add(sun);

    // Prepare terrain material
    const terrainMat: TerrainMaterial = new TerrainMaterial({
      sandMap: Texture.fromImage(await TextureGenerator.createSand()),
      grassMap: Texture.fromImage(await TextureGenerator.createGrass()),
      rockMap: Texture.fromImage(await TextureGenerator.createRock()),
      snowMap: Texture.fromImage(await TextureGenerator.createSnow()),
    });

    // Configuration for Infinite Terrain
    this._terrainManager = new TerrainManager(this.scene, {
      chunkSize: 80,
      meshSegments: 64,
      heightmapDetail: 7, // 128x128
      heightmapRoughness: 0.55,
      maxHeight: 6.0,
      gridSize: 3, // 3x3 active chunks
      material: terrainMat,
      onRebuild: (): void => {
        // Rebuild the static octree whenever terrain chunks change
        this.scene.updateStaticOctree();
      },
    });

    await this._terrainManager.init();

    const loader: ObjLoader = new ObjLoader();
    loader.setBasePath("./assets/models/");

    try {
      const model: Object3D = await loader.load("vehicle-racer.obj");
      const carScale: number = 5;
      model.scale.set(carScale, carScale, carScale);
      // Position slightly above 0, as terrain fluctuates around 0
      model.position.set(0, 2.0, 0);

      this.scene.add(model);
      this._car = model; // Store car object, isStatic = false (default)

      // Setup WASD Controller for the car
      this._car.addBehavior(
        new WASDController({
          input: this.input,
          audio: this.audio,
          moveSpeed: CAR_SPEED,
        }),
      );
    } catch (error: unknown) {
      console.error("[Showcase 4] Error during loading:", error);
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

  protected override update(deltaTime: number): void {
    const dx: number = this.input.isPointerLocked ? this.input.mouse.dx : 0;
    const dy: number = this.input.isPointerLocked ? this.input.mouse.dy : 0;

    this.camera.update(this._targetPos, dx, dy, deltaTime);

    // --- WASD Control is now handled by WASDController ---
    if (this._car) {
      // Terrain update based on car position
      if (this._terrainManager) {
        this._terrainManager.update(this._car.position);
      }

      // Camera follows the car
      // Simple tracking: We set the camera target to the car
      this._targetPos.copyFrom(this._car.position);
    }
  }
}

// === START THE ENGINE ===
const app = new Showcase4();
app.start().catch((err: unknown) => console.error("[Showcase4] Failed to start:", err));
