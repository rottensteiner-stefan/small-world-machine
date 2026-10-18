import {
  AbstractShowcase,
  AmbientLight,
  AxesHelper,
  BasicMaterial,
  CameraStrategyType,
  Color,
  Grid,
  Keys,
  Object3D,
  OrbitController,
  PointLight,
  Sphere,
  WireframeMaterial,
} from "@small-world-machine/engine";

/**
 * Showcase 11: Orientation
 * Displays a ground grid centered at (0,0,0) to showcasesnstrate the coordinate system.
 */
class Showcase11 extends AbstractShowcase {
  protected override async setupScene(): Promise<void> {
    // Setup input listeners (e.g. pointer lock)
    this.onCanvasRecreated();

    // Configure camera projection
    this.defaultFov = (75 * Math.PI) / 180;
    this.configureCamera();

    // Use HYBRID_SYNC strategy: Syncs manual position changes (WSAD) with orbital rotation (Maus).
    this.camera.setStrategy(CameraStrategyType.HYBRID_SYNC);
    this.camera.position.set(20, 20, 40);

    // Re-add OrbitController to handle rotation via mouse
    this.camera.addBehavior(new OrbitController({ input: this.input }));

    // Create the ground grid (size 20x20)
    // Absolute (0,0,0) is in the middle of this grid.
    const gridObj: Object3D = new Object3D("FloorGrid");
    gridObj.geometry = new Grid({ size: 20, divisions: 20 }).getGeometryData();
    const gridMat: WireframeMaterial = new WireframeMaterial();
    gridMat.color = Color.fromName("darkslategray")!;
    gridObj.material = gridMat;
    this.scene.add(gridObj);

    // Create a centered "Sun" (diameter 1)
    const sunObj: Object3D = new Object3D("Sun");
    sunObj.geometry = new Sphere({ radius: 0.5 }).getGeometryData();
    // BasicMaterial makes it appear "unlit" and always bright (glowing)
    sunObj.material = new BasicMaterial({ color: new Color(1, 0.8, 0.1) });
    this.scene.add(sunObj);

    // Add a PointLight at the sun's position to illuminate the scene
    const sunLight: PointLight = new PointLight({
      color: new Color(1, 0.9, 0.5),
      intensity: 1.5,
      distance: 50,
    });
    sunObj.add(sunLight);

    // Add AmbientLight so the rest of the coordinate system is visible
    this.scene.add(new AmbientLight({ color: Color.WHITE, intensity: 0.2 }));

    // --- Add Axes ---
    // The engine's own coordinate-cross gizmo (Neon Red/Green/Blue for X/Y/Z, arrow + label per
    // axis) -- previously this showcase drew its own bespoke double-headed axis lines here, which
    // had drifted from AxesHelper's colors and duplicated its label-rendering logic. `size: 7`
    // matches the old axis' half-length (each old arm reached 7 units from the origin).
    this.scene.add(new AxesHelper({ size: 7 }));
  }

  /**
   * Update logic for camera movement.
   */
  protected override update(deltaTime: number): void {
    const moveSpeed: number = 10 * deltaTime;

    // Movement along world axes
    if (this.input.isPressed(Keys.W)) this.camera.position.z -= moveSpeed; // Forward (-Z)
    if (this.input.isPressed(Keys.S)) this.camera.position.z += moveSpeed; // Backward (+Z)
    if (this.input.isPressed(Keys.A)) this.camera.position.x -= moveSpeed; // Left (-X)
    if (this.input.isPressed(Keys.D)) this.camera.position.x += moveSpeed; // Right (+X)
    if (this.input.isPressed(Keys.Q)) this.camera.position.y += moveSpeed; // Up (+Y)
    if (this.input.isPressed(Keys.E)) this.camera.position.y -= moveSpeed; // Down (-Y)

    // OrbitController will handle theta/phi rotation via mouse,
    // we keep the camera focused on the origin.
    this.camera.target.set(0, 0, 0);
  }
}

const app = new Showcase11();
app.start().catch((err: unknown) => console.error("[Showcase11] Failed to start:", err));
