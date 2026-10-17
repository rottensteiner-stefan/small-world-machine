import type { ToolMode } from "./ToolMode.js";

/**
 * Registry and lifecycle owner for Maker tool modes. Exactly one mode is active at a time:
 * activating a mode unmounts the previously active one (its `unmount()` releases any live 3D
 * surface) before mounting the new one -- modes are mounted only while active (lazy mount).
 * Registration/activation are explicit so unknown modes fail fast when activated.
 *
 * Resource note (budget not enforced here yet): GL-heavy modes share a hard budget of at most
 * two simultaneously live 3D surfaces (primary editor viewport + one secondary preview).
 * Modes must release their surface in `unmount()` so the total stays within budget.
 */
export class ToolModeHost {
  private readonly _modes = new Map<string, ToolMode>();
  private readonly _initialized = new Set<ToolMode>();
  private _activeModeId: string | undefined;

  constructor(private readonly _mountEl: HTMLElement) {}

  /** Registers a mode. Throws on duplicate `modeId`. */
  public register(mode: ToolMode): void {
    if (this._modes.has(mode.modeId)) {
      throw new Error(`ToolModeHost: mode '${mode.modeId}' is already registered`);
    }
    this._modes.set(mode.modeId, mode);
  }

  /** Unregisters a mode; unmounts it first when it is the active mode. */
  public unregister(modeId: string): void {
    const mode = this._modes.get(modeId);
    if (!mode) {
      return;
    }
    if (this._activeModeId === modeId) {
      mode.unmount();
      this._activeModeId = undefined;
    }
    this._initialized.delete(mode);
    this._modes.delete(modeId);
  }

  /** Makes `modeId` the single active mode; unmounts the previous active mode first. */
  public activate(modeId: string): void {
    if (this._activeModeId === modeId) {
      return;
    }
    const next = this._modes.get(modeId);
    if (!next) {
      throw new Error(`ToolModeHost: unknown mode '${modeId}'`);
    }
    if (this._activeModeId !== undefined) {
      this._modes.get(this._activeModeId)?.unmount();
    }
    if (!this._initialized.has(next)) {
      next.initialize();
      this._initialized.add(next);
    }
    next.mount(this._mountEl);
    this._activeModeId = modeId;
  }

  public get activeModeId(): string | undefined {
    return this._activeModeId;
  }

  public has(modeId: string): boolean {
    return this._modes.has(modeId);
  }

  public get modeIds(): readonly string[] {
    return [...this._modes.keys()];
  }
}
