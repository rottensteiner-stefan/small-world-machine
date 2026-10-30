import type { Behavior, EngineOptions, GeometryDataInterface } from "@small-world-machine/engine";
import {
  AbstractShowcase,
  AmbientLight,
  BasicMaterial,
  BillboardInstancer,
  BobbingBehavior,
  BoundingBox,
  CameraStrategyType,
  Color,
  Cube,
  Cylinder,
  DirectionalLight,
  FPSController,
  Fog,
  FogMode,
  GltfLoader,
  Ground,
  LambertMaterial,
  LiquidWaveMaterial,
  MathUtils,
  Object3D,
  OpenWaterMaterial,
  OpenWaterSurfaceProbe,
  PlanarReflectionNode,
  Plane,
  PointLight,
  RendererType,
  RigidBody,
  RotatorBehavior,
  StandardMaterial,
  StylizedWaterMaterial,
  Texture,
  TextureWrap,
  Vector3D,
  ZoomController,
  FluidVolume,
} from "@small-world-machine/engine";
import { NoirWaterMaterial } from "@small-world-machine/liquid-extras";
import type { GoldenSpec } from "./GoldenCapture.js";
import {
  GoldenCapture,
  createGoldenRandom,
  installRampVerifyHook,
  parseGoldenSpec,
} from "./GoldenCapture.js";
import { LiveTunePad } from "./LiveTunePad.js";
import { PoolHomeBehavior, SplashDropBehavior } from "./PoolBehaviors.js";
import type { PoolKey } from "./PoolLayout.js";
import {
  FLOOR_Y,
  LIQUID_Y,
  POOL_CELLS,
  POOL_GRID_ROWS,
  POOL_SIZE,
  TILE_CELL_PX,
  TILE_UNIT_SIZE,
  WALL_CENTER_Y,
  WALL_HEIGHT,
  WALL_THICKNESS,
  poolWorldPosition,
} from "./PoolLayout.js";
import type { PoolAssets, PoolLiquid, PoolPreset } from "./PoolPresets.js";
import { POOL_PRESETS } from "./PoolPresets.js";
import type { PropSpec } from "./PoolProps.js";
import { PoolProps } from "./PoolProps.js";
import type { RandomSource, TilePaletteName } from "./PoolTextures.js";
import { createNoirPoolTileTexture, createPoolTileTexture } from "./PoolTextures.js";

// FluidVolume drag is a per-step velocity factor. The default 0.95 leaves the bodies nearly in
// resonance with the swell and they overshoot the surface; 0.88 makes them ride it.
const BUOYANCY_POOL_DRAG = 0.88;

/** Rigid bodies of a buoyancy pool: prop, fraction submerged at rest in plain water, home x, home z. */
const BUOYANCY_BODIES: ReadonlyArray<readonly [PropSpec, number, number, number]> = [
  [{ kind: "ball", color: [0.9, 0.2, 0.15], radius: 0.35 }, 0.35, -1.2, 0.9],
  [{ kind: "crate", color: [0.55, 0.38, 0.22] }, 0.5, 0.4, -0.5],
  [{ kind: "crate", color: [0.2, 0.2, 0.24] }, 0.75, 1.2, 0.9],
];
const BUOYANCY_BODY_DROP_HEIGHT = 0.8;

/** Distance below the water line (m) down to which the mirror image still shows geometry. */
const REFLECTION_CLIP_DEPTH = 0.15;
const LAVA_LIGHT_INTENSITY_BASE = 4.5;
const LAVA_LIGHT_INTENSITY_PULSE = 5.0;
const LAVA_LIGHT_GREEN_BASE = 0.4;
const LAVA_LIGHT_GREEN_PULSE = 0.3;
const SLIME_LIGHT_PULSE_SPEED = 1.8;
const SLIME_LIGHT_INTENSITY_BASE = 2.5;
const SLIME_LIGHT_INTENSITY_PULSE = 2.5;

type PoolTiles = Record<TilePaletteName | "noir", LambertMaterial>;

/** What `_buildPool` hands back: the props some pools' scripted effects need to follow. */
interface BuiltPool {
  floaters: Object3D[];
  dropper: Object3D | undefined;
}

/**
 * Showcase 10: "Waterworld & Liquid Gallery" -- A grand open-air gallery of square half-sunk pools
 * on a lush meadow landscape, showcasing all engine-known liquid materials, shader presets, and
 * extension hooks side-by-side. The pools themselves are data: see `PoolPresets.ts`.
 */
export class Showcase extends AbstractShowcase {
  private readonly _moveSpeed: number = 12.0;
  private readonly _startEyeHeight: number = 18.0;
  private readonly _minEyeHeight: number = 0.1;
  private readonly _lightPulseSpeed: number = 2.1;

  private _liquids: PoolLiquid[] = [];
  private _lavaLight: PointLight | undefined;
  private _slimeLight: PointLight | undefined;
  private _noirWater: NoirWaterMaterial | undefined;
  private _noirPosition: { x: number; z: number } = { x: 0, z: 0 };
  /** The three objects whose pool position drives the noir ripple centers. */
  private _noirTracked: Array<Object3D | undefined> = [];
  private readonly _rippleScratch: [number, number] = [0, 0];
  private _liveTunePad: LiveTunePad | undefined;
  private _grassTufts: BillboardInstancer | undefined;
  private _time: number = 0;
  private readonly _buoyancyBodies: Array<{
    body: Object3D;
    position: Vector3D;
    rotation: Vector3D;
  }> = [];
  /** One mirror for all water pools: they share the plane `LIQUID_Y`. Absent in golden mode, whose baselines predate it. */
  private _reflection: PlanarReflectionNode | undefined;
  private _golden: GoldenSpec | undefined;
  private _goldenCapture: GoldenCapture | undefined;
  /** Random source of the procedural tile textures; seeded in golden mode. */
  private _random: RandomSource = (): number => Math.random();

  constructor(options: EngineOptions = {}) {
    const aniso = Number(new URLSearchParams(window.location.search).get("aniso"));
    super({
      canvasId: "SmallWorldMachine",
      rendererType: RendererType.BEST,
      fullscreen: true,
      enablePhysics: true, // the buoyancy pools (FluidVolume) need the physics step
      ...options,
      // `?aniso=N` caps anisotropic filtering at N (1 = off) so it can be compared by eye.
      // The textures ask for 16, the engine default cap is 4.
      ...(Number.isFinite(aniso) && aniso >= 1
        ? { quality: { ...options.quality, maxAnisotropy: aniso } }
        : {}),
    });
  }

  /**
   * Runs the regular showcase boot, then -- only when the golden query parameters are present --
   * the deterministic single-pool capture on top of the fully-ready scene.
   */
  public override async start(): Promise<void> {
    const golden = parseGoldenSpec();
    this._golden = golden;
    // Golden mode must be pixel-reproducible: seed the texture RNG *before* the engine boots the
    // scene, or every run would generate a different meadow/tile pattern.
    if (golden) {
      this._random = createGoldenRandom();
    }
    await super.start();
    if (golden) {
      this._goldenCapture = new GoldenCapture(this, (): void => {
        this._time = 0;
        this._resetBuoyancyBodies();
      });
      await this._goldenCapture.run(golden);
    }
  }

  public override destroy(): void {
    this._goldenCapture?.dispose();
    this._liveTunePad?.detach();
    this._disposeProceduralTextures(this.scene.root);
    super.destroy();
  }

  /** Frees the backing stores of the canvas-drawn textures (pool tiles, crates, buoys, signs). */
  private _disposeProceduralTextures(root: Object3D): void {
    const material = root.material;
    if (undefined !== material) {
      for (const texture of Object.values(material.getRenderManifest().textures)) {
        if (texture instanceof Texture && texture.image instanceof HTMLCanvasElement) {
          texture.dispose();
        }
      }
    }
    for (const child of root.children) this._disposeProceduralTextures(child);
  }

  protected override async setupScene(): Promise<void> {
    this.onCanvasRecreated();

    const aspect = this.canvas.clientWidth / this.canvas.clientHeight;
    // Start framing: as close as possible while the near pool row (outer pools + signs, +-21 m
    // wide, with margin) still fits the horizontal field of view at this aspect ratio.
    const startFov = MathUtils.degToRad(64);
    const startPitch = MathUtils.degToRad(-42);
    const nearRowZ = poolWorldPosition("petroleum-oil").z;
    const framedDepth = 21 / (Math.tan(startFov / 2) * aspect);
    const startZ = Math.min(
      60,
      Math.max(
        24,
        nearRowZ +
          (framedDepth - this._startEyeHeight * Math.sin(-startPitch)) / Math.cos(startPitch),
      ),
    );
    this.defaultFov = startFov;
    this.configureCamera();
    this.camera.setStrategy(CameraStrategyType.FPS);
    this.camera.position.set(0, this._startEyeHeight, startZ);
    this.camera.theta = 0; // Look across all pool rows along -Z (the whole gallery in view)
    this.camera.phi = startPitch;
    this.renderer.setClearColor(new Color(0.26, 0.48, 0.8, 1.0)); // Daylight sky instead of a black void
    // Horizon haze: the far meadow fades into a pale sky tone, so the sky reads as a gradient
    this.scene.fog = new Fog({
      mode: FogMode.LINEAR,
      color: new Color(0.62, 0.78, 0.92),
      near: 70.0,
      far: 260.0,
    });
    this.camera.addBehavior(new FPSController({ input: this.input, moveSpeed: this._moveSpeed }));
    this.camera.addBehavior(new ZoomController({ input: this.input }));

    this.scene.add(new AmbientLight({ color: Color.WHITE, intensity: 0.35 }));
    const sun = new DirectionalLight({
      color: Color.WHITE,
      intensity: 1.15,
      castShadow: true,
      numCascades: 4,
      shadowResolution: 2048,
      shadowBias: 0.0005,
      shadowNormalBias: 0.002,
    });
    sun.direction.set(-0.65, -0.95, 0.55).normalize();
    this.scene.add(sun);

    const tiles = this._createTileMaterials();

    // Meadow grass PBR textures for surrounding terrain (albedo, normal, roughness, AO)
    const grassTexture = await Texture.fromUrl("./assets/grass.webp", {
      generateMipmaps: true,
      flipY: true,
      anisotropy: 16,
    });
    const grassNormal = await Texture.fromUrl("./assets/grass_normal.webp", {
      generateMipmaps: true,
      flipY: true,
      anisotropy: 16,
    });
    const grassRoughness = await Texture.fromUrl("./assets/grass_roughness.webp", {
      generateMipmaps: true,
      flipY: true,
    });
    const grassAo = await Texture.fromUrl("./assets/grass_ao.webp", {
      generateMipmaps: true,
      flipY: true,
    });
    const groundMaterial = new StandardMaterial({
      diffuseMap: grassTexture,
      normalMap: grassNormal,
      roughnessMap: grassRoughness,
      aoMap: grassAo,
      roughness: 0.9,
      metallic: 0.0,
      color: Color.WHITE,
    });

    // Build the lush meadow ground with seamless cutouts for the pool grid
    this._buildGroundWithPoolHoles(groundMaterial);

    // Plant 3D billboard grass tufts around pool curbs and across walkways to break up flat geometry
    const tuftTexture = await Texture.fromUrl("./assets/grass_tuft.webp", {
      generateMipmaps: true,
      flipY: true,
    });
    const tuftMaterial = new StandardMaterial({
      diffuseMap: tuftTexture,
      roughness: 0.85,
      metallic: 0.0,
      color: Color.WHITE,
      transparent: true,
      alphaTest: 0.35,
    });
    const tuftPositions = this._generateTuftPositions();
    this._grassTufts = new BillboardInstancer("GrassTufts", {
      positions: tuftPositions,
      size: [0.35, 0.6],
      axisLocked: true,
      material: tuftMaterial,
      seed: 1042,
    });
    this._grassTufts.mesh.position.y = 0.22;
    this._grassTufts.mesh.receiveShadow = true;
    this.scene.add(this._grassTufts.mesh);
    // Load fluid textures for Lava & Slime pools
    const textureOptions = { generateMipmaps: true, flipY: true };
    // Stylized Lava inputs (MinionsArt _MainTex / _DistortTex): sampled at world XZ, so they must
    // repeat. Generated by scripts/gen-lava-textures.mjs.
    const lavaTiling = {
      generateMipmaps: true,
      addressModeU: TextureWrap.REPEAT,
      addressModeV: TextureWrap.REPEAT,
    };
    const assets: PoolAssets = {
      lavaTexture: await Texture.fromUrl("./assets/lava_crust.webp", textureOptions),
      lavaNormalMap: await Texture.fromUrl("./assets/lava_crust_normal.webp", textureOptions),
      lavaMainMap: await Texture.fromUrl("./assets/lava_main.webp", lavaTiling),
      lavaDistortMap: await Texture.fromUrl("./assets/lava_distort.webp", lavaTiling),
      slimeTexture: await Texture.fromUrl("./assets/slime_bubbles.webp", textureOptions),
      slimeNormalMap: await Texture.fromUrl("./assets/slime_bubbles_normal.webp", textureOptions),
    };

    // Industrial Kit barrels (GLB models), cloned per pool
    const gltfLoader = new GltfLoader();
    const [hazard, oil, chemical] = await Promise.all([
      gltfLoader.load("./assets/barrel_hazard_yellow.glb"),
      gltfLoader.load("./assets/barrel_oil_black.glb"),
      gltfLoader.load("./assets/barrel_chemical_blue.glb"),
    ]);
    const props = new PoolProps({ hazard, oil, chemical });

    // `?reflection=0|1` forces it; unset it is on, except in golden mode (baselines predate it).
    const reflectionParam = new URLSearchParams(window.location.search).get("reflection");
    if ("1" === reflectionParam || (null === reflectionParam && undefined === this._golden)) {
      this._reflection = new PlanarReflectionNode("PoolReflection", 1024, 1024);
      this._reflection.position.set(0, LIQUID_Y, 0);
      // The grass and curbs sit just below the water line; only the pool floors (-1.35 m) must go.
      this._reflection.clipPlaneOffset = -REFLECTION_CLIP_DEPTH;
      this.scene.add(this._reflection);
    }

    this._noirPosition = poolWorldPosition("noir-graphic");
    const stylizedWaters: Record<string, StylizedWaterMaterial> = {};
    for (const preset of POOL_PRESETS) {
      const liquid = preset.createLiquid(assets);
      // Noir water is a monochrome graphic style: a coloured mirror would break it.
      if (
        this._reflection &&
        (liquid instanceof OpenWaterMaterial ||
          (liquid instanceof StylizedWaterMaterial && !(liquid instanceof NoirWaterMaterial)))
      ) {
        liquid.reflectionMap = this._reflection.renderTarget;
      }
      const built = this._buildPool(preset, liquid, tiles[preset.tiles], props);
      if (liquid instanceof StylizedWaterMaterial) stylizedWaters[preset.key] = liquid;
      if (liquid instanceof NoirWaterMaterial) {
        this._noirWater = liquid;
        this._noirTracked = [built.floaters[0], built.floaters[1], built.dropper];
      }
      if (undefined !== preset.buoyancyDensity && liquid instanceof OpenWaterMaterial) {
        this._installBuoyancyPool(preset.key, liquid, preset.buoyancyDensity, props);
      }
      const light = this._createPoolLight(preset);
      if ("molten-lava" === preset.key) this._lavaLight = light;
      if ("toxic-slime" === preset.key) this._slimeLight = light;
      if ("toon-water" === preset.key && liquid instanceof StylizedWaterMaterial) {
        this._attachTunePad(liquid);
      }
    }
    installRampVerifyHook(stylizedWaters);

    // Signboards stand BESIDE the pools (in the gap on the entrance side of each pool, not in front
    // of the edges), angled towards the avenue so they read from the start view.
    for (const { key, sign } of POOL_PRESETS) {
      const { x, z } = poolWorldPosition(key);
      const yaw = MathUtils.degToRad(POOL_CELLS[key].row === POOL_GRID_ROWS - 1 ? -12 : 12);
      this._createSignboard(sign[0], sign[1], x - 3.9, z + 1.4, yaw);
    }

    this.scene.update();

    await this.waitForAssets();
  }

  /** Live parameter tweaking of the toon pool (keys 0, G, arrows); only with `?tune=1`. */
  private _attachTunePad(material: StylizedWaterMaterial): void {
    if ("1" !== new URLSearchParams(window.location.search).get("tune")) return;
    this._liveTunePad = new LiveTunePad(material);
    this._liveTunePad.attach(window);
  }

  /** Adds the colored point light of lava/slime pools, if the preset has one. */
  private _createPoolLight(preset: PoolPreset): PointLight | undefined {
    const spec = preset.light;
    if (undefined === spec) return undefined;
    const light = new PointLight({
      color: new Color(spec.color[0], spec.color[1], spec.color[2]),
      intensity: spec.intensity,
      distance: spec.distance,
    });
    const { x, z } = poolWorldPosition(preset.key);
    light.position.set(x, spec.y, z);
    this.scene.add(light);
    return light;
  }

  /**
   * Generates a high-legibility 3D signboard beside a pool with large, crisp text on both faces.
   */
  private _createSignboard(
    title: string,
    subtitle: string,
    x: number,
    z: number,
    rotationY: number,
  ): Object3D {
    const sign = new Object3D(`Sign_${title.replace(/\s+/g, "_")}`);
    sign.position.set(x, 0, z);
    sign.rotation.y = rotationY;
    sign.scale.set(0.82, 0.82, 0.82); // Compact enough to stand right beside its own pool

    // 1. Sleek dark metallic stand post
    const post = new Object3D("SignPost");
    post.geometry = new Cylinder({
      radiusTop: 0.035,
      radiusBottom: 0.045,
      height: 1.25,
      radialSegments: 12,
    }).getGeometryData();
    post.position.set(0, 0.625, 0);
    post.material = new BasicMaterial({ color: new Color(0.2, 0.22, 0.25) });
    post.castShadow = true;
    sign.add(post);

    // 2. Tilted backplate (the same text face is mounted on both sides, so there is no blank back)
    const board = new Object3D("SignBoard");
    board.geometry = new Cube({ size: 1 }).getGeometryData();
    board.scale.set(3.1, 1.45, 0.06);
    board.position.set(0, 1.25, 0);
    board.rotation.x = -0.32; // Ergonomic upward tilt (~18 deg) for player eye height
    board.material = new BasicMaterial({ color: new Color(0.08, 0.1, 0.14) });
    board.castShadow = true;
    sign.add(board);

    // 3. Crisp High-DPI Text Canvas (1024x480)
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 480;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      // Dark slate gradient background
      const grad = ctx.createLinearGradient(0, 0, 0, 480);
      grad.addColorStop(0, "#0b1329");
      grad.addColorStop(1, "#182234");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 1024, 480);

      // Cyan accent border + header line
      ctx.strokeStyle = "#38bdf8";
      ctx.lineWidth = 10;
      ctx.strokeRect(8, 8, 1008, 464);
      ctx.fillStyle = "#38bdf8";
      ctx.fillRect(28, 28, 968, 6);

      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const font = "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

      // Main title (shrinks to fit long names)
      ctx.fillStyle = "#ffffff";
      let titleSize = 104;
      ctx.font = `bold ${titleSize}px ${font}`;
      while (ctx.measureText(title).width > 940 && titleSize > 40) {
        titleSize -= 4;
        ctx.font = `bold ${titleSize}px ${font}`;
      }
      ctx.fillText(title, 512, 185);

      // Subtitle / tech description
      ctx.fillStyle = "#7dd3fc";
      let subSize = 58;
      ctx.font = `600 ${subSize}px ${font}`;
      while (ctx.measureText(subtitle).width > 940 && subSize > 30) {
        subSize -= 2;
        ctx.font = `600 ${subSize}px ${font}`;
      }
      ctx.fillText(subtitle, 512, 330);

      ctx.fillStyle = "rgba(56, 189, 248, 0.35)";
      ctx.fillRect(160, 405, 704, 3);
    }

    const textTexture = Texture.fromCanvas(canvas, {
      anisotropy: 16,
      generateMipmaps: true,
    });
    textTexture.flipY();

    const faceMaterial = new BasicMaterial({ diffuseMap: textTexture });
    const displayPlane = new Object3D("SignFace");
    displayPlane.geometry = new Plane({ width: 3.0, height: 1.4 }).getGeometryData();
    displayPlane.position.set(0, 1.25, 0.035);
    displayPlane.rotation.x = -0.32;
    displayPlane.material = faceMaterial;
    sign.add(displayPlane);

    // Back face: turned 180 degrees around the board's own Y axis
    const backFace = new Object3D("SignFaceBack");
    backFace.geometry = new Plane({ width: 3.0, height: 1.4 }).getGeometryData();
    backFace.position.set(0, 1.25, -0.035);
    backFace.rotation.set(0.32, Math.PI, 0);
    backFace.material = faceMaterial;
    sign.add(backFace);

    this.scene.add(sign);
    return sign;
  }

  private _createTileMaterials(): PoolTiles {
    const random = this._random;
    const material = (texture: Texture): LambertMaterial => {
      const m = new LambertMaterial({ diffuseMap: texture });
      m.color = Color.WHITE;
      return m;
    };
    // Property order is generation order: the seeded golden RNG is consumed in exactly this sequence.
    return {
      pool: material(createPoolTileTexture("pool", random)),
      murk: material(createPoolTileTexture("murk", random)),
      noir: material(createNoirPoolTileTexture(random)),
      basalt: material(createPoolTileTexture("basalt", random)),
      toxic: material(createPoolTileTexture("toxic", random)),
      graphite: material(createPoolTileTexture("graphite", random)),
      salt: material(createPoolTileTexture("salt", random)),
    };
  }

  /**
   * Creates a box geometry with UV coordinates scaled so that each unit of `tileUnitSize`
   * maps to exactly one tile cell (half-grout at outer/inner edges, full grout between tiles).
   * For the 2-tile rim, this produces: half grout, whole tile, whole grout, whole tile, half grout.
   */
  private _createTiledBoxGeometry(
    width: number,
    height: number,
    depth: number,
    tileUnitSize: number = TILE_UNIT_SIZE,
  ): GeometryDataInterface {
    const geom = new Cube({ size: 1 }).getGeometryData();
    const uvs = geom.uvs;
    const vertices = geom.vertices;
    if (uvs && vertices) {
      for (let i = 0; i < vertices.length; i += 3) {
        vertices[i] = vertices[i]! * width;
        vertices[i + 1] = vertices[i + 1]! * height;
        vertices[i + 2] = vertices[i + 2]! * depth;
      }

      const faceDims: Array<[number, number]> = [
        [depth, height], // Face 0: Right (+X)
        [depth, height], // Face 1: Left (-X)
        [width, depth], // Face 2: Top (+Y)
        [width, depth], // Face 3: Bottom (-Y)
        [width, height], // Face 4: Front (+Z)
        [width, height], // Face 5: Back (-Z)
      ];

      for (let f = 0; f < 6; f++) {
        const [spanU, spanV] = faceDims[f]!;
        const numTilesU = Math.max(1, Math.round(spanU / tileUnitSize));
        const numTilesV = Math.max(1, Math.round(spanV / tileUnitSize));
        const u0 = 0;
        const u1 = (numTilesU * TILE_CELL_PX) / 1024;
        const v0 = 0;
        const v1 = (numTilesV * TILE_CELL_PX) / 1024;

        const offset = f * 8;
        // Vertices order from Cube.buildPlane:
        // Vertex 0: (u0, v1), Vertex 1: (u1, v1), Vertex 2: (u0, v0), Vertex 3: (u1, v0)
        uvs[offset + 0] = u0;
        uvs[offset + 1] = v1;
        uvs[offset + 2] = u1;
        uvs[offset + 3] = v1;
        uvs[offset + 4] = u0;
        uvs[offset + 5] = v0;
        uvs[offset + 6] = u1;
        uvs[offset + 7] = v0;
      }
    }
    return geom;
  }

  /**
   * Builds the world meadow ground with seamless cutouts for all pools of the grid,
   * mapping UVs in world space so the grass tiles continuously across all chunks.
   */
  private _buildGroundWithPoolHoles(groundMaterial: StandardMaterial): void {
    const addGroundChunk = (name: string, w: number, d: number, px: number, pz: number): void => {
      const chunk = new Object3D(name);
      const geom = new Ground({ width: w, depth: d }).getGeometryData();
      const uvs = geom.uvs;
      if (uvs) {
        const uvScale = 0.35; // Seamless ~2.8m grass tile repetition
        for (let i = 0; i < uvs.length; i += 2) {
          const localX = uvs[i]! * w - w / 2;
          const localZ = (1 - uvs[i + 1]!) * d - d / 2;
          const worldX = localX + px;
          const worldZ = localZ + pz;
          uvs[i] = worldX * uvScale;
          uvs[i + 1] = worldZ * uvScale;
        }
      }
      chunk.geometry = geom;
      chunk.position.set(px, 0, pz);
      chunk.material = groundMaterial;
      chunk.receiveShadow = true;
      this.scene.add(chunk);
    };

    // Total area: 600 x 600 (X/Z [-300, +300]) so the meadow edge never shows in the gallery views.
    // The plane is cut along every pool edge; the cells that fall inside a pool footprint are left
    // out, everything else (walkways, plaza, surrounding meadow) becomes one chunk per cell.
    const halfPool = POOL_SIZE / 2;
    const edgesAround = (centers: number[]): number[] => [
      -300,
      ...centers.flatMap((c) => [c - halfPool, c + halfPool]),
      300,
    ];
    const poolCenters = (Object.keys(POOL_CELLS) as PoolKey[]).map(poolWorldPosition);
    const xEdges = edgesAround([...new Set(poolCenters.map((c) => c.x))].sort((a, b) => a - b));
    const zEdges = edgesAround([...new Set(poolCenters.map((c) => c.z))].sort((a, b) => a - b));
    for (let i = 0; i < xEdges.length - 1; i++) {
      for (let j = 0; j < zEdges.length - 1; j++) {
        // Intervals alternate outside / pool: odd indices are pool footprints.
        if (i % 2 === 1 && j % 2 === 1) continue;
        const w = xEdges[i + 1]! - xEdges[i]!;
        const d = zEdges[j + 1]! - zEdges[j]!;
        addGroundChunk(
          `Ground_${i}_${j}`,
          w,
          d,
          (xEdges[i]! + xEdges[i + 1]!) / 2,
          (zEdges[j]! + zEdges[j + 1]!) / 2,
        );
      }
    }
  }

  /**
   * Generates placement positions for grass tufts hugging pool perimeters and scattered
   * across lawn walkways.
   */
  private _generateTuftPositions(): Vector3D[] {
    const positions: Vector3D[] = [];
    const poolKeys = Object.keys(POOL_CELLS) as PoolKey[];
    const half = POOL_SIZE / 2;

    // Seeded local PRNG for deterministic placement across all runs
    let seed = 1042;
    const rng = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };

    // 1. Scatter tufts tightly along pool perimeters to break up sharp concrete edges
    for (const key of poolKeys) {
      const pos = poolWorldPosition(key);
      const tuftsPerSide = 8;
      for (let s = 0; s < tuftsPerSide; s++) {
        const offsetRatio = (s + 0.5) / tuftsPerSide;
        const span = (offsetRatio - 0.5) * (POOL_SIZE - 0.4);
        const jitter = (rng() - 0.5) * 0.15;
        const curbMargin = 0.08 + rng() * 0.22;

        // North edge
        positions.push(new Vector3D(pos.x + span + jitter, 0, pos.z - half - curbMargin));
        // South edge
        positions.push(new Vector3D(pos.x + span + jitter, 0, pos.z + half + curbMargin));
        // West edge
        positions.push(new Vector3D(pos.x - half - curbMargin, 0, pos.z + span + jitter));
        // East edge
        positions.push(new Vector3D(pos.x + half + curbMargin, 0, pos.z + span + jitter));
      }
    }

    // 2. Scatter tufts across the meadow walkways between the pools
    const poolCenters = poolKeys.map(poolWorldPosition);
    let attempts = 0;
    while (positions.length < 750 && attempts < 3000) {
      attempts++;
      const rx = (rng() - 0.5) * 44; // walkway width span
      const rz = (rng() - 0.5) * 60; // walkway depth span

      // Check if inside any pool footprint (with small curb margin)
      let insidePool = false;
      for (let i = 0; i < poolCenters.length; i++) {
        const c = poolCenters[i]!;
        if (Math.abs(rx - c.x) < half + 0.15 && Math.abs(rz - c.z) < half + 0.15) {
          insidePool = true;
          break;
        }
      }
      if (!insidePool) {
        positions.push(new Vector3D(rx, 0, rz));
      }
    }

    return positions;
  }

  /**
   * Builds one square, half-sunk pool basin: ceramic rim walls, floor plate, liquid surface,
   * sunk objects on the floor, floating bobbing objects, and one periodic splash dropper.
   */
  private _buildPool(
    preset: PoolPreset,
    liquid: PoolLiquid,
    tileMaterial: LambertMaterial,
    props: PoolProps,
  ): BuiltPool {
    const { name, needsTangents, spawnDelay } = preset;
    const { x, z } = poolWorldPosition(preset.key);
    const inner = POOL_SIZE - 2 * WALL_THICKNESS; // 4.4
    const wallOffset = (POOL_SIZE - WALL_THICKNESS) / 2; // 2.35

    const pool = new Object3D(name);
    pool.position.set(x, 0, z);
    this.scene.add(pool);

    // 4 non-overlapping rim walls forming a crisp, seamless rectangle with perfect 90-degree corners:
    // North wall spans full POOL_SIZE along X at +Z
    const wallN = new Object3D(`${name}_WallN`);
    wallN.geometry = this._createTiledBoxGeometry(POOL_SIZE, WALL_HEIGHT, WALL_THICKNESS);
    wallN.position.set(0, WALL_CENTER_Y, wallOffset);
    wallN.material = tileMaterial;
    wallN.castShadow = true;
    wallN.receiveShadow = true;
    pool.add(wallN);

    // South wall spans full POOL_SIZE along X at -Z
    const wallS = new Object3D(`${name}_WallS`);
    wallS.geometry = this._createTiledBoxGeometry(POOL_SIZE, WALL_HEIGHT, WALL_THICKNESS);
    wallS.position.set(0, WALL_CENTER_Y, -wallOffset);
    wallS.material = tileMaterial;
    wallS.castShadow = true;
    wallS.receiveShadow = true;
    pool.add(wallS);

    // East wall fits snugly between North and South walls along Z at +X
    const wallE = new Object3D(`${name}_WallE`);
    wallE.geometry = this._createTiledBoxGeometry(WALL_THICKNESS, WALL_HEIGHT, inner);
    wallE.position.set(wallOffset, WALL_CENTER_Y, 0);
    wallE.material = tileMaterial;
    wallE.castShadow = true;
    wallE.receiveShadow = true;
    pool.add(wallE);

    // West wall fits snugly between North and South walls along Z at -X
    const wallW = new Object3D(`${name}_WallW`);
    wallW.geometry = this._createTiledBoxGeometry(WALL_THICKNESS, WALL_HEIGHT, inner);
    wallW.position.set(-wallOffset, WALL_CENTER_Y, 0);
    wallW.material = tileMaterial;
    wallW.castShadow = true;
    wallW.receiveShadow = true;
    pool.add(wallW);

    const floorPlate = new Object3D(`${name}_Floor`);
    floorPlate.geometry = this._createTiledBoxGeometry(inner, 0.2, inner);
    floorPlate.position.set(0, FLOOR_Y, 0);
    floorPlate.material = tileMaterial;
    floorPlate.receiveShadow = true;
    pool.add(floorPlate);

    const liquidObj = new Object3D(`${name}_Liquid`);
    if (undefined !== preset.createSurface) {
      liquidObj.geometry = preset.createSurface();
    } else {
      const plane = new Plane({
        width: inner,
        height: inner,
        widthSegments: 32,
        heightSegments: 32,
      });
      if (needsTangents) plane.computeTangents();
      liquidObj.geometry = plane.getGeometryData();
      liquidObj.rotation.x = -MathUtils.HALF_PI;
    }
    liquidObj.material = liquid;
    liquidObj.position.set(0, LIQUID_Y, 0);
    pool.add(liquidObj);
    // Every surface sits in the mirror plane, so none may show up in the mirror image.
    this._reflection?.excludedObjects.push(liquidObj);
    this._liquids.push(liquid);

    // Objects resting on the pool floor
    for (const [spec, ox, oz] of preset.sunk ?? []) {
      const obj = props.create(spec);
      obj.position.set(ox, FLOOR_Y + 0.35, oz);
      obj.castShadow = true;
      pool.add(obj);
    }

    // Objects floating at the liquid surface
    const floaters: Object3D[] = [];
    for (const [spec, ox, oz, amplitude, frequency] of preset.floating ?? []) {
      const obj = props.create(spec);
      obj.position.set(ox, LIQUID_Y, oz);
      obj.castShadow = true;
      this._attachPoolBehavior(obj, new BobbingBehavior(amplitude, frequency));
      this._attachPoolBehavior(obj, new RotatorBehavior());
      pool.add(obj);
      floaters.push(obj);
    }

    // Buoyancy pools get their bodies from the physics system instead
    if (undefined !== preset.buoyancyDensity) return { floaters, dropper: undefined };

    // The periodic "splash" dropper
    const dropper = props.create(preset.dropper ?? { kind: "crate" });
    dropper.position.set(0.3, LIQUID_Y, 0.2);
    dropper.castShadow = true;
    this._attachPoolBehavior(
      dropper,
      new SplashDropBehavior(LIQUID_Y, WALL_HEIGHT + 3.0, spawnDelay, (hitX, hitZ, speed) => {
        if (liquid instanceof LiquidWaveMaterial) {
          liquid.emitSplat(hitX, hitZ, this._time, speed);
        }
      }),
    );
    pool.add(dropper);
    return { floaters, dropper };
  }

  /**
   * Turns a finished OpenWater pool into a buoyancy pool: a `FluidVolume` of the given density
   * whose surface height is the CPU mirror of the shader's wave field, plus three physics bodies
   * of different density (about 35 %, 50 % and 75 % submerged in plain water) that ride it.
   */
  private _installBuoyancyPool(
    key: PoolKey,
    liquid: OpenWaterMaterial,
    density: number,
    props: PoolProps,
  ): void {
    const { x, z } = poolWorldPosition(key);
    const half = (POOL_SIZE - 2 * WALL_THICKNESS) / 2;
    const probe = OpenWaterSurfaceProbe.fromMaterial(liquid, { restHeight: LIQUID_Y });
    const water = new FluidVolume(
      new BoundingBox(
        new Vector3D(x - half, FLOOR_Y, z - half),
        new Vector3D(x + half, LIQUID_Y + 1.5, z + half),
      ),
      density,
      BUOYANCY_POOL_DRAG,
    );
    water.surfaceHeightAt = (worldX: number, worldZ: number): number =>
      probe.surfaceHeightAt(worldX, worldZ, this._time);
    this.physics.addFluidVolume(water);

    for (const [spec, submersion, offsetX, offsetZ] of BUOYANCY_BODIES) {
      const body = props.create(spec);
      const homeX = x + offsetX;
      const homeZ = z + offsetZ;
      body.position.set(homeX, LIQUID_Y + BUOYANCY_BODY_DROP_HEIGHT, homeZ);
      body.rigidBody = new RigidBody(1.0);
      body.castShadow = true;
      this._buoyancyBodies.push({
        body,
        position: body.position.clone(),
        rotation: body.rotation.clone(),
      });
      this._attachPoolBehavior(body, new PoolHomeBehavior(homeX, homeZ, submersion));
      this.scene.add(body);
    }
  }

  protected override update(deltaTime: number): void {
    this._time += deltaTime;
    this.camera.position.y = Math.max(this._minEyeHeight, this.camera.position.y);

    if (this._grassTufts) {
      this._grassTufts.update(this.camera);
    }

    for (const liquid of this._liquids) {
      liquid.time = this._time;
    }

    this._reflection?.updateReflection(this.scene, this.camera, this.renderer);

    if (this._lavaLight) {
      const pulse = Math.sin(this._time * this._lightPulseSpeed) * 0.5 + 0.5;
      this._lavaLight.intensity = LAVA_LIGHT_INTENSITY_BASE + pulse * LAVA_LIGHT_INTENSITY_PULSE;
      this._lavaLight.color.g = LAVA_LIGHT_GREEN_BASE + pulse * LAVA_LIGHT_GREEN_PULSE;
    }

    if (this._slimeLight) {
      const pulse = Math.cos(this._time * SLIME_LIGHT_PULSE_SPEED) * 0.5 + 0.5;
      this._slimeLight.intensity = SLIME_LIGHT_INTENSITY_BASE + pulse * SLIME_LIGHT_INTENSITY_PULSE;
    }

    if (this._noirWater) {
      const [floater1, floater2, dropper] = this._noirTracked;
      if (floater1) this._noirWater.rippleCenter = this._rippleAt(floater1);
      if (floater2) this._noirWater.rippleCenter2 = this._rippleAt(floater2);
      if (dropper) this._noirWater.rippleCenter3 = this._rippleAt(dropper);
    }
  }

  /** World XZ of a noir pool prop, in a scratch tuple the material setter copies from. */
  private _rippleAt(obj: Object3D): [number, number] {
    this._rippleScratch[0] = this._noirPosition.x + obj.position.x;
    this._rippleScratch[1] = this._noirPosition.z + obj.position.z;
    return this._rippleScratch;
  }

  /**
   * Attaches one pool behavior, created frozen when golden mode is active so no pre-golden
   * realtime frame can advance its internal timer by an unknown amount.
   */
  private _attachPoolBehavior(obj: Object3D, behavior: Behavior): void {
    obj.addBehavior(behavior);
    if (this._golden) {
      behavior.isActive = false;
    }
  }

  /**
   * Puts the physics side of the buoyancy pools back to the pristine state: the realtime frames
   * before golden mode took over dropped, bounced and half-settled the bodies by an unknown
   * amount and left an unknown remainder in the fixed-timestep accumulator (which drives the
   * render interpolation). Without this the golden frames of those pools would not reproduce.
   */
  private _resetBuoyancyBodies(): void {
    this.physics.clear();
    for (const { body, position, rotation } of this._buoyancyBodies) {
      const rigidBody = body.rigidBody;
      if (!rigidBody) continue;
      body.position.copyFrom(position);
      body.rotation.copyFrom(rotation);
      rigidBody.velocity.set(0, 0, 0);
      rigidBody.angularVelocity.set(0, 0, 0);
      rigidBody.clearForces();
      rigidBody.prevPosition.copyFrom(position);
      rigidBody.prevRotation.copyFrom(rotation);
      rigidBody.wakeUp();
    }
  }
}

const app = new Showcase();
app.start().catch((err: unknown) => console.error("[Showcase10] Failed to start:", err));
