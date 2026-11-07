/** Mouse fields the guard clears when a press lands on the panel so the camera does not jerk. */
export interface HudGuardInput {
  readonly mouse: { dx: number; dy: number; zoom: number; left: boolean };
}

export interface HudPointerGuardOptions {
  readonly root: HTMLElement;
  readonly input: HudGuardInput;
  /** Window `pointerup` listener is removed with this signal (Showcase teardown). */
  readonly signal: AbortSignal;
  /** Pointer entered or pressed inside the panel: pause the camera controllers. */
  readonly onEngage: () => void;
  /** Pointer left (or a drag ended outside) the panel: re-evaluate the controllers. */
  readonly onRelease: () => void;
}

/**
 * Tracks hover/drag on a HUD panel so camera controllers pause while the user interacts with it.
 * A drag that starts in the panel keeps the guard engaged until `pointerup`, even outside it.
 */
export class HudPointerGuard {
  private _hovering = false;
  private _dragging = false;

  constructor(options: HudPointerGuardOptions) {
    const { root, input, signal, onEngage, onRelease } = options;
    root.addEventListener("pointerenter", () => {
      this._hovering = true;
      onEngage();
    });
    root.addEventListener("pointerleave", (e: PointerEvent) => {
      if (0 === e.buttons && !this._dragging) {
        this._hovering = false;
        onRelease();
      }
    });
    root.addEventListener("pointerdown", () => {
      this._hovering = true;
      this._dragging = true;
      onEngage();
      input.mouse.dx = 0;
      input.mouse.dy = 0;
      input.mouse.zoom = 0;
      input.mouse.left = false;
    });
    window.addEventListener(
      "pointerup",
      () => {
        if (!this._dragging) return;
        this._dragging = false;
        if (!root.matches(":hover")) {
          this._hovering = false;
          onRelease();
        }
      },
      { signal },
    );
  }

  public get hovering(): boolean {
    return this._hovering;
  }

  public get dragging(): boolean {
    return this._dragging;
  }

  /** True while the panel owns the pointer (hover or drag). */
  public get blocking(): boolean {
    return this._hovering || this._dragging;
  }

  /** Clears both flags, e.g. when the panel closes under the pointer. */
  public reset(): void {
    this._hovering = false;
    this._dragging = false;
  }
}
