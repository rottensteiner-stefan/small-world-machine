import { describe, expect, it } from "vitest";
import { StylizedWaterMaterial } from "@small-world-machine/engine";
import { DEFAULT_TUNE_PARAMETERS, LiveTunePad } from "../LiveTunePad.js";

describe("LiveTunePad (D4)", () => {
  function createPad(initialOptions?: {
    rampSoftness?: number;
    washAmount?: number;
    glitterStrength?: number;
  }): { material: StylizedWaterMaterial; pad: LiveTunePad } {
    const material = new StylizedWaterMaterial({
      rampSoftness: initialOptions?.rampSoftness ?? 0.3,
      washAmount: initialOptions?.washAmount ?? 0.2,
      glitterStrength: initialOptions?.glitterStrength ?? 0.5,
    });
    const pad = new LiveTunePad(material, { logger: (): void => {} });
    return { material, pad };
  }

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
});
