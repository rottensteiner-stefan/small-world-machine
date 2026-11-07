/**
 * Contract every authoring tool must implement to be hosted as a merge-able mode inside the
 * Maker shell -- deliberately NOT `ForgeTool`, the engine's in-game overlay-over-canvas
 * contract. A mode owns its UI and lifecycle: it is mounted only while it is the active mode
 * and unmounted (releasing any live 3D surface) on deactivation.
 *
 * Undo scope note: undo is ALWAYS per-tool and per-document, never global. Each mode carries
 * its own undo state (e.g. Maker's `UndoStack`, Pixler's bitmap history) and must never
 * depend on a shared undo rail across modes.
 */
export interface ToolMode {
  /** Stable, URL-safe identifier used for hash routing (`maker.html#<modeId>`). */
  readonly modeId: string;

  /** One-time setup, invoked by the host exactly once before the first `mount()`. */
  initialize(): void;

  /** Mounts the mode's UI into `hostEl`. */
  mount(hostEl: HTMLElement): void;

  /** Unmounts the mode's UI. GL-backed modes MUST release their live 3D surface here. */
  unmount(): void;

  /** Serialisable snapshot of the mode's document-scoped state, or `undefined` when stateless. */
  getState(): unknown;

  /** Restores a previously captured `getState()` snapshot. */
  setState(state: unknown): void;
}

/** Reserved mode id of the Maker world editor; the fallback the hash router bootstraps into. */
export const DEFAULT_MODE_ID = "world";

/** Mode ids of the tools merged into the shell (`maker.html#<id>`). */
export const XTRACTOR_MODE_ID = "xtractor";
export const PIXLER_MODE_ID = "pixler";
export const MAP_MODE_ID = "map";
export const MATERIAL_MODE_ID = "material";
export const IBL_MODE_ID = "ibl";
export const KIT_MODE_ID = "kit";
