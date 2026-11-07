import { PulsatingBehavior } from "../../../src/core/behaviors/PulsatingBehavior.js";
import { Object3D } from "../../../src/core/Object3D.js";

describe("PulsatingBehavior", () => {
  it("should interpolate values smoothly between min and max", () => {
    let lastValue = 0;
    const target = new Object3D("testTarget");
    const behavior = new PulsatingBehavior({
      min: 0,
      max: 10,
      minDuration: 1.0,
      maxDuration: 1.0,
      onUpdate: (val): void => {
        lastValue = val;
      },
    });

    behavior.onAttach(target);
    behavior.update(0.0); // t = 0

    let hasMin = false;
    let hasMax = false;
    let inBounds = true;

    // Simulate 10 seconds of updates at 60 FPS
    for (let i = 0; i < 600; i++) {
      behavior.update(1 / 60);
      if (lastValue < 0 || lastValue > 10) inBounds = false;
      if (lastValue < 1.0) hasMin = true;
      if (lastValue > 9.0) hasMax = true;
    }

    expect(inBounds).toBe(true);
    expect(hasMin).toBe(true);
    expect(hasMax).toBe(true);
  });
});
