import { UniversalGamepadController } from "./UniversalGamepadController.js";
import { Keys } from "../../enums/index.js";
import { MathUtils } from "../../math/index.js";

/**
 * Interface for mouse state.
 */
export interface MouseState {
  x: number;
  y: number;
  dx: number;
  dy: number;
  wheelX: number;
  wheelY: number;
  zoom: number;
  left: boolean;
  right: boolean;
}

/**
 * Interface for Input management to allow mocking and dependency injection.
 */
export interface InputInterface {
  mouse: MouseState;
  isPointerLocked: boolean;
  isPressed(code: string | Keys): boolean;
  getAxis(neg: string | Keys, pos: string | Keys): number;
}

/**
 * Helper to check whether an active element or event target is a text input field,
 * textarea, select dropdown, or contenteditable element where keyboard shortcuts
 * should not be intercepted.
 * @param target The target element to test (defaults to document.activeElement).
 * @returns True if the user is currently editing text.
 */
export function isEditingTextInput(
  target: EventTarget | null = typeof document !== "undefined" ? document.activeElement : null,
): boolean {
  if (!target || !(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if ("INPUT" === tag || "TEXTAREA" === tag || "SELECT" === tag) return true;
  if (
    target.isContentEditable ||
    target.contentEditable === "true" ||
    target.contentEditable === "plaintext-only" ||
    target.getAttribute("contenteditable") === "true" ||
    target.getAttribute("contenteditable") === ""
  ) {
    return true;
  }
  return false;
}

/**
 * Handles user input (keyboard and mouse).
 * Implements a static singleton pattern for global access,
 * but can be instantiated or mocked for testing.
 */
export class Input implements InputInterface {
  public preventPointerLock: boolean = false;
  private _keys: Map<string, boolean> = new Map<string, boolean>();
  private _gamepadController: UniversalGamepadController = new UniversalGamepadController();

  /** Mouse state including position and button status. */
  public mouse: MouseState = {
    x: 0,
    y: 0,
    dx: 0,
    dy: 0,
    wheelX: 0,
    wheelY: 0,
    zoom: 0,
    left: false,
    right: false,
  };

  /** Whether the pointer is currently locked. */
  public isPointerLocked: boolean = false;
  /** Whether debug mode is enabled for input. */
  public debug: boolean = false;

  public get gamepadController(): UniversalGamepadController {
    return this._gamepadController;
  }
  public requestJoyConConnection(): Promise<void> {
    return this._gamepadController.requestJoyConConnection();
  }

  private _lastTouchX: number = 0;
  private _lastTouchY: number = 0;
  private _isInitialized: boolean = false;

  private _onKeyDown = (e: KeyboardEvent): void => {
    if (isEditingTextInput(e.target) || isEditingTextInput()) {
      return;
    }
    this._keys.set(e.code, true);
  };

  private _onKeyUp = (e: KeyboardEvent): void => {
    const active = document.activeElement;
    if (active && ["INPUT", "TEXTAREA", "SELECT"].includes(active.tagName)) {
      return;
    }
    this._keys.set(e.code, false);
  };

  private _onMouseDown = (e: MouseEvent): void => {
    this.mouse.x = e.clientX;
    this.mouse.y = e.clientY;
    if (0 === e.button) {
      this.mouse.left = true;
    }
    if (2 === e.button) {
      this.mouse.right = true;
    }
  };

  private _onMouseUp = (e: MouseEvent): void => {
    this.mouse.x = e.clientX;
    this.mouse.y = e.clientY;
    if (0 === e.button) {
      this.mouse.left = false;
    }
    if (2 === e.button) {
      this.mouse.right = false;
    }
  };

  private _onMouseMove = (e: MouseEvent): void => {
    this.mouse.x = e.clientX;
    this.mouse.y = e.clientY;
    if (typeof e.buttons === "number") {
      this.mouse.left = (e.buttons & 1) !== 0;
      this.mouse.right = (e.buttons & 2) !== 0;
    }
    const dx = typeof e.movementX === "number" ? e.movementX : 0;
    const dy = typeof e.movementY === "number" ? e.movementY : 0;
    if (!Number.isNaN(dx)) this.mouse.dx += dx;
    if (!Number.isNaN(dy)) this.mouse.dy += dy;
  };

  private _onWheel = (e: WheelEvent): void => {
    // Pinch-to-zoom on trackpads is often sent as a wheel event with ctrlKey
    if (e.ctrlKey) {
      e.preventDefault();
      this.mouse.zoom += e.deltaY * 0.01;
    } else {
      this.mouse.wheelX += e.deltaX;
      this.mouse.wheelY += e.deltaY;
      this.mouse.zoom += e.deltaY * 0.001;
    }
  };

  private _onGestureChange = (e: Event): void => {
    e.preventDefault();
    const gestureEvent = e as unknown as { scale: number };
    this.mouse.zoom += (1.0 - gestureEvent.scale) * 2.0;
  };

  private _onContextMenu = (e: MouseEvent): void => {
    e.preventDefault();
  };

  private _onBlur = (): void => {
    this._keys.clear();
    this.mouse.left = false;
    this.mouse.right = false;
    this.mouse.dx = 0;
    this.mouse.dy = 0;
  };

  private _onPointerLockChange = (): void => {
    this.isPointerLocked = null !== document.pointerLockElement;
    // Reset deltas when lock state changes to prevent jumping
    this.mouse.dx = 0;
    this.mouse.dy = 0;
  };

  private _onTouchStart = (e: TouchEvent): void => {
    if (e.touches.length > 0) {
      this._lastTouchX = e.touches[0]!.clientX;
      this._lastTouchY = e.touches[0]!.clientY;
      this.mouse.x = this._lastTouchX;
      this.mouse.y = this._lastTouchY;
      this.mouse.left = true;
    }
  };

  private _onTouchMove = (e: TouchEvent): void => {
    if (e.touches.length > 0) {
      const currentX = e.touches[0]!.clientX;
      const currentY = e.touches[0]!.clientY;
      this.mouse.dx += currentX - this._lastTouchX;
      this.mouse.dy += currentY - this._lastTouchY;
      this.mouse.x = currentX;
      this.mouse.y = currentY;
      this._lastTouchX = currentX;
      this._lastTouchY = currentY;
    }
  };

  private _onTouchEnd = (e: TouchEvent): void => {
    if (e.touches.length === 0) {
      this.mouse.left = false;
    }
  };

  /**
   * Initializes the input listeners.
   */
  public init(): void {
    if (this._isInitialized) return;
    this._isInitialized = true;

    window.addEventListener("keydown", this._onKeyDown);
    window.addEventListener("keyup", this._onKeyUp);
    window.addEventListener("mousedown", this._onMouseDown);
    window.addEventListener("mouseup", this._onMouseUp);
    window.addEventListener("mousemove", this._onMouseMove);
    window.addEventListener("wheel", this._onWheel, { passive: false });
    window.addEventListener("gesturechange", this._onGestureChange);
    window.addEventListener("contextmenu", this._onContextMenu);
    window.addEventListener("blur", this._onBlur);
    document.addEventListener("pointerlockchange", this._onPointerLockChange);
    window.addEventListener("touchstart", this._onTouchStart, { passive: true });
    window.addEventListener("touchmove", this._onTouchMove, { passive: true });
    window.addEventListener("touchend", this._onTouchEnd);
  }

  /**
   * Removes all global input listeners and cleans up resources.
   */
  public destroy(): void {
    if (!this._isInitialized) return;
    this._isInitialized = false;

    window.removeEventListener("keydown", this._onKeyDown);
    window.removeEventListener("keyup", this._onKeyUp);
    window.removeEventListener("mousedown", this._onMouseDown);
    window.removeEventListener("mouseup", this._onMouseUp);
    window.removeEventListener("mousemove", this._onMouseMove);
    window.removeEventListener("wheel", this._onWheel);
    window.removeEventListener("gesturechange", this._onGestureChange);
    window.removeEventListener("contextmenu", this._onContextMenu);
    window.removeEventListener("blur", this._onBlur);
    document.removeEventListener("pointerlockchange", this._onPointerLockChange);
    window.removeEventListener("touchstart", this._onTouchStart);
    window.removeEventListener("touchmove", this._onTouchMove);
    window.removeEventListener("touchend", this._onTouchEnd);

    this._keys.clear();
    this._gamepadController.destroy();
  }

  public requestPointerLock(element: HTMLElement): void {
    if (true === this.preventPointerLock) {
      return;
    }
    try {
      element.requestPointerLock();
    } catch (e: unknown) {
      console.warn("[Input] Could not activate PointerLock:", e);
    }
  }

  /** @inheritdoc */
  public isPressed(code: string | Keys): boolean {
    if (true === this._keys.get(code)) {
      return true;
    }

    const gp = this._gamepadController.getActiveDevice();
    if (gp) {
      const deadzone = 0.5;

      // Map left stick directions to movement keys
      if (code === Keys.W || code === Keys.UP) {
        if (gp.getAxis(1) < -deadzone) return true;
      }
      if (code === Keys.S || code === Keys.DOWN) {
        if (gp.getAxis(1) > deadzone) return true;
      }
      if (code === Keys.A || code === Keys.LEFT) {
        if (gp.getAxis(0) < -deadzone) return true;
      }
      if (code === Keys.D || code === Keys.RIGHT) {
        if (gp.getAxis(0) > deadzone) return true;
      }

      // Map gamepad button 0 (A / Cross) to Space
      if (code === Keys.SPACE) {
        if (gp.isButtonPressed(0)) return true;
      }

      // Map D-Pad buttons
      if (code === Keys.UP) {
        if (gp.isButtonPressed(12)) return true;
      }
      if (code === Keys.DOWN) {
        if (gp.isButtonPressed(13)) return true;
      }
      if (code === Keys.LEFT) {
        if (gp.isButtonPressed(14)) return true;
      }
      if (code === Keys.RIGHT) {
        if (gp.isButtonPressed(15)) return true;
      }
    }

    return false;
  }

  /** @inheritdoc */
  public getAxis(neg: string | Keys, pos: string | Keys): number {
    let v: number = 0;
    if (this.isPressed(neg)) v -= 1;
    if (this.isPressed(pos)) v += 1;

    const gp = this._gamepadController.getActiveDevice();
    if (gp) {
      const deadzone = 0.15;
      if ((neg === Keys.W || neg === Keys.UP) && (pos === Keys.S || pos === Keys.DOWN)) {
        const val = gp.getAxis(1);
        if (Math.abs(val) > deadzone) {
          v += val;
        }
      }
      if ((neg === Keys.A || neg === Keys.LEFT) && (pos === Keys.D || pos === Keys.RIGHT)) {
        const val = gp.getAxis(0);
        if (Math.abs(val) > deadzone) {
          v += val;
        }
      }
    }

    return MathUtils.clamp(v, -1.0, 1.0);
  }

  private _lastDebugLog: number = 0;

  /**
   * Polls gamepad look axes and accumulates them into mouse deltas.
   * Should be called once per frame.
   */
  public update(): void {
    this._gamepadController.update();
    const gp = this._gamepadController.getActiveDevice();
    if (!gp) return;

    const deadzone = 0.15;
    const rx = gp.getAxis(2);
    const ry = gp.getAxis(3);

    // Accumulate right stick movements into mouse.dx / mouse.dy
    if (Math.abs(rx) > deadzone) {
      this.mouse.dx += rx * 15.0;
    }
    if (Math.abs(ry) > deadzone) {
      this.mouse.dy += ry * 15.0;
    }

    // Diagnostics logging when debug is enabled
    if (this.debug) {
      const now = performance.now();
      if (now - this._lastDebugLog > 500) {
        // throttle log to every 500ms
        const axes: string[] = [];
        for (let i = 0; i < 4; i++) {
          const val = gp.getAxis(i);
          if (Math.abs(val) > 0.05) {
            axes.push(`Axis ${i}: ${val.toFixed(2)}`);
          }
        }
        const buttons: string[] = [];
        for (let i = 0; i < 18; i++) {
          if (gp.isButtonPressed(i)) {
            buttons.push(`Btn ${i}: Pressed`);
          }
        }

        // Debug logging removed
        this._lastDebugLog = now;
      }
    }
  }

  /**
   * Helper for testing to manually set key state.
   */
  public setKeyState(code: string | Keys, pressed: boolean): void {
    this._keys.set(code, pressed);
  }
}
