import type { EngineOptions, HbaoElement } from "@small-world-machine/engine";
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
  Plane,
  Object3D,
  OrbitController,
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
import { Hud, type BumpLevel, type DecalLabSlider } from "./Hud.js";

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

/**
 * Post elements with loud visual defaults (they activate the moment `postProcessing.enabled` turns
 * on). The HBAO lab disables them so the AO toggle shows HBAO only, not vignette/bloom/grain.
 */
const LOUD_POST_EFFECTS: readonly PostProcessingEffectType[] = [
  PostProcessingEffectType.BLOOM,
  PostProcessingEffectType.VIGNETTE,
  PostProcessingEffectType.GRAIN,
  PostProcessingEffectType.COLOR_GRADING,
  PostProcessingEffectType.QUANTIZE,
  PostProcessingEffectType.TAA,
  PostProcessingEffectType.MOTION_TRAIL,
  PostProcessingEffectType.OUTLINE,
  PostProcessingEffectType.GRAVITATIONAL_LENSING,
  PostProcessingEffectType.FLASH,
  PostProcessingEffectType.LIGHT_SHAFTS,
  PostProcessingEffectType.VOLUMETRIC_FOG,
  PostProcessingEffectType.DEPTH_OF_FIELD,
];

export class Showcase extends AbstractShowcase {
  private _hud: Hud | undefined = undefined;
  private _sun: DirectionalLight | undefined = undefined;
  private _ambient: AmbientLight | undefined = undefined;
  private _floor: Object3D | undefined = undefined;
  private _normalProbe: DecalMaterial | undefined = undefined;
  private _hbao: HbaoElement | undefined = undefined;
  /** Every probe decal's material; the lab's unlit toggle flips them as one. */
  private readonly _decalMaterials: DecalMaterial[] = [];
  /** Index by {@link BumpLevel}: 0 = plain floor material, 1/2 = bump variants (lazy). */
  private readonly _floorMaterials: (StandardMaterial | undefined)[] = [
    undefined,
    undefined,
    undefined,
  ];
  private _bumpLevel: BumpLevel = 0;
  private _unlit: boolean = UNLIT;
  private _hbaoOn: boolean = false;
  private _hbaoRadius: number = 0.5;
  private _hbaoIntensity: number = 1.5;
  private _authoredSun: number = 1.1;
  private _authoredAmbient: number = 0.25;
  private _authoredBump: BumpLevel = 0;
  private _authoredOpacity: number = 128 / 255;
  private _authoredEdgeFade: number = 0.1;
  private _authoredUnlit: boolean = UNLIT;
  private _authoredHbao: boolean = false;

  constructor(config: EngineOptions = {}) {
    super(config);
    this._authoredHbao = new URLSearchParams(location.search).get("hbao") === "1";
    this._hbaoOn = this._authoredHbao;
  }

  protected override async setupScene(): Promise<void> {
    this.defaultFov = (60 * Math.PI) / 180;
    this.defaultFar = 100;
    this.configureCamera();

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
      this._hbao = hbao;
    }

    const spotShadows: boolean = new URLSearchParams(location.search).get("spot") === "1";
    this._authoredSun = spotShadows ? 0 : 1.1;
    this._authoredAmbient = spotShadows ? 0.05 : 0.25;
    const sun = new DirectionalLight({ color: Color.WHITE, intensity: this._authoredSun });
    sun.direction.set(-0.4, -1, -0.3);
    this._sun = sun;
    this.scene.add(sun);
    const ambient = new AmbientLight({ color: Color.WHITE, intensity: this._authoredAmbient });
    this._ambient = ambient;
    this.scene.add(ambient);

    // The plain floor material is registered under bump level 0; bump variants are built lazily
    // and swap `floor.material` live from the lab (the wall/pedestal keep sharing this instance).
    const concrete = new StandardMaterial({ color: new Color(0.55, 0.55, 0.58), roughness: 0.9 });
    this._floorMaterials[0] = concrete;

    const floor = new Object3D("Floor");
    floor.geometry = new Ground({ width: 24, depth: 24 }).getGeometryData();
    floor.receiveShadow = true;
    this._floor = floor;
    this.scene.add(floor);

    // `?bump=1`: floor gets a strong constant tangent-space tilt; `?bump=2`: a stripe bump pattern.
    // Ground has UVs and auto-computed tangents, so the shading normal clearly differs from (0,1,0).
    const bumpParam = Number(new URLSearchParams(location.search).get("bump"));
    this._authoredBump = (bumpParam === 1 || bumpParam === 2 ? bumpParam : 0) as BumpLevel;
    this._applyFloorBump(this._authoredBump);

    const wall = new Object3D("Wall").setPosition(0, 1.5, -3).setScale(8, 3, 0.4);
    wall.geometry = new Cube({ size: 1 }).getGeometryData();
    wall.material = concrete;
    this.scene.add(wall);

    const pedestal = new Object3D("Pedestal").setPosition(2.2, 0.75, -0.5).setScale(1.5);
    pedestal.geometry = new Cube({ size: 1 }).getGeometryData();
    pedestal.material = concrete;
    this.scene.add(pedestal);

    const stripes = await Texture.fromUrl("/assets/kits/flakturm/decals/hazard_stripes.webp");
    const sign = await Texture.fromUrl("/assets/kits/flakturm/decals/sign_koje42.webp");

    const floorStripesMaterial = new DecalMaterial({ unlit: UNLIT, diffuseMap: stripes });
    this._decalMaterials.push(floorStripesMaterial);
    const floorStripes = new Decal(floorStripesMaterial, "FloorStripes");
    floorStripes.setPosition(-1.6, 0, 0.6).setScale(3, 0.8, 1);
    this.scene.add(floorStripes);

    // Local +Y is the decal's up axis, so tipping the box by 90 degrees about X aims it at the wall's +Z face.
    const wallSignMaterial = new DecalMaterial({ unlit: UNLIT, diffuseMap: sign });
    this._decalMaterials.push(wallSignMaterial);
    const wallSign = new Decal(wallSignMaterial, "WallSign");
    wallSign
      .setPosition(0, 1.8, -2.8)
      .setRotation(Math.PI / 2, 0, 0)
      .setScale(2.4, 0.6, 1.2);
    this.scene.add(wallSign);

    // A box wider than the pedestal base: stripes land on the floor around it, the pedestal's
    // vertical sides must fade out through the angle fade instead of smearing.
    const aroundPedestalMaterial = new DecalMaterial({ unlit: UNLIT, diffuseMap: stripes });
    this._decalMaterials.push(aroundPedestalMaterial);
    const aroundPedestal = new Decal(aroundPedestalMaterial, "AroundPedestal");
    aroundPedestal.setPosition(2.2, 0, -0.5).setScale(3.4, 1.2, 3.4);
    this.scene.add(aroundPedestal);

    // Half-transparent decal with a strongly tilted tangent-space normal: the normal buffer beneath
    // it must end up between the floor normal and the decal normal (alpha-blended).
    // The lab exposes its opacity and edge fade for direct probing.
    const normalProbeMaterial = new DecalMaterial({
      unlit: UNLIT,
      diffuseMap: solidTexture(255, 255, 255, 128),
      normalMap: solidTexture(230, 128, 200, 255),
    });
    this._decalMaterials.push(normalProbeMaterial);
    this._normalProbe = normalProbeMaterial;
    const normalProbe = new Decal(normalProbeMaterial, "NormalProbe");
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
    const signDecalMaterial = new DecalMaterial({ unlit: UNLIT, diffuseMap: sign });
    this._decalMaterials.push(signDecalMaterial);
    const signDecal = new Decal(signDecalMaterial, "SignDecal");
    signDecal
      .setPosition(3, 0.45, -2.8)
      .setRotation(Math.PI / 2, 0, 0)
      .setScale(1.2, 0.4, 0.3);
    this.scene.add(signDecal);
    controlPlane.material = controlMaterial;
    this.scene.add(controlPlane);

    const quadrantDecalMaterial = new DecalMaterial({ unlit: UNLIT, diffuseMap: quadrants });
    this._decalMaterials.push(quadrantDecalMaterial);
    const quadrantDecal = new Decal(quadrantDecalMaterial, "QuadrantDecal");
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

  /** After boot: mount the Decal Probe Lab on the interactive main scene only (QA probes stay bare). */
  public override async start(): Promise<void> {
    await super.start();
    if (!this._isProbeMode()) {
      this._createHud();
    }
  }

  public override destroy(): void {
    this._hud?.dispose();
    this._hud = undefined;
    super.destroy();
  }

  protected override onKeyDown(event: KeyboardEvent): void {
    super.onKeyDown(event);
    if (this._isProbeMode() || event.altKey || event.metaKey || event.ctrlKey) return;
    if (document.activeElement?.tagName === "INPUT") return;
    if (this._hud?.handleKey(event)) {
      event.preventDefault();
      return;
    }
    switch (event.code) {
      case "Digit0":
        this._resetToReference();
        break;
      case "Digit1":
      case "Digit2":
      case "Digit3":
        this._applyFloorBump((Number(event.code.slice(-1)) - 1) as BumpLevel);
        this._syncHud();
        break;
      case "KeyU":
        this._setUnlit(!this._unlit);
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  private _isProbeMode(): boolean {
    const params = new URLSearchParams(location.search);
    return (
      params.get("mip") === "1" ||
      params.get("orm") === "1" ||
      params.get("pool") === "1" ||
      params.get("wet") === "1"
    );
  }

  private _createHud(): void {
    this._hud = new Hud({
      setSlider: (name: DecalLabSlider, value: number): void => this._setSlider(name, value),
      setBumpLevel: (level: BumpLevel): void => {
        this._applyFloorBump(level);
        this._syncHud();
      },
      toggleUnlit: (): void => this._setUnlit(!this._unlit),
      toggleHbao: (): void => this._applyHbao(!this._hbaoOn),
      resetToReference: (): void => this._resetToReference(),
    });
    this._syncHud();
  }

  /** Pushes the current lab state into the panel controls; event-driven only, never per frame. */
  private _syncHud(): void {
    if (!this._hud) return;
    this._hud.sync({
      sun: this._sun?.intensity ?? 0,
      ambient: this._ambient?.intensity ?? 0,
      bumpLevel: this._bumpLevel,
      opacity: this._normalProbe?.color.a ?? 1,
      edgeFade: this._normalProbe?.edgeFade ?? this._authoredEdgeFade,
      unlit: this._unlit,
      hbaoOn: this._hbaoOn,
      hbaoRadius: this._hbaoRadius,
      hbaoIntensity: this._hbaoIntensity,
    });
  }

  private _setSlider(name: DecalLabSlider, value: number): void {
    switch (name) {
      case "Sun":
        if (this._sun) this._sun.intensity = value;
        break;
      case "Ambient":
        if (this._ambient) this._ambient.intensity = value;
        break;
      case "Opacity":
        if (this._normalProbe) this._normalProbe.color.a = value;
        break;
      case "EdgeFade":
        if (this._normalProbe) this._normalProbe.edgeFade = value;
        break;
      case "HbaoRadius":
        this._hbaoRadius = value;
        if (this._hbao) this._hbao.radius = value;
        break;
      case "HbaoIntensity":
        this._hbaoIntensity = value;
        if (this._hbao) this._hbao.intensity = value;
        break;
    }
    this._syncHud();
  }

  /** Swaps `floor.material` between the plain concrete and the two bump variants (live flags). */
  private _applyFloorBump(level: BumpLevel): void {
    const floor = this._floor;
    if (!floor) return;
    const material = this._bumpMaterial(level);
    if (material) floor.material = material;
    this._bumpLevel = level;
  }

  private _bumpMaterial(level: BumpLevel): StandardMaterial | undefined {
    const existing = this._floorMaterials[level];
    if (existing) return existing;
    if (level === 0) return undefined; // plain concrete is pre-registered in setupScene
    const material = new StandardMaterial({
      color: new Color(0.55, 0.55, 0.58),
      roughness: 0.9,
      normalMap: level === 1 ? solidTexture(200, 128, 200, 255) : bumpPatternTexture(),
    });
    this._floorMaterials[level] = material;
    return material;
  }

  private _setUnlit(unlit: boolean): void {
    this._unlit = unlit;
    for (const material of this._decalMaterials) {
      material.unlit = unlit;
    }
    this._syncHud();
  }

  /**
   * Controlled HBAO toggle: keeps only tone mapping + HBAO in the post pipeline and silences the
   * loud default siblings, so the knob demos ambient occlusion and nothing else.
   */
  private _applyHbao(on: boolean): void {
    this._hbaoOn = on;
    const post = this.renderer.postProcessing;
    const hbao = this._hbao;
    if (on && hbao) {
      post.enabled = true;
      for (const type of LOUD_POST_EFFECTS) {
        const element = post.get(type);
        if (element) element.enabled = false;
      }
      hbao.enabled = true;
      hbao.radius = this._hbaoRadius;
      hbao.intensity = this._hbaoIntensity;
    } else {
      if (hbao) hbao.enabled = false;
      post.enabled = false;
    }
    this._syncHud();
  }

  private _resetToReference(): void {
    if (this._sun) this._sun.intensity = this._authoredSun;
    if (this._ambient) this._ambient.intensity = this._authoredAmbient;
    this._applyFloorBump(this._authoredBump);
    if (this._normalProbe) {
      this._normalProbe.color.a = this._authoredOpacity;
      this._normalProbe.edgeFade = this._authoredEdgeFade;
    }
    this._setUnlit(this._authoredUnlit);
    this._applyHbao(this._authoredHbao);
    this.resetCamera();
    this._syncHud();
  }

  protected override update(_deltaTime: number): void {
    this.scene.update();
  }
}

const app = new Showcase({
  quality: { normalBuffer: normalBufferMode() },
});
(window as unknown as { app: Showcase }).app = app;
app.start().catch((err: unknown) => console.error("[DecalProbe] Failed to start:", err));
