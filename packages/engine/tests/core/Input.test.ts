// @vitest-environment jsdom
import { Input, isEditingTextInput } from "../../src/core/input/Input.js";
import { Keys } from "../../src/enums/Keys.js";

describe("Input Gamepad Support", () => {
  let originalGetGamepads: (() => (Gamepad | null)[]) | undefined;
  let input: Input;

  beforeEach(() => {
    // Reset keys and mouse state
    input = new Input();
    // Clear private keys map using helper or setting key states to false
    for (const key of Object.values(Keys)) {
      input.setKeyState(key, false);
    }
    input.mouse.dx = 0;
    input.mouse.dy = 0;

    originalGetGamepads = navigator.getGamepads;
  });

  afterEach(() => {
    navigator.getGamepads = originalGetGamepads!;
  });

  function mockGamepad(axes: number[], buttons: { pressed: boolean }[]): Gamepad {
    return {
      axes,
      buttons,
      connected: true,
      id: "Mock Controller",
      index: 0,
      mapping: "standard",
      timestamp: performance.now(),
      vibrationActuator: null,
      hapticActuators: [],
    } as unknown as Gamepad;
  }

  it("should detect gamepad buttons mapping (A/Cross to SPACE)", () => {
    const gamepad = mockGamepad([0, 0, 0, 0], [{ pressed: true }]);
    navigator.getGamepads = (): Gamepad[] => [gamepad];

    expect(input.isPressed(Keys.SPACE)).toBe(true);
    expect(input.isPressed(Keys.ESCAPE)).toBe(false);
  });

  it("should map left stick to isPressed for directions", () => {
    // Left stick pushed fully up (axis 1 = -1.0)
    const gamepad = mockGamepad([0.0, -1.0, 0.0, 0.0], []);
    navigator.getGamepads = (): Gamepad[] => [gamepad];

    expect(input.isPressed(Keys.W)).toBe(true);
    expect(input.isPressed(Keys.UP)).toBe(true);
    expect(input.isPressed(Keys.S)).toBe(false);

    // Left stick pushed fully right (axis 0 = 1.0)
    const gamepad2 = mockGamepad([1.0, 0.0, 0.0, 0.0], []);
    navigator.getGamepads = (): Gamepad[] => [gamepad2];

    expect(input.isPressed(Keys.D)).toBe(true);
    expect(input.isPressed(Keys.RIGHT)).toBe(true);
    expect(input.isPressed(Keys.A)).toBe(false);
  });

  it("should map D-Pad buttons to directions", () => {
    // Map D-pad up (button 12)
    const buttons = Array.from({ length: 16 }, (_, idx) => ({
      pressed: idx === 12,
    }));
    const gamepad = mockGamepad([0, 0, 0, 0], buttons);
    navigator.getGamepads = (): Gamepad[] => [gamepad];

    expect(input.isPressed(Keys.UP)).toBe(true);
    expect(input.isPressed(Keys.DOWN)).toBe(false);
  });

  it("should interpolate axis from analog left stick in getAxis", () => {
    // Left stick pushed 50% down (axis 1 = 0.5)
    const gamepad = mockGamepad([0.0, 0.5, 0.0, 0.0], []);
    navigator.getGamepads = (): Gamepad[] => [gamepad];

    const vertical = input.getAxis(Keys.W, Keys.S);
    expect(vertical).toBeCloseTo(0.5, 2);
  });

  it("should accumulate look stick to mouse delta in update", () => {
    // Right stick pushed 80% right and 50% down (axes 2 = 0.8, axis 3 = 0.5)
    const gamepad = mockGamepad([0.0, 0.0, 0.8, 0.5], []);
    navigator.getGamepads = (): Gamepad[] => [gamepad];

    input.update();

    expect(input.mouse.dx).toBeCloseTo(0.8 * 15.0, 2);
    expect(input.mouse.dy).toBeCloseTo(0.5 * 15.0, 2);
  });

  describe("Lifecycle & Listener Cleanup", () => {
    it("attaches event listeners in init() and removes them cleanly in destroy()", () => {
      const liveInput = new Input();
      liveInput.init();

      // Dispatch keydown
      window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyW" }));
      expect(liveInput.isPressed("KeyW")).toBe(true);

      // Clean up
      liveInput.destroy();
      expect(liveInput.isPressed("KeyW")).toBe(false);

      // Dispatch keydown after destroy
      window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyW" }));
      expect(liveInput.isPressed("KeyW")).toBe(false);
    });
  });

  describe("isEditingTextInput Guard [MAJ-06]", () => {
    it("correctly identifies input, textarea, select, and contenteditable elements", () => {
      const inputEl = document.createElement("input");
      const textareaEl = document.createElement("textarea");
      const selectEl = document.createElement("select");
      const divEl = document.createElement("div");
      const editableDiv = document.createElement("div");
      editableDiv.contentEditable = "true";

      expect(isEditingTextInput(inputEl)).toBe(true);
      expect(isEditingTextInput(textareaEl)).toBe(true);
      expect(isEditingTextInput(selectEl)).toBe(true);
      expect(isEditingTextInput(editableDiv)).toBe(true);
      expect(isEditingTextInput(divEl)).toBe(false);
      expect(isEditingTextInput(null)).toBe(false);
    });
  });

  describe("Audit E4 Input regressions", () => {
    it("releases a held key on keyup even while an <input> is focused (IN02)", () => {
      const liveInput = new Input();
      liveInput.init();
      const field = document.createElement("input");
      document.body.appendChild(field);

      window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyW" }));
      expect(liveInput.isPressed("KeyW")).toBe(true);

      field.focus();
      window.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyW" }));
      expect(liveInput.isPressed("KeyW")).toBe(false);

      document.body.removeChild(field);
      liveInput.destroy();
    });

    it("scopes contextmenu and mousedown to target canvas when setTargetElement is used (IN01)", () => {
      const canvas = document.createElement("canvas");
      document.body.appendChild(canvas);
      const liveInput = new Input();
      liveInput.init(canvas);

      const winMenu = new MouseEvent("contextmenu", { cancelable: true });
      window.dispatchEvent(winMenu);
      expect(winMenu.defaultPrevented).toBe(false);

      const canvasMenu = new MouseEvent("contextmenu", { cancelable: true });
      canvas.dispatchEvent(canvasMenu);
      expect(canvasMenu.defaultPrevented).toBe(true);

      liveInput.destroy();
      document.body.removeChild(canvas);
    });

    it("normalizes wheel deltaMode line/page units and resets state on touchcancel/visibilitychange (IN05/IN06)", () => {
      const liveInput = new Input();
      liveInput.init();

      window.dispatchEvent(new WheelEvent("wheel", { deltaY: 3, deltaMode: 1 }));
      expect(liveInput.mouse.wheelY).toBe(48);

      liveInput.mouse.left = true;
      window.dispatchEvent(new Event("touchcancel"));
      expect(liveInput.mouse.left).toBe(false);

      window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyA" }));
      Object.defineProperty(document, "hidden", { configurable: true, value: true });
      document.dispatchEvent(new Event("visibilitychange"));
      expect(liveInput.isPressed("KeyA")).toBe(false);
      Object.defineProperty(document, "hidden", { configurable: true, value: false });

      liveInput.destroy();
    });

    it("uses radial deadzone and snapshots navigator.getGamepads once per update() frame (IN03/IN07)", () => {
      let calls = 0;
      const gp = mockGamepad([0.12, 0.12, 0, 0], [{ pressed: true }]);
      navigator.getGamepads = (): Gamepad[] => {
        calls++;
        return [gp];
      };

      input.update();
      expect(calls).toBe(1);

      // Diagonal (0.12, 0.12) has hypot ~0.17 > 0.15 -> radial deadzone passes, no extra getGamepads calls
      expect(input.getAxis(Keys.A, Keys.D)).toBeCloseTo(0.12, 4);
      expect(input.isPressed(Keys.SPACE)).toBe(true);
      expect(calls).toBe(1);
    });
  });
});
