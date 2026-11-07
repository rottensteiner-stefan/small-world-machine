import {
  ShowcaseDrawer,
  type FrameTelemetrySource,
  hudNote,
  hudSection,
  hudSlider,
  hudSwitch,
} from "../shared/ShowcaseDrawer.js";

/** Sliders the panel exposes. */
export type HelmetSlider =
  | "RotateSpeed"
  | "EmissiveIntensity"
  | "Roughness"
  | "Metallic"
  | "Clearcoat"
  | "SpotIntensity"
  | "SunIntensity"
  | "AmbientIntensity"
  | "BloomIntensity";

export type LightingPresetId = "studio" | "cyberpunk" | "highnoon" | "noir";

/** State reflected by the inspector controls. */
export interface HudState {
  preset: LightingPresetId;
  autoRotate: boolean;
  rotateSpeed: number;
  orbitSpotLight: boolean;
  emissiveIntensity: number;
  roughness: number;
  metallic: number;
  clearcoat: number;
  envMapEnabled: boolean;
  spotIntensity: number;
  sunIntensity: number;
  ambientIntensity: number;
  bloomEnabled: boolean;
  bloomIntensity: number;
}

/** Actions triggered by the inspector. */
export interface HudActions {
  applyPreset(preset: LightingPresetId): void;
  toggleAutoRotate(): void;
  toggleOrbitSpot(): void;
  toggleEnvMap(): void;
  toggleBloom(): void;
  setSlider(name: HelmetSlider, value: number): void;
  flyToCamera(view: "hero" | "macro" | "side" | "top"): void;
  resetToReference(): void;
}

const PRESETS: readonly { id: LightingPresetId; label: string }[] = [
  { id: "studio", label: "Studio" },
  { id: "cyberpunk", label: "Cyberpunk" },
  { id: "highnoon", label: "High Noon" },
  { id: "noir", label: "Noir" },
];

/**
 * Helmet Inspector panel for Showcase 13 on the shared {@link ShowcaseDrawer}.
 */
export class Hud {
  private readonly _drawer: ShowcaseDrawer;

  constructor(
    private readonly _actions: HudActions,
    engine?: FrameTelemetrySource,
  ) {
    const presetButtons = PRESETS.map(
      (p, i) =>
        `<button id="st13Preset_${p.id}" class="btn-preset" title="${p.label} Mood (Key ${i + 1})">${i + 1} · ${p.label}</button>`,
    ).join("");

    this._drawer = new ShowcaseDrawer({
      id: "helmet-inspector-drawer",
      title: "Damaged Helmet Lab",
      icon: "🪖",
      footerIcon: "⚙",
      engine,
      body: [
        hudSection(
          "💡 Lighting Moods",
          "Keys 1–4",
          `
          <div class="preset-group four-col" style="margin-bottom:8px;">${presetButtons}</div>
          ${hudSlider("st13SlSpotIntensity", "Spotlight", 0, 10, 0.1)}
          ${hudSlider("st13SlSunIntensity", "Directional Sun", 0, 5, 0.1)}
          ${hudSlider("st13SlAmbientIntensity", "Ambient Light", 0, 1, 0.02)}
        `,
        ),
        hudSection(
          "🔄 Turntable & Motion",
          "Space",
          `
          ${hudSwitch("st13SwAutoRotate", "Auto-Rotate Helmet")}
          ${hudSlider("st13SlRotateSpeed", "Turntable Speed", 0, 2.0, 0.05)}
          ${hudSwitch("st13SwOrbitSpot", "Orbit Spotlight")}
        `,
        ),
        hudSection(
          "✨ PBR Material & IBL",
          "",
          `
          ${hudSlider("st13SlEmissiveIntensity", "Visor Glow (Emissive)", 0, 5.0, 0.1)}
          ${hudSlider("st13SlRoughness", "Roughness Factor", 0, 1.0, 0.02)}
          ${hudSlider("st13SlMetallic", "Metallic Factor", 0, 1.0, 0.02)}
          ${hudSlider("st13SlClearcoat", "Clearcoat Lacquer", 0, 1.0, 0.02)}
          ${hudSwitch("st13SwEnvMap", "IBL Reflections")}
        `,
        ),
        hudSection(
          "📷 Post-Processing & Camera",
          "",
          `
          ${hudSwitch("st13SwBloom", "HDR Bloom")}
          ${hudSlider("st13SlBloomIntensity", "Bloom Intensity", 0, 4.0, 0.1)}
          <div style="display:grid;grid-template-columns:repeat(2, 1fr);gap:6px;margin-top:8px;">
            <button id="st13CamHero" class="btn-preset" title="Hero Front View">Hero Front</button>
            <button id="st13CamMacro" class="btn-preset" title="Visor Macro View">Visor Macro</button>
            <button id="st13CamSide" class="btn-preset" title="Side Contour View">Side Profile</button>
            <button id="st13CamTop" class="btn-preset" title="Dramatic Top View">Dramatic Top</button>
          </div>
        `,
        ),
        `<div style="display:flex;justify-content:flex-end;margin-top:10px;">
          <button id="st13BtnReset" class="btn-preset" style="padding:4px 12px;font-size:11px;" title="Reset all controls (Key R)">↺ Reset to Default</button>
        </div>`,
        hudNote(
          "<b>DamagedHelmet.glb</b> &mdash; Official Khronos glTF 2.0 PBR Sample Model (Battle Studio). Zero-GC PBR rendering with split-sum IBL & clustered shadows.",
        ),
      ].join(""),
    });

    this._bindEvents();
  }

  private _bindEvents(): void {
    // Preset buttons
    for (const p of PRESETS) {
      document.getElementById(`st13Preset_${p.id}`)?.addEventListener("click", () => {
        this._actions.applyPreset(p.id);
      });
    }

    // Switches
    document.getElementById("st13SwAutoRotate")?.addEventListener("change", () => {
      this._actions.toggleAutoRotate();
    });
    document.getElementById("st13SwOrbitSpot")?.addEventListener("change", () => {
      this._actions.toggleOrbitSpot();
    });
    document.getElementById("st13SwEnvMap")?.addEventListener("change", () => {
      this._actions.toggleEnvMap();
    });
    document.getElementById("st13SwBloom")?.addEventListener("change", () => {
      this._actions.toggleBloom();
    });

    // Sliders
    this._bindSlider("st13SlRotateSpeed", "RotateSpeed");
    this._bindSlider("st13SlEmissiveIntensity", "EmissiveIntensity");
    this._bindSlider("st13SlRoughness", "Roughness");
    this._bindSlider("st13SlMetallic", "Metallic");
    this._bindSlider("st13SlClearcoat", "Clearcoat");
    this._bindSlider("st13SlSpotIntensity", "SpotIntensity");
    this._bindSlider("st13SlSunIntensity", "SunIntensity");
    this._bindSlider("st13SlAmbientIntensity", "AmbientIntensity");
    this._bindSlider("st13SlBloomIntensity", "BloomIntensity");

    // Camera buttons
    document.getElementById("st13CamHero")?.addEventListener("click", () => {
      this._actions.flyToCamera("hero");
    });
    document.getElementById("st13CamMacro")?.addEventListener("click", () => {
      this._actions.flyToCamera("macro");
    });
    document.getElementById("st13CamSide")?.addEventListener("click", () => {
      this._actions.flyToCamera("side");
    });
    document.getElementById("st13CamTop")?.addEventListener("click", () => {
      this._actions.flyToCamera("top");
    });

    // Reset button
    document.getElementById("st13BtnReset")?.addEventListener("click", () => {
      this._actions.resetToReference();
    });
  }

  private _bindSlider(id: string, name: HelmetSlider): void {
    const el = document.getElementById(id) as HTMLInputElement | null;
    if (!el) return;
    el.addEventListener("input", () => {
      const val = parseFloat(el.value);
      if (!Number.isNaN(val)) {
        this._actions.setSlider(name, val);
      }
    });
  }

  /**
   * Synchronizes the UI controls with the current state without triggering event callbacks.
   */
  public sync(state: HudState): void {
    // Preset active highlight
    for (const p of PRESETS) {
      const btn = document.getElementById(`st13Preset_${p.id}`);
      if (btn) {
        if (state.preset === p.id) {
          btn.classList.add("active");
        } else {
          btn.classList.remove("active");
        }
      }
    }

    // Switches
    this._syncCheckbox("st13SwAutoRotate", state.autoRotate);
    this._syncCheckbox("st13SwOrbitSpot", state.orbitSpotLight);
    this._syncCheckbox("st13SwEnvMap", state.envMapEnabled);
    this._syncCheckbox("st13SwBloom", state.bloomEnabled);

    // Sliders
    this._syncSlider("st13SlRotateSpeed", state.rotateSpeed, `${state.rotateSpeed.toFixed(2)}x`);
    this._syncSlider(
      "st13SlEmissiveIntensity",
      state.emissiveIntensity,
      `${state.emissiveIntensity.toFixed(1)}x`,
    );
    this._syncSlider("st13SlRoughness", state.roughness, state.roughness.toFixed(2));
    this._syncSlider("st13SlMetallic", state.metallic, state.metallic.toFixed(2));
    this._syncSlider("st13SlClearcoat", state.clearcoat, state.clearcoat.toFixed(2));
    this._syncSlider(
      "st13SlSpotIntensity",
      state.spotIntensity,
      `${state.spotIntensity.toFixed(1)}`,
    );
    this._syncSlider("st13SlSunIntensity", state.sunIntensity, `${state.sunIntensity.toFixed(1)}`);
    this._syncSlider(
      "st13SlAmbientIntensity",
      state.ambientIntensity,
      `${state.ambientIntensity.toFixed(2)}`,
    );
    this._syncSlider(
      "st13SlBloomIntensity",
      state.bloomIntensity,
      `${state.bloomIntensity.toFixed(1)}`,
    );
  }

  private _syncCheckbox(id: string, checked: boolean): void {
    const el = document.getElementById(id) as HTMLInputElement | null;
    if (el) el.checked = checked;
  }

  private _syncSlider(id: string, value: number, label: string): void {
    const el = document.getElementById(id) as HTMLInputElement | null;
    if (el) el.value = String(value);
    const valEl = document.getElementById(`${id}_val`);
    if (valEl) valEl.textContent = label;
  }

  public toggle(): void {
    this._drawer.toggle();
  }

  /** Removes the drawer and its footer button (showcase teardown). */
  public dispose(): void {
    this._drawer.dispose();
  }
}
