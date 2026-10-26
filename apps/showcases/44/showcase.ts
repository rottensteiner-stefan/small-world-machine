import {
  AbstractShowcase,
  AmbientLight,
  Color,
  Cube,
  Object3D,
  RendererType,
  Sphere,
  StandardMaterial,
  Vector3D,
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

type PatternMode = "alternating" | "single" | "multi";

class Showcase44 extends AbstractShowcase {
  private _instancingOn: boolean;
  private _count: number;
  private readonly _targetFrames: number;
  private readonly _isAutomatedTest: boolean;

  private _tally: DrawTally = { total: 0, perObject: 0, instanced: 0 };
  private _state: "idle" | "warmup" | "sampling" | "done" = "idle";
  private _warmupFrames = 0;
  private _sampledFrames = 0;
  private _startMs = 0;
  private _startTally: DrawTally = { total: 0, perObject: 0, instanced: 0 };

  private _cubes: Object3D[] = [];
  private _distances: Float32Array = new Float32Array(0);
  private _baseY: Float32Array = new Float32Array(0);
  private _pattern: PatternMode = "alternating";
  private _waveActive: boolean = false;
  private _waveTime: number = 0;

  // Live per-frame metrics
  private _prevTotal: number = 0;
  private _prevInstanced: number = 0;
  private _prevPerObject: number = 0;
  private _lastFrameDraws: number = 0;
  private _lastFrameInstanced: number = 0;
  private _lastFramePerObject: number = 0;
  private _fpsFrames: number = 0;
  private _fpsTimer: number = 0;
  private _smoothedFps: number = 60;
  private _smoothedFrameMs: number = 16.6;

  private _hud: HTMLElement | undefined;
  private _hudStyle: HTMLStyleElement | undefined;
  private _hudToggleBtn: HTMLButtonElement | undefined;
  private _material: StandardMaterial | undefined;

  constructor(options: EngineOptions = {}) {
    const params = new URLSearchParams(window.location.search);
    const instancingOn = params.get("inst") !== "off";
    const count = Number(params.get("count"));
    const frames = Number(params.get("frames"));
    const isAutomated = params.has("frames") || params.has("measure");
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
    this._isAutomatedTest = isAutomated;
    this.defaultCameraController = isAutomated ? "none" : "orbit";
    this._instancingOn = instancingOn;
    this._count = Number.isFinite(count) && count > 0 ? Math.floor(count) : DEFAULT_COUNT;
    this._targetFrames =
      Number.isFinite(frames) && frames > 0 ? Math.floor(frames) : DEFAULT_FRAMES;
  }

  protected override onCanvasRecreated(): void {
    // No pointer lock so the user can interact freely with sliders and orbit the camera.
  }

  protected override async setupScene(): Promise<void> {
    // Fixed elevated 3/4 view framing the whole grid.
    const camPos = new Vector3D(80, 90, 80);
    const camTarget = new Vector3D(0, 0, 0);
    this.camera.position.copyFrom(camPos);
    this.camera.target.copyFrom(camTarget);
    this.setInitialCamera(camPos, camTarget);

    // Ambient only: no shadow-casting light, so no shadow passes add draws to the count.
    this.scene.add(new AmbientLight({ color: Color.WHITE, intensity: 0.6 }));

    this._material = new StandardMaterial({
      color: new Color(0.85, 0.85, 0.92),
      roughness: 0.45,
      metallic: 0.05,
    });

    this._buildObjects(this._count, this._pattern);
  }

  private _buildObjects(count: number, pattern: PatternMode): void {
    for (const cube of this._cubes) {
      this.scene.remove(cube);
    }
    this._cubes.length = 0;

    this._count = count;
    this._pattern = pattern;

    const gridSize = Math.ceil(Math.sqrt(count));
    const spacing = 1.5;
    const offset = (gridSize * spacing) / 2 - spacing / 2;
    const geoA = new Cube({ size: 1.0 }).getGeometryData();
    const geoB = new Cube({ size: 1.7 }).getGeometryData();
    const geoC = new Sphere({
      radius: 0.8,
      widthSegments: 16,
      heightSegments: 12,
    }).getGeometryData();
    const material = this._material!;

    this._distances = new Float32Array(count);
    this._baseY = new Float32Array(count);

    let i = 0;
    outer: for (let x = 0; x < gridSize; x++) {
      for (let z = 0; z < gridSize; z++) {
        if (i >= count) break outer;
        const cube = new Object3D(`m_${i}`);
        if (pattern === "single") {
          cube.geometry = geoA;
        } else if (pattern === "multi") {
          const mod = i % 3;
          cube.geometry = mod === 0 ? geoA : mod === 1 ? geoB : geoC;
        } else {
          // Alternating: A/B stress test for A2 geometry grouping
          cube.geometry = i % 2 === 0 ? geoA : geoB;
        }
        cube.material = material;
        const posX = x * spacing - offset;
        const posZ = z * spacing - offset;
        cube.setPosition(posX, 0, posZ);
        cube.frustumCulled = false;
        this.scene.add(cube);
        this._cubes.push(cube);

        this._distances[i] = Math.sqrt(posX * posX + posZ * posZ);
        this._baseY[i] = 0;
        i++;
      }
    }
    this._syncHudButtons();
  }

  public override async start(): Promise<void> {
    await super.start();
    const gl = this.canvas.getContext("webgl2");
    if (!gl) {
      this._writeStatus("ERROR no webgl2 context (renderer did not come up as WEB_GL2?)");
      return;
    }
    this._installDrawCounter(gl);

    // The #__measure overlay and its MEASURE sequence belong to the headless rig (?frames / ?measure);
    // the interactive lab shows its live numbers in the HUD instead.
    if (this._isAutomatedTest) {
      this._state = "warmup";
      this._writeStatus(`ready autoInstancing=${this._instancingOn} objects=${this._count}`);
    } else {
      this._createHud();
    }
  }

  public override destroy(): void {
    this._hud?.remove();
    this._hudStyle?.remove();
    this._hudToggleBtn?.remove();
    super.destroy();
  }

  protected override onKeyDown(event: KeyboardEvent): void {
    super.onKeyDown(event);
    if (this._isAutomatedTest || event.altKey || event.metaKey || event.ctrlKey) return;
    if (document.activeElement?.tagName === "INPUT") return;

    switch (event.code) {
      case "Space":
        this._toggleAutoInstancing();
        break;
      case "KeyW":
        this._toggleWave();
        break;
      case "Digit1":
        this._setPattern("alternating");
        break;
      case "Digit2":
        this._setPattern("single");
        break;
      case "Digit3":
        this._setPattern("multi");
        break;
      case "KeyI":
      case "KeyH":
        this._toggleHud();
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  protected override update(deltaTime: number): void {
    // 1. Live per-frame draw call delta tracking
    const curTotal = this._tally.total;
    const curInstanced = this._tally.instanced;
    const curPerObject = this._tally.perObject;

    this._lastFrameDraws = curTotal - this._prevTotal;
    this._lastFrameInstanced = curInstanced - this._prevInstanced;
    this._lastFramePerObject = curPerObject - this._prevPerObject;

    this._prevTotal = curTotal;
    this._prevInstanced = curInstanced;
    this._prevPerObject = curPerObject;

    // 2. Smooth FPS metrics
    this._fpsFrames++;
    this._fpsTimer += deltaTime;
    if (this._fpsTimer >= 0.2) {
      this._smoothedFps = this._fpsFrames / this._fpsTimer;
      this._smoothedFrameMs = (this._fpsTimer / this._fpsFrames) * 1000;
      this._fpsFrames = 0;
      this._fpsTimer = 0;
      this._updateLiveReadout();
    }

    // 3. Dynamic GPU wave transform stress test
    if (this._waveActive) {
      this._waveTime += deltaTime;
      const time = this._waveTime;
      const cubes = this._cubes;
      const dists = this._distances;
      const baseY = this._baseY;
      for (let idx = 0; idx < cubes.length; idx++) {
        const cube = cubes[idx]!;
        cube.position.y = baseY[idx]! + Math.sin(dists[idx]! * 0.25 - time * 4.0) * 2.0;
        cube.updateMatrixWorld();
      }
    }

    // 4. Automated measurement sequence for scripts/measure-a2-instancing.mjs
    if (this._state === "idle" || this._state === "done") return;

    if (this._state === "warmup") {
      this._warmupFrames++;
      if (this._warmupFrames < WARMUP_FRAMES) return;
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

  private _toggleAutoInstancing(): void {
    this._instancingOn = !this._instancingOn;
    this.renderer.quality.autoInstancing = this._instancingOn;
    this._syncHudButtons();
  }

  private _toggleWave(): void {
    this._waveActive = !this._waveActive;
    if (!this._waveActive) {
      for (let idx = 0; idx < this._cubes.length; idx++) {
        const cube = this._cubes[idx]!;
        cube.position.y = this._baseY[idx]!;
        cube.updateMatrixWorld();
      }
    }
    this._syncHudButtons();
  }

  private _setPattern(pattern: PatternMode): void {
    if (this._pattern === pattern) return;
    this._buildObjects(this._count, pattern);
  }

  private _setObjectCount(count: number): void {
    if (this._count === count) return;
    this._buildObjects(count, this._pattern);
  }

  private _toggleHud(force?: boolean): void {
    if (!this._hud) return;
    const open = force ?? !this._hud.classList.contains("open");
    this._hud.classList.toggle("open", open);
    this._hudToggleBtn?.classList.toggle("active", open);
  }

  private _syncHudButtons(): void {
    if (!this._hud) return;
    const toggleBtn = document.getElementById("btnToggleInstancing");
    if (toggleBtn) {
      toggleBtn.classList.toggle("active", this._instancingOn);
      toggleBtn.innerHTML = this._instancingOn
        ? "<span>⚡</span> Auto-Instancing: <b>ON</b> (A2 Active)"
        : "<span>⚠️</span> Auto-Instancing: <b>OFF</b> (Per-Object Baseline)";
      toggleBtn.style.background = this._instancingOn
        ? "rgba(16, 185, 129, 0.25)"
        : "rgba(239, 68, 68, 0.2)";
      toggleBtn.style.borderColor = this._instancingOn ? "#10b981" : "#ef4444";
      toggleBtn.style.color = this._instancingOn ? "#6ee7b7" : "#fca5a5";
    }

    const waveBtn = document.getElementById("btnToggleWave");
    if (waveBtn) {
      waveBtn.classList.toggle("active", this._waveActive);
      waveBtn.innerHTML = this._waveActive
        ? "<span>🌊</span> Sine Wave: <b>ON</b>"
        : "<span>🌊</span> Sine Wave: <b>OFF</b>";
    }

    document
      .getElementById("btnPatternAlt")
      ?.classList.toggle("active", this._pattern === "alternating");
    document
      .getElementById("btnPatternSingle")
      ?.classList.toggle("active", this._pattern === "single");
    document
      .getElementById("btnPatternMulti")
      ?.classList.toggle("active", this._pattern === "multi");

    const countPresets = [400, 1600, 3600, 6400];
    for (const cp of countPresets) {
      document.getElementById(`btnCount${cp}`)?.classList.toggle("active", this._count === cp);
    }
    const slider = document.getElementById("slCount") as HTMLInputElement | null;
    const label = document.getElementById("valCount");
    if (slider) slider.value = String(this._count);
    if (label) label.textContent = `${this._count.toLocaleString()} Cubes`;
  }

  private _updateLiveReadout(): void {
    const el = document.getElementById("benchLiveReadout");
    if (!el) return;

    const totalDraws = this._lastFrameDraws;
    const instanced = this._lastFrameInstanced;
    const perObj = this._lastFramePerObject;
    const reduction = totalDraws > 0 ? (this._count / Math.max(1, totalDraws)).toFixed(0) : "1";

    const text =
      `Draw Calls/Frame:   ${totalDraws}  (${reduction}× Reduktion)\n` +
      `  ├─ Instanced:     ${instanced}  (Batches)\n` +
      `  └─ Per-Object:    ${perObj}\n` +
      `Objekte im Gitter:  ${this._count.toLocaleString()} (${this._pattern})\n` +
      `Framerate:          ${this._smoothedFps.toFixed(1)} FPS (${this._smoothedFrameMs.toFixed(1)} ms)\n` +
      `Auto-Instancing:    ${this._instancingOn ? "AKTIV (A2 Grouping)" : "AUS (Baseline)"}`;

    if (el.textContent !== text) {
      el.textContent = text;
    }
  }

  private _createHud(): void {
    const style = document.createElement("style");
    style.textContent = `
      #showcase-hud .preset-group.four-col { grid-template-columns: repeat(4, 1fr); }
      #showcase-hud .preset-group.three-col { grid-template-columns: repeat(3, 1fr); }
      #showcase-hud .preset-group.two-col { grid-template-columns: repeat(2, 1fr); }
      #showcase-hud .hud-note { font-size: 10px; line-height: 1.4; color: #94a3b8; margin-top: 6px; }
      #showcase-hud .hud-keys { font-size: 10px; line-height: 1.6; color: #94a3b8; }
      #showcase-hud .hud-keys kbd {
        font-family: var(--font-mono, "JetBrains Mono", monospace);
        border: 1px solid rgba(148, 163, 184, 0.35); border-radius: 3px; padding: 0 4px;
      }
      #benchLiveReadout {
        font-family: var(--font-mono, "JetBrains Mono", monospace);
        font-size: 11px;
        line-height: 1.5;
        color: #67e8f9;
        background: rgba(2, 6, 23, 0.75);
        border: 1px solid rgba(56, 189, 248, 0.25);
        border-radius: 6px;
        padding: 8px 10px;
        margin: 4px 0 8px 0;
        white-space: pre;
      }
      #btnToggleInstancing {
        width: 100%;
        padding: 10px;
        font-weight: 700;
        font-size: 12px;
        letter-spacing: 0.5px;
        cursor: pointer;
        border-radius: 6px;
        transition: all 0.2s ease;
      }
    `;
    document.head.appendChild(style);
    this._hudStyle = style;

    const hud = document.createElement("aside");
    hud.id = "showcase-hud";
    hud.className = "swm-inspector-drawer open";
    hud.innerHTML = `
      <div class="bottom-sheet-grabber"></div>
      <div class="hud-header">
        <div class="hud-title"><span>⚡</span> Instancing Benchmark Lab</div>
        <div style="display:flex;align-items:center;gap:8px;">
          <span class="hud-badge">${this.renderer.type}</span>
          <button id="btnBenchClose" class="hud-close-btn" title="Close Panel (Key: I / H)">✕</button>
        </div>
      </div>
      <div class="hud-body">
        <div class="hud-section">
          <div class="section-title"><span>📊 Live Performance Monitor</span><span style="font-size:9px;color:#64748b;">Echte GL Calls</span></div>
          <pre id="benchLiveReadout">Initialisiere Zähler...</pre>
        </div>

        <div class="hud-section">
          <div class="section-title"><span>⚙️ Instancing Technik</span><span style="font-size:9px;color:#64748b;">ADR 0046 / Space</span></div>
          <button id="btnToggleInstancing" class="btn-preset" title="Auto-Instancing an/aus (Taste: Leertaste)"></button>
          <div class="hud-note">💡 <b>A/B-Vergleich:</b> Schalte um, um 2 instanziierte Draws gegen hunderte bis tausende Per-Object-Draw-Calls zu vergleichen.</div>
        </div>

        <div class="hud-section">
          <div class="section-title"><span>🔢 Objekt-Dichte</span><span style="font-size:9px;color:#64748b;">Gittergröße</span></div>
          <div class="preset-group four-col" style="margin-bottom:8px;">
            <button id="btnCount400" class="btn-preset" title="400 Cubes (20×20)">400</button>
            <button id="btnCount1600" class="btn-preset" title="1.600 Cubes (40×40)">1.6k</button>
            <button id="btnCount3600" class="btn-preset" title="3.600 Cubes (60×60)">3.6k</button>
            <button id="btnCount6400" class="btn-preset" title="6.400 Cubes (80×80)">6.4k</button>
          </div>
          <div class="hud-row">
            <label for="slCount">Anzahl Objekte</label>
            <input id="slCount" type="range" min="100" max="10000" step="100" />
            <span id="valCount" class="val-label"></span>
          </div>
        </div>

        <div class="hud-section">
          <div class="section-title"><span>📐 Geometrie-Muster</span><span style="font-size:9px;color:#64748b;">Tasten 1–3</span></div>
          <div class="preset-group three-col">
            <button id="btnPatternAlt" class="btn-preset" title="Alternating A/B: Härtetest für Geometrie-Gruppierung (Taste 1)">1 · A/B Mix</button>
            <button id="btnPatternSingle" class="btn-preset" title="Pure A: Alle identisch (Taste 2)">2 · Pure A</button>
            <button id="btnPatternMulti" class="btn-preset" title="Multi A/B/C: Cube 1m, Cube 1.7m, Sphere 0.8m (Taste 3)">3 · A/B/C Mix</button>
          </div>
          <div class="hud-note">Bei <b>A/B Mix</b> alternieren Geometrien in der Einfügereihenfolge. Naives Instancing scheitert hier komplett — nur A2 gruppiert!</div>
        </div>

        <div class="hud-section">
          <div class="section-title"><span>🌊 Dynamischer Stresstest</span><span style="font-size:9px;color:#64748b;">Taste W</span></div>
          <button id="btnToggleWave" class="btn-preset" style="width:100%;" title="Sinuswelle animieren (Taste W)"><span>🌊</span> Sine Wave: <b>OFF</b></button>
          <div class="hud-note">Erzwingt kontinuierliche Matrix-Neuberechnungen und Instance-Buffer-Uploads jedes Frame.</div>
        </div>

        <div class="hud-section hud-keys">
          <kbd>Space</kbd> Instancing · <kbd>W</kbd> Welle · <kbd>1–3</kbd> Muster · <kbd>Drag</kbd> Orbit · <kbd>R</kbd> Reset · <kbd>I</kbd> HUD
        </div>
      </div>
    `;
    document.body.appendChild(hud);
    this._hud = hud;

    const stopEvents = [
      "mousedown",
      "mouseup",
      "mousemove",
      "pointerdown",
      "pointerup",
      "pointermove",
      "wheel",
      "touchstart",
      "touchmove",
      "touchend",
      "click",
      "dblclick",
      "contextmenu",
    ];
    for (const eventName of stopEvents) {
      hud.addEventListener(eventName, (e: Event): void => e.stopPropagation(), {
        passive: eventName === "wheel" || eventName === "touchstart" || eventName === "touchmove",
      });
    }

    const toggleBtn = document.createElement("button");
    toggleBtn.className = "swm-inspector-btn active";
    toggleBtn.innerHTML = "<span>⚙</span>";
    toggleBtn.title = "Benchmark Lab (Toggle, Key: I / H)";
    toggleBtn.setAttribute("aria-label", "Toggle Benchmark Lab");
    toggleBtn.onclick = (): void => this._toggleHud();
    (document.querySelector(".app-footer") ?? document.body).appendChild(toggleBtn);
    this._hudToggleBtn = toggleBtn;

    document
      .getElementById("btnBenchClose")
      ?.addEventListener("click", () => this._toggleHud(false));
    document
      .getElementById("btnToggleInstancing")
      ?.addEventListener("click", () => this._toggleAutoInstancing());
    document.getElementById("btnToggleWave")?.addEventListener("click", () => this._toggleWave());

    document
      .getElementById("btnPatternAlt")
      ?.addEventListener("click", () => this._setPattern("alternating"));
    document
      .getElementById("btnPatternSingle")
      ?.addEventListener("click", () => this._setPattern("single"));
    document
      .getElementById("btnPatternMulti")
      ?.addEventListener("click", () => this._setPattern("multi"));

    const countPresets = [400, 1600, 3600, 6400];
    for (const cp of countPresets) {
      document
        .getElementById(`btnCount${cp}`)
        ?.addEventListener("click", () => this._setObjectCount(cp));
    }

    const slider = document.getElementById("slCount") as HTMLInputElement | null;
    slider?.addEventListener("input", () => {
      this._setObjectCount(parseInt(slider.value, 10));
    });
    slider?.addEventListener("change", () => slider.blur());

    this._syncHudButtons();
    this._updateLiveReadout();
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
