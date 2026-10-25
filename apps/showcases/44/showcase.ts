import {
  AbstractShowcase,
  AmbientLight,
  Color,
  Cube,
  Object3D,
  RendererType,
  StandardMaterial,
} from "@small-world-machine/engine";
import type { EngineOptions } from "@small-world-machine/engine";

/**
 * Real-browser measurement rig for the A2 geometry-grouping instancing work
 * (`docs/research/instanced-batching-2026-10-24.md` §7.1(b)/§9.1).
 *
 * The scene is a *geometry mix*: two cube sizes share ONE `StandardMaterial` and are scattered in
 * alternating insertion order (`i % 2`), so plain "consecutive identical objects" automatic
 * instancing (ADR 0046) can never merge them -- it takes A2's geometry grouping to turn the batch
 * into two instanced draws. Every cube has `frustumCulled = false` so culling cannot reduce the
 * count on one side of the comparison but not the other.
 *
 * Measurement is engine-independent: `canvas.getContext("webgl2")` on the engine's own canvas
 * returns the *same* context object, so the wrapper below shadows `gl.drawArrays/drawElements`
 * (+Instanced variants) and tallies real per-frame draw calls without touching any engine source.
 * The renderer is pinned to `WEB_GL2` (a WebGPU context would not go through these GL entry
 * points), and the scene holds no shadow-casting light so only the opaque main pass draws.
 *
 * URL knobs:
 *   `?inst=off`  disable autoInstancing (== per-object baseline, "before")
 *   `?count=N`   object count, default 1600 (40x40 grid)
 *   `?frames=N`  sampled frames after warm-up, default 240
 *
 * Result contract (consumed by `scripts/measure-a2-instancing.mjs`): the overlay `#__measure`
 * element and the console both receive `MEASURE { ...json... }` exactly once on completion.
 */
const DEFAULT_COUNT = 1600;
const DEFAULT_FRAMES = 240;
const WARMUP_FRAMES = 30;

interface DrawTally {
  total: number;
  perObject: number;
  instanced: number;
}

interface MeasureResult {
  rendererType: string | undefined;
  autoInstancing: boolean;
  objects: number;
  frames: number;
  wallMs: number;
  drawCalls: number;
  perObjectDraws: number;
  instancedDraws: number;
  drawCallsPerFrame: number;
  perObjectDrawsPerFrame: number;
  instancedDrawsPerFrame: number;
  frameTimeMs: number;
  avgFps: number;
}

/** Just the four counted entry points, loosely typed so the wrapper stays `any`-free. */
interface MutableDrawContext {
  drawArrays: (...args: number[]) => void;
  drawElements: (...args: number[]) => void;
  drawArraysInstanced: (...args: number[]) => void;
  drawElementsInstanced: (...args: number[]) => void;
}

class Showcase44 extends AbstractShowcase {
  private readonly _instancingOn: boolean;
  private readonly _count: number;
  private readonly _targetFrames: number;

  private _tally: DrawTally = { total: 0, perObject: 0, instanced: 0 };
  private _state: "idle" | "warmup" | "sampling" | "done" = "idle";
  private _warmupFrames = 0;
  private _sampledFrames = 0;
  private _startMs = 0;
  private _startTally: DrawTally = { total: 0, perObject: 0, instanced: 0 };

  constructor(options: EngineOptions = {}) {
    const params = new URLSearchParams(window.location.search);
    const instancingOn = params.get("inst") !== "off";
    const count = Number(params.get("count"));
    const frames = Number(params.get("frames"));
    super({
      canvasId: "SmallWorldMachine",
      fullscreen: true,
      // Pinned on purpose: a WEB_GPU context does not run through the GL draw wrappers this rig is
      // built on, so the comparison would silently turn into "0 vs 0". WebGL2 is the parity target
      // of the A2 work anyway.
      rendererType: RendererType.WEB_GL2,
      ...options,
      quality: {
        ...(options.quality ?? {}),
        autoInstancing: instancingOn,
      },
    });
    this.defaultCameraController = "none";
    this._instancingOn = instancingOn;
    this._count = Number.isFinite(count) && count > 0 ? Math.floor(count) : DEFAULT_COUNT;
    this._targetFrames =
      Number.isFinite(frames) && frames > 0 ? Math.floor(frames) : DEFAULT_FRAMES;
  }

  protected override async setupScene(): Promise<void> {
    // Fixed elevated 3/4 view framing the whole grid. Combined with `frustumCulled = false` below,
    // visibility can never bias the draw count.
    this.camera.position.set(80, 90, 80);
    this.camera.target.set(0, 0, 0);

    // Ambient only: no shadow-casting light, so no shadow passes add draws to the count.
    this.scene.add(new AmbientLight({ color: Color.WHITE, intensity: 0.6 }));

    const gridSize = Math.ceil(Math.sqrt(this._count));
    const spacing = 1.5;
    const offset = (gridSize * spacing) / 2 - spacing / 2;
    const geoA = new Cube({ size: 1.0 }).getGeometryData();
    const geoB = new Cube({ size: 1.7 }).getGeometryData();
    const material = new StandardMaterial({
      color: new Color(0.85, 0.85, 0.92),
      roughness: 0.45,
      metallic: 0.05,
    });

    let i = 0;
    outer: for (let x = 0; x < gridSize; x++) {
      for (let z = 0; z < gridSize; z++) {
        if (i >= this._count) break outer;
        // Scatter: geometry alternates in insertion order, so no run of >=2 (let alone >=4)
        // equal geometries exists -- only A2's grouping recovers the two instanced draws.
        const cube = new Object3D(`m_${i}`);
        cube.geometry = i % 2 === 0 ? geoA : geoB;
        cube.material = material;
        cube.setPosition(x * spacing - offset, 0, z * spacing - offset);
        cube.frustumCulled = false;
        this.scene.add(cube);
        i++;
      }
    }
  }

  public override async start(): Promise<void> {
    await super.start();
    const gl = this.canvas.getContext("webgl2");
    if (!gl) {
      this._writeStatus("ERROR no webgl2 context (renderer did not come up as WEB_GL2?)");
      return;
    }
    this._installDrawCounter(gl);
    this._state = "warmup";
    this._writeStatus(`ready autoInstancing=${this._instancingOn} objects=${this._count}`);
  }

  protected override update(_deltaTime: number): void {
    if (this._state === "idle" || this._state === "done") return;

    if (this._state === "warmup") {
      this._warmupFrames++;
      if (this._warmupFrames < WARMUP_FRAMES) return;
      // Steady-state reached: snapshot before this frame's render. Its draws are part of the
      // window, hence the +1 on the frame denominator in `_finalize`.
      this._state = "sampling";
      this._startMs = performance.now();
      this._startTally = { ...this._tally };
      this._writeStatus(`sampling 0/${this._targetFrames}`);
      return;
    }

    this._sampledFrames++;
    if (this._sampledFrames % 20 === 0) {
      this._writeStatus(`sampling ${this._sampledFrames}/${this._targetFrames}`);
    }
    if (this._sampledFrames >= this._targetFrames) {
      this._finalize();
    }
  }

  /**
   * Shadows the four GL draw entry points on the live context. The engine keeps calling the same
   * functions (property lookup on the shared context object), so nothing else changes -- every real
   * main-pass draw is tallied, instanced ones separated from per-object ones.
   */
  private _installDrawCounter(gl: WebGL2RenderingContext): void {
    const mutable = gl as unknown as MutableDrawContext;
    const tally = this._tally;
    const wrap = (key: keyof MutableDrawContext): void => {
      const original = mutable[key].bind(gl);
      mutable[key] = (...args): void => {
        tally.total++;
        if (key === "drawArraysInstanced" || key === "drawElementsInstanced") {
          tally.instanced++;
        } else {
          tally.perObject++;
        }
        original(...args);
      };
    };
    wrap("drawArrays");
    wrap("drawElements");
    wrap("drawArraysInstanced");
    wrap("drawElementsInstanced");
  }

  private _finalize(): void {
    this._state = "done";
    const wallMs = Math.max(0.001, performance.now() - this._startMs);
    const frames = this._sampledFrames + 1; // +1: the transition frame's draws are in the tally
    const total = Math.max(0, this._tally.total - this._startTally.total);
    const perObject = Math.max(0, this._tally.perObject - this._startTally.perObject);
    const instanced = Math.max(0, this._tally.instanced - this._startTally.instanced);
    const result: MeasureResult = {
      rendererType: this.renderer.type,
      autoInstancing: this._instancingOn,
      objects: this._count,
      frames,
      wallMs: Math.round(wallMs),
      drawCalls: total,
      perObjectDraws: perObject,
      instancedDraws: instanced,
      drawCallsPerFrame: total / frames,
      perObjectDrawsPerFrame: perObject / frames,
      instancedDrawsPerFrame: instanced / frames,
      frameTimeMs: wallMs / frames,
      avgFps: frames / (wallMs / 1000),
    };
    const message = `MEASURE ${JSON.stringify(result)}`;
    this._writeStatus(message);
    console.info(`[Showcase44 MEASURE] ${JSON.stringify(result)}`);
  }

  private _writeStatus(message: string): void {
    let overlay = document.getElementById("__measure");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "__measure";
      overlay.style.cssText =
        "position:fixed;top:8px;right:8px;z-index:99999;background:rgba(0,0,0,.78);" +
        "color:#0f0;font:12px/1.4 ui-monospace,Menlo,monospace;padding:6px 10px;border-radius:4px;" +
        "white-space:pre-wrap;max-width:72vw;pointer-events:none;";
      document.body.appendChild(overlay);
    }
    overlay.textContent = message;
  }
}

const app = new Showcase44();
app.start().catch((err: unknown) => console.error("[Showcase44] failed to start:", err));
