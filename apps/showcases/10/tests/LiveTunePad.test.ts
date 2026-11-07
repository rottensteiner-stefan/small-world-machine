import { describe, expect, it, vi } from "vitest";
import { StylizedWaterMaterial } from "@small-world-machine/engine";
import { DEFAULT_TUNE_PARAMETERS, LiveTunePad } from "../LiveTunePad.js";

describe("LiveTunePad (D4)", () => {
  function createPad(initialOptions?: {
    rampSoftness?: number;
    washAmount?: number;
    glitterStrength?: number;
  }): { material: StylizedWaterMaterial; pad: LiveTunePad; logs: string[] } {
    const material = new StylizedWaterMaterial({
      rampSoftness: initialOptions?.rampSoftness ?? 0.3,
      washAmount: initialOptions?.washAmount ?? 0.2,
      glitterStrength: initialOptions?.glitterStrength ?? 0.5,
    });
    const logs: string[] = [];
    const logger = (msg: string, ...args: unknown[]): void => {
      logs.push([msg, ...args].join(" "));
    };
    const pad = new LiveTunePad(material, { logger });
    return { material, pad, logs };
  }

  it("initializes with default parameter list and snapshots initial values", () => {
    const { material, pad } = createPad({ rampSoftness: 0.45, washAmount: 0.15 });
    expect(pad.parameters.length).toBe(DEFAULT_TUNE_PARAMETERS.length);
    expect(pad.selectedIndex).toBe(0);
    expect(pad.currentParam.key).toBe("rampSoftness");
    expect(pad.currentValue).toBe(0.45);

    const vector = pad.getVector();
    expect(vector.rampSoftness).toBe(0.45);
    expect(vector.washAmount).toBe(0.15);
    expect(material.rampSoftness).toBe(0.45);
  });

  it("navigates forward and backward through parameters with wrap-around", () => {
    const { pad } = createPad();
    expect(pad.selectedIndex).toBe(0);

    // Forward
    const p1 = pad.selectNext();
    expect(pad.selectedIndex).toBe(1);
    expect(p1.key).toBe(DEFAULT_TUNE_PARAMETERS[1]!.key);

    // Backward
    const p0 = pad.selectPrevious();
    expect(pad.selectedIndex).toBe(0);
    expect(p0.key).toBe(DEFAULT_TUNE_PARAMETERS[0]!.key);

    // Wrap-around backward
    const pLast = pad.selectPrevious();
    expect(pad.selectedIndex).toBe(DEFAULT_TUNE_PARAMETERS.length - 1);
    expect(pLast.key).toBe(DEFAULT_TUNE_PARAMETERS[DEFAULT_TUNE_PARAMETERS.length - 1]!.key);

    // Wrap-around forward
    const pWrap = pad.selectNext();
    expect(pad.selectedIndex).toBe(0);
    expect(pWrap.key).toBe(DEFAULT_TUNE_PARAMETERS[0]!.key);
  });

  it("increases and decreases parameter value by step", () => {
    const { material, pad } = createPad({ rampSoftness: 0.3 });
    expect(pad.currentParam.key).toBe("rampSoftness");

    pad.increase();
    expect(pad.currentValue).toBe(0.35);
    expect(material.rampSoftness).toBe(0.35);

    pad.decrease();
    expect(pad.currentValue).toBe(0.3);
    expect(material.rampSoftness).toBe(0.3);
  });

  it("clamps values to min and max boundaries", () => {
    const { material, pad } = createPad({ rampSoftness: 0.95 });
    pad.increase(); // 1.00
    expect(pad.currentValue).toBe(1.0);

    pad.increase(); // should clamp to 1.0 (max)
    expect(pad.currentValue).toBe(1.0);
    expect(material.rampSoftness).toBe(1.0);

    // Decrease down to min
    for (let i = 0; i < 30; i++) {
      pad.decrease();
    }
    expect(pad.currentValue).toBe(0.0);
    expect(material.rampSoftness).toBe(0.0);
  });

  it("resets current parameter with resetCurrent()", () => {
    const { material, pad } = createPad({ rampSoftness: 0.3 });
    pad.increase();
    pad.increase();
    expect(pad.currentValue).toBe(0.4);

    pad.resetCurrent();
    expect(pad.currentValue).toBe(0.3);
    expect(material.rampSoftness).toBe(0.3);
  });

  it("resets all parameters with resetAll()", () => {
    const { material, pad } = createPad({ rampSoftness: 0.3, washAmount: 0.2 });
    pad.selectParameter("rampSoftness");
    pad.increase();
    pad.selectParameter("washAmount");
    pad.increase();

    expect(material.rampSoftness).toBe(0.35);
    expect(material.washAmount).toBe(0.25);

    pad.resetAll();
    expect(material.rampSoftness).toBe(0.3);
    expect(material.washAmount).toBe(0.2);
  });

  it("handles keyboard events correctly", () => {
    const { material, pad, logs } = createPad({ rampSoftness: 0.5 });
    const preventDefault = vi.fn();

    // Navigation: ] (next)
    expect(pad.handleKeyDown({ key: "]", preventDefault })).toBe(true);
    expect(pad.selectedIndex).toBe(1);

    // Navigation: [ (previous)
    expect(pad.handleKeyDown({ key: "[", preventDefault })).toBe(true);
    expect(pad.selectedIndex).toBe(0);

    // ArrowUp: increase
    expect(pad.handleKeyDown({ key: "ArrowUp", preventDefault })).toBe(true);
    expect(material.rampSoftness).toBe(0.55);

    // ArrowDown: decrease
    expect(pad.handleKeyDown({ key: "ArrowDown", preventDefault })).toBe(true);
    expect(material.rampSoftness).toBe(0.5);

    // 0 without shift: reset current
    pad.increase();
    expect(material.rampSoftness).toBe(0.55);
    expect(pad.handleKeyDown({ key: "0", shiftKey: false, preventDefault })).toBe(true);
    expect(material.rampSoftness).toBe(0.5);

    // Shift+0: reset all
    pad.increase();
    expect(pad.handleKeyDown({ key: "0", shiftKey: true, preventDefault })).toBe(true);
    expect(material.rampSoftness).toBe(0.5);

    // g: log vector
    expect(pad.handleKeyDown({ key: "g", preventDefault })).toBe(true);
    expect(logs.some((l) => l.includes("Current Vector"))).toBe(true);

    // Unhandled key
    expect(pad.handleKeyDown({ key: "x", preventDefault })).toBe(false);
  });

  it("attaches and detaches event listener on target", () => {
    const { pad } = createPad();
    const listeners: Record<string, EventListener> = {};
    const mockTarget = {
      addEventListener: vi.fn((type: string, listener: EventListenerOrEventListenerObject) => {
        listeners[type] = listener as EventListener;
      }),
      removeEventListener: vi.fn((type: string) => {
        delete listeners[type];
      }),
    };

    pad.attach(mockTarget as unknown as EventTarget);
    expect(mockTarget.addEventListener).toHaveBeenCalledWith("keydown", expect.any(Function));

    // Trigger keydown
    const event = { key: "]" } as unknown as Event;
    listeners["keydown"]?.(event);
    expect(pad.selectedIndex).toBe(1);

    pad.detach();
    expect(mockTarget.removeEventListener).toHaveBeenCalledWith("keydown", expect.any(Function));
  });
});
