import {
  ShowcaseDrawer,
  hudNote,
  hudSection,
  hudSlider,
  hudSwitch,
} from "../shared/ShowcaseDrawer.js";

/** Target choices for the LookAt surveillance spotlight. */
export type TrackingTarget = "ship" | "crystal" | "companion" | "origin";

/** Everything the viewer can tweak in the Behavior Lab. */
export interface BehaviorLabSettings {
  // Crystal
  bobbing: boolean;
  bobbingAmp: number;
  bobbingFreq: number;
  rotator: boolean;
  rotatorSpeed: number;
  rainbow: boolean;
  rainbowSpeed: number;

  // Spaceship
  patrol: boolean;
  patrolDuration: number;
  patrolPingPong: boolean;
  patrolLookForward: boolean;
  flicker: boolean;
  trail: boolean;

  // Companion
  companion: boolean;
  companionLerp: number;
  companionDistance: number;

  // Spotlight
  spotlight: boolean;
  spotlightTarget: TrackingTarget;
  spotlightAngle: number;
  spotlightIntensity: number;

  // Post-Processing
  bloom: boolean;
  bloomIntensity: number;
}

export function defaultBehaviorLabSettings(): BehaviorLabSettings {
  return {
    bobbing: true,
    bobbingAmp: 1.0,
    bobbingFreq: 2.0,
    rotator: true,
    rotatorSpeed: 1.0,
    rainbow: true,
    rainbowSpeed: 0.2,

    patrol: true,
    patrolDuration: 10.0,
    patrolPingPong: false,
    patrolLookForward: true,
    flicker: true,
    trail: true,

    companion: true,
    companionLerp: 0.05,
    companionDistance: 5.0,

    spotlight: true,
    spotlightTarget: "ship",
    spotlightAngle: Math.PI / 8, // ~0.39 rad = 22.5 deg
    spotlightIntensity: 100.0,

    bloom: true,
    bloomIntensity: 2.5,
  };
}

const SWITCHES = [
  "bobbing",
  "rotator",
  "rainbow",
  "patrol",
  "patrolLookForward",
  "patrolPingPong",
  "flicker",
  "trail",
  "companion",
  "spotlight",
  "bloom",
] as const;

interface SliderConfig {
  readonly id: string;
  readonly key: keyof BehaviorLabSettings;
  readonly format: (val: number) => string;
}

const SLIDERS: readonly SliderConfig[] = [
  { id: "sl_bobAmp", key: "bobbingAmp", format: (v) => `${v.toFixed(1)} m` },
  { id: "sl_bobFreq", key: "bobbingFreq", format: (v) => `${v.toFixed(1)} Hz` },
  { id: "sl_rotSpeed", key: "rotatorSpeed", format: (v) => `${v.toFixed(1)}×` },
  { id: "sl_rainSpeed", key: "rainbowSpeed", format: (v) => v.toFixed(2) },
  { id: "sl_patrolDur", key: "patrolDuration", format: (v) => `${v.toFixed(1)} s` },
  { id: "sl_compLerp", key: "companionLerp", format: (v) => v.toFixed(2) },
  { id: "sl_compDist", key: "companionDistance", format: (v) => `${v.toFixed(1)} m` },
  {
    id: "sl_spotAngle",
    key: "spotlightAngle",
    format: (v) => `${((v * 180) / Math.PI).toFixed(0)}°`,
  },
  { id: "sl_spotInt", key: "spotlightIntensity", format: (v) => v.toFixed(0) },
  { id: "sl_bloomInt", key: "bloomIntensity", format: (v) => v.toFixed(1) },
];

/**
 * Behavior Lab inspector for Showcase 20.
 */
export class BehaviorLabHud {
  private readonly _drawer: ShowcaseDrawer;
  private readonly _root: HTMLElement;
  private readonly _settings: BehaviorLabSettings;
  private readonly _onChange: (settings: BehaviorLabSettings) => void;

  constructor(
    initialSettings: BehaviorLabSettings,
    onChange: (settings: BehaviorLabSettings) => void,
  ) {
    this._settings = { ...initialSettings };
    this._onChange = onChange;

    this._drawer = new ShowcaseDrawer({
      id: "behavior-lab-hud",
      title: "Behavior Lab",
      icon: "🕹️",
      badge: "Showcase 20",
      open: false,
      footerIcon: "⚙",
      buttonId: "behaviorLabHudBtn",
      shieldKeys: true,
      body: `
        ${hudSection(
          "🔮 Kristall",
          "Bobbing · Rotator · Rainbow",
          hudSwitch("sw_bobbing", "Bobbing aktiv") +
            hudSlider("sl_bobAmp", "Amplitude", 0.0, 3.0, 0.1) +
            hudSlider("sl_bobFreq", "Frequenz", 0.2, 5.0, 0.1) +
            hudSwitch("sw_rotator", "Rotation aktiv") +
            hudSlider("sl_rotSpeed", "Drehtempo", 0.0, 3.0, 0.1) +
            hudSwitch("sw_rainbow", "Regenbogen-Farbe") +
            hudSlider("sl_rainSpeed", "Farbwechsel-Tempo", 0.05, 1.5, 0.05),
        )}

        ${hudSection(
          "🚀 Raumschiff-Patrouille",
          "Spline · Flicker · Trail",
          hudSwitch("sw_patrol", "Flugbahn (Catmull-Rom)") +
            hudSlider("sl_patrolDur", "Umlaufzeit", 2.0, 30.0, 0.5) +
            hudSwitch("sw_patrolLookForward", "In Flugrichtung blicken") +
            hudSwitch("sw_patrolPingPong", "Ping-Pong Modus") +
            hudSwitch("sw_flicker", "Triebwerks-Flackern") +
            hudSwitch("sw_trail", "Lichtschweif (TrailRenderer)"),
        )}

        ${hudSection(
          "🔵 Begleiter",
          "SpringLerp · Dämpfung",
          hudSwitch("sw_companion", "Begleiter aktiv") +
            hudSlider("sl_compLerp", "Elastizität (lerpFactor)", 0.01, 0.4, 0.01) +
            hudSlider("sl_compDist", "Kamera-Distanz", 2.0, 15.0, 0.5) +
            hudNote("Folgt der Kamera mit weicher Trägheitsdämpfung via SpringLerpBehavior."),
        )}

        ${hudSection(
          "🔦 Suchscheinwerfer",
          "LookAt · Spotlight",
          hudSwitch("sw_spotlight", "Scheinwerfer aktiv") +
            `<div class="hud-row" style="flex-direction:column;align-items:stretch;gap:6px;margin:6px 0 8px 0;">
              <span style="font-size:11px;color:#94a3b8;">Tracking-Ziel (LookAt):</span>
              <div class="preset-group two-col" id="spotlightTargetGroup">
                <button class="btn-preset active" data-target="ship">🚀 Schiff</button>
                <button class="btn-preset" data-target="crystal">🔮 Kristall</button>
                <button class="btn-preset" data-target="companion">🔵 Begleiter</button>
                <button class="btn-preset" data-target="origin">🎯 Zentrum</button>
              </div>
            </div>` +
            hudSlider("sl_spotAngle", "Lichtkegel", 0.1, 0.75, 0.02) +
            hudSlider("sl_spotInt", "Intensität", 0, 300, 10) +
            hudNote("Richtet sich in jedem Frame auf das Ziel aus via LookAtBehavior."),
        )}

        ${hudSection(
          "✨ Post-Processing",
          "HDR Bloom",
          hudSwitch("sw_bloom", "Bloom aktivieren") +
            hudSlider("sl_bloomInt", "Bloom-Stärke", 0.0, 5.0, 0.1),
        )}

        <div class="hud-section hud-keys">
          <kbd>I</kbd> / <kbd>H</kbd> Panel umschalten · <kbd>Drag</kbd> Orbit-Kamera · <kbd>Wheel</kbd> Zoom
        </div>
      `,
    });

    this._root = this._drawer.root;
    this._bind();
    this.sync();
  }

  public get settings(): BehaviorLabSettings {
    return this._settings;
  }

  public handleKey(event: KeyboardEvent): boolean {
    return this._drawer.handleKey(event);
  }

  public sync(): void {
    // 1. Sync switches
    for (const key of SWITCHES) {
      const input = this._root.querySelector<HTMLInputElement>(`#sw_${key}`);
      if (input) {
        input.checked = Boolean(this._settings[key as keyof BehaviorLabSettings]);
      }
    }

    // 2. Sync sliders and their value labels
    for (const s of SLIDERS) {
      const input = this._root.querySelector<HTMLInputElement>(`#${s.id}`);
      const valLabel = this._root.querySelector<HTMLElement>(`#${s.id}_val`);
      const val = Number(this._settings[s.key]);
      if (input) {
        input.value = String(val);
      }
      if (valLabel) {
        valLabel.textContent = s.format(val);
      }
    }

    // 3. Sync target buttons
    const targetButtons = this._root.querySelectorAll<HTMLButtonElement>(
      "#spotlightTargetGroup button",
    );
    targetButtons.forEach((btn) => {
      const isSelected = btn.dataset["target"] === this._settings.spotlightTarget;
      btn.classList.toggle("active", isSelected);
    });
  }

  private _bind(): void {
    // 1. Bind switches
    for (const key of SWITCHES) {
      const input = this._root.querySelector<HTMLInputElement>(`#sw_${key}`);
      input?.addEventListener("change", () => {
        (this._settings as unknown as Record<string, boolean>)[key] = input.checked;
        this._onChange(this._settings);
      });
    }

    // 2. Bind sliders
    for (const s of SLIDERS) {
      const input = this._root.querySelector<HTMLInputElement>(`#${s.id}`);
      input?.addEventListener("input", () => {
        const val = parseFloat(input.value);
        (this._settings as unknown as Record<string, number>)[s.key] = val;
        const valLabel = this._root.querySelector<HTMLElement>(`#${s.id}_val`);
        if (valLabel) {
          valLabel.textContent = s.format(val);
        }
        this._onChange(this._settings);
      });
    }

    // 3. Bind target buttons
    const targetGroup = this._root.querySelector("#spotlightTargetGroup");
    targetGroup?.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
      if (!btn || !btn.dataset["target"]) return;
      this._settings.spotlightTarget = btn.dataset["target"] as TrackingTarget;
      this.sync();
      this._onChange(this._settings);
    });
  }
}
