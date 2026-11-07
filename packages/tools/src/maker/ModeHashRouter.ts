import type { ToolModeHost } from "./ToolModeHost.js";
import { DEFAULT_MODE_ID } from "./ToolMode.js";

/** Returns the current route fragment, e.g. `"#world"`. */
export function readModeHash(): string {
  return window.location.hash;
}

/** Sets the route fragment in-place; never navigates the document. */
export function writeModeHash(modeId: string, replace: boolean = false): void {
  if (replace) {
    // Correcting an unknown hash must not add a history entry (Back would loop into it).
    window.history.replaceState(window.history.state, "", `#${modeId}`);
    return;
  }
  window.location.hash = modeId;
}

export interface ModeHashRouterOptions {
  /** Fallback mode for absent or unknown hashes; defaults to the `world` editor. */
  defaultModeId?: string;
  /** Injectable hash read; defaults to `readModeHash`. */
  readHash?: () => string;
  /** Injectable hash write; defaults to `writeModeHash`. */
  writeHash?: (modeId: string, replace?: boolean) => void;
}

/**
 * Boots and routes `maker.html#<mode>` against a {@link ToolModeHost} using in-app view
 * swaps only -- no `location.replace`, no document navigation, so bound project folders,
 * undo stacks and auto-save survive mode switches. Unknown or absent hashes fall back to the
 * default mode. `start()` parses the current hash and reacts to subsequent `hashchange`
 * events; `navigate()` is the in-app entry point for launchers.
 */
export class ModeHashRouter {
  private readonly _host: ToolModeHost;
  private readonly _defaultModeId: string;
  private readonly _readHash: () => string;
  private readonly _writeHash: (modeId: string, replace?: boolean) => void;
  private readonly _onHashChange = (): void => {
    this._applyRoute();
  };
  private _started = false;

  constructor(host: ToolModeHost, options: ModeHashRouterOptions = {}) {
    this._host = host;
    this._defaultModeId = options.defaultModeId ?? DEFAULT_MODE_ID;
    this._readHash = options.readHash ?? readModeHash;
    this._writeHash = options.writeHash ?? writeModeHash;
  }

  /** Starts routing: applies the current hash and listens for `hashchange`. */
  public start(): void {
    if (this._started) {
      return;
    }
    this._started = true;
    this._applyRoute();
    window.addEventListener("hashchange", this._onHashChange);
  }

  /** Stops routing and detaches the `hashchange` listener. */
  public stop(): void {
    if (!this._started) {
      return;
    }
    this._started = false;
    window.removeEventListener("hashchange", this._onHashChange);
  }

  /** In-app switch to `modeId` (unknown ids fall back to the default mode); never navigates. */
  public navigate(modeId: string): void {
    const target = this._resolveTarget(modeId);
    this._writeHash(target);
    this._activate(target);
  }

  public get activeModeId(): string | undefined {
    return this._host.activeModeId;
  }

  private _applyRoute(): void {
    const requested = this._requestedMode();
    const target = this._resolveTarget(requested);
    if (target !== requested) {
      this._writeHash(target, true);
    }
    this._activate(target);
  }

  private _activate(target: string): void {
    if (this._host.activeModeId === target) {
      return;
    }
    this._host.activate(target);
  }

  private _resolveTarget(modeId: string): string {
    return this._host.has(modeId) ? modeId : this._defaultModeId;
  }

  private _requestedMode(): string {
    const raw = this._readHash();
    return raw[0] === "#" ? raw.slice(1) : raw;
  }
}
