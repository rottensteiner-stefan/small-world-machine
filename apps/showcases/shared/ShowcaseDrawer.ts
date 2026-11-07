/** Frame telemetry interface satisfied by {@link SmallWorldMachine} or custom metric sources. */
export interface FrameTelemetrySource {
  lastCpuTimeMs?: number;
}

/**
 * Options for {@link ShowcaseDrawer}.
 */
export interface ShowcaseDrawerOptions {
  /** DOM id of the drawer element (also scopes per-showcase CSS, e.g. `#fire-lab-hud .foo`). */
  id: string;
  /** Header title. */
  title: string;
  /** Emoji shown in the header and on the footer toggle button. */
  icon: string;
  /** Inner HTML of the drawer body; can be replaced later with {@link ShowcaseDrawer.setBody}. */
  body?: string | undefined;
  /** Whether the drawer starts open. Defaults to true. */
  open?: boolean | undefined;
  /** Emoji on the footer button when it should differ from `icon` (e.g. the classic ⚙). */
  footerIcon?: string | undefined;
  /** DOM id for the footer button, for showcases whose scripts or CSS address it. */
  buttonId?: string | undefined;
  /** `KeyboardEvent.code`s that toggle the drawer. Defaults to I and H; pass ["KeyI"] where H is taken. */
  toggleKeys?: readonly string[] | undefined;
  /** Stops keydown/keyup inside the drawer from reaching the page, so typing or arrow keys in
   * panel widgets cannot steer the camera. Off by default: a focused panel button would
   * otherwise swallow WASD. */
  shieldKeys?: boolean | undefined;
  /** Called after every open/close, from any source (key, close button, footer button, code). */
  onToggle?: ((open: boolean) => void) | undefined;
  /**
   * Optional engine/showcase instance or custom frame metrics provider to power the built-in
   * performance & headroom telemetry readout in the drawer footer.
   */
  engine?: FrameTelemetrySource | undefined;
  /** Custom callback returning the frame CPU execution time in milliseconds. */
  getCpuTime?: (() => number) | undefined;
  /** Whether to show the performance telemetry footer. Defaults to true. */
  showPerf?: boolean | undefined;
}

/** Pointer/touch events that must not reach the camera controller while the drawer is used.
 *  Release events (`mouseup`/`pointerup`/`touchend`) are deliberately NOT shielded: the engine
 *  `Input` and showcase HUDs reset drag/button state on `window` release listeners, so a drag
 *  released over the drawer would otherwise leave `mouse.left`/drag flags stuck. */
const SHIELDED_EVENTS = [
  "mousedown",
  "mousemove",
  "pointerdown",
  "pointermove",
  "wheel",
  "touchstart",
  "touchmove",
  "click",
  "dblclick",
  "contextmenu",
];
const PASSIVE_EVENTS = new Set(["wheel", "touchstart", "touchmove"]);

/** Layout helpers every showcase panel re-declared locally; injected once per page. */
const SHARED_STYLE_ID = "swm-showcase-drawer-style";
const SHARED_STYLE = `
  .swm-inspector-drawer .preset-group.two-col { grid-template-columns: repeat(2, 1fr); }
  .swm-inspector-drawer .preset-group.three-col { grid-template-columns: repeat(3, 1fr); }
  .swm-inspector-drawer .preset-group.four-col { grid-template-columns: repeat(4, 1fr); }
  .swm-inspector-drawer .preset-group.five-col { grid-template-columns: repeat(5, 1fr); }
  .swm-inspector-drawer .hud-note { font-size: 10px; line-height: 1.4; color: #94a3b8; margin-top: 6px; }
  .swm-inspector-drawer .hud-keys { font-size: 10px; line-height: 1.7; color: #94a3b8; }
  .swm-inspector-drawer .hud-keys kbd {
    font-family: var(--font-mono, "JetBrains Mono", monospace);
    border: 1px solid rgba(148, 163, 184, 0.35); border-radius: 3px; padding: 0 4px;
  }
  .swm-inspector-drawer .hud-perf-footer {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px 14px 10px;
    background: rgba(0, 0, 0, 0.4);
    border-top: 1px solid rgba(255, 255, 255, 0.08);
    font-family: var(--font-mono, "JetBrains Mono", monospace);
    font-size: 11px;
    color: #94a3b8;
    flex-shrink: 0;
    user-select: none;
  }
  .swm-inspector-drawer .hud-perf-meta {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .swm-inspector-drawer .hud-perf-indicator {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #22c55e;
    box-shadow: 0 0 6px rgba(34, 197, 94, 0.6);
    flex-shrink: 0;
    transition: background 0.25s, box-shadow 0.25s;
  }
  .swm-inspector-drawer .hud-perf-indicator.warn {
    background: #eab308;
    box-shadow: 0 0 6px rgba(234, 179, 8, 0.6);
  }
  .swm-inspector-drawer .hud-perf-indicator.alert {
    background: #ef4444;
    box-shadow: 0 0 6px rgba(239, 68, 68, 0.6);
  }
  .swm-inspector-drawer .hud-perf-fps {
    color: #f8fafc;
    font-weight: 600;
  }
  .swm-inspector-drawer .hud-perf-time {
    color: #cbd5e1;
  }
  .swm-inspector-drawer .hud-perf-reserve {
    color: #38bdf8;
    font-weight: 500;
  }
  .swm-inspector-drawer .hud-perf-sep {
    color: rgba(148, 163, 184, 0.4);
  }
  .swm-inspector-drawer .hud-perf-bar {
    width: 100%;
    height: 3px;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 2px;
    overflow: hidden;
  }
  .swm-inspector-drawer .hud-perf-bar-fill {
    height: 100%;
    width: 100%;
    background: linear-gradient(90deg, #22c55e, #38bdf8);
    border-radius: 2px;
    transition: width 0.2s ease-out, background 0.25s;
  }
`;

/**
 * The standard showcase side panel (`swm-inspector-drawer` from shared.css): header with title
 * and close button, a body for the showcase's own controls, a footer toggle button, I/H
 * shortcut handling and shielding so clicks and drags inside the panel never move the camera.
 * Each showcase's `Hud.ts` composes one of these and owns only its content and wiring.
 */
export class ShowcaseDrawer {
  /** The drawer element. */
  public readonly root: HTMLElement;
  /** Container for the showcase's controls. */
  public readonly body: HTMLElement;
  /** Footer button that toggles the drawer. */
  public readonly toggleButton: HTMLButtonElement;

  private readonly _toggleKeys: readonly string[];
  private readonly _onToggle: ((open: boolean) => void) | undefined;

  private _perfRafId: number = 0;
  private _lastRafTime: number = 0;
  private _lastDomUpdateTime: number = 0;
  private _smoothedDelta: number = 16.67;
  private _smoothedCpu: number = 0;
  private _mountTimer: number = 0;
  private readonly _perfIndicator?: HTMLElement;
  private readonly _perfFps?: HTMLElement;
  private readonly _perfTime?: HTMLElement;
  private readonly _perfReserve?: HTMLElement;
  private readonly _perfBarFill?: HTMLElement;

  constructor(options: ShowcaseDrawerOptions) {
    this._toggleKeys = options.toggleKeys ?? ["KeyI", "KeyH"];
    this._onToggle = options.onToggle;
    const keyHint = this._toggleKeys.map((code) => code.replace("Key", "")).join(" / ");
    ShowcaseDrawer._injectSharedStyle();
    document.getElementById(options.id)?.remove();

    const root = document.createElement("aside");
    root.id = options.id;
    root.className = "swm-inspector-drawer";
    root.innerHTML = `
      <div class="bottom-sheet-grabber"></div>
      <div class="hud-header">
        <div class="hud-title"><span>${options.icon}</span> ${options.title}</div>
        <div style="display:flex;align-items:center;gap:8px;">
          <button class="hud-close-btn" title="Close panel (${keyHint})">✕</button>
        </div>
      </div>
      <div class="hud-body"></div>
      ${
        options.showPerf !== false
          ? `
      <div class="hud-perf-footer" title="Live performance: FPS, frame time and headroom up to the VSync limit">
        <div class="hud-perf-meta">
          <span class="hud-perf-indicator"></span>
          <span class="hud-perf-fps">-- FPS</span>
          <span class="hud-perf-sep">·</span>
          <span class="hud-perf-time">-- ms</span>
          <span class="hud-perf-sep">·</span>
          <span class="hud-perf-reserve">--% Reserve</span>
        </div>
        <div class="hud-perf-bar"><div class="hud-perf-bar-fill"></div></div>
      </div>`
          : ""
      }
    `;
    for (const eventName of SHIELDED_EVENTS) {
      root.addEventListener(eventName, (e: Event): void => e.stopPropagation(), {
        passive: PASSIVE_EVENTS.has(eventName),
      });
    }
    if (options.shieldKeys) {
      root.addEventListener("keydown", (e: Event): void => e.stopPropagation());
      root.addEventListener("keyup", (e: Event): void => e.stopPropagation());
    }
    document.body.appendChild(root);
    this.root = root;
    this.body = root.querySelector(".hud-body") as HTMLElement;
    (root.querySelector(".hud-close-btn") as HTMLButtonElement).onclick = (): void =>
      this.toggle(false);

    if (options.showPerf !== false) {
      this._perfIndicator = root.querySelector(".hud-perf-indicator") as HTMLElement;
      this._perfFps = root.querySelector(".hud-perf-fps") as HTMLElement;
      this._perfTime = root.querySelector(".hud-perf-time") as HTMLElement;
      this._perfReserve = root.querySelector(".hud-perf-reserve") as HTMLElement;
      this._perfBarFill = root.querySelector(".hud-perf-bar-fill") as HTMLElement;
      this._startPerfMonitoring(options.engine, options.getCpuTime);
    }

    const button = document.createElement("button");
    button.className = "swm-inspector-btn";
    if (options.buttonId) {
      button.id = options.buttonId;
    }
    button.innerHTML = `<span>${options.footerIcon ?? options.icon}</span>`;
    button.title = `${options.title} (${keyHint})`;
    button.setAttribute("aria-label", `Toggle ${options.title}`);
    button.onclick = (): void => this.toggle();
    this.toggleButton = button;
    this._mountInFooter(button);

    if (options.body !== undefined) {
      this.setBody(options.body);
    }
    this._apply(options.open ?? true);
  }

  /** Whether the drawer is currently open. */
  public get isOpen(): boolean {
    return this.root.classList.contains("open");
  }

  /** Replaces the body content (re-render); re-bind control listeners afterwards. */
  public setBody(html: string): void {
    this.body.innerHTML = html;
  }

  /** Opens, closes or flips the drawer and notifies `onToggle`. */
  public toggle(force?: boolean): void {
    this._apply(force ?? !this.isOpen);
    this._onToggle?.(this.isOpen);
  }

  /**
   * Handles the toggle shortcut (`toggleKeys`, default I / H). Returns true when the key was consumed. Ignores
   * modifier combos (Alt+digits switch the renderer) and keys typed into form fields.
   */
  public handleKey(event: KeyboardEvent): boolean {
    if (event.altKey || event.metaKey || event.ctrlKey || isTypingTarget()) {
      return false;
    }
    if (!this._toggleKeys.includes(event.code)) {
      return false;
    }
    this.toggle();
    return true;
  }

  /** Typed lookup inside the drawer. */
  public query<T extends HTMLElement>(selector: string): T | null {
    return this.root.querySelector<T>(selector);
  }

  // Initial state is applied without onToggle: the showcase is still constructing the Hud.
  private _apply(open: boolean): void {
    this.root.classList.toggle("open", open);
    this.toggleButton.classList.toggle("active", open);
  }

  /** Removes drawer and footer button (showcase teardown, canvas recreation). */
  public dispose(): void {
    if (this._perfRafId) {
      cancelAnimationFrame(this._perfRafId);
      this._perfRafId = 0;
    }
    if (this._mountTimer) {
      window.clearTimeout(this._mountTimer);
      this._mountTimer = 0;
    }
    this.root.remove();
    this.toggleButton.remove();
  }

  private _startPerfMonitoring(
    engine?: FrameTelemetrySource | undefined,
    getCpuTime?: (() => number) | undefined,
  ): void {
    this._lastRafTime = performance.now();
    this._lastDomUpdateTime = this._lastRafTime;

    const tick = (now: number): void => {
      this._perfRafId = requestAnimationFrame(tick);
      const delta = now - this._lastRafTime;
      this._lastRafTime = now;
      if (delta <= 0 || delta > 1000) return;

      this._smoothedDelta = this._smoothedDelta * 0.9 + delta * 0.1;

      const rawCpu = getCpuTime ? getCpuTime() : engine?.lastCpuTimeMs;
      if (rawCpu !== undefined && rawCpu >= 0) {
        this._smoothedCpu =
          this._smoothedCpu === 0 ? rawCpu : this._smoothedCpu * 0.85 + rawCpu * 0.15;
      } else {
        this._smoothedCpu = this._smoothedDelta;
      }

      // Throttle DOM updates to ~4 Hz (every 250ms) to avoid layout recalculations and garbage
      if (now - this._lastDomUpdateTime >= 250) {
        this._lastDomUpdateTime = now;
        this._updatePerfDom(rawCpu !== undefined);
      }
    };

    this._perfRafId = requestAnimationFrame(tick);
  }

  private _updatePerfDom(hasCpuTelemetry: boolean): void {
    if (
      !this.isOpen ||
      !this._perfFps ||
      !this._perfTime ||
      !this._perfReserve ||
      !this._perfIndicator ||
      !this._perfBarFill
    ) {
      return;
    }
    const fps = Math.round(1000 / Math.max(1, this._smoothedDelta));
    // Determine screen frame budget: ~8.33ms for 120Hz (ProMotion), ~16.67ms for 60Hz
    const targetBudget = this._smoothedDelta <= 10.5 ? 8.33 : 16.67;
    const cpuTime = Math.min(this._smoothedCpu, targetBudget * 2);

    let headroomPct: number;
    if (hasCpuTelemetry) {
      headroomPct = Math.max(
        0,
        Math.min(100, Math.round(((targetBudget - cpuTime) / targetBudget) * 100)),
      );
    } else {
      // If only frame interval is available, estimate jitter / stability against target budget
      const diff = Math.abs(this._smoothedDelta - targetBudget);
      headroomPct = Math.max(0, Math.min(100, Math.round((1 - diff / targetBudget) * 100)));
    }

    this._perfFps.textContent = `${fps} FPS`;
    this._perfTime.textContent = `${cpuTime.toFixed(1)} ms`;
    this._perfReserve.textContent = `${headroomPct}% Reserve`;

    this._perfIndicator.classList.remove("warn", "alert");
    if (headroomPct < 15) {
      this._perfIndicator.classList.add("alert");
      this._perfBarFill.style.background = "#ef4444";
    } else if (headroomPct < 40) {
      this._perfIndicator.classList.add("warn");
      this._perfBarFill.style.background = "#eab308";
    } else {
      this._perfBarFill.style.background = "linear-gradient(90deg, #22c55e, #38bdf8)";
    }
    this._perfBarFill.style.width = `${headroomPct}%`;
  }

  // The footer is injected by the showcase-layout plugin and is normally present, but a showcase
  // that builds its panel very early must not lose the button.
  private _mountInFooter(button: HTMLButtonElement): void {
    const footer = document.querySelector(".app-footer");
    if (footer) {
      footer.appendChild(button);
      return;
    }
    document.body.appendChild(button);
    this._mountTimer = window.setTimeout(() => {
      this._mountTimer = 0;
      const late = document.querySelector(".app-footer");
      if (late && button.parentNode !== late) {
        late.appendChild(button);
      }
    }, 100);
  }

  private static _injectSharedStyle(): void {
    if (document.getElementById(SHARED_STYLE_ID)) {
      return;
    }
    const style = document.createElement("style");
    style.id = SHARED_STYLE_ID;
    style.textContent = SHARED_STYLE;
    document.head.appendChild(style);
  }
}

/** True while the user types into a form field, so single-letter shortcuts must not fire. */
export function isTypingTarget(): boolean {
  const tag = document.activeElement?.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/** Section with the standard title row (`hint` is the small right-aligned shortcut text). */
export function hudSection(title: string, hint: string, content: string): string {
  return `
    <div class="hud-section">
      <div class="section-title"><span>${title}</span><span style="font-size:9px;color:#64748b;">${hint}</span></div>
      ${content}
    </div>`;
}

/** Labelled on/off switch row. */
export function hudSwitch(id: string, label: string): string {
  return `
    <div class="hud-row">
      <label for="${id}">${label}</label>
      <label class="hud-switch"><input type="checkbox" id="${id}"><span class="hud-switch-slider"></span></label>
    </div>`;
}

/** Labelled range slider row with a value label `${id}_val`. */
export function hudSlider(
  id: string,
  label: string,
  min: number,
  max: number,
  step: number,
): string {
  return `
    <div class="hud-row">
      <label for="${id}">${label}</label>
      <input id="${id}" type="range" min="${min}" max="${max}" step="${step}" />
      <span id="${id}_val" class="val-label"></span>
    </div>`;
}

/** Small explanatory note below a group of controls. */
export function hudNote(html: string): string {
  return `<div class="hud-note">${html}</div>`;
}
