import { ForgeTool } from "../forge/ForgeTool.js";

/**
 * Lightweight ForgeTool that exposes a set of numeric parameters as live sliders.
 * Each slider writes back to a user-supplied `onChange` callback immediately (no apply button).
 * Integrated into {@link AbstractShowcase} as `this.sceneParams` for showcase debugging,
 * lighting tweaks, and runtime parameter exploration.
 */
export class SceneParams extends ForgeTool {
  private readonly _params: {
    name: string;
    min: number;
    max: number;
    step: number;
    value: number;
    onChange: ((value: number) => void) | undefined;
  }[] = [];

  constructor() {
    super();
    this._injectCSS();
  }

  /**
   * Register a parameter slider. Call before `mount` for best results, but calling after
   * mount will still work (the UI is rebuilt on demand).
   *
   * @param name Label shown next to the slider
   * @param min Minimum value
   * @param max Maximum value
   * @param step Step increment (slider precision)
   * @param value Initial value
   * @param onChange Callback invoked on every value change
   */
  public addParam(
    name: string,
    min: number,
    max: number,
    step: number,
    value: number,
    onChange?: (value: number) => void,
  ): void {
    this._params.push({ name, min, max, step, value, onChange: onChange ?? undefined });
    // Rebuild UI if already mounted
    if (this._container.firstChild) {
      this._buildUI();
    }
  }

  /** Returns the number of registered parameters. */
  public get paramCount(): number {
    return this._params.length;
  }

  /** Remove all registered parameters and rebuild the UI. */
  public clear(): void {
    this._params.length = 0;
    if (this._container.firstChild) {
      this._buildUI();
    }
  }

  public override mount(parent: HTMLElement): void {
    super.mount(parent);
    this._buildUI();
  }

  private _injectCSS(): void {
    if (document.getElementById("scene-params-style")) return;
    const style = document.createElement("style");
    style.id = "scene-params-style";
    style.innerHTML = `
      .scene-params-container {
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding: 4px;
        width: 100%;
        color: var(--swf-text);
        font-family: var(--swf-font);
      }
      .scene-params-row {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .scene-params-label {
        width: 120px;
        flex-shrink: 0;
        font-size: 12px;
        font-weight: 600;
        color: var(--swf-text-muted);
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }
      .scene-params-slider {
        flex: 1;
        height: 4px;
        -webkit-appearance: none;
        appearance: none;
        background: rgba(0,0,0,0.3);
        border-radius: 2px;
        outline: none;
        cursor: pointer;
      }
      .scene-params-slider::-webkit-slider-thumb {
        -webkit-appearance: none;
        appearance: none;
        width: 14px;
        height: 14px;
        border-radius: 50%;
        background: var(--swf-accent);
        cursor: pointer;
        border: 2px solid var(--swf-panel);
        box-shadow: 0 0 6px rgba(176, 0, 255, 0.4);
      }
      .scene-params-slider::-moz-range-thumb {
        width: 14px;
        height: 14px;
        border-radius: 50%;
        background: var(--swf-accent);
        cursor: pointer;
        border: 2px solid var(--swf-panel);
        box-shadow: 0 0 6px rgba(176, 0, 255, 0.4);
      }
      .scene-params-value {
        width: 50px;
        text-align: right;
        font-size: 12px;
        font-weight: 600;
        color: var(--swf-accent);
        font-family: monospace;
      }
    `;
    document.head.appendChild(style);
  }

  private _buildUI(): void {
    this._container.innerHTML = "";
    const wrapper = document.createElement("div");
    wrapper.className = "scene-params-container";

    for (const param of this._params) {
      const row = document.createElement("div");
      row.className = "scene-params-row";

      const label = document.createElement("span");
      label.className = "scene-params-label";
      label.textContent = param.name;

      const slider = document.createElement("input");
      slider.type = "range";
      slider.className = "scene-params-slider";
      slider.min = String(param.min);
      slider.max = String(param.max);
      slider.step = String(param.step);
      slider.value = String(param.value);

      const valueDisplay = document.createElement("span");
      valueDisplay.className = "scene-params-value";
      valueDisplay.textContent = param.value.toFixed(2);

      slider.addEventListener("input", () => {
        const val = parseFloat(slider.value);
        param.value = val;
        valueDisplay.textContent = val.toFixed(2);
        if (param.onChange) param.onChange(val);
      });

      row.appendChild(label);
      row.appendChild(slider);
      row.appendChild(valueDisplay);
      wrapper.appendChild(row);
    }

    this._container.appendChild(wrapper);
  }

  public getState(): unknown {
    return this._params.map((p) => ({ name: p.name, value: p.value }));
  }

  public setState(_state: unknown): void {
    // State restoration not critical for live sliders
  }
}
