import { describe, expect, it } from "vitest";
import { defaultPickingLabSettings } from "../Hud.js";

describe("PickingLab Settings", () => {
  it("initializes with recommended interactive defaults", () => {
    const settings = defaultPickingLabSettings();

    expect(settings.hoverEnabled).toBe(true);
    expect(settings.hoverScale).toBe(1.4);
    expect(settings.glowIntensity).toBe(2.5);
    expect(settings.glowColor).toBe("cyan");

    expect(settings.dragEnabled).toBe(true);
    expect(settings.dragMode).toBe("ground");

    expect(settings.clickRecolorEnabled).toBe(true);
    expect(settings.palette).toBe("cyber");

    expect(settings.gridSize).toBe(30);
    expect(settings.spacing).toBe(1.5);

    expect(settings.cameraMode).toBe("orbit");
    expect(settings.shadows).toBe(true);
    expect(settings.bloom).toBe(true);
  });
});
