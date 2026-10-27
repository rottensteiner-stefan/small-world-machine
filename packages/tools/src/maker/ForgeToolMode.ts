import type { ForgeTool } from "@small-world-machine/engine";
import type { ToolMode } from "./ToolMode.js";

/**
 * Hosts a self-contained `ForgeTool` (Xtractor, Pixler, Map Generator) as a Maker shell mode.
 *
 * The tool is built fresh on every `mount()` and torn down in `unmount()`: its window-level
 * listeners die with `ForgeTool.unmount()` and would not come back on a re-mount of the same
 * instance. Document state survives the round trip through `getState()`/`setState()`, so
 * leaving a mode and coming back restores the document (undo stays per tool, per mount).
 *
 * `hostEl` is the shell's mode surface: it is shown while a mode is mounted and hidden again on
 * unmount, so the world editor underneath keeps its size and never sees a 0x0 canvas.
 */
export class ForgeToolMode<T extends ForgeTool> implements ToolMode {
  private _tool: T | undefined;
  private _state: unknown;
  private _hostEl: HTMLElement | undefined;

  constructor(
    public readonly modeId: string,
    private readonly _create: (parent: HTMLElement) => T,
    /** Extra teardown for tools whose `unmount()` leaves resources behind (e.g. a dropzone). */
    private readonly _dispose?: (tool: T) => void,
  ) {}

  public initialize(): void {}

  public mount(hostEl: HTMLElement): void {
    this._hostEl = hostEl;
    hostEl.hidden = false;
    hostEl.dataset["mode"] = this.modeId;
    this._tool = this._create(hostEl);
    if (this._state !== undefined && this._state !== null) {
      this._tool.setState(this._state);
    }
  }

  public unmount(): void {
    if (this._tool) {
      this._state = this._tool.getState();
      this._tool.unmount();
      this._dispose?.(this._tool);
      this._tool = undefined;
    }
    if (this._hostEl) {
      this._hostEl.hidden = true;
      delete this._hostEl.dataset["mode"];
      this._hostEl = undefined;
    }
  }

  public getState(): unknown {
    return this._tool ? this._tool.getState() : this._state;
  }

  public setState(state: unknown): void {
    if (this._tool) {
      this._tool.setState(state);
    } else {
      this._state = state;
    }
  }
}
