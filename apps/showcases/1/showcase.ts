import {
  AbstractShowcase,
  AmbientLight,
  CameraStrategyType,
  Color,
  Cube,
  DirectionalLight,
  Ground,
  LambertMaterial,
  Object3D,
  OrbitController,
  PerspectiveProjection,
  PhongMaterial,
} from "@small-world-machine/engine";

class Showcase1 extends AbstractShowcase {
  private _myCube!: Object3D;

  protected override async setupScene(): Promise<void> {
    // Force perspective projection
    const aspect: number = window.innerWidth / window.innerHeight;
    this.camera.projection = new PerspectiveProjection({
      fov: (75 * Math.PI) / 180,
      aspect,
      near: 0.1,
      far: 1000,
    });
    this.camera.updateProjectionMatrix();

    // 1. Light: A gentle sun
    const sun: DirectionalLight = new DirectionalLight({ color: Color.WHITE, intensity: 1.0 });
    sun.direction.set(-1, -1, -1);
    sun.castShadow = true;
    sun.shadowBias = 0.005;
    this.scene.add(sun);

    this.scene.add(new AmbientLight({ color: Color.WHITE, intensity: 0.2 }));

    // 2. Object: A single cube with blue material
    this._myCube = new Object3D("RotatingCube").setPosition(0, 0, 0).setScale(1);

    this._myCube.geometry = new Cube({ size: 2 }).getGeometryData();
    this._myCube.material = new PhongMaterial({
      color: Color.fromName("dodgerblue")!,
      shininess: 60,
    });
    this._myCube.castShadow = true;
    this._myCube.receiveShadow = true;

    this.scene.add(this._myCube);

    // Floor to receive shadows (square, centered on the scene origin)
    const floor = new Object3D("Floor").setPosition(0, -2, 0);
    floor.geometry = new Ground({ width: 8, depth: 8 }).getGeometryData();
    floor.material = new LambertMaterial({ color: Color.WHITE });
    floor.receiveShadow = true;
    this.scene.add(floor);

    // 3. Position camera
    this.camera.setStrategy(CameraStrategyType.SMOOTH);
    this.camera.position.set(0, 3, 6);
    this.camera.target.set(0, 0, 0);
    this.camera.addBehavior(new OrbitController({ input: this.input, audio: this.audio }));
    this.camera.updateViewMatrix();
  }

  protected override update(deltaTime: number): void {
    // Rotate the cube around all axes every frame
    this._myCube.rotation.x += deltaTime;
    this._myCube.rotation.y += 1.5 * deltaTime;
  }
}

// === START THE ENGINE ===
const app = new Showcase1();
app.start().catch((err: unknown) => console.error("[Showcase1] Failed to start:", err));
