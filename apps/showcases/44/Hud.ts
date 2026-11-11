import { ShowcaseDrawer } from "../shared/ShowcaseDrawer.js";

export type PatternMode = "alternating" | "single" | "multi";

/** What the panel reflects; read from the showcase on every {@link Hud.sync}. */
export interface HudState {
  instancingOn: boolean;
  waveActive: boolean;
  pattern: PatternMode;
  count: number;
}

/** Showcase actions the panel triggers; the showcase calls `sync` afterwards. */
export interface HudActions {
  toggleAutoInstancing(): void;
  toggleWave(): void;
  setPattern(pattern: PatternMode): void;
  setObjectCount(count: number): void;
}

const COUNT_PRESETS = [400, 1600, 3600, 6400];

/**
 * Instancing Benchmark Lab panel of showcase 44 on the shared {@link ShowcaseDrawer}. Owns only
 * its controls; scene state and the draw counter stay in the showcase.
 */
export class Hud {
  private readonly _drawer: ShowcaseDrawer;
  private readonly _root: HTMLElement;
  private readonly _readout: HTMLElement;
  private readonly _style: HTMLStyleElement;

  constructor(private readonly _actions: HudActions) {
    const style = document.createElement("style");
    style.textContent = `
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
        white-space: pre-wrap; overflow-wrap: anywhere;
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
    this._style = style;

    this._drawer = new ShowcaseDrawer({
      id: "showcase-hud",
      title: "Instancing Benchmark Lab",
      icon: "⚡",
      footerIcon: "⚙",
      body: `
        <div class="hud-section">
          <div class="section-title"><span>📊 Live Performance Monitor</span><span style="font-size:9px;color:#64748b;">Real GL calls</span></div>
          <pre id="benchLiveReadout">Initializing counters...</pre>
        </div>

        <div class="hud-section">
          <div class="section-title"><span>⚙️ Instancing technique</span><span style="font-size:9px;color:#64748b;">ADR 0046 / Space</span></div>
          <button id="btnToggleInstancing" class="btn-preset" title="Toggle auto-instancing (key: Space)"></button>
          <div class="hud-note">💡 <b>A/B comparison:</b> Toggle to compare 2 instanced draws against hundreds to thousands of per-object draw calls.</div>
        </div>

        <div class="hud-section">
          <div class="section-title"><span>🔢 Object density</span><span style="font-size:9px;color:#64748b;">Grid size</span></div>
          <div class="preset-group four-col" style="margin-bottom:8px;">
            <button id="btnCount400" class="btn-preset" title="400 Cubes (20×20)">400</button>
            <button id="btnCount1600" class="btn-preset" title="1,600 Cubes (40×40)">1.6k</button>
            <button id="btnCount3600" class="btn-preset" title="3,600 Cubes (60×60)">3.6k</button>
            <button id="btnCount6400" class="btn-preset" title="6,400 Cubes (80×80)">6.4k</button>
          </div>
          <div class="hud-row">
            <label for="slCount">Object count</label>
            <input id="slCount" type="range" min="100" max="10000" step="100" />
            <span id="valCount" class="val-label"></span>
          </div>
        </div>

        <div class="hud-section">
          <div class="section-title"><span>📐 Geometry pattern</span><span style="font-size:9px;color:#64748b;">Keys 1–3</span></div>
          <div class="preset-group three-col">
            <button id="btnPatternAlt" class="btn-preset" title="Alternating A/B: stress test for geometry grouping (key 1)">1 · A/B Mix</button>
            <button id="btnPatternSingle" class="btn-preset" title="Pure A: all identical (key 2)">2 · Pure A</button>
            <button id="btnPatternMulti" class="btn-preset" title="Multi A/B/C: Cube 1m, Cube 1.7m, Sphere 0.8m (key 3)">3 · A/B/C Mix</button>
          </div>
          <div class="hud-note">With <b>A/B Mix</b> geometries alternate in insertion order. Naive instancing fails completely here — only A2 groups them!</div>
        </div>

        <div class="hud-section">
          <div class="section-title"><span>🌊 Dynamic stress test</span><span style="font-size:9px;color:#64748b;">Key W</span></div>
          <button id="btnToggleWave" class="btn-preset" style="width:100%;" title="Animate sine wave (key W)"><span>🌊</span> Sine Wave: <b>OFF</b></button>
          <div class="hud-note">Forces continuous matrix recomputation and instance-buffer uploads every frame.</div>
        </div>

        <div class="hud-section hud-keys">
          <kbd>Space</kbd> Instancing · <kbd>W</kbd> Wave · <kbd>1–3</kbd> Muster · <kbd>Drag</kbd> Orbit · <kbd>R</kbd> Reset · <kbd>I</kbd> HUD
        </div>
      `,
    });
    this._root = this._drawer.root;
    this._readout = this._root.querySelector("#benchLiveReadout") as HTMLElement;
    this._bind();
  }

  /** Handles the I / H panel toggle. Returns true when the key was consumed. */
  public handleKey(event: KeyboardEvent): boolean {
    return this._drawer.handleKey(event);
  }

  /** Writes the live performance text (a few times per second, not every frame). */
  public setReadout(text: string): void {
    if (this._readout.textContent !== text) {
      this._readout.textContent = text;
    }
  }

  /** Reflects the current showcase state in every control. */
  public sync(state: HudState): void {
    const toggleBtn = this._drawer.query<HTMLButtonElement>("#btnToggleInstancing");
    if (toggleBtn) {
      toggleBtn.classList.toggle("active", state.instancingOn);
      toggleBtn.innerHTML = state.instancingOn
        ? "<span>⚡</span> Auto-Instancing: <b>ON</b> (A2 Active)"
        : "<span>⚠️</span> Auto-Instancing: <b>OFF</b> (Per-Object Baseline)";
      toggleBtn.style.background = state.instancingOn
        ? "rgba(16, 185, 129, 0.25)"
        : "rgba(239, 68, 68, 0.2)";
      toggleBtn.style.borderColor = state.instancingOn ? "#10b981" : "#ef4444";
      toggleBtn.style.color = state.instancingOn ? "#6ee7b7" : "#fca5a5";
    }

    const waveBtn = this._drawer.query<HTMLButtonElement>("#btnToggleWave");
    if (waveBtn) {
      waveBtn.classList.toggle("active", state.waveActive);
      waveBtn.innerHTML = state.waveActive
        ? "<span>🌊</span> Sine Wave: <b>ON</b>"
        : "<span>🌊</span> Sine Wave: <b>OFF</b>";
    }

    this._drawer
      .query("#btnPatternAlt")
      ?.classList.toggle("active", state.pattern === "alternating");
    this._drawer.query("#btnPatternSingle")?.classList.toggle("active", state.pattern === "single");
    this._drawer.query("#btnPatternMulti")?.classList.toggle("active", state.pattern === "multi");

    for (const cp of COUNT_PRESETS) {
      this._drawer.query(`#btnCount${cp}`)?.classList.toggle("active", state.count === cp);
    }
    const slider = this._drawer.query<HTMLInputElement>("#slCount");
    const label = this._drawer.query("#valCount");
    if (slider) slider.value = String(state.count);
    if (label) label.textContent = `${state.count.toLocaleString()} Cubes`;
  }

  /** Removes panel and footer button. */
  public dispose(): void {
    this._drawer.dispose();
    this._style.remove();
  }

  private _bind(): void {
    const a = this._actions;
    const d = this._drawer;
    d.query("#btnToggleInstancing")?.addEventListener("click", () => a.toggleAutoInstancing());
    d.query("#btnToggleWave")?.addEventListener("click", () => a.toggleWave());
    d.query("#btnPatternAlt")?.addEventListener("click", () => a.setPattern("alternating"));
    d.query("#btnPatternSingle")?.addEventListener("click", () => a.setPattern("single"));
    d.query("#btnPatternMulti")?.addEventListener("click", () => a.setPattern("multi"));
    for (const cp of COUNT_PRESETS) {
      d.query(`#btnCount${cp}`)?.addEventListener("click", () => a.setObjectCount(cp));
    }
    const slider = d.query<HTMLInputElement>("#slCount");
    slider?.addEventListener("input", () => a.setObjectCount(parseInt(slider.value, 10)));
    slider?.addEventListener("change", () => slider.blur());
  }
}
