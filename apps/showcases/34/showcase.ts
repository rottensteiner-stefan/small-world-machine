import type { EngineOptions } from "@small-world-machine/engine";
import {
  AbstractShowcase,
  AmbientLight,
  bakeImposter,
  BillboardInstancer,
  CameraStrategyType,
  Color,
  Cylinder,
  DirectionalLight,
  Fog,
  FogMode,
  Ground,
  ImposterSprite,
  Object3D,
  OrbitController,
  RendererType,
  Sphere,
  StandardMaterial,
  Texture,
  Vector3D,
} from "@small-world-machine/engine";
import { attachDevTools } from "@small-world-machine/tools";

/** A simple procedural tree: a tapered trunk plus three overlapping foliage spheres. Built
 * fresh for every instance -- shared, mutable geometry/material would be wrong here since bake
 * targets must not be part of the live scene while real comparison trees must be. */
function buildTree(): Object3D {
  const trunkMat = new StandardMaterial({
    color: new Color(0.32, 0.21, 0.12),
    roughness: 0.9,
    metallic: 0.0,
  });
  const leafMat = new StandardMaterial({
    color: new Color(0.15, 0.4, 0.14),
    roughness: 0.85,
    metallic: 0.0,
  });

  const tree = new Object3D("Tree");

  const trunk = new Object3D("Trunk");
  trunk.geometry = new Cylinder({
    radiusTop: 0.14,
    radiusBottom: 0.22,
    height: 2.2,
    radialSegments: 8,
  }).getGeometryData();
  trunk.position.y = 1.1;
  trunk.material = trunkMat;
  trunk.castShadow = true;
  trunk.receiveShadow = true;
  tree.add(trunk);

  for (let i = 0; i < 3; i++) {
    const foliage = new Object3D(`Foliage_${i}`);
    foliage.geometry = new Sphere({
      radius: 1.05 - i * 0.15,
      widthSegments: 10,
      heightSegments: 8,
    }).getGeometryData();
    foliage.position.set((i - 1) * 0.3, 2.5 + i * 0.5, (i - 1) * 0.2);
    foliage.material = leafMat;
    foliage.castShadow = true;
    tree.add(foliage);
  }

  return tree;
}

/**
 * Showcase 34: "Billboard Grove"
 *
 * A forest glade demonstrating AAA research item #15 (Billboards/Imposter): a dense
 * `BillboardInstancer` grass field (Y-axis-locked, camera-facing quads, one instanced draw
 * call), plus a row of `ImposterSprite` trees -- baked once at startup via `bakeImposter()` --
 * standing right next to real 3D comparison trees so the swap is visible up close.
 */
export class Showcase extends AbstractShowcase {
  private _grass!: BillboardInstancer;
  private _imposterTrees: ImposterSprite[] = [];

  constructor(options: EngineOptions = {}) {
    super({
      canvasId: "SmallWorldMachine",
      rendererType: RendererType.BEST,
      fullscreen: true,
      ...options,
    });
  }

  protected override async setupScene(): Promise<void> {
    // Post-processing deliberately stays off in this showcase: `bakeImposter()` renders into
    // offscreen `RenderTarget`s, which `WebGPURenderer` always creates in the canvas's swapchain
    // format (`this._format`) regardless of `postProcessing.enabled` -- but with post-processing
    // on, the *live* scene renders into an `rgba16float` HDR buffer instead, and this engine's
    // pipeline cache isn't keyed by target format. Whichever render call (bake or live) happens
    // first "wins" that pipeline for every later draw using the same shader/material variant,
    // and every subsequent draw targeting the other format then fails validation. Baking before
    // the first live frame (as this showcase does, from `setupScene()`) means the bake would
    // poison the live scene's pipelines if post-processing pulled it onto a different format --
    // so this showcase stays on the swapchain format throughout instead, which sidesteps the
    // mismatch entirely without touching renderer internals. A real fix belongs in the renderer's
    // pipeline cache (key it by target format too), not here.
    this.defaultFov = (55 * Math.PI) / 180;
    this.defaultFar = 100;
    this.configureCamera();
    this.camera.setStrategy(CameraStrategyType.HYBRID_SYNC);
    this.camera.position.set(0, 2.2, 8);
    this.camera.target.set(0, 1.5, -10);
    this.camera.addBehavior(new OrbitController({ input: this.input }));

    // No skybox in this glade -- match the clear color to a soft sky tone instead of black.
    this.renderer.setClearColor(new Color(0.55, 0.72, 0.85));

    // Horizon haze: a gentle LINEAR fog that stays off the foreground comparison trees (~13
    // units) and fades only the far back of the glade -- the imposter row gets a soft graded
    // aerial-perspective fade while the grass band behind it stays readable green, so nothing
    // reads as a razor-sharp billboard against a hazed backdrop. Sprites honor the exact same
    // `scene.fog` as every lit surface (Sprite.frag.*), so the billboard tree line never pops.
    this.scene.fog = new Fog({
      mode: FogMode.LINEAR,
      color: new Color(0.6, 0.76, 0.9),
      near: 18.0,
      far: 40.0,
    });

    // The imposter bake reuses exactly the same light rig as the live scene (color, intensity,
    // direction) -- bakeImposter defaults to a neutral grey/white rig, and mismatched lighting
    // would make the billboards read as cut-outs lit by another sun instead of as same-lit trees.
    const ambientColor = new Color(0.621, 0.659, 0.596);
    const ambientIntensity = 0.6;
    const sunColor = new Color(1, 0.991, 0.953);
    const sunIntensity = 1.6;
    const sunDirection: [number, number, number] = [-0.5, -1.0, -0.4];

    this.scene.add(new AmbientLight({ color: ambientColor, intensity: ambientIntensity }));

    const sun = new DirectionalLight({ color: sunColor, intensity: sunIntensity });
    sun.position.set(10, 20, 12);
    sun.direction.set(sunDirection[0], sunDirection[1], sunDirection[2]);
    sun.castShadow = true;
    sun.shadowBias = 0.001;
    sun.shadowResolution = 2048;
    this.scene.add(sun);

    const ground = new Object3D("Ground");
    ground.geometry = new Ground({ width: 40, depth: 40 }).getGeometryData();
    ground.material = new StandardMaterial({
      color: new Color(0.22, 0.32, 0.15),
      roughness: 0.95,
      metallic: 0.0,
    });
    ground.receiveShadow = true;
    this.scene.add(ground);

    // Real, close-up comparison trees.
    const realTreePositions: Array<[number, number]> = [
      [-2.2, -3],
      [2.6, -4.5],
    ];
    for (const [x, z] of realTreePositions) {
      const tree = buildTree();
      tree.position.set(x, 0, z);
      this.scene.add(tree);
    }

    // Imposter trees, baked once here and placed in the back -- from the default viewpoint
    // they read as trees, but they're a single camera-facing quad each, swapping between 8
    // baked angle textures as the viewer moves around them. `groundAtBottom` pins each baked
    // tree's trunk base to the bottom edge of the quad, and each quad is planted with its
    // lower edge at floor level -- so the billboard row is rooted in the grass field instead of
    // hovering above it. The row stays at z >= -14.5, well inside the floor's far edge (z = -20),
    // leaving a clearly visible band of green between the trees and the horizon.
    const imposterPositions: Array<[number, number]> = [
      [-4, -11],
      [-1, -13],
      [2, -11.5],
      [4.5, -12],
      [0, -14],
    ];
    // Slight per-tree scale variation keeps the row from reading as five identical clones;
    // 256px keeps the up-close comparison from dissolving into a blurry 128px quad.
    const imposterScales: Array<[number, number]> = [
      [2.5, 3.3],
      [2.7, 3.5],
      [2.4, 3.1],
      [2.8, 3.6],
      [2.6, 3.4],
    ];
    for (let i = 0; i < imposterPositions.length; i++) {
      const [x, z] = imposterPositions[i]!;
      const bakeTarget = buildTree();
      const textures = bakeImposter(this.renderer, bakeTarget, {
        angleCount: 8,
        resolution: 256,
        groundAtBottom: true,
        ambientColor,
        ambientIntensity,
        lightColor: sunColor,
        lightIntensity: sunIntensity,
        lightDirection: sunDirection,
      });
      const imposter = new ImposterSprite(`ImposterTree_${x}_${z}`, textures);
      const [sx, sy] = imposterScales[i]!;
      // Quad planted with its bottom edge at floor level (trunk base is baked at that edge via
      // groundAtBottom). Slight per-tree yaw scale variation reads as scattered, not clones.
      imposter.position.set(x, sy / 2, z);
      imposter.scale.set(sx, sy, 1);
      this.scene.add(imposter);
      this._imposterTrees.push(imposter);
    }

    // Dense grass field across the whole glade. Uses the alpha-cutout tuft atlas (same asset as
    // Showcase 10) -- an alphaTest on a solid-color material can never cut anything out, so plain
    // green cards would read as a flat poster field instead of blades.
    const grassTuft = await Texture.fromUrl("./assets/grass_tuft.webp", {
      generateMipmaps: true,
      flipY: true,
    });
    this._grass = new BillboardInstancer("Grass", {
      count: 260,
      seed: 34, // fixed field, so capture mode and goldens see the same grass
      // Scatter rectangle fully inside the 40x40 ([-20, 20] per axis) ground: x spans
      // [-17, 17], z spans [-19, 5] -- the old 34-deep field centered at z = -8 leaked
      // 5 units past the floor's far edge (z = -25), floating over the void.
      scatterArea: { width: 34, depth: 24, center: new Vector3D(0, 0, -7) },
      size: [0.35, 0.65],
      axisLocked: true,
      material: new StandardMaterial({
        diffuseMap: grassTuft,
        color: Color.WHITE,
        roughness: 0.85,
        metallic: 0.0,
        transparent: true,
        alphaTest: 0.35,
      }),
    });
    this._grass.mesh.position.y = 0.25;
    this._grass.mesh.receiveShadow = true;
    this.scene.add(this._grass.mesh);
  }

  protected override update(): void {
    this._grass.update(this.camera);
    for (const imposter of this._imposterTrees) {
      imposter.update(this.camera);
    }
  }
}

// ----------------------------------------------------------------------------
// Bootstrap the example
// ----------------------------------------------------------------------------
const app = new Showcase();
attachDevTools(app);
app.start().catch((err: unknown) => console.error("[Showcase34] Failed to start:", err));
