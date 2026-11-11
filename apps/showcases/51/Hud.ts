import { ShowcaseDrawer, hudNote, hudSection } from "../shared/ShowcaseDrawer.js";
import { CAMERA_PATH_NAMES, type PathName } from "./CameraPaths.js";

/**
 * Measurement HUD of Showcase 51 (vegetation rig, ADR 0059 step 0). Built on the shared
 * {@link ShowcaseDrawer} exactly like the 45/46 labs; owns only its content and wiring.
 *
 * Surface (mirrored from the 45/46 Hud pattern): `VEG_HUD_TOGGLE_KEYS`, `Hud.handleKey`,
 * `Hud.sync`, `Hud.setReadout`, `Hud.dispose`.
 *
 * HUD-FREE MODES (golden / `?frames` / `?truth`): the showcase MUST NOT construct this Hud in
 * those modes (same gating as showcase 45: `if (golden) ... else new Hud(...)`). The HUD is pure
 * overlay DOM -- it never touches the render path -- but golden byte-identity requires it to not
 * exist at capture time. See {@link hudFreeMode} for the mode predicate.
 *
 * GPU ms contract: this module defines {@link HudGpuTimings} as its LOCAL structural interface of
 * the opt-in engine GPU timing ring (`renderer.gpuTimings`, P0-1 / S1, Bob). The integration layer
 * adapts whatever the engine ships to this shape when calling {@link HudOptions}; every read is
 * guarded (`hudReadGpuMs`), so an absent/unsupported/unresolved ring degrades to `--`, never throws.
 */
export interface HudGpuTimings {
  /** Whether the timing ring was armed (timestamp-query feature present and enabled). */
  readonly available: boolean;
  /** Total GPU time of the last fully resolved frame in ms; < 0 while unresolved. */
  readonly lastFrameMs: number;
  /** Per-pass GPU time in ms (pass name -> ms); values < 0 mean "unresolved". */
  readonly passesMs: Readonly<Record<string, number>>;
}

/** Live measurement readout the call site pushes at HUD refresh rate (~4 Hz). */
export interface VegHudStats {
  /** `?n=` value (requested instance count). */
  readonly instances: number;
  /** Scatter mode label (e.g. `autoinst` | `instanced` | `field`). */
  readonly mode: string;
  /** Frames per second, smoothed. */
  readonly fps: number;
  /** CPU frame time in ms (engine `lastCpuTimeMs`); < 0 when unavailable. */
  readonly cpuMs: number;
  /** GPU frame time in ms (from the timing ring); the HUD overrides this with the ring when present. */
  readonly gpuMs: number;
  /** Visible instances/objects this frame; < 0 when n/a. */
  readonly visible: number;
  /** Triangles drawn this frame; < 0 when n/a. */
  readonly triangles: number;
  /** Live field-lane wind state (true = wind applying, false = hard wind-off). */
  readonly wind: boolean;
  /** Ground-cover ring instances this frame (ADR 0059 step 1b; 0 when the cover is inactive). */
  readonly cover: number;
  /** Live TAA state (`?taa=1` arms the engine `TaaElement`; dither-mode sighting condition). */
  readonly taa: boolean;
  /** Optional P2 LOD-transition live state of the field lane (ADR 0059 step 2); absent when the
   *  field lane is inactive. `band` 0 = candidate C (hard switch), > 0 = candidate A band.
   *  `mode` = DECISIVE MODE SWITCH preset name when one is armed (absent = legacy raw-knob mode). */
  readonly lod?: {
    readonly mode?: string;
    readonly band: number;
    readonly hyst: number;
    readonly biasPx: number;
  };
}

export interface VegHudOptions {
  /** Engine GPU timing ring, adapted to {@link HudGpuTimings}; `null`/`undefined` = unsupported. */
  gpuTimings?: HudGpuTimings | null;
  /** CPU frame time in ms; mirrors the ShowcaseDrawer telemetry footer (`getCpuTime`). */
  getCpuTime?: (() => number) | undefined;
  /** Called when the user switches the camera path (keys 1-3 or the buttons). */
  onSelectPath(path: PathName): void;
  /** Leaves the active camera path and hands the camera to the free fly controller (`0`). */
  onFreeFly(): void;
  /** Camera mode at load (`?path=` value, absent = free fly). */
  initialPath?: PathName;
  /** Called when the user toggles the field-lane wind (key `F` or the button). */
  onToggleWind?(): void;
  /** Called when the user cycles the P2 LOD transition mode (candidate A <-> C; key `L` or the
   *  button). No-op when the host engine / field lane predates the P2 surface. */
  onCycleLodMode?(): void;
}

/** Drawer toggle shortcuts. `H` opens/closes the panel (ADR step 0 layout: keys 1-3 + H). */
export const VEG_HUD_TOGGLE_KEYS: readonly string[] = ["KeyI", "KeyH"];

/** Camera mode of the lab: one of the seeded paths or the free 6-DOF fly camera. */
type CameraMode = PathName | "fly";

const PATH_KEY_MAP: Readonly<Record<string, CameraMode>> = {
  Digit0: "fly",
  Digit1: "walk",
  Digit2: "flight",
  Digit3: "aerial",
};

/** Reads the total GPU ms from a ring object with full guards; -1 on any degradation. */
function hudReadGpuMs(timings: HudGpuTimings | null | undefined): number {
  try {
    if (!timings || timings.available !== true) return -1;
    const ms = timings.lastFrameMs;
    return typeof ms === "number" && Number.isFinite(ms) && ms >= 0 ? ms : -1;
  } catch {
    return -1;
  }
}

/**
 * True for the modes in which this HUD must not exist: golden capture (`__golden`), automated
 * measurement (`measure`/`frames`/`truth`). Byte-identical golden output is only guaranteed when
 * the call site consults this before constructing the Hud.
 */
export function hudFreeMode(search: string): boolean {
  const params = new URLSearchParams(search);
  return params.has("__golden") || params.has("frames") || params.has("truth");
}

/** Formats one ms value; `--` for unavailable. */
function fmtMs(ms: number): string {
  return ms >= 0 ? `${ms.toFixed(1)} ms` : "--";
}

/** Formats a count; `--` for unavailable. */
function fmtCount(value: number): string {
  return value >= 0 ? value.toLocaleString("en-US") : "--";
}

/**
 * Vegetation measurement panel of showcase 51. Owns only its controls, the displayed metrics and
 * the path selection; the showcase reads nothing back from it except via {@link VegHudOptions}.
 */
export class Hud {
  private readonly _drawer: ShowcaseDrawer;
  private readonly _style: HTMLStyleElement;
  private readonly _root: HTMLElement;
  private readonly _readout: HTMLElement;
  private readonly _options: VegHudOptions;
  private _path: CameraMode;
  private _lastStats: VegHudStats | undefined;

  constructor(options: VegHudOptions) {
    this._path = options.initialPath ?? "fly";
    this._options = options;

    const style = document.createElement("style");
    this._style = style;
    style.textContent = `
      #vegLabReadout {
        font-family: var(--font-mono, "JetBrains Mono", monospace); font-size: 11px; line-height: 1.5;
        color: #a7f3d0; background: rgba(2, 23, 12, 0.8); border: 1px solid rgba(52, 211, 153, 0.3);
        border-radius: 6px; padding: 8px 10px; margin: 0 0 8px 0; white-space: pre-wrap; overflow-wrap: anywhere;
      }
      #vegLabReadout .hud-metric-line { color: #ecfdf5; font-weight: 600; }
    `;
    document.head.appendChild(style);

    const paths =
      CAMERA_PATH_NAMES.map(
        (name) =>
          `<button class="btn-preset" data-path="${name}" title="Camera path ${name} (${
            name === "flight" ? "fast flight, pop-sensitive" : name
          })">${name === "walk" ? "🚶" : name === "flight" ? "✈️" : "🚁"} ${name}</button>`,
      ).join("") +
      `<button class="btn-preset" data-path="fly" title="Free fly: WASD + mouse look, Space/C up/down, Shift boost">🕹️ fly</button>`;

    this._drawer = new ShowcaseDrawer({
      id: "veg-lab-hud",
      title: "Vegetation Lab",
      icon: "🌲",
      toggleKeys: VEG_HUD_TOGGLE_KEYS,
      getCpuTime: options.getCpuTime,
      body: `
        <div class="hud-section"><pre id="vegLabReadout"></pre></div>
        ${hudSection(
          "📷 Camera",
          "0 · 1 · 2 · 3",
          `<div class="preset-group">${paths}</div>` +
            hudNote(
              "Seeded paths walk / fast flight / aerial (1–3, ADR 0059 step 0) or free fly (0: WASD + mouse, Space/C, Shift boost).",
            ),
        )}
        ${hudSection(
          "🌬️ Wind",
          "F",
          `<div class="preset-group"><button class="btn-preset" data-wind>Wind: on</button></div>` +
            hudNote(
              "Field-lane wind on/off (`F`); hard off = static lane for cost isolation (`?wind=0` at load).",
            ),
        )}
        ${hudSection(
          "🔬 LOD mix",
          "L",
          `<div class="preset-group"><button class="btn-preset" data-lod>LOD: --</button></div>` +
            hudNote(
              "P2 DECISIVE MODE SWITCH (ADR 0059 step 2): `L` cycles the transition strategies — off / hysteresis / dither / dither-hysteresis (one declarative switch, bounded cost per mode). `?lodMode=` preselects.",
            ),
        )}
        <div class="hud-section hud-keys">
          <kbd>1</kbd> Walk · <kbd>2</kbd> Flight · <kbd>3</kbd> Aerial · <kbd>F</kbd> Wind · <kbd>L</kbd> LOD · <kbd>H</kbd> Panel · <kbd>WASD</kbd>/<kbd>Mouse</kbd> Free fly
        </div>
      `,
    });
    this._root = this._drawer.root;
    this._readout = this._root.querySelector("#vegLabReadout") as HTMLElement;

    this._root.querySelectorAll<HTMLButtonElement>("[data-path]").forEach((btn) => {
      btn.addEventListener("click", () => {
        this._selectPath(btn.dataset["path"] as CameraMode);
      });
    });
    this._root.querySelectorAll<HTMLButtonElement>("[data-wind]").forEach((btn) => {
      btn.addEventListener("click", () => {
        this._options.onToggleWind?.();
      });
    });
    this._root.querySelectorAll<HTMLButtonElement>("[data-lod]").forEach((btn) => {
      btn.addEventListener("click", () => {
        this._options.onCycleLodMode?.();
        this.sync(this._lastStats);
      });
    });
    this.sync(undefined);
  }

  /** Releases the drawer, its footer button and the injected style (showcase teardown). */
  public dispose(): void {
    this._style.remove();
    this._drawer.dispose();
  }

  /**
   * Applies a lab shortcut. Returns true when the key was consumed. Digits select the camera
   * path, `F` toggles the field-lane wind, `L` cycles the P2 LOD transition mode, `I`/`H`
   * toggle the panel (handled by the shared drawer).
   */
  public handleKey(event: KeyboardEvent): boolean {
    if (this._drawer.handleKey(event)) return true;
    if (event.altKey || event.metaKey || event.ctrlKey) return false;
    const path = PATH_KEY_MAP[event.code];
    if (path) {
      this._selectPath(path);
      return true;
    }
    if (event.code === "KeyF") {
      this._options.onToggleWind?.();
      return true;
    }
    if (event.code === "KeyL") {
      this._options.onCycleLodMode?.();
      this.sync(this._lastStats);
      return true;
    }
    return false;
  }

  /**
   * Pushes the latest measurement state into the HUD (call a few times per second, not every
   * frame). `undefined` resets the readout to a placeholder while leaving controls intact.
   */
  public sync(stats: VegHudStats | undefined): void {
    this._lastStats = stats;
    this._root.querySelectorAll<HTMLButtonElement>("[data-path]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset["path"] === this._path);
    });
    // Wind toggle mirrors the LIVE state pushed by the showcase (no local echo); hard-off is
    // only true while the field lane actually applies wind.
    const windOn = stats?.wind === true;
    this._root.querySelectorAll<HTMLButtonElement>("[data-wind]").forEach((btn) => {
      btn.classList.toggle("active", windOn);
      const label = `Wind: ${windOn ? "on" : "off"}`;
      if (btn.textContent !== label) btn.textContent = label;
    });
    // P2 LOD transition mode mirrors the live field-lane state pushed by the showcase (no local
    // echo): a DECISIVE MODE SWITCH preset name when armed, else band-derived crossfade/hard.
    const lod = stats?.lod;
    const lodHard = lod !== undefined && lod.band <= 0;
    this._root.querySelectorAll<HTMLButtonElement>("[data-lod]").forEach((btn) => {
      btn.classList.toggle("active", lod !== undefined && lodHard);
      const label =
        lod === undefined
          ? "LOD: --"
          : lod.mode !== undefined
            ? `LOD: ${lod.mode}`
            : `LOD: ${lodHard ? "hard" : "crossfade"}`;
      if (btn.textContent !== label) btn.textContent = label;
    });
    this._refreshReadout();
  }

  /** Absolute control override (e.g. restore the readout after a capture); see {@link sync}. */
  public setReadout(stats: VegHudStats | undefined): void {
    this.sync(stats);
  }

  private _selectPath(path: CameraMode): void {
    if (this._path === path) return;
    this._path = path;
    if (path === "fly") this._options.onFreeFly();
    else this._options.onSelectPath(path);
    this.sync(this._lastStats);
  }

  private _refreshReadout(): void {
    const gpuMs = hudReadGpuMs(this._options.gpuTimings);
    const stats = this._lastStats;
    const body =
      stats === undefined
        ? "no measurement yet\nwaiting for the first frame sample…"
        : this._metricBody(stats, gpuMs);
    const header = `fps | cpu ms | gpu ms | visible / triangles\n` + `${body}`;
    if (this._readout.textContent !== header) {
      this._readout.textContent = header;
    }
  }

  private _metricBody(stats: VegHudStats, gpuMs: number): string {
    const gpu = gpuMs >= 0 ? gpuMs : stats.gpuMs;
    const cpu = stats.cpuMs;
    const lines = [
      `${stats.fps >= 0 ? stats.fps.toFixed(1) : "--"} | ${fmtMs(cpu)} | ${fmtMs(gpu)} | ${fmtCount(stats.visible)} / ${fmtCount(stats.triangles)}`,
      `?n=${stats.instances.toLocaleString("en-US")}  mode=${stats.mode}  path=${this._path}  wind=${stats.wind ? "on" : "off"}  taa=${stats.taa ? "on" : "off"}${stats.cover > 0 ? `  cover=${fmtCount(stats.cover)}` : ""}`,
    ];
    const lod = stats.lod;
    if (lod !== undefined) {
      lines.push(
        `LOD: band=${lod.band.toFixed(2)} hyst=${lod.hyst.toFixed(2)} bias=${lod.biasPx.toFixed(1)}px  ${lod.mode !== undefined ? `mode=${lod.mode} ` : ""}(${lod.band <= 0 ? "hard" : "crossfade"})`,
      );
    }
    const passes = this._options.gpuTimings?.passesMs;
    if (passes && this._options.gpuTimings?.available === true) {
      const entries = Object.entries(passes).filter(([, ms]) => ms >= 0);
      if (entries.length > 0) {
        lines.push(`passes: ${entries.map(([name, ms]) => `${name}=${ms.toFixed(2)}`).join("  ")}`);
      }
    }
    return lines.join("\n");
  }
}
