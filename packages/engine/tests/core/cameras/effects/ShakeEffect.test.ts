import { ShakeEffect } from "../../../../src/core/cameras/effects/ShakeEffect.js";

describe("ShakeEffect", () => {
  it("keeps the rotation offsets within the trauma^2 envelope on every axis", () => {
    const intensity = 0.5;
    const duration = 0.5;
    const maxAngle = intensity * 0.15; // must match ShakeEffect's internal scale constant
    const effect = new ShakeEffect(intensity, duration);

    let t = 0;
    const step = 1 / 60;
    while (t < duration) {
      effect.update(step);
      t += step;

      const trauma = Math.max(0, 1.0 - t / duration);
      const envelope = maxAngle * trauma * trauma + 1e-6;

      expect(Math.abs(effect.pitchOffset)).toBeLessThanOrEqual(envelope);
      expect(Math.abs(effect.yawOffset)).toBeLessThanOrEqual(envelope);
      expect(effect.offset.x).toBe(0);
      expect(effect.offset.y).toBe(0);
      expect(effect.offset.z).toBe(0);
    }
  });

  it("finishes and zeroes the rotation offsets once trauma decays to zero", () => {
    const effect = new ShakeEffect(0.5, 0.2);

    effect.update(0.25);

    expect(effect.isFinished).toBe(true);
    expect(effect.pitchOffset).toBe(0);
    expect(effect.yawOffset).toBe(0);
  });

  it("produces different offsets for two simultaneously-created effects (per-instance seed)", () => {
    const a = new ShakeEffect(0.5, 1.0);
    const b = new ShakeEffect(0.5, 1.0);

    a.update(0.1);
    b.update(0.1);

    // Extremely unlikely to collide unless the per-instance seed offset were missing.
    expect(a.pitchOffset === b.pitchOffset && a.yawOffset === b.yawOffset).toBe(false);
  });

  it("merges a re-triggered shake into a single instance instead of stacking", () => {
    const a = new ShakeEffect(0.5, 0.5);
    const b = new ShakeEffect(0.5, 0.5);

    expect(a.merge?.(b)).toBe(true);
  });

  it("clamps merged trauma to 1 instead of letting it grow unbounded", () => {
    const a = new ShakeEffect(0.9, 0.5);
    const b = new ShakeEffect(0.9, 0.5);
    a.merge?.(b);

    a.update(0);
    const maxAngle = 0.9 * 0.15;

    // Trauma is clamped to 1, so the envelope can never exceed maxAngle even after merging
    // two high-intensity shakes.
    expect(Math.abs(a.pitchOffset)).toBeLessThanOrEqual(maxAngle + 1e-6);
    expect(Math.abs(a.yawOffset)).toBeLessThanOrEqual(maxAngle + 1e-6);
  });

  it("refuses to merge with an effect of a different type", () => {
    const a = new ShakeEffect(0.5, 0.5);
    const notAShake = { type: "OtherEffect" } as unknown as ShakeEffect;

    expect(a.merge?.(notAShake)).toBe(false);
  });
});
