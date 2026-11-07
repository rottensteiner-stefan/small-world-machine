import { FlickerBehavior } from "../../../src/core/behaviors/FlickerBehavior.js";
import { Object3D } from "../../../src/core/Object3D.js";

describe("FlickerBehavior", () => {
  it("should toggle between stable and flickering phases and trigger callback", () => {
    let lastMultiplier = -1;
    const target = new Object3D("testTarget");
    const behavior = new FlickerBehavior({
      minStableTime: 0.1,
      maxStableTime: 0.1,
      minFlickerTime: 0.2,
      maxFlickerTime: 0.2,
      minMultiplier: 0.0,
      smoothness: 0.0,
      onUpdate: (multiplier): void => {
        lastMultiplier = multiplier;
      },
    });

    behavior.onAttach(target);

    // Initially should start flickering (timer is 0)
    behavior.update(0.01);

    let hadZero = false;
    let hadOne = false;

    // Simulate 3 seconds at 60 FPS
    for (let i = 0; i < 180; i++) {
      behavior.update(1 / 60);
      if (lastMultiplier === 0.0) hadZero = true;
      if (lastMultiplier === 1.0) hadOne = true;
    }

    expect(hadOne).toBe(true);
    expect(hadZero).toBe(true);
  });

  it("should de-correlate multiple FlickerBehavior instances", () => {
    let m1 = 0;
    let m2 = 0;
    const target1 = new Object3D("t1");
    const target2 = new Object3D("t2");

    const b1 = new FlickerBehavior({
      minStableTime: 0.0,
      maxStableTime: 0.0,
      minFlickerTime: 0.1,
      maxFlickerTime: 0.1,
      smoothness: 0.5,
      frequency: 15.0,
      noiseOffset: 0.0,
      onUpdate: (multiplier): void => {
        m1 = multiplier;
      },
    });
    const b2 = new FlickerBehavior({
      minStableTime: 0.0,
      maxStableTime: 0.0,
      minFlickerTime: 0.1,
      maxFlickerTime: 0.1,
      smoothness: 0.5,
      frequency: 15.0,
      noiseOffset: 1234.5,
      onUpdate: (multiplier): void => {
        m2 = multiplier;
      },
    });

    b1.onAttach(target1);
    b2.onAttach(target2);

    let differencesFound = 0;
    for (let i = 0; i < 120; i++) {
      b1.update(1 / 60);
      b2.update(1 / 60);
      if (Math.abs(m1 - m2) > 0.01) {
        differencesFound++;
      }
    }

    expect(differencesFound).toBeGreaterThan(0);
  });
});
