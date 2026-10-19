import type { Camera } from "@small-world-machine/engine";
import { Behavior, MathUtils, Object3D, RendererType, Vector3D } from "@small-world-machine/engine";
import {
  getRendererTypeFromQuery,
  SmallWorldMachine,
} from "@small-world-machine/engine/core/index.js";
import { PerspectiveProjection } from "@small-world-machine/engine/math/projections/index.js";
import {
  BlockRegistry,
  BLOCK_DIRT,
  BLOCK_AIR,
  BLOCK_GRASS,
  BLOCK_STONE,
} from "./voxel/BlockRegistry.js";
import { Chunk } from "./voxel/Chunk.js";
import { BlockMaterial } from "./voxel/material/BlockMaterial.js";
import { NaiveMesher } from "./voxel/mesh/NaiveMesher.js";
import { VoxelChunkGeometry } from "./voxel/mesh/VoxelChunkGeometry.js";
import { createBlockPalette } from "./voxel/BlockTextureFactory.js";

/**
 * Slowly orbits the camera around a fixed world target while keeping a constant height and
 * always looking at the target -- the M0 verification vantage: every pillar face is
 * continuously shown, which proves culling/winding (faces appear from the outside only) and
 * per-face atlas layers without any interaction. The rotation is purely cosmetic; M1 replaces
 * this with the real FPS/collision rig.
 */
class OrbitAroundBehavior extends Behavior<Camera> {
  private readonly _target: Readonly<Vector3D>;
  private readonly _radius: number;
  private readonly _height: number;
  private readonly _speed: number;
  private _angle: number;

  constructor(target: Readonly<Vector3D>, radius: number, height: number) {
    super();
    this._target = target;
    this._radius = radius;
    this._height = height;
    this._speed = 0.14; // rad/s -- slow enough to inspect, fast enough to cover all faces
    this._angle = 0;
  }

  public override update(deltaTime: number): void {
    const cam = this.target;
    if (!cam) return;
    this._angle += deltaTime * this._speed;
    cam.position.x = this._target.x + Math.cos(this._angle) * this._radius;
    cam.position.y = this._target.y + this._height;
    cam.position.z = this._target.z + Math.sin(this._angle) * this._radius;
    cam.target = new Vector3D(this._target.x, this._target.y, this._target.z);
    cam.updateViewMatrix();
  }
}

/**
 * M0 "Skelett + EIN statischer Chunk" (dossier §4.2) -- the mesh<->engine contract proof:
 *
 *   - `BlockRegistry` (seeded) is the single source of truth for block semantics.
 *   - One data-only `Chunk` (16³) holding a freestanding terrain pillar.
 *   - `NaiveMesher` builds visible-face geometry; `colors.r` carries the per-face atlas layer.
 *   - `VoxelChunkGeometry` + shared `BlockMaterial` (GLSL300, `sampler2DArray`) host the chunk
 *     on the standard `Object3D` path (bounds, frustum culling, static draw), exactly the
 *     "one `Object3D` per chunk" pattern the later milestones keep.
 *
 * Backend: WebGL2 default (dossier §4.4 #5 -- WebGL2 first, WebGPU as a later quality path).
 * `?rendererType=WEB_GL2|WEB_GPU|WEB_GL1` overrides for CI/smoke verification.
 */
export class App extends SmallWorldMachine {
  private _statsEl: HTMLElement | null = null;
  private _lastStatsUpdate = 0;
  private _triangleCount = 0;

  constructor() {
    // M0 ships GLSL300 only (no WGSL/GLSL100 variants yet), so force WebGL2 unless the
    // URL explicitly pins a backend. This keeps default launches rendering even on machines
    // whose `BEST` would pick WebGPU (whose array-texture material path is a follow-up).
    const rendererType = getRendererTypeFromQuery();
    if (rendererType) {
      super({ fullscreen: true, rendererType });
    } else {
      super({ fullscreen: true, rendererType: RendererType.WEB_GL2 });
    }
  }

  /** Builds a single terraint column inside the chunk: grass cap, dirt body, stone base. */
  private _seedDemoPillar(chunk: Chunk): void {
    // Freestanding pillar, centered in the chunk footprint so the orbit camera shows every
    // side. Top block is grass (grass-top layer), body dirt, footing stone.
    chunk.fill(BLOCK_AIR);
    for (let y = 0; y < 4; y++) {
      for (let z = 5; z < 11; z++) {
        for (let x = 5; x < 11; x++) {
          chunk.setBlock(x, y, z, BLOCK_STONE);
        }
      }
    }
    for (let y = 4; y < 11; y++) {
      for (let z = 5; z < 11; z++) {
        for (let x = 5; x < 11; x++) {
          chunk.setBlock(x, y, z, BLOCK_DIRT);
        }
      }
    }
    for (let z = 5; z < 11; z++) {
      for (let x = 5; x < 11; x++) {
        chunk.setBlock(x, 11, z, BLOCK_GRASS);
      }
    }
  }

  /** @inheritdoc */
  protected override async setupScene(): Promise<void> {
    // Statistics overlay (draw-count proof for M0: 1 chunk => 1 Object3D => 1 draw call).
    this._statsEl = document.getElementById("voxel-stats");

    // 1. Camera -- perspective, fixed interaction-free vantage driven by the orbit behavior.
    this.camera.projection = new PerspectiveProjection({
      fov: MathUtils.degToRad(60),
      aspect: this.camera.aspect,
      near: 0.1,
      far: 300,
    });
    this.camera.updateProjectionMatrix();

    // 2. Registry (seeded, per-instance -- no singleton) and a single data-only chunk.
    const registry = new BlockRegistry();
    BlockRegistry.seed(registry);
    const chunk = new Chunk();
    this._seedDemoPillar(chunk);

    // 3. Palette + material (WebGL2 GLSL300; browser-only texture path).
    const palette = await createBlockPalette();
    const material = new BlockMaterial(palette);

    // 4. Mesh the chunk on the main thread (M0; M1 moves this into a `ThreadPool` worker) and
    //    host it on the standard Object3D path -- one draw call per chunk, exactly the target
    //    architecture (Dave-Report §2.1).
    const mesh = new NaiveMesher(registry).build(chunk);
    this._triangleCount = mesh.triangleCount;

    const host = new Object3D("chunk_0_0_0");
    host.geometry = new VoxelChunkGeometry(mesh).getGeometryData();
    host.material = material;
    host.frustumCulled = true;
    host.computeBounds();
    this.scene.add(host);

    // 5. Orbit camera around the pillar center (top of the pillar + a margin).
    this.camera.addBehavior(new OrbitAroundBehavior(new Vector3D(8, 9, 8), 27, 13));

    // Final scene refresh so world matrices and light state exist before the first frame.
    this.scene.update();

    this._updateStats(true);
  }

  /** @inheritdoc */
  protected override update(deltaTime: number): void {
    this._updateStats(false);
    void deltaTime;
  }

  private _updateStats(force: boolean): void {
    if (!this._statsEl) return;
    const now = performance.now();
    if (!force && now - this._lastStatsUpdate < 250) return;
    this._lastStatsUpdate = now;

    const renderer = this.renderer;
    const backend = renderer ? renderer.type : "n/a";
    this._statsEl.innerHTML =
      `<div class="stat-row"><span>renderer</span><b>${backend}</b></div>` +
      `<div class="stat-row"><span>backend</span><b>WEBGL2 default (M0)</b></div>` +
      `<div class="stat-row"><span>chunks</span><b>1</b></div>` +
      `<div class="stat-row"><span>objects</span><b>${this.scene.lastFrustumVisibleObjects.length}</b></div>` +
      `<div class="stat-row"><span>triangles</span><b>${this._triangleCount}</b></div>` +
      `<div class="stat-row"><span>meshing</span><b>main thread (M1 → worker)</b></div>`;
  }
}

if (typeof window !== "undefined") {
  const app: App = new App();
  app.start().catch((err: unknown) => console.error("[voxel-prototype] Failed to start:", err));
}
