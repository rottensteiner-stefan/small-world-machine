import {
  AbstractShowcase,
  AmbientLight,
  CameraStrategyType,
  Color,
  DirectionalLight,
  Grid,
  Keys,
  Object3D,
  ObjLoader,
  OrbitController,
  PhongMaterial,
  Vector3D,
  WireframeMaterial,
} from "@small-world-machine/engine";

export class Showcase extends AbstractShowcase {
  private _carModel: Object3D | undefined;

  protected override async setupScene(): Promise<void> {
    this.defaultFov = (75 * Math.PI) / 180;
    this.configureCamera();

    this.setInitialCamera(new Vector3D(0, 5, 15), new Vector3D(0, 0, 0));

    // Turntable orbit around the grid center (target = (0,0,0)) so drag-to-rotate pivots
    // at the middle of the grid, matching the pre-migration behavior.
    this.camera.setStrategy(CameraStrategyType.HYBRID_SYNC);
    this.camera.target.set(0, 0, 0);
    this.camera.addBehavior(new OrbitController({ input: this.input }));

    const ambientLight: AmbientLight = new AmbientLight({ color: Color.WHITE, intensity: 0.3 });
    this.scene.add(ambientLight);

    const sun: DirectionalLight = new DirectionalLight({ color: Color.WHITE, intensity: 0.8 });
    sun.direction.set(-1, -1, -1);
    this.scene.add(sun);

    const gridObj: Object3D = new Object3D("Floor");
    gridObj.geometry = new Grid({ size: 20, divisions: 20 }).getGeometryData();
    const gridMat: WireframeMaterial = new WireframeMaterial();
    gridMat.color = Color.fromName("darkslategray")!;
    gridObj.material = gridMat;
    this.scene.add(gridObj);

    const loader: ObjLoader = new ObjLoader();
    loader.setBasePath("./assets/models/");

    try {
      this._carModel = await loader.load("vehicle-racer.obj");
      const carScale: number = 5;
      this._carModel.scale.set(carScale, carScale, carScale);
      this._carModel.position.set(0, 0.0, 0);
      this.scene.add(this._carModel);
    } catch (error: unknown) {
      console.error("[Showcase 3] Error loading model:", error);
    }
  }

  private _setCarColor(index: number): void {
    if (!this._carModel) return;

    // Find the part of the car that uses the colormap material
    // The ObjLoader creates children named after the material groups
    this._carModel.children.forEach((child) => {
      if (child.material instanceof PhongMaterial && child.material.diffuseMap) {
        // Shifting the X offset picks a different color column in colormap.webp
        // Usually, these textures have 8 or 16 columns. 0.125 is a good step for Kenney assets.
        child.material.diffuseMap.offset.x = index * 0.125;
      }
    });
  }

  protected override update(): void {
    // Handle Color Switching
    if (this.input.isPressed(Keys.D1)) this._setCarColor(0);
    if (this.input.isPressed(Keys.D2)) this._setCarColor(1);
    if (this.input.isPressed(Keys.D3)) this._setCarColor(2);
    if (this.input.isPressed(Keys.D4)) this._setCarColor(3);
    if (this.input.isPressed(Keys.D5)) this._setCarColor(4);
  }
}

const app = new Showcase();
app.start().catch((err: unknown) => console.error("[Showcase3] Failed to start:", err));
