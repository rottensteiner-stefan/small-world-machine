import { FlashEffect } from "../../../../src/core/cameras/effects/FlashEffect.js";
import { Color } from "../../../../src/core/colors/index.js";

describe("FlashEffect", () => {
  it("starts at (near) peak intensity and decays quadratically toward zero", () => {
    const intensity = 0.8;
    const duration = 0.2;
    const effect = new FlashEffect(intensity, duration);

    effect.update(0.0001);
    expect(effect.flashIntensity).toBeCloseTo(intensity, 2);

    effect.update(duration / 2);
    const remaining = 1 - (0.0001 + duration / 2) / duration;
    expect(effect.flashIntensity).toBeCloseTo(intensity * remaining * remaining, 5);
  });

  it("finishes and zeroes the flash intensity once the duration elapses", () => {
    const effect = new FlashEffect(1.0, 0.2);

    effect.update(0.25);

    expect(effect.isFinished).toBe(true);
    expect(effect.flashIntensity).toBe(0);
  });

  it("defaults to a white flash but accepts a custom tint color", () => {
    const white = new FlashEffect();
    expect(white.flashColor.r).toBe(1);
    expect(white.flashColor.g).toBe(1);
    expect(white.flashColor.b).toBe(1);

    const red = new FlashEffect(1.0, 0.2, new Color(1, 0, 0));
    expect(red.flashColor.r).toBe(1);
    expect(red.flashColor.g).toBe(0);
    expect(red.flashColor.b).toBe(0);
  });
});
