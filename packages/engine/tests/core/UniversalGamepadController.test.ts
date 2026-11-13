import { JoyConGamepadDevice } from "../../src/core/input/UniversalGamepadController.js";
import type { JoyConLeft, JoyConRight } from "joy-con-webhid";

describe("UniversalGamepadController", () => {
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
});
