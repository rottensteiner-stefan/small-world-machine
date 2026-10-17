import {
  AbstractShowcase,
  AmbientLight,
  bakeSceneDecals,
  CameraStrategyType,
  Color,
  Cube,
  Decal,
  DecalMaterial,
  DirectionalLight,
  Ground,
  HbaoElement,
  Plane,
  Object3D,
  OrbitController,
  PerspectiveProjection,
  PostProcessingEffectType,
  SpotLight,
  StandardMaterial,
  Texture,
  Vector3D,
} from "@small-world-machine/engine";
import { setupMipScene } from "./mipScene.js";
import { setupOrmScene } from "./ormScene.js";
import { setupPoolScene } from "./poolScene.js";
import { setupWetScene } from "./wetScene.js";

/**
 * Decal probe: box-projected decals on a floor, a wall and a pedestal. Query params:
 * `?pool=1` (+ `&shoot=1` for real clicks) drives a `DecalPool` from the check script (`poolChecks`), `?wet=1` shows the kit's wet-puddle preset against a dark-only twin (`wetChecks`), `?nb=1`/`?nb=0` force the normal buffer on/off (default: auto, on while decals are visible), `?pp=1` enables post-processing, `?hbao=1` enables HBAO (and post-processing), `?unlit=1` draws the decals unlit (WebGL2 needs it for the
 * normal buffer), `?bump=1|2` gives the floor a normal map, `?spot=1` swaps the sun for a shadow-casting spot light with an occluder whose shadow crosses the
 * FloorStripes decal edge, `?bake=1` bakes every decal into a mesh before the first frame (the WebGL1 path, see docs/guides/decals.md), `?rendererType=WEB_GPU|WEB_GL2|WEB_GL1` picks the backend.
 */
/** 2x2 quadrants, image top-left red, top-right green, bottom-left blue, bottom-right yellow. */
function quadrantTexture(): Texture {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  const quadrants: [number, number, string][] = [
    [0, 0, "#ff0000"],
    [32, 0, "#00ff00"],
    [0, 32, "#0000ff"],
    [32, 32, "#ffff00"],
  ];
  for (const [x, y, color] of quadrants) {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, 32, 32);
  }
  return Texture.fromCanvas(canvas);
}

function solidTexture(r: number, g: number, b: number, a: number): Texture {
  const canvas = document.createElement("canvas");
  canvas.width = 4;
  canvas.height = 4;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${a / 255})`;
  ctx.fillRect(0, 0, 4, 4);
  return Texture.fromCanvas(canvas);
}

/** Tangent-space normal map with alternating strongly tilted stripes (bump pattern). */
function bumpPatternTexture(): Texture {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  for (let x = 0; x < 64; x += 8) {
    ctx.fillStyle = (x / 8) % 2 === 0 ? "rgb(200,128,200)" : "rgb(56,128,200)";
    ctx.fillRect(x, 0, 8, 64);
  }
  return Texture.fromCanvas(canvas);
}

/** `?nb=1` forces the normal buffer on, `?nb=0` off, no `nb` leaves the engine default ("auto"). */
function normalBufferMode(): boolean | "auto" {
  const nb = new URLSearchParams(location.search).get("nb");
  if (nb === "1") return true;
  if (nb === "0") return false;
  return "auto";
}

/** `?unlit=1` makes every probe decal unlit (flat albedo, no light loop). */
const UNLIT = new URLSearchParams(location.search).get("unlit") === "1";

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

    if (new URLSearchParams(location.search).get("mip") === "1") {
      this.defaultCameraController = "none";
      setupMipScene(this.scene, this.camera);
      return;
    }

    if (new URLSearchParams(location.search).get("orm") === "1") {
      this.defaultCameraController = "none";
      setupOrmScene(this.scene, this.camera);
      return;
    }

    if (new URLSearchParams(location.search).get("pool") === "1") {
      this.defaultCameraController = "none";
      setupPoolScene(this.scene, this.camera);
      return;
    }

    if (new URLSearchParams(location.search).get("wet") === "1") {
      this.defaultCameraController = "none";
      await setupWetScene(this.scene, this.camera);
      return;
    }

    if (new URLSearchParams(location.search).get("pp") === "1") {
      this.renderer.postProcessing.enabled = true;
    }
    if (new URLSearchParams(location.search).get("hbao") === "1") {
      this.renderer.postProcessing.enabled = true;
      const hbao = this.renderer.postProcessing.get<HbaoElement>(PostProcessingEffectType.HBAO)!;
      hbao.enabled = true;
      hbao.radius = 0.5;
      hbao.intensity = 1.5;
    }

    const spotShadows: boolean = new URLSearchParams(location.search).get("spot") === "1";
    const sun = new DirectionalLight({ color: Color.WHITE, intensity: spotShadows ? 0 : 1.1 });
    sun.direction.set(-0.4, -1, -0.3);
    this.scene.add(sun);
    this.scene.add(new AmbientLight({ color: Color.WHITE, intensity: spotShadows ? 0.05 : 0.25 }));

    const concrete = new StandardMaterial({ color: new Color(0.55, 0.55, 0.58), roughness: 0.9 });

    const floor = new Object3D("Floor");
    floor.geometry = new Ground({ width: 24, depth: 24 }).getGeometryData();
    // `?bump=1`: floor gets a strong constant tangent-space tilt; `?bump=2`: a stripe bump pattern.
    // Ground has UVs and auto-computed tangents, so the shading normal clearly differs from (0,1,0).
    const bump: string | null = new URLSearchParams(location.search).get("bump");
    if (bump === "1" || bump === "2") {
      floor.material = new StandardMaterial({
        color: new Color(0.55, 0.55, 0.58),
        roughness: 0.9,
        normalMap: bump === "1" ? solidTexture(200, 128, 200, 255) : bumpPatternTexture(),
      });
    } else {
      floor.material = concrete;
    }
    floor.receiveShadow = true;
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

    const floorStripes = new Decal(
      new DecalMaterial({ unlit: UNLIT, diffuseMap: stripes }),
      "FloorStripes",
    );
    floorStripes.setPosition(-1.6, 0, 0.6).setScale(3, 0.8, 1);
    this.scene.add(floorStripes);

    // Local +Y is the decal's up axis, so tipping the box by 90 degrees about X aims it at the wall's +Z face.
    const wallSign = new Decal(new DecalMaterial({ unlit: UNLIT, diffuseMap: sign }), "WallSign");
    wallSign
      .setPosition(0, 1.8, -2.8)
      .setRotation(Math.PI / 2, 0, 0)
      .setScale(2.4, 0.6, 1.2);
    this.scene.add(wallSign);

    // A box wider than the pedestal base: stripes land on the floor around it, the pedestal's
    // vertical sides must fade out through the angle fade instead of smearing.
    const aroundPedestal = new Decal(
      new DecalMaterial({ unlit: UNLIT, diffuseMap: stripes }),
      "AroundPedestal",
    );
    aroundPedestal.setPosition(2.2, 0, -0.5).setScale(3.4, 1.2, 3.4);
    this.scene.add(aroundPedestal);

    // Half-transparent decal with a strongly tilted tangent-space normal: the normal buffer beneath
    // it must end up between the floor normal and the decal normal (alpha-blended).
    const normalProbe = new Decal(
      new DecalMaterial({
        unlit: UNLIT,
        diffuseMap: solidTexture(255, 255, 255, 128),
        normalMap: solidTexture(230, 128, 200, 255),
      }),
      "NormalProbe",
    );
    normalProbe.setPosition(-4, 0, 2).setScale(1.5, 1, 1.5);
    this.scene.add(normalProbe);

    // UV orientation check: a Plane mesh (left) and a Decal (right) carrying the same quadrant
    // texture on the wall must show the quadrants in the same arrangement.
    const quadrants = quadrantTexture();
    const controlMaterial = new StandardMaterial({ roughness: 1 });
    controlMaterial.diffuseMap = quadrants;
    const controlPlane = new Object3D("QuadrantPlane").setPosition(-3, 1.4, -2.78);
    controlPlane.geometry = new Plane({ width: 1, height: 1 }).getGeometryData();
    const signPlaneMaterial = new StandardMaterial({ roughness: 1 });
    signPlaneMaterial.diffuseMap = sign;
    const signPlane = new Object3D("SignPlane").setPosition(-3, 0.45, -2.78);
    signPlane.geometry = new Plane({ width: 1.2, height: 0.3 }).getGeometryData();
    signPlane.material = signPlaneMaterial;
    this.scene.add(signPlane);
    const signDecal = new Decal(new DecalMaterial({ unlit: UNLIT, diffuseMap: sign }), "SignDecal");
    signDecal
      .setPosition(3, 0.45, -2.8)
      .setRotation(Math.PI / 2, 0, 0)
      .setScale(1.2, 0.4, 0.3);
    this.scene.add(signDecal);
    controlPlane.material = controlMaterial;
    this.scene.add(controlPlane);

    const quadrantDecal = new Decal(
      new DecalMaterial({ unlit: UNLIT, diffuseMap: quadrants }),
      "QuadrantDecal",
    );
    quadrantDecal
      .setPosition(3, 1.4, -2.8)
      .setRotation(Math.PI / 2, 0, 0)
      .setScale(1, 0.4, 1);
    this.scene.add(quadrantDecal);

    if (spotShadows) {
      const spot = new SpotLight({
        color: Color.WHITE,
        intensity: 40,
        distance: 20,
        decay: 2,
        angle: (40 * Math.PI) / 180,
        penumbra: 0.2,
        direction: new Vector3D(0, -1, 0),
        castShadow: true,
        shadowBias: 0.002,
        shadowResolution: 2048,
      });
      spot.position.set(-1.6, 6, 0.6);
      this.scene.add(spot);

      // Its shadow straddles the right edge of FloorStripes (x = -0.1): plain floor and decal both lit by the spot.
      const occluder = new Object3D("Occluder").setPosition(-0.4, 2.4, 0.6).setScale(1.5, 0.2, 0.8);
      occluder.geometry = new Cube({ size: 1 }).getGeometryData();
      occluder.material = concrete;
      occluder.castShadow = true;
      this.scene.add(occluder);

      // WebGPU rebuilds the shadow camera every frame; WebGL2 only uses the one created at
      // construction, so give it the final world position once (the light never moves).
      this.scene.update();
      spot.updateShadowCamera();
    }

    if (new URLSearchParams(location.search).get("bake") === "1") {
      bakeSceneDecals(this.scene.root);
    }

    this.camera.setStrategy(CameraStrategyType.SMOOTH);
    this.camera.position.set(0, spotShadows ? 6 : 3.2, spotShadows ? 4 : 6);
    this.camera.target.set(spotShadows ? -0.5 : 0, spotShadows ? 0 : 0.8, spotShadows ? 0.6 : -1);
    this.camera.addBehavior(new OrbitController({ input: this.input }));
    this.camera.updateViewMatrix();
  }

  protected override update(_deltaTime: number): void {
    this.scene.update();
  }
}

const app = new DecalProbe({
  quality: { normalBuffer: normalBufferMode() },
});
(window as unknown as { app: DecalProbe }).app = app;
app.start().catch((err: unknown) => console.error("[DecalProbe] Failed to start:", err));
