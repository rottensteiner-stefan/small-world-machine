import { describe, it, expect } from "vitest";
import type { CameraInterfaceData } from "@small-world-machine/engine";
import { Color, PointLight, Vector3D } from "@small-world-machine/engine";
import { FireFlickerProfile } from "../src/fire/FireFlickerProfile.js";
import { FireLightBehavior, temperatureRatio } from "../src/fire/FireLightBehavior.js";
import { FireLightBudget } from "../src/fire/FireLightBudget.js";

const DT = 1 / 60;

function makeFire(x: number, seed: number = 0): { light: PointLight; fire: FireLightBehavior } {
  const light = new PointLight({ intensity: 3, distance: 8 });
  light.position.set(x, 1, 0);
  light.updateMatrixWorld(true);
  const fire = new FireLightBehavior({ seed, temperatureK: 2000 });
  light.addBehavior(fire);
  return { light, fire };
}

describe("FireFlickerProfile", () => {
  it("is a pure function of seed and time", () => {
    const a = new FireFlickerProfile(7);
    const b = new FireFlickerProfile(7);
    for (let t = 0; t < 5; t += 0.37) {
      expect(a.sample(t)).toBe(b.sample(t));
    }
  });

  it("gives different seeds uncorrelated curves", () => {
    const a = new FireFlickerProfile(1);
    const b = new FireFlickerProfile(2);
    let differing = 0;
    for (let t = 0; t < 5; t += 0.1) {
      if (Math.abs(a.sample(t) - b.sample(t)) > 0.02) differing++;
    }
    expect(differing).toBeGreaterThan(25);
  });

  it("breathes inside [MIN, MAX] without jumps and never settles", () => {
    const p = new FireFlickerProfile(3);
    let min = Infinity;
    let max = -Infinity;
    let prev = p.sample(0);
    let maxStep = 0;
    for (let frame = 1; frame < 60 * 60; frame++) {
      const v = p.sample(frame * DT);
      min = Math.min(min, v);
      max = Math.max(max, v);
      maxStep = Math.max(maxStep, Math.abs(v - prev));
      prev = v;
    }
    expect(min).toBeGreaterThanOrEqual(FireFlickerProfile.MIN);
    expect(max).toBeLessThanOrEqual(FireFlickerProfile.MAX);
    // Continuous flicker: visible range, but no single-frame pops.
    expect(max - min).toBeGreaterThan(0.3);
    expect(maxStep).toBeLessThan(0.1);
  });
});

describe("FireLightBehavior", () => {
  it("captures base intensity and position on attach", () => {
    const { fire } = makeFire(2);
    expect(fire.baseIntensity).toBe(3);
    expect(fire.basePosition.x).toBe(2);
  });

  it("flickers intensity, cools the colour when dim and sways within the jitter radius", () => {
    const { light, fire } = makeFire(0, 5);
    let dimmest = Infinity;
    let dimmestGreen = 0;
    let brightest = -Infinity;
    let brightestGreen = 0;
    for (let frame = 0; frame < 600; frame++) {
      fire.update(DT);
      expect(light.intensity).toBeCloseTo(3 * fire.value, 6);
      expect(Math.abs(light.position.x)).toBeLessThanOrEqual(fire.jitter + 1e-9);
      expect(Math.abs(light.position.z)).toBeLessThanOrEqual(fire.jitter + 1e-9);
      const ratio = temperatureRatio(fire.value);
      expect(light.color.g).toBeCloseTo(Color.fromTemperature(2000 * ratio).g, 6);
      if (fire.value < dimmest) [dimmest, dimmestGreen] = [fire.value, light.color.g];
      if (fire.value > brightest) [brightest, brightestGreen] = [fire.value, light.color.g];
    }
    // Dimmer flame = lower temperature = less green in the light (deeper orange-red).
    expect(dimmestGreen).toBeLessThan(brightestGreen);
  });

  it("maps base, dimmest and brightest flicker onto the documented temperatures", () => {
    expect(temperatureRatio(1)).toBe(1);
    expect(temperatureRatio(FireFlickerProfile.MIN)).toBeCloseTo(0.86, 10);
    expect(temperatureRatio(FireFlickerProfile.MAX)).toBeCloseTo(1.08, 10);
  });

  it("holds a steady light at base intensity, colour and position with flicker 0", () => {
    const { light, fire } = makeFire(2, 4);
    fire.flicker = 0;
    for (let frame = 0; frame < 120; frame++) {
      fire.update(DT);
      expect(light.intensity).toBe(3);
      expect(light.position.x).toBe(2);
      expect(light.color.g).toBe(Color.fromTemperature(2000).g);
    }
    // and back: flicker resumes without any reset
    fire.flicker = 1;
    let moved = false;
    for (let frame = 0; frame < 120; frame++) {
      fire.update(DT);
      moved = moved || light.intensity !== 3;
    }
    expect(moved).toBe(true);
  });

  it("leaves the colour alone without a temperature (palette fire)", () => {
    const light = new PointLight({ intensity: 2, color: new Color(0.2, 0.55, 1) });
    light.addBehavior(new FireLightBehavior({ seed: 1 }));
    for (let frame = 0; frame < 120; frame++) light.behaviors[0]!.update(DT);
    expect([light.color.r, light.color.g, light.color.b]).toEqual([0.2, 0.55, 1]);
  });

  it("reproduces a frozen frame from time alone", () => {
    const a = makeFire(0, 9);
    const b = makeFire(0, 9);
    for (let frame = 0; frame < 90; frame++) a.fire.update(DT);
    b.fire.time = a.fire.time;
    b.fire.apply();
    expect(b.light.intensity).toBe(a.light.intensity);
    expect(b.light.position.x).toBe(a.light.position.x);
  });
});

describe("FireLightBudget", () => {
  function camera(x: number): CameraInterfaceData {
    return { position: new Vector3D(x, 1, 0) } as unknown as CameraInterfaceData;
  }

  it("keeps the nearest fires lit and fades the rest out of the light list", () => {
    const fires = [makeFire(0), makeFire(5), makeFire(50)];
    const budget = new FireLightBudget({ maxActive: 2, fadeTime: 0.5 });
    for (const f of fires) budget.register(f.fire);
    budget.onAttach(camera(0));

    for (let frame = 0; frame < 40; frame++) budget.update(DT);

    expect(fires[0]!.fire.fade).toBe(1);
    expect(fires[1]!.fire.fade).toBe(1);
    expect(fires[2]!.fire.fade).toBe(0);
    expect(fires[2]!.light.isVisible).toBe(false);
    expect(fires[0]!.light.isVisible).toBe(true);
  });

  it("swaps lights over fadeTime when the camera moves (transition both ways)", () => {
    const near = makeFire(0);
    const far = makeFire(40);
    const budget = new FireLightBudget({ maxActive: 1, fadeTime: 0.5 });
    budget.register(near.fire);
    budget.register(far.fire);
    const cam = camera(0);
    budget.onAttach(cam);
    for (let frame = 0; frame < 40; frame++) budget.update(DT);
    expect(near.fire.fade).toBe(1);
    expect(far.fire.fade).toBe(0);

    cam.position.set(40, 1, 0);
    budget.update(DT);
    // Mid-transition: neither pops, the outgoing one is still visible.
    expect(near.fire.fade).toBeGreaterThan(0.9);
    expect(near.light.isVisible).toBe(true);
    expect(far.fire.fade).toBeGreaterThan(0);
    expect(far.light.isVisible).toBe(true);

    for (let frame = 0; frame < 40; frame++) budget.update(DT);
    expect(near.fire.fade).toBe(0);
    expect(near.light.isVisible).toBe(false);
    expect(far.fire.fade).toBe(1);
  });

  it("restores a fire to fully lit when it leaves budget control", () => {
    const a = makeFire(0);
    const b = makeFire(30);
    const budget = new FireLightBudget({ maxActive: 1 });
    budget.register(a.fire);
    budget.register(b.fire);
    budget.onAttach(camera(0));
    for (let frame = 0; frame < 60; frame++) budget.update(DT);
    budget.unregister(b.fire);
    expect(b.fire.fade).toBe(1);
    expect(b.light.isVisible).toBe(true);
    expect(budget.count).toBe(1);
  });
});
