import {
  UniversalGamepadController,
  StandardGamepadDevice,
  JoyConGamepadDevice,
} from "../../src/core/input/UniversalGamepadController.js";
import type { JoyConLeft, JoyConRight } from "joy-con-webhid";

describe("UniversalGamepadController", () => {
  let originalGetGamepads: (() => (Gamepad | null)[]) | undefined;

  beforeEach(() => {
    originalGetGamepads = navigator.getGamepads;
  });

  afterEach(() => {
    navigator.getGamepads = originalGetGamepads!;
  });

  function mockGamepad(
    id: string,
    index: number,
    axes: number[],
    buttons: { pressed: boolean }[],
  ): Gamepad {
    return {
      id,
      index,
      axes,
      buttons,
      connected: true,
      timestamp: performance.now(),
      vibrationActuator: null,
      hapticActuators: [],
    } as unknown as Gamepad;
  }

  it("StandardGamepadDevice should read buttons and axes", () => {
    const rawGp = mockGamepad(
      "Xbox Controller",
      0,
      [0.5, -0.2],
      [{ pressed: true }, { pressed: false }],
    );
    navigator.getGamepads = (): Gamepad[] => [rawGp];

    const device = new StandardGamepadDevice(rawGp);
    expect(device.id).toBe("Xbox Controller");
    expect(device.isButtonPressed(0)).toBe(true);
    expect(device.isButtonPressed(1)).toBe(false);
    expect(device.getAxis(0)).toBeCloseTo(0.5, 2);
    expect(device.getAxis(1)).toBeCloseTo(-0.2, 2);
  });

  it("JoyConGamepadDevice should handle left, right or combined mapping", () => {
    type HidInputCallback = (event: { detail: Record<string, unknown> }) => void;
    const leftCallbackRef: { current: HidInputCallback | null } = { current: null };
    const rightCallbackRef: { current: HidInputCallback | null } = { current: null };

    const mockLeft = {
      device: { productName: "Joy-Con (L)", opened: true } as unknown as {
        productName: string;
        opened: boolean;
      },
      on: (event: string, cb: HidInputCallback): void => {
        if (event === "hidinput") leftCallbackRef.current = cb;
      },
    } as unknown as JoyConLeft;

    const mockRight = {
      device: { productName: "Joy-Con (R)", opened: true } as unknown as {
        productName: string;
        opened: boolean;
      },
      on: (event: string, cb: HidInputCallback): void => {
        if (event === "hidinput") rightCallbackRef.current = cb;
      },
    } as unknown as JoyConRight;

    const device = new JoyConGamepadDevice(mockLeft, mockRight);
    expect(device.id).toBe("Combined Nintendo Joy-Cons (L + R)");

    // Simulate Left JoyCon input (Dpad down, stick left)
    leftCallbackRef.current?.({
      detail: {
        buttonStatus: { down: true },
        analogStickLeft: { horizontal: "-0.7", vertical: "0.1" },
      },
    });

    expect(device.isButtonPressed(13)).toBe(true); // Dpad Down
    expect(device.isButtonPressed(0)).toBe(false); // A button
    expect(device.getAxis(0)).toBeCloseTo(-0.7, 2);

    // Simulate Right JoyCon input (A button, stick right)
    rightCallbackRef.current?.({
      detail: {
        buttonStatus: { a: true },
        analogStickRight: { horizontal: "0.8", vertical: "-0.3" },
      },
    });

    expect(device.isButtonPressed(0)).toBe(true); // A button
    expect(device.getAxis(2)).toBeCloseTo(0.8, 2);
  });

  it("UniversalGamepadController should list and query devices", () => {
    const rawGp = mockGamepad(
      "Xbox Controller",
      0,
      [0.5, -0.2],
      [{ pressed: true }, { pressed: false }],
    );
    navigator.getGamepads = (): Gamepad[] => [rawGp];

    const controller = new UniversalGamepadController();
    controller.update();
    expect(controller.devices.length).toBe(1);
    expect(controller.getActiveDevice()).not.toBeNull();
  });
});
