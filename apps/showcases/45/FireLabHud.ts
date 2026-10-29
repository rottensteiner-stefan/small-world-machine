/** Colour override for every fire; "original" keeps each fire's own palette. */
export type PaletteChoice = "original" | "blackbody" | "spectral" | "wisp" | "cursed";

/** Everything the viewer can change in the Fire VFX lab. */
export interface FireLabSettings {
  flicker: boolean;
  flame: boolean;
  glow: boolean;
  lights: boolean;
  bloom: boolean;
  paused: boolean;
  timeScale: number;
  palette: PaletteChoice;
  temperatureScale: number;
  intensityScale: number;
  turbulenceScale: number;
  flowScale: number;
  windAngleDeg: number;
  windStrength: number;
  maxActiveLights: number;
  showBudget: boolean;
  daylight: boolean;
}

export function defaultFireLabSettings(maxActiveLights: number): FireLabSettings {
  return {
    flicker: true,
    flame: true,
    glow: true,
    lights: true,
    bloom: true,
    paused: false,
    timeScale: 1,
    palette: "original",
    temperatureScale: 1,
    intensityScale: 1,
    turbulenceScale: 1,
    flowScale: 1,
    windAngleDeg: 0,
    windStrength: 0,
    maxActiveLights,
    showBudget: false,
    daylight: false,
  };
}

const TIME_SCALES = [0.1, 0.25, 0.5, 1, 2];
const PALETTE_KEYS: Record<string, PaletteChoice> = {
  Digit0: "original",
  Digit1: "blackbody",
  Digit2: "spectral",
  Digit3: "wisp",
  Digit4: "cursed",
};
const SWITCHES = ["flicker", "flame", "glow", "lights", "bloom", "showBudget", "daylight"] as const;
type SwitchKey = (typeof SWITCHES)[number];

interface SliderSpec {
  readonly key:
    | "temperatureScale"
    | "intensityScale"
    | "turbulenceScale"
    | "flowScale"
    | "windStrength"
    | "windAngleDeg"
    | "maxActiveLights";
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly format: (value: number) => string;
}

const percent = (value: number): string => `${Math.round(value * 100)} %`;

/**
 * Side drawer of showcase 45 (shared `swm-inspector-drawer` look). Owns only the DOM and the
 * settings object; the showcase reads the settings and applies them in `onChange`.
 */
export class FireLabHud {
  private readonly _root: HTMLElement;
  private readonly _toggleButton: HTMLButtonElement;
  private readonly _readout: HTMLElement;
  private readonly _sliders: SliderSpec[];

  constructor(
    private readonly _settings: FireLabSettings,
    totalFires: number,
    private readonly _onChange: () => void,
  ) {
    this._sliders = [
      {
        key: "temperatureScale",
        label: "Temperatur",
        min: 0.6,
        max: 1.75,
        step: 0.01,
        format: (v: number): string => `${Math.round(2000 * v)} K`,
      },
      { key: "intensityScale", label: "Intensität", min: 0, max: 2.5, step: 0.05, format: percent },
      { key: "turbulenceScale", label: "Unruhe", min: 0, max: 2.5, step: 0.05, format: percent },
      {
        key: "flowScale",
        label: "Flussgeschwindigkeit",
        min: 0,
        max: 3,
        step: 0.05,
        format: percent,
      },
      { key: "windStrength", label: "Windstärke", min: 0, max: 1, step: 0.05, format: percent },
      {
        key: "windAngleDeg",
        label: "Windrichtung",
        min: 0,
        max: 345,
        step: 15,
        format: (v: number): string => `${v}°`,
      },
      {
        key: "maxActiveLights",
        label: "Licht-Budget",
        min: 0,
        max: totalFires,
        step: 1,
        format: (v: number): string => `${v} / ${totalFires}`,
      },
    ];

    const style = document.createElement("style");
    style.textContent = `
      #fire-lab-hud .preset-group.five-col { grid-template-columns: repeat(5, 1fr); }
      #fire-lab-hud .preset-group.four-col { grid-template-columns: repeat(4, 1fr); }
      #fire-lab-hud .hud-note { font-size: 10px; line-height: 1.4; color: #94a3b8; margin-top: 6px; }
      #fire-lab-hud .hud-keys { font-size: 10px; line-height: 1.7; color: #94a3b8; }
      #fire-lab-hud .hud-keys kbd {
        font-family: var(--font-mono, "JetBrains Mono", monospace);
        border: 1px solid rgba(148, 163, 184, 0.35); border-radius: 3px; padding: 0 4px;
      }
      #fireLabReadout {
        font-family: var(--font-mono, "JetBrains Mono", monospace); font-size: 11px; line-height: 1.5;
        color: #fdba74; background: rgba(2, 6, 23, 0.75); border: 1px solid rgba(251, 146, 60, 0.25);
        border-radius: 6px; padding: 8px 10px; margin: 4px 0 0 0; white-space: pre;
      }
    `;
    document.head.appendChild(style);

    const root = document.createElement("aside");
    root.id = "fire-lab-hud";
    root.className = "swm-inspector-drawer open";
    root.innerHTML = `
      <div class="bottom-sheet-grabber"></div>
      <div class="hud-header">
        <div class="hud-title"><span>🔥</span> Fire Lab</div>
        <button id="fireLabClose" class="hud-close-btn" title="Panel schließen (I / H)">✕</button>
      </div>
      <div class="hud-body">
        <div class="hud-section">
          <pre id="fireLabReadout"></pre>
        </div>
        <div class="hud-section">
          <div class="section-title"><span>⚖️ Vorher / Nachher</span><span style="font-size:9px;color:#64748b;">F · G · L</span></div>
          ${this._switchRow("flicker", "Flackern (Licht)")}
          ${this._switchRow("flame", "Flammenkörper")}
          ${this._switchRow("glow", "Glow-Halo")}
          ${this._switchRow("lights", "Punktlichter")}
          ${this._switchRow("bloom", "Bloom")}
          <div class="hud-note">💡 Schalte das Flackern aus: Ein starres Licht wirkt sofort wie eine Glühbirne.</div>
        </div>
        <div class="hud-section">
          <div class="section-title"><span>⏱️ Zeit</span><span style="font-size:9px;color:#64748b;">P · T</span></div>
          <div class="preset-group five-col">
            ${TIME_SCALES.map((s) => `<button class="btn-preset" data-time="${s}" title="Tempo ×${s}">×${s}</button>`).join("")}
          </div>
          <button id="fireLabPause" class="btn-preset" style="width:100%;margin-top:6px;" title="Einfrieren (P)"></button>
        </div>
        <div class="hud-section">
          <div class="section-title"><span>🎨 Farbe</span><span style="font-size:9px;color:#64748b;">0–4</span></div>
          <div class="preset-group five-col">
            <button class="btn-preset" data-palette="original" title="Jedes Feuer in seiner Farbe (0)">Orig.</button>
            <button class="btn-preset" data-palette="blackbody" title="Blackbody / Temperatur (1)">🔥</button>
            <button class="btn-preset" data-palette="spectral" title="Spectral, Gespensterblau (2)">👻</button>
            <button class="btn-preset" data-palette="wisp" title="Wisp, Irrlichtgrün (3)">🍀</button>
            <button class="btn-preset" data-palette="cursed" title="Cursed, Violett (4)">🔮</button>
          </div>
          <div class="hud-note">Temperatur wirkt nur auf Blackbody-Feuer; Paletten sind freie Farben.</div>
        </div>
        <div class="hud-section">
          <div class="section-title"><span>🕯️ Flamme</span><span style="font-size:9px;color:#64748b;">alle Feuer</span></div>
          ${this._sliderRow(0)}${this._sliderRow(1)}${this._sliderRow(2)}${this._sliderRow(3)}
        </div>
        <div class="hud-section">
          <div class="section-title"><span>🌬️ Wind</span><span style="font-size:9px;color:#64748b;">, . Richtung · + − Stärke</span></div>
          ${this._sliderRow(4)}${this._sliderRow(5)}
        </div>
        <div class="hud-section">
          <div class="section-title"><span>💡 Licht-Budget</span><span style="font-size:9px;color:#64748b;">V</span></div>
          ${this._sliderRow(6)}
          ${this._switchRow("showBudget", "Feuer ohne Licht markieren")}
          <div class="hud-note">WebGL1/2 schattieren nur 16 Punktlichter. Fliege seitlich die Fackelreihe entlang und sieh zu, wie die Lichter weitergereicht werden.</div>
        </div>
        <div class="hud-section">
          <div class="section-title"><span>🌗 Umgebung</span><span style="font-size:9px;color:#64748b;">N</span></div>
          ${this._switchRow("daylight", "Tageslicht")}
        </div>
        <div class="hud-section hud-keys">
          <kbd>F</kbd> Flackern · <kbd>G</kbd> Glow · <kbd>L</kbd> Lichter · <kbd>P</kbd> Pause · <kbd>T</kbd> Tempo ·
          <kbd>0–4</kbd> Farbe · <kbd>,</kbd><kbd>.</kbd> Windrichtung · <kbd>+</kbd><kbd>−</kbd> Windstärke · <kbd>V</kbd> Budget ·
          <kbd>N</kbd> Tag/Nacht · <kbd>I</kbd> Panel · <kbd>WASD</kbd> Fliegen
        </div>
      </div>
    `;
    document.body.appendChild(root);
    this._root = root;
    this._readout = root.querySelector("#fireLabReadout") as HTMLElement;

    // Keep clicks and drags inside the panel from reaching the fly camera.
    for (const eventName of [
      "mousedown",
      "mouseup",
      "mousemove",
      "pointerdown",
      "pointerup",
      "pointermove",
      "click",
      "dblclick",
      "contextmenu",
    ]) {
      root.addEventListener(eventName, (e: Event): void => e.stopPropagation());
    }
    root.addEventListener("wheel", (e: Event): void => e.stopPropagation(), { passive: true });

    this._toggleButton = document.createElement("button");
    this._toggleButton.className = "swm-inspector-btn active";
    this._toggleButton.innerHTML = "<span>🔥</span>";
    this._toggleButton.title = "Fire Lab (I / H)";
    this._toggleButton.setAttribute("aria-label", "Fire Lab ein-/ausblenden");
    this._toggleButton.onclick = (): void => this.toggle();
    (document.querySelector(".app-footer") ?? document.body).appendChild(this._toggleButton);

    this._bind();
    this.sync();
  }

  /** Shows or hides the drawer. */
  public toggle(force?: boolean): void {
    const open = force ?? !this._root.classList.contains("open");
    this._root.classList.toggle("open", open);
    this._toggleButton.classList.toggle("active", open);
  }

  /** Writes the live status text (call a few times per second, not every frame). */
  public setReadout(text: string): void {
    if (this._readout.textContent !== text) {
      this._readout.textContent = text;
    }
  }

  /**
   * Applies a lab shortcut. Returns true when the key was consumed.
   */
  public handleKey(event: KeyboardEvent): boolean {
    if (!this._applyShortcut(event)) {
      return false;
    }
    this.sync();
    this._onChange();
    return true;
  }

  // Symbols go by `event.key`, letters and digits by `event.code`: on a German Mac layout "=" and
  // "[ ]" need Alt or don't exist, while "+ - , ." are plain keys on both DE and US.
  private _applyShortcut(event: KeyboardEvent): boolean {
    const s = this._settings;
    switch (event.key) {
      case ",":
        s.windAngleDeg = (s.windAngleDeg + 345) % 360;
        return true;
      case ".":
        s.windAngleDeg = (s.windAngleDeg + 15) % 360;
        return true;
      case "-":
        s.windStrength = Math.max(0, Math.round((s.windStrength - 0.1) * 10) / 10);
        return true;
      case "+":
      case "=":
        s.windStrength = Math.min(1, Math.round((s.windStrength + 0.1) * 10) / 10);
        return true;
    }
    const palette = PALETTE_KEYS[event.code];
    if (palette) {
      s.palette = palette;
      return true;
    }
    switch (event.code) {
      case "KeyF":
        s.flicker = !s.flicker;
        return true;
      case "KeyG":
        s.glow = !s.glow;
        return true;
      case "KeyL":
        s.lights = !s.lights;
        return true;
      case "KeyV":
        s.showBudget = !s.showBudget;
        return true;
      case "KeyN":
        s.daylight = !s.daylight;
        return true;
      case "KeyP":
        s.paused = !s.paused;
        return true;
      case "KeyT":
        s.timeScale = this._nextTimeScale();
        s.paused = false;
        return true;
      case "KeyI":
      case "KeyH":
        this.toggle();
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
      const label = this._root.querySelector(`#val_${spec.key}`) as HTMLElement | null;
      if (input) input.value = String(s[spec.key]);
      if (label) label.textContent = spec.format(s[spec.key]);
    }
    this._root.querySelectorAll<HTMLButtonElement>("[data-time]").forEach((btn) => {
      btn.classList.toggle("active", Number(btn.dataset["time"]) === s.timeScale);
    });
    this._root.querySelectorAll<HTMLButtonElement>("[data-palette]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset["palette"] === s.palette);
    });
    const pause = this._root.querySelector("#fireLabPause") as HTMLButtonElement | null;
    if (pause) {
      pause.innerHTML = s.paused ? "▶ Weiter" : "⏸ Einfrieren";
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
        this.sync();
        this._onChange();
      });
      // Hand keyboard focus back so shortcuts and WASD keep working after dragging a slider.
      input.addEventListener("change", () => input.blur());
    }
    this._root.querySelectorAll<HTMLButtonElement>("[data-time]").forEach((btn) => {
      btn.addEventListener("click", () => {
        s.timeScale = Number(btn.dataset["time"]);
        s.paused = false;
        this.sync();
        this._onChange();
      });
    });
    this._root.querySelectorAll<HTMLButtonElement>("[data-palette]").forEach((btn) => {
      btn.addEventListener("click", () => {
        s.palette = btn.dataset["palette"] as PaletteChoice;
        this.sync();
        this._onChange();
      });
    });
    this._root.querySelector("#fireLabPause")?.addEventListener("click", () => {
      s.paused = !s.paused;
      this.sync();
      this._onChange();
    });
    this._root.querySelector("#fireLabClose")?.addEventListener("click", () => this.toggle(false));
  }

  private _set(key: SwitchKey, value: boolean): void {
    this._settings[key] = value;
    this.sync();
    this._onChange();
  }

  /** Cycles 1 → 0.5 → 0.25 → 0.1 → 2 → 1: slow motion first, it is the more useful direction. */
  private _nextTimeScale(): number {
    const cycle = [1, 0.5, 0.25, 0.1, 2];
    const index = cycle.indexOf(this._settings.timeScale);
    return cycle[(index + 1) % cycle.length]!;
  }

  private _switchRow(key: SwitchKey, label: string): string {
    return `
      <div class="hud-row">
        <label for="sw_${key}">${label}</label>
        <label class="hud-switch"><input type="checkbox" id="sw_${key}"><span class="hud-switch-slider"></span></label>
      </div>`;
  }

  private _sliderRow(index: number): string {
    const spec = this._sliders[index]!;
    return `
      <div class="hud-row">
        <label for="sl_${spec.key}">${spec.label}</label>
        <input id="sl_${spec.key}" type="range" min="${spec.min}" max="${spec.max}" step="${spec.step}" />
        <span id="val_${spec.key}" class="val-label"></span>
      </div>`;
  }
}
