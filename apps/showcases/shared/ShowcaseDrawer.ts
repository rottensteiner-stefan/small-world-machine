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
  /** Optional small badge next to the close button (renderer, showcase number, ...). */
  badge?: string | undefined;
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
}

/** Pointer/touch events that must not reach the camera controller while the drawer is used. */
const SHIELDED_EVENTS = [
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
`;

/**
 * The standard showcase side panel (`swm-inspector-drawer` from shared.css): header with title,
 * badge and close button, a body for the showcase's own controls, a footer toggle button, I/H
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

  private readonly _badge: HTMLElement;
  private readonly _toggleKeys: readonly string[];
  private readonly _onToggle: ((open: boolean) => void) | undefined;

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
          <span class="hud-badge"></span>
          <button class="hud-close-btn" title="Panel schließen (${keyHint})">✕</button>
        </div>
      </div>
      <div class="hud-body"></div>
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
    this._badge = root.querySelector(".hud-badge") as HTMLElement;
    this.setBadge(options.badge);
    (root.querySelector(".hud-close-btn") as HTMLButtonElement).onclick = (): void =>
      this.toggle(false);

    const button = document.createElement("button");
    button.className = "swm-inspector-btn";
    if (options.buttonId) {
      button.id = options.buttonId;
    }
    button.innerHTML = `<span>${options.footerIcon ?? options.icon}</span>`;
    button.title = `${options.title} (${keyHint})`;
    button.setAttribute("aria-label", `${options.title} ein-/ausblenden`);
    button.onclick = (): void => this.toggle();
    this.toggleButton = button;
    ShowcaseDrawer._mountInFooter(button);

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

  /** Sets or clears the header badge. */
  public setBadge(text: string | undefined): void {
    this._badge.textContent = text ?? "";
    this._badge.style.display = text ? "" : "none";
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
    this.root.remove();
    this.toggleButton.remove();
  }

  // The footer is injected by the showcase-layout plugin and is normally present, but a showcase
  // that builds its panel very early must not lose the button.
  private static _mountInFooter(button: HTMLButtonElement): void {
    const footer = document.querySelector(".app-footer");
    if (footer) {
      footer.appendChild(button);
      return;
    }
    document.body.appendChild(button);
    window.setTimeout(() => {
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
