import { CameraStrategyType, RendererType } from "@small-world-machine/engine";
import {
  getRendererTypeFromQuery,
  SmallWorldMachine,
} from "@small-world-machine/engine/core/index.js";
import { PerspectiveProjection } from "@small-world-machine/engine/math/projections/index.js";
import { BlockRegistry } from "./voxel/BlockRegistry.js";
import { ChunkWorld } from "./voxel/ChunkWorld.js";
import { ChunkWorldHost } from "./voxel/ChunkWorldHost.js";
import { createBlockPalette } from "./voxel/BlockTextureFactory.js";
import { BlockMaterial } from "./voxel/material/BlockMaterial.js";
import { descriptorFromRegistry } from "./voxel/mesh/NaiveMesher.js";
import { TerrainGenerator } from "./voxel/TerrainGenerator.js";
import { VoxelPlayerCollision } from "./voxel/physics/VoxelPlayerCollision.js";
import { ForegroundMeshClient } from "./voxel/worker/ForegroundMeshClient.js";
import { MeshWorkerClient } from "./voxel/worker/MeshWorkerClient.js";
import type { MeshClient } from "./voxel/worker/MeshWorkerProtocol.js";

/**
 * Voxel M1 "unbounded streaming" (dossier §4.2, §5 S2) -- replaces the M0 orbit demo with a
 * first-person player STANDING on generated terrain that streams around him:
 *
 *   - `TerrainGenerator` (seeded, deterministic) + `ChunkWorld` (pure streaming/lifecycle core).
 *   - Meshing runs on a dedicated Vite module worker (`MeshWorkerClient`); the main thread ONLY
 *     decides and dispatches -- proof in the stats overlay (`mesh total` grows, worker-side
 *     `performance.now()` time, never a main-thread mesher call).
 *   - Neighbor-aware culling (`buildNeighborRim`) makes chunk borders seamless (pinned by the
 *     seam tests); the host materializes each outcome as the standard "one Object3D per chunk".
 *   - `VoxelPlayerCollision` (app-level Behavior) runs the Luanti-derived swept AABB resolver
 *     against the world: gravity, ground stand, wall slide -- the M1 gate's "player STANDS".
 *
 * Backend: WebGL2 default (dossier §4.4 #5); `?rendererType=WEB_GL2|WEB_GPU|WEB_GL1` overrides.
 * WebGPU array-texture material + WebGL1 atlas remain later milestones (M0 logs).
 */
export class App extends SmallWorldMachine {
  private _statsEl: HTMLElement | null = null;
  private _lastStatsUpdate = 0;

  private _world!: ChunkWorld;
  private _host!: ChunkWorldHost;
  private _player!: VoxelPlayerCollision;

  constructor() {
    // M1 ships GLSL300 only (like M0), so force WebGL2 unless the URL pins a backend.
    const rendererType = getRendererTypeFromQuery();
    if (rendererType) {
      super({ fullscreen: true, rendererType });
    } else {
      super({ fullscreen: true, rendererType: RendererType.WEB_GL2 });
    }
  }

  /** @inheritdoc */
  protected override async setupScene(): Promise<void> {
    this._statsEl = document.getElementById("voxel-stats");

    // 1. Perspective projection; far plane covers the streaming radius with margin.
    this.camera.projection = new PerspectiveProjection({
      fov: (75 * Math.PI) / 180,
      aspect: this.camera.aspect,
      near: 0.1,
      far: 500,
    });
    this.camera.updateProjectionMatrix();
    this.camera.setStrategy(CameraStrategyType.FPS);

    // 2. Registry (seeded, per-instance -- no singleton) + its transferable descriptor.
    const registry = new BlockRegistry();
    BlockRegistry.seed(registry);
    const descriptor = descriptorFromRegistry(registry);

    // 3. Palette + shared material -- ONE BlockMaterial instance for every chunk host.
    const palette = await createBlockPalette();
    const material = new BlockMaterial(palette);

    // 4. World backbone. Production uses the dedicated mesh worker; a browser without `Worker`
    //    degrades to the foreground double (meshing would run on main -- stats show the label).
    const client: MeshClient =
      typeof Worker !== "undefined" ? new MeshWorkerClient() : new ForegroundMeshClient();
    this._host = new ChunkWorldHost(this.scene, material);
    this._world = new ChunkWorld({
      client,
      descriptor,
      seed: WORLD_SEED,
      generateRadius: GENERATE_RADIUS,
      unloadRadius: GENERATE_RADIUS + 2, // hysteresis: > generateRadius (ChunkWorld invariant)
      callbacks: {
        onMeshReady: (cx, cz, mesh): void => this._host.onMeshReady(cx, cz, mesh),
        onUnload: (cx, cz): void => this._host.onUnload(cx, cz),
      },
    });

    // 5. Player: FPS look via the FPS strategy, feet standing on the generated surface.
    const generator = new TerrainGenerator({ seed: WORLD_SEED });
    const surface = generator.heightAt(SPAWN_X, SPAWN_Z); // topmost solid y
    this._player = new VoxelPlayerCollision({ world: this._world, input: this.input });
    this._player.setSpawn(SPAWN_X, surface + 1, SPAWN_Z); // feet on top of the grass cap
    this.camera.addBehavior(this._player);
    this._installQaHook();

    // 6. Pointer lock on click (engine FPS convention, see showcases 2/10/29).
    this.canvas.addEventListener("click", (): void => {
      if (!this.input.isPointerLocked) {
        this.input.requestPointerLock(this.canvas);
      }
    });

    this.scene.update();
    this._updateStats(true);
  }

  /** @inheritdoc */
  protected override update(deltaTime: number): void {
    void deltaTime;
    this._updateStats(false);
  }

  /**
   * Minimal QA surface for the headless live gate (`check-voxel-m1.mjs`, showcase24 pattern):
   * structured reads of the player body and the world stats without parsing CSS/HTML text.
   * Inert for normal usage (a single property on `window`).
   */
  private _installQaHook(): void {
    (window as unknown as { __voxelM1?: VoxelM1QaApi }).__voxelM1 = {
      getPlayer: (): PlayerQaState => {
        const feet = this._player.getFeetPosition(); // fresh object; safe to hand out
        return { feet, onGround: this._player.isOnGround() };
      },
      getStats: (): WorldQaStats => {
        const s = this._world.getStats();
        return {
          ready: s.ready,
          generated: s.generated,
          inFlight: s.inFlight,
          meshMsLast: s.meshMsLast,
          meshMsTotal: s.meshMsTotal,
          focus: this._world.getFocusChunk(),
        };
      },
    };
  }

  private _updateStats(force: boolean): void {
    if (!this._statsEl) return;
    const now = performance.now();
    if (!force && now - this._lastStatsUpdate < 250) return;
    this._lastStatsUpdate = now;
    const renderer = this.renderer;
    const backend = renderer ? renderer.type : "n/a";
    const stats = this._world.getStats();
    const feet = this._player.getFeetPosition();
    const workerMode = typeof Worker !== "undefined" ? "dedicated worker" : "foreground (main!)";

    this._statsEl.innerHTML =
      `<div class="stat-row"><span>renderer</span><b>${backend}</b></div>` +
      `<div class="stat-row"><span>engine</span><b>voxel M1</b></div>` +
      `<div class="stat-row"><span>player</span><b>${feet.x.toFixed(1)}, ${feet.y.toFixed(1)}, ${feet.z.toFixed(1)}</b></div>` +
      `<div class="stat-row"><span>grounded</span><b>${this._player.isOnGround() ? "yes" : "no"}</b></div>` +
      `<div class="stat-row"><span>chunks ready</span><b>${stats.ready}</b></div>` +
      `<div class="stat-row"><span>chunks data</span><b>${stats.generated}</b></div>` +
      `<div class="stat-row"><span>in flight</span><b>${stats.inFlight}</b></div>` +
      `<div class="stat-row"><span>objects</span><b>${this.scene.lastFrustumVisibleObjects.length}</b></div>` +
      `<div class="stat-row"><span>triangles</span><b>${this._host.triangleCount}</b></div>` +
      `<div class="stat-row"><span>mesh last</span><b>${stats.meshMsLast.toFixed(2)} ms</b></div>` +
      `<div class="stat-row"><span>mesh total</span><b>${stats.meshMsTotal.toFixed(1)} ms</b></div>` +
      `<div class="stat-row"><span>meshing</span><b>${workerMode}</b></div>`;
  }
}

/**
 * QA gate state shapes (see `_installQaHook`). Plain serializable data -- evaluated through
 * Puppeteer's structured clone by `.agents/scratches/check-voxel-m1.mjs`.
 */
export interface PlayerQaState {
  feet: { x: number; y: number; z: number };
  onGround: boolean;
}

export interface WorldQaStats {
  ready: number;
  generated: number;
  inFlight: number;
  meshMsLast: number;
  meshMsTotal: number;
  focus: { cx: number; cz: number };
}

export interface VoxelM1QaApi {
  getPlayer(): PlayerQaState;
  getStats(): WorldQaStats;
}

/** World seed for deterministic terrain (same seed -> same world; see TerrainGenerator tests). */
const WORLD_SEED = 777;
/** Player spawn column (world units). Streaming centers on the player every frame. */
const SPAWN_X = 20.5;
const SPAWN_Z = 20.5;
/** Streaming add radius in chunks (Chebyshev). Data is generated within it. */
const GENERATE_RADIUS = 6;

if (typeof window !== "undefined") {
  const app: App = new App();
  app.start().catch((err: unknown) => console.error("[voxel-prototype] Failed to start:", err));
}
