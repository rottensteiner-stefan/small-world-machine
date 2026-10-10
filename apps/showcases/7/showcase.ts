import {
  AbstractShowcase,
  AmbientLight,
  Color,
  Cube,
  CubeLayout,
  CubeTexture,
  DirectionalLight,
  MathUtils,
  Object3D,
  PerspectiveProjection,
  PhongMaterial,
  SkyboxMaterial,
  Vector3D,
} from "@small-world-machine/engine";

/**
 * Showcase 7: Skybox & FPS Controls.
 * This example showcases a pure skybox environment without a physical floor.
 */
export class Showcase7 extends AbstractShowcase {
  private _moveSpeed: number = 15.0;
  private _eyeHeight: number = 2.0;

  protected override async setupScene(): Promise<void> {
    // 1. Camera
    const aspect: number = window.innerWidth / window.innerHeight;
    this.camera.projection = new PerspectiveProjection({
      fov: MathUtils.degToRad(75),
      aspect,
      near: 0.1,
      far: 2000,
    });
    this.camera.updateProjectionMatrix();

    this.defaultMoveSpeed = this._moveSpeed;
    this.setInitialCamera(
      new Vector3D(0, this._eyeHeight, 0),
      new Vector3D(0, this._eyeHeight, -10),
    );

    // 2. Lighting
    this.scene.add(new AmbientLight({ color: Color.WHITE, intensity: 0.5 }));
    const sun = new DirectionalLight({ color: Color.WHITE, intensity: 0.8 });
    sun.direction.set(-1, -1, -1).normalize();
    this.scene.add(sun);

    // 3. Skybox (Contains the floor texture in the bottom part of the cube map)
    const skyTexture = new CubeTexture();
    await skyTexture.loadFrom("./assets/skybox.webp", CubeLayout.CROSS_HORIZONTAL);

    const skybox = new Object3D("Skybox");
    skybox.geometry = new Cube({ size: 1000 }).getGeometryData();
    skybox.material = new SkyboxMaterial({ cubeMap: skyTexture });
    skybox.frustumCulled = false;
    this.scene.add(skybox);

    // 4. Orientierungspunkte (Illusion Breaker)
    const referenceCube = new Object3D("ReferenceCube");
    referenceCube.geometry = new Cube({ size: 2 }).getGeometryData();
    referenceCube.material = new PhongMaterial({ color: Color.BLUE, shininess: 50 });
    referenceCube.position.set(0, 1, -10);
    this.scene.add(referenceCube);

    const redCube = new Object3D("RedCube");
    redCube.geometry = new Cube({ size: 2 }).getGeometryData();
    redCube.material = new PhongMaterial({ color: Color.RED, shininess: 50 });
    redCube.position.set(10, 1, 0);
    this.scene.add(redCube);
  }

  protected override update(): void {
    // Keep camera above "virtual" floor
    this.camera.position.y = Math.max(this._eyeHeight, this.camera.position.y);

    // Skybox follows camera
    const skybox = this.scene.objects.find((o) => o.name === "Skybox");
    if (skybox) {
      skybox.position.copyFrom(this.camera.position);
    }
  }
}

const app = new Showcase7();
app.start().catch((err: unknown) => console.error("[Showcase7] Failed to start:", err));
