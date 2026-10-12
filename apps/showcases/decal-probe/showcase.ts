import {
  AbstractShowcase,
  AmbientLight,
  CameraStrategyType,
  Color,
  Cube,
  Decal,
  DecalMaterial,
  DirectionalLight,
  Ground,
  Object3D,
  OrbitController,
  PerspectiveProjection,
  StandardMaterial,
  Texture,
} from "@small-world-machine/engine";

/**
 * Decal probe: box-projected decals on a floor, a wall and a pedestal. Query params:
 * `?nb=1` turns the normal buffer on, `?rendererType=WEB_GPU` picks the backend.
 */
class DecalProbe extends AbstractShowcase {
  protected override async setupScene(): Promise<void> {
    const aspect: number = window.innerWidth / window.innerHeight;
    this.camera.projection = new PerspectiveProjection({
      fov: (60 * Math.PI) / 180,
      aspect,
      near: 0.1,
      far: 100,
    });
    this.camera.updateProjectionMatrix();

    const sun = new DirectionalLight({ color: Color.WHITE, intensity: 1.1 });
    sun.direction.set(-0.4, -1, -0.3);
    this.scene.add(sun);
    this.scene.add(new AmbientLight({ color: Color.WHITE, intensity: 0.25 }));

    const concrete = new StandardMaterial({ color: new Color(0.55, 0.55, 0.58), roughness: 0.9 });

    const floor = new Object3D("Floor");
    floor.geometry = new Ground({ width: 24, depth: 24 }).getGeometryData();
    floor.material = concrete;
    this.scene.add(floor);

    const wall = new Object3D("Wall").setPosition(0, 1.5, -3).setScale(8, 3, 0.4);
    wall.geometry = new Cube({ size: 1 }).getGeometryData();
    wall.material = concrete;
    this.scene.add(wall);

    const pedestal = new Object3D("Pedestal").setPosition(2.2, 0.75, -0.5).setScale(1.5);
    pedestal.geometry = new Cube({ size: 1 }).getGeometryData();
    pedestal.material = concrete;
    this.scene.add(pedestal);

    const stripes = await Texture.fromUrl("/assets/kits/flakturm/decals/hazard_stripes.png");
    const sign = await Texture.fromUrl("/assets/kits/flakturm/decals/sign_koje42.png");

    const floorStripes = new Decal(new DecalMaterial({ diffuseMap: stripes }), "FloorStripes");
    floorStripes.setPosition(-1.6, 0, 0.6).setScale(3, 0.8, 1);
    this.scene.add(floorStripes);

    // Local +Y is the decal's up axis, so tipping the box by 90 degrees about X aims it at the wall's +Z face.
    const wallSign = new Decal(new DecalMaterial({ diffuseMap: sign }), "WallSign");
    wallSign
      .setPosition(0, 1.8, -2.8)
      .setRotation(Math.PI / 2, 0, 0)
      .setScale(2.4, 0.6, 1.2);
    this.scene.add(wallSign);

    // A box wider than the pedestal base: stripes land on the floor around it, the pedestal's
    // vertical sides must fade out through the angle fade instead of smearing.
    const aroundPedestal = new Decal(new DecalMaterial({ diffuseMap: stripes }), "AroundPedestal");
    aroundPedestal.setPosition(2.2, 0, -0.5).setScale(3.4, 1.2, 3.4);
    this.scene.add(aroundPedestal);

    this.camera.setStrategy(CameraStrategyType.SMOOTH);
    this.camera.position.set(0, 3.2, 6);
    this.camera.target.set(0, 0.8, -1);
    this.camera.addBehavior(new OrbitController({ input: this.input, audio: this.audio }));
    this.camera.updateViewMatrix();
  }

  protected override update(_deltaTime: number): void {
    this.scene.update();
  }
}

const app = new DecalProbe({
  quality: { normalBuffer: new URLSearchParams(location.search).get("nb") === "1" },
});
(window as unknown as { app: DecalProbe }).app = app;
app.start().catch((err: unknown) => console.error("[DecalProbe] Failed to start:", err));
