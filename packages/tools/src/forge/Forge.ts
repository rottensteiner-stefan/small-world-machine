import { ForgeWindow } from "./ForgeWindow.js";
import type { ForgeTool } from "@small-world-machine/engine";
import { FORGE_THEME_CSS } from "./ForgeTheme.js";

export interface ForgeOptions {
  toggleKey?: string; // e.g. "F12" or "~"
}

export class Forge {
  private _overlay: HTMLDivElement;
  private _isVisible: boolean = false;
  private _windows: ForgeWindow[] = [];
  private _onKeyDown: ((e: KeyboardEvent) => void) | undefined;
  private readonly _onPaste: (e: ClipboardEvent) => void;

  public get isVisible(): boolean {
    return this._isVisible;
  }

  constructor(options: ForgeOptions = {}) {
    this._injectCSS();

    this._overlay = document.createElement("div");
    this._overlay.className = "swf-forge-overlay";
    this._overlay.style.display = "none"; // hidden by default
    document.body.appendChild(this._overlay);

    if (options.toggleKey) {
      this._onKeyDown = (e): void => {
        if (e.key === options.toggleKey) {
          this.toggle();
          e.preventDefault();
        }
      };
      window.addEventListener("keydown", this._onKeyDown);
    }

    // Global Paste Listener for Tools
    this._onPaste = (e): void => {
      if (!this._isVisible) return;

      const items = e.clipboardData?.items;
      if (!items) return;

      let blob: File | null = null;
      for (let i = 0; i < items.length; i++) {
        if (items[i]!.type.indexOf("image") !== -1) {
          blob = items[i]!.getAsFile();
          break;
        }
      }

      if (blob) {
        // Find topmost window
        let activeWin: ForgeWindow | null = null;
        let maxZ = -1;
        for (const win of this._windows) {
          if (win.isVisible) {
            const z = parseInt(win.getElement().style.zIndex || "0", 10);
            if (z > maxZ) {
              maxZ = z;
              activeWin = win;
            }
          }
        }

        if (activeWin && activeWin.tool) {
          const reader = new FileReader();
          reader.onload = (event): void => {
            const base64 = event.target?.result as string;
            if (base64 && activeWin?.tool) {
              activeWin.tool.onPasteImage(base64);
            }
          };
          reader.readAsDataURL(blob);
        }
      }
    };
    window.addEventListener("paste", this._onPaste);
  }

  public toggle(): void {
    this._isVisible = !this._isVisible;
    this._overlay.style.display = this._isVisible ? "block" : "none";
    // We must NOT block pointer events on the overlay itself, otherwise the canvas underneath cannot be clicked!
    this._overlay.style.pointerEvents = "none";
    this._overlay.style.backgroundColor = "transparent";
  }

  public get windows(): ForgeWindow[] {
    return this._windows;
  }

  public openWindow(
    title: string,
    tool: ForgeTool,
    x: number = 20,
    y: number = 20,
    persistenceKey: string = title,
  ): ForgeWindow {
    const win = new ForgeWindow(title, this._overlay, x, y, persistenceKey);
    win.mountTool(tool);
    this._windows.push(win);

    // Every time a window state changes (like closed), update the taskbar
    win.setOnClose(() => {
      this._updateTaskbar();
    });

    this._updateTaskbar();
    win.restoreState();
    return win;
  }

  private _taskbarEl?: HTMLDivElement;

  private _updateTaskbar(): void {
    if (!this._taskbarEl) {
      this._taskbarEl = document.createElement("div");
      this._taskbarEl.className = "swf-taskbar";
      this._overlay.appendChild(this._taskbarEl);
    }

    this._taskbarEl.innerHTML = "";
    for (const win of this._windows) {
      const btn = document.createElement("div");
      btn.className = "swf-taskbar-btn" + (win.isVisible ? "" : " inactive");
      btn.textContent = win.title;
      // Toggles on click (releasing elsewhere cancels it); mousedown only has to stay away from
      // the scene underneath.
      btn.addEventListener("mousedown", (e) => e.stopPropagation());
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        win.toggleVisibility();
        this._updateTaskbar();
      });
      this._taskbarEl.appendChild(btn);
    }
  }

  private _injectCSS(): void {
    if (document.getElementById("sw-forge-style")) return;
    const style = document.createElement("style");
    style.id = "sw-forge-style";
    style.innerHTML = FORGE_THEME_CSS;
    document.head.appendChild(style);
  }

  /** Tears down every open window (and the `window`-level listeners/`ResizeObserver`s each of
   * them holds -- see `ForgeWindow.destroy()`), this hub's own `keydown`/`paste` listeners, and
   * removes the overlay from the DOM. Call this when the owning engine instance is destroyed. */
  public destroy(): void {
    for (const win of [...this._windows]) {
      win.destroy();
    }
    this._windows.length = 0;

    if (this._onKeyDown) {
      window.removeEventListener("keydown", this._onKeyDown);
      this._onKeyDown = undefined;
    }
    window.removeEventListener("paste", this._onPaste);

    if (this._overlay.parentNode) {
      this._overlay.parentNode.removeChild(this._overlay);
    }
  }
}
