import type {
  JoyConLeft,
  JoyConRight,
  GeneralController,
  ParsedJoyConPacketData,
  CompleteJoyConDataPacket,
  CompleteButtonStatus,
  AnalogStick,
} from "joy-con-webhid";

/**
 * Interface representing a generic gamepad device (standard or WebHID).
 */
export interface GamepadDevice {
  /** Descriptive identifier of the gamepad. */
  id: string;
  /** Whether the device is currently active and connected. */
  connected: boolean;
  /** Checks if a specific button is pressed using standard button indices (0-17). */
  isButtonPressed(buttonIndex: number): boolean;
  /** Returns the analog value of a specific axis (-1.0 to 1.0). */
  getAxis(axisIndex: number): number;
  /** Synchronizes state each frame. */
  update(): void;
}

/**
 * GamepadDevice implementation wrapping the native browser Gamepad API.
 */
export class StandardGamepadDevice implements GamepadDevice {
  public id: string;
  public connected: boolean = true;
  private _index: number;

  constructor(gamepad: Gamepad) {
    this.id = gamepad.id;
    this._index = gamepad.index;
  }

  private _getGamepad(): Gamepad | null {
    if (typeof navigator === "undefined" || !navigator.getGamepads) {
      return null;
    }
    const gps = navigator.getGamepads();
    return gps[this._index] || null;
  }

  public isButtonPressed(buttonIndex: number): boolean {
    const gp = this._getGamepad();
    if (!gp) return false;
    const btn = gp.buttons[buttonIndex];
    return btn ? btn.pressed : false;
  }

  public getAxis(axisIndex: number): number {
    const gp = this._getGamepad();
    if (!gp) return 0;
    const val = gp.axes[axisIndex];
    return val !== undefined ? val : 0;
  }

  public update(): void {
    const gp = this._getGamepad();
    this.connected = gp ? gp.connected : false;
  }
}

/**
 * GamepadDevice implementation wrapping one or two Nintendo Joy-Cons via WebHID.
 */
export class JoyConGamepadDevice implements GamepadDevice {
  public id: string;
  public connected: boolean = true;
  private _leftDevice: JoyConLeft | null = null;
  private _rightDevice: JoyConRight | null = null;

  private _buttonStates: { [key: number]: boolean } = {};
  private _axisStates: { [key: number]: number } = {};

  constructor(left: JoyConLeft | null, right: JoyConRight | null) {
    this._leftDevice = left;
    this._rightDevice = right;

    if (left && right) {
      this.id = "Combined Nintendo Joy-Cons (L + R)";
    } else if (left) {
      this.id = `Nintendo Joy-Con (L) - ${left.device.productName || "WebHID"}`;
    } else {
      this.id = `Nintendo Joy-Con (R) - ${right ? right.device.productName || "WebHID" : "WebHID"}`;
    }

    this._setupListeners();
  }

  private _setupListeners(): void {
    if (this._leftDevice) {
      this._leftDevice.on(
        "hidinput",
        (event: CustomEvent<ParsedJoyConPacketData | CompleteJoyConDataPacket>) => {
          this._handleInput(event.detail, "left");
        },
      );
    }
    if (this._rightDevice) {
      this._rightDevice.on(
        "hidinput",
        (event: CustomEvent<ParsedJoyConPacketData | CompleteJoyConDataPacket>) => {
          this._handleInput(event.detail, "right");
        },
      );
    }
  }

  private _handleInput(
    detail: ParsedJoyConPacketData | CompleteJoyConDataPacket,
    side: "left" | "right",
  ): void {
    if (!detail) return;

    const btns = (detail.buttonStatus || {}) as Partial<CompleteButtonStatus>;
    const sticks = detail.analogStick || {};
    const stickLeft = (detail.analogStickLeft || sticks) as Partial<AnalogStick>;
    const stickRight = (detail.analogStickRight || sticks) as Partial<AnalogStick>;

    const getFloatVal = (val: string | number | undefined): number => {
      if (typeof val === "number") return val;
      if (typeof val === "string") return parseFloat(val);
      return 0;
    };

    if (side === "left") {
      // D-Pad Buttons -> Standard button mapping
      if (btns.up !== undefined) this._buttonStates[12] = !!btns.up;
      if (btns.down !== undefined) this._buttonStates[13] = !!btns.down;
      if (btns.left !== undefined) this._buttonStates[14] = !!btns.left;
      if (btns.right !== undefined) this._buttonStates[15] = !!btns.right;

      // Triggers & Bumpers
      if (btns.l !== undefined) this._buttonStates[4] = !!btns.l;
      if (btns.zl !== undefined) this._buttonStates[6] = !!btns.zl;

      // System Buttons
      if (btns.minus !== undefined) this._buttonStates[8] = !!btns.minus;
      if (btns.capture !== undefined) this._buttonStates[17] = !!btns.capture;

      // Stick Click
      if (btns.leftStick !== undefined) this._buttonStates[10] = !!btns.leftStick;

      // Analog Stick (0 = X, 1 = Y)
      if (stickLeft.horizontal !== undefined) {
        this._axisStates[0] = getFloatVal(stickLeft.horizontal);
      }
      if (stickLeft.vertical !== undefined) {
        this._axisStates[1] = getFloatVal(stickLeft.vertical);
      }
    }

    if (side === "right") {
      // Face Buttons (A/B/X/Y)
      if (btns.a !== undefined) this._buttonStates[0] = !!btns.a;
      if (btns.b !== undefined) this._buttonStates[1] = !!btns.b;
      if (btns.x !== undefined) this._buttonStates[2] = !!btns.x;
      if (btns.y !== undefined) this._buttonStates[3] = !!btns.y;

      // Triggers & Bumpers
      if (btns.r !== undefined) this._buttonStates[5] = !!btns.r;
      if (btns.zr !== undefined) this._buttonStates[7] = !!btns.zr;

      // System Buttons
      if (btns.plus !== undefined) this._buttonStates[9] = !!btns.plus;
      if (btns.home !== undefined) this._buttonStates[16] = !!btns.home;

      // Stick Click
      if (btns.rightStick !== undefined) this._buttonStates[11] = !!btns.rightStick;

      // Analog Stick (2 = X, 3 = Y)
      if (stickRight.horizontal !== undefined) {
        this._axisStates[2] = getFloatVal(stickRight.horizontal);
      }
      if (stickRight.vertical !== undefined) {
        this._axisStates[3] = getFloatVal(stickRight.vertical);
      }
    }
  }

  public isButtonPressed(buttonIndex: number): boolean {
    return !!this._buttonStates[buttonIndex];
  }

  public getAxis(axisIndex: number): number {
    const val = this._axisStates[axisIndex];
    return val !== undefined ? val : 0;
  }

  public update(): void {
    const leftConnected = this._leftDevice ? this._leftDevice.device.opened : true;
    const rightConnected = this._rightDevice ? this._rightDevice.device.opened : true;
    this.connected = leftConnected && rightConnected;
  }
}

/**
 * Manages standard browser gamepads and WebHID Nintendo controllers.
 */
export class UniversalGamepadController {
  private _devices: GamepadDevice[] = [];
  private _joyConModule: typeof import("joy-con-webhid") | null = null;
  private _initializedJoyCons: Set<JoyConLeft | JoyConRight | GeneralController> = new Set();
  private _lastUpdateFrameTime: number = -1;
  private _pollIntervalId: ReturnType<typeof setInterval> | null = null;
  private _devicesBuilt: boolean = false;

  constructor() {
    this._loadModule();
  }

  public destroy(): void {
    if (null !== this._pollIntervalId) {
      clearInterval(this._pollIntervalId);
      this._pollIntervalId = null;
    }
  }

  private async _loadModule(): Promise<void> {
    if (typeof navigator !== "undefined" && "hid" in navigator) {
      try {
        this._joyConModule = await import("joy-con-webhid");
        this._initializeWebHIDDevices();
      } catch (e) {
        console.warn(
          "[UniversalGamepadController] joy-con-webhid load failed. WebHID disabled.",
          e,
        );
      }
    }
  }

  /**
   * Prompts the user to connect a new Joy-Con controller using WebHID.
   * MUST be called in response to a user gesture (e.g. click).
   */
  public async requestJoyConConnection(): Promise<void> {
    await this._loadModule();
    if (this._joyConModule && this._joyConModule.connectJoyCon) {
      await this._joyConModule.connectJoyCon();
    } else {
      console.warn("[UniversalGamepadController] WebHID or joy-con-webhid is not available.");
    }
  }

  private async _initializeWebHIDDevices(): Promise<void> {
    if (!this._joyConModule) return;

    const checkConnections = async (): Promise<void> => {
      const connectedMap = this._joyConModule?.connectedJoyCons;

      if (!connectedMap) return;

      for (const joyCon of connectedMap.values()) {
        if (this._initializedJoyCons.has(joyCon)) {
          continue;
        }

        try {
          await joyCon.open();
          await joyCon.enableStandardFullMode();
          await joyCon.enableIMUMode();
          await joyCon.enableVibration();

          this._initializedJoyCons.add(joyCon);
          // Device initialized
        } catch (e) {
          console.error("[UniversalGamepadController] Error opening Joy-Con WebHID", e);
        }
      }
    };

    await checkConnections();
    if (null !== this._pollIntervalId) {
      clearInterval(this._pollIntervalId);
    }
    this._pollIntervalId = setInterval(checkConnections, 1500);
  }

  /**
   * Updates all devices and scans for changes. Should be called once per frame.
   */
  public update(force: boolean = false): void {
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    if (!force && now === this._lastUpdateFrameTime) {
      return;
    }
    this._lastUpdateFrameTime = now;

    const standardDevices: GamepadDevice[] = [];
    if (typeof navigator !== "undefined" && navigator.getGamepads) {
      const gps = navigator.getGamepads();
      for (let i = 0; i < gps.length; i++) {
        const gp = gps[i];
        if (gp && gp.connected) {
          const idUpper = gp.id.toUpperCase();
          const isNintendo =
            idUpper.includes("NINTENDO") ||
            idUpper.includes("JOY-CON") ||
            idUpper.includes("PRO CONTROLLER");

          if (!isNintendo || !this._joyConModule) {
            standardDevices.push(new StandardGamepadDevice(gp));
          }
        }
      }
    }

    const webHidDevices: GamepadDevice[] = [];
    if (this._joyConModule && this._joyConModule.connectedJoyCons) {
      const connectedMap = this._joyConModule.connectedJoyCons;
      const leftJoyCons: JoyConLeft[] = [];
      const rightJoyCons: JoyConRight[] = [];
      const generalControllers: GeneralController[] = [];

      for (const jc of connectedMap.values()) {
        if (!jc.device.opened) continue;

        const name = jc.constructor.name;
        if (
          jc.device.productId === 8198 ||
          name.includes("Left") ||
          jc.device.productName?.includes("(L)")
        ) {
          leftJoyCons.push(jc as JoyConLeft);
        } else if (
          jc.device.productId === 8199 ||
          name.includes("Right") ||
          jc.device.productName?.includes("(R)")
        ) {
          rightJoyCons.push(jc as JoyConRight);
        } else {
          generalControllers.push(jc as GeneralController);
        }
      }

      const pairedLeft = new Set<JoyConLeft>();
      const pairedRight = new Set<JoyConRight>();

      const minPairs = Math.min(leftJoyCons.length, rightJoyCons.length);
      for (let i = 0; i < minPairs; i++) {
        const left = leftJoyCons[i];
        const right = rightJoyCons[i];
        if (left && right) {
          webHidDevices.push(new JoyConGamepadDevice(left, right));
          pairedLeft.add(left);
          pairedRight.add(right);
        }
      }

      for (const left of leftJoyCons) {
        if (!pairedLeft.has(left)) {
          webHidDevices.push(new JoyConGamepadDevice(left, null));
        }
      }
      for (const right of rightJoyCons) {
        if (!pairedRight.has(right)) {
          webHidDevices.push(new JoyConGamepadDevice(null, right));
        }
      }

      for (const gc of generalControllers) {
        webHidDevices.push(new JoyConGamepadDevice(gc as unknown as JoyConLeft, null));
      }
    }

    this._devices = [...standardDevices, ...webHidDevices];
    this._devicesBuilt = true;

    for (const dev of this._devices) {
      dev.update();
    }
  }

  public get devices(): GamepadDevice[] {
    if (!this._devicesBuilt) {
      this.update();
    }
    return this._devices;
  }

  public getActiveDevice(): GamepadDevice | null {
    if (!this._devicesBuilt) {
      this.update();
    }
    for (const dev of this._devices) {
      if (dev.connected) {
        return dev;
      }
    }
    return null;
  }
}
