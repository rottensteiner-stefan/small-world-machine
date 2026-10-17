import {
  AbstractShowcase,
  AmbientLight,
  bakeImposter,
  BillboardInstancer,
  CameraStrategyType,
  Color,
  Cylinder,
  DirectionalLight,
  EngineOptions,
  Ground,
  ImposterSprite,
  Object3D,
  OrbitController,
  PerspectiveProjection,
  ProjectionType,
  RendererType,
  Sphere,
  StandardMaterial,
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
class Showcase34 extends AbstractShowcase {
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
    if (ProjectionType.PERSPECTIVE === this.camera.projection.type) {
      const aspect = window.innerWidth / window.innerHeight;
      this.camera.projection = new PerspectiveProjection({
        fov: (55 * Math.PI) / 180,
        aspect,
        near: 0.1,
        far: 100,
      });
      this.camera.updateProjectionMatrix();
    }
    this.camera.setStrategy(CameraStrategyType.HYBRID_SYNC);
    this.camera.position.set(0, 2.2, 8);
    this.camera.target.set(0, 1.5, -10);
    this.camera.addBehavior(new OrbitController({ input: this.input }));

    // No skybox in this glade -- match the clear color to a soft sky tone instead of black.
    this.renderer.setClearColor(new Color(0.55, 0.72, 0.85));

    this.scene.add(new AmbientLight({ color: new Color(0.35, 0.4, 0.32), intensity: 0.6 }));

    const sun = new DirectionalLight({ color: new Color(1.0, 0.98, 0.9), intensity: 1.6 });
    sun.position.set(10, 20, 12);
    sun.direction.set(-0.5, -1.0, -0.4);
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

    // Imposter trees, baked once here and placed farther back -- from the default viewpoint
    // they read as trees, but they're a single camera-facing quad each, swapping between 8
    // baked angle textures as the viewer moves around them.
    const imposterPositions: Array<[number, number]> = [
      [-4, -16],
      [-1, -18],
      [2, -15.5],
      [4.5, -17],
      [0, -20],
    ];
    for (const [x, z] of imposterPositions) {
      const bakeTarget = buildTree();
      const textures = bakeImposter(this.renderer, bakeTarget, { angleCount: 8, resolution: 128 });
      const imposter = new ImposterSprite(`ImposterTree_${x}_${z}`, textures);
      imposter.position.set(x, 1.7, z);
      imposter.scale.set(2.6, 3.4, 1);
      this.scene.add(imposter);
      this._imposterTrees.push(imposter);
    }

    // Dense grass field across the whole glade.
    this._grass = new BillboardInstancer("Grass", {
      count: 260,
      seed: 34, // fixed field, so capture mode and goldens see the same grass
      scatterArea: { width: 34, depth: 34, center: new Vector3D(0, 0, -8) },
      size: [0.35, 0.65],
      axisLocked: true,
      material: new StandardMaterial({
        color: new Color(0.32, 0.5, 0.2),
        roughness: 0.8,
        metallic: 0.0,
        transparent: true,
        alphaTest: 0.35,
      }),
    });
    this._grass.mesh.position.y = 0.25;
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
const app = new Showcase34();
attachDevTools(app);
app.start().catch((err: unknown) => console.error("[Showcase34] Failed to start:", err));
