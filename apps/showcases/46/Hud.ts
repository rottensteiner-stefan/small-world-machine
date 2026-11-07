import {
  ShowcaseDrawer,
  hudNote,
  hudSection,
  hudSlider,
  hudSwitch,
} from "../shared/ShowcaseDrawer.js";
import {
  CAMERA_POOL_IDS,
  PARTICLE_VARIANTS,
  type CameraPoolId,
  type ParticleVariantId,
} from "./Variants.js";

/** Everything the viewer can change in the Particle Variant Lab. */
export interface HudState {
  /** Active effect variant. */
  variant: ParticleVariantId;
  /** Active camera pool. */
  pool: CameraPoolId;
  /** Live burst intensity multiplier (sparks + splashes). */
  burstScale: number;
  /** Live smoke density multiplier. */
  smokeScale: number;
  /** Live weather intensity multiplier (rain count). */
  weatherScale: number;
  /** Global time scale (0 freezes). */
  timeScale: number;
  paused: boolean;
  /** Whether the WebGPU lane may be used when a device is present. */
  gpuAllowed: boolean;
}

export function defaultHudState(): HudState {
  return {
    variant: "overview",
    pool: "overview",
    burstScale: 1,
    smokeScale: 1,
    weatherScale: 1,
    timeScale: 1,
    paused: false,
    gpuAllowed: true,
  };
}

const TIME_SCALES = [0.1, 0.25, 0.5, 1, 2];
const VARIANT_KEYS: Readonly<Record<string, ParticleVariantId>> = {
  Digit1: "overview",
  Digit2: "forge",
  Digit3: "smoke",
  Digit4: "trails",
  Digit5: "weather",
  Digit6: "gpu",
};
const POOL_KEYS: Readonly<Record<string, CameraPoolId>> = {
  Digit7: "overview",
  Digit8: "closeup",
  Digit9: "budget",
};
const SWITCHES = ["gpuAllowed"] as const;
type SwitchKey = (typeof SWITCHES)[number];

interface SliderSpec {
  readonly key: "burstScale" | "smokeScale" | "weatherScale";
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly format: (value: number) => string;
}

const percent = (value: number): string => `${Math.round(value * 100)} %`;

/**
 * Particle Lab panel of showcase 46 on the shared {@link ShowcaseDrawer}. Owns only its controls
 * and the settings object; the showcase reads the settings and applies them.
 */
export class Hud {
  private readonly _drawer: ShowcaseDrawer;
  private readonly _style: HTMLStyleElement;
  private readonly _root: HTMLElement;
  private readonly _readout: HTMLElement;
  private readonly _sliders: SliderSpec[];

  constructor(
    private readonly _settings: HudState,
    private readonly _onChange: () => void,
  ) {
    this._sliders = [
      { key: "burstScale", label: "Spark amount", min: 0, max: 3, step: 0.05, format: percent },
      { key: "smokeScale", label: "Smoke density", min: 0, max: 2.5, step: 0.05, format: percent },
      { key: "weatherScale", label: "Precipitation", min: 0, max: 2, step: 0.05, format: percent },
    ];

    const style = document.createElement("style");
    this._style = style;
    style.textContent = `
      #particleLabReadout {
        font-family: var(--font-mono, "JetBrains Mono", monospace); font-size: 11px; line-height: 1.5;
        color: #7dd3fc; background: rgba(2, 6, 23, 0.75); border: 1px solid rgba(56, 189, 248, 0.25);
        border-radius: 6px; padding: 8px 10px; margin: 4px 0 0 0; white-space: pre;
      }
    `;
    document.head.appendChild(style);

    const times = TIME_SCALES.map(
      (t) => `<button class="btn-preset" data-time="${t}" title="Tempo ×${t}">×${t}</button>`,
    ).join("");
    const variants = PARTICLE_VARIANTS.map(
      (v) =>
        `<button class="btn-preset" data-variant="${v.id}" title="${v.hint}">${v.icon} ${v.title}</button>`,
    ).join("");
    const pools = CAMERA_POOL_IDS.map(
      (p) =>
        `<button class="btn-preset" data-pool="${p}" title="Camera pool ${p}">${p === "overview" ? "🌐" : p === "closeup" ? "🎯" : "📐"} ${p}</button>`,
    ).join("");

    this._drawer = new ShowcaseDrawer({
      id: "particle-lab-hud",
      title: "Particle Lab",
      icon: "🧪",
      toggleKeys: ["KeyI"],
      body: `
        <div class="hud-section"><pre id="particleLabReadout"></pre></div>
        ${hudSection(
          "🧨 Effect variant",
          "1–6",
          `<div class="preset-group">${variants}</div>` +
            hudNote("Each variant focuses one particle lane; the overview shows all."),
        )}
        ${hudSection("📷 Camera pool", "7–9", `<div class="preset-group">${pools}</div>`)}
        ${hudSection(
          "⚖️ Live controls",
          "",
          this._sliderRows(0, 3) +
            hudSwitch("sw_gpuAllowed", "Allow WebGPU lane") +
            hudNote("The GPU variant needs a WebGPU device; otherwise it falls back to Forge."),
        )}
        ${hudSection(
          "⏱️ Time",
          "P · T",
          `<div class="preset-group five-col">${times}</div>
           <button id="particleLabPause" class="btn-preset" style="width:100%;margin-top:6px;" title="Freeze (P)"></button>`,
        )}
        <div class="hud-section hud-keys">
          <kbd>1–6</kbd> Variant · <kbd>7–9</kbd> Camera · <kbd>P</kbd> Pause · <kbd>T</kbd> Speed · <kbd>R</kbd> Camera reset · <kbd>I</kbd> Panel · <kbd>WASD</kbd>/<kbd>Mouse</kbd> Fly
        </div>
      `,
    });
    this._root = this._drawer.root;
    this._readout = this._root.querySelector("#particleLabReadout") as HTMLElement;

    this._bind();
    this.sync();
  }

  /** Releases the shared drawer and its DOM (panel, style tag is inert after removal). */
  public dispose(): void {
    this._style.remove();
    this._drawer.dispose();
  }

  /** Writes the live status text (call a few times per second, not every frame). */
  public setReadout(text: string): void {
    if (this._readout.textContent !== text) {
      this._readout.textContent = text;
    }
  }

  /** Applies a lab shortcut. Returns true when the key was consumed. */
  public handleKey(event: KeyboardEvent): boolean {
    if (this._drawer.handleKey(event)) {
      return true;
    }
    if (!this._applyShortcut(event)) {
      return false;
    }
    this._onChange();
    this.sync();
    return true;
  }

  private _applyShortcut(event: KeyboardEvent): boolean {
    const s = this._settings;
    const variant = VARIANT_KEYS[event.code];
    if (variant) {
      s.variant = variant;
      return true;
    }
    const pool = POOL_KEYS[event.code];
    if (pool) {
      s.pool = pool;
      return true;
    }
    switch (event.code) {
      case "KeyP":
        s.paused = !s.paused;
        return true;
      case "KeyT":
        s.timeScale = this._nextTimeScale();
        s.paused = false;
        return true;
      default:
        return false;
    }
  }

  /** Reflects the current settings in every control. */
  public sync(): void {
    const s = this._settings;
    for (const key of SWITCHES) {
      const input = this._root.querySelector(`#sw_${key}`) as HTMLInputElement | null;
      if (input) input.checked = s[key];
    }
    for (const spec of this._sliders) {
      const input = this._root.querySelector(`#sl_${spec.key}`) as HTMLInputElement | null;
      const label = this._root.querySelector(`#sl_${spec.key}_val`) as HTMLElement | null;
      if (input) input.value = String(s[spec.key]);
      if (label) label.textContent = spec.format(s[spec.key]);
    }
    this._root.querySelectorAll<HTMLButtonElement>("[data-time]").forEach((btn) => {
      btn.classList.toggle("active", Number(btn.dataset["time"]) === s.timeScale);
    });
    this._root.querySelectorAll<HTMLButtonElement>("[data-variant]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset["variant"] === s.variant);
    });
    this._root.querySelectorAll<HTMLButtonElement>("[data-pool]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset["pool"] === s.pool);
    });
    const pause = this._root.querySelector("#particleLabPause") as HTMLButtonElement | null;
    if (pause) {
      pause.innerHTML = s.paused ? "▶ Resume" : "⏸ Freeze";
      pause.classList.toggle("active", s.paused);
    }
  }

  private _bind(): void {
    const s = this._settings;
    for (const key of SWITCHES) {
      const input = this._root.querySelector(`#sw_${key}`) as HTMLInputElement | null;
      input?.addEventListener("change", () => this._set(key, input.checked));
    }
    for (const spec of this._sliders) {
      const input = this._root.querySelector(`#sl_${spec.key}`) as HTMLInputElement | null;
      if (!input) continue;
      input.addEventListener("input", () => {
        s[spec.key] = Number(input.value);
        this._onChange();
        this.sync();
      });
      // Hand keyboard focus back so shortcuts and WASD keep working after dragging a slider.
      input.addEventListener("change", () => input.blur());
    }
    this._root.querySelectorAll<HTMLButtonElement>("[data-time]").forEach((btn) => {
      btn.addEventListener("click", () => {
        s.timeScale = Number(btn.dataset["time"]);
        s.paused = false;
        this._onChange();
        this.sync();
      });
    });
    this._root.querySelectorAll<HTMLButtonElement>("[data-variant]").forEach((btn) => {
      btn.addEventListener("click", () => {
        s.variant = btn.dataset["variant"] as ParticleVariantId;
        this._onChange();
        this.sync();
      });
    });
    this._root.querySelectorAll<HTMLButtonElement>("[data-pool]").forEach((btn) => {
      btn.addEventListener("click", () => {
        s.pool = btn.dataset["pool"] as CameraPoolId;
        this._onChange();
        this.sync();
      });
    });
    this._root.querySelector("#particleLabPause")?.addEventListener("click", () => {
      s.paused = !s.paused;
      this._onChange();
      this.sync();
    });
  }

  private _set(key: SwitchKey, value: boolean): void {
    this._settings[key] = value;
    this._onChange();
    this.sync();
  }

  /** Cycles 1 → 0.5 → 0.25 → 0.1 → 2 → 1: slow motion first, it is the more useful direction. */
  private _nextTimeScale(): number {
    const cycle = [1, 0.5, 0.25, 0.1, 2];
    const index = cycle.indexOf(this._settings.timeScale);
    return cycle[(index + 1) % cycle.length]!;
  }

  private _sliderRows(from: number, to: number): string {
    let html = "";
    for (let i = from; i < to; i++) {
      const spec = this._sliders[i]!;
      html += hudSlider(`sl_${spec.key}`, spec.label, spec.min, spec.max, spec.step);
    }
    return html;
  }
}
