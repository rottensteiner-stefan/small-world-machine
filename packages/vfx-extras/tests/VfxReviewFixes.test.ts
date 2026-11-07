import { describe, expect, it } from "vitest";
import { AccretionDiskEmitter } from "../src/AccretionDiskEmitter.js";
import { ParticleSystem } from "../src/ParticleSystem.js";
import {
  DragAffector,
  FadeOutZoneAffector,
  PointAttractorAffector,
  ThermalCoolingAffector,
  VortexAffector,
} from "../src/affectors/index.js";
import type { CameraInterfaceData } from "@small-world-machine/engine";
import { PointLight, Vector3D } from "@small-world-machine/engine";
import { Fire } from "../src/fire/Fire.js";
import { FireLightBudget } from "../src/fire/FireLightBudget.js";

function snapshot(disk: AccretionDiskEmitter): number[] {
  return Array.from(disk.system.arrays.positions);
}

describe("AccretionDiskEmitter determinism", () => {
  it("same seed yields the identical disk, different seed a different one", () => {
    const a = snapshot(new AccretionDiskEmitter({ particleCount: 20, seed: 7 }));
    const b = snapshot(new AccretionDiskEmitter({ particleCount: 20, seed: 7 }));
    const c = snapshot(new AccretionDiskEmitter({ particleCount: 20, seed: 8 }));
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });
});

describe("force affectors with non-positive mass", () => {
  it("leave the acceleration finite (immovable) instead of Infinity/NaN", () => {
    const affectors = [
      new PointAttractorAffector({ center: new Vector3D(5, 0, 0) }),
      new DragAffector({ drag: 1 }),
      new VortexAffector({ strength: 2 }),
    ];
    for (const affector of affectors) {
      const system = new ParticleSystem({ capacity: 2, affectors: [affector] });
      const i = system.emit({
        position: new Vector3D(1, 0, 1),
        velocity: new Vector3D(1, 1, 1),
        mass: 0,
      });
      system.update(0.016);
      for (let k = 0; k < 3; k++) {
        expect(Number.isFinite(system.arrays.positions[i * 3 + k]!)).toBe(true);
      }
    }
  });
});

describe("FadeOutZoneAffector frame-rate independence", () => {
  function fadeAfter(fps: number): number {
    const zone = new FadeOutZoneAffector({ fadeStartRadius: 2, fadeEndRadius: 0.1 });
    const system = new ParticleSystem({ capacity: 1, affectors: [zone] });
    system.emit({ position: new Vector3D(1.0, 0, 0), alpha: 1 });
    const steps = fps; // one simulated second
    for (let s = 0; s < steps; s++) {
      system.arrays.positions[0] = 1.0; // hold particle in place
      system.arrays.velocities.fill(0);
      system.update(1 / fps);
    }
    return system.arrays.alphas[0]!;
  }

  it("fades the same amount over one second at 30, 60 and 144 fps", () => {
    const a60 = fadeAfter(60);
    expect(a60).toBeLessThan(1);
    expect(fadeAfter(30)).toBeCloseTo(a60, 5);
    expect(fadeAfter(144)).toBeCloseTo(a60, 5);
  });
});

describe("ThermalCoolingAffector", () => {
  it("applies heat/color via apply and applyBatch identically without per-particle state", () => {
    const make = (): ParticleSystem => {
      const s = new ParticleSystem({ capacity: 3 });
      for (let i = 0; i < 3; i++) {
        s.emit({ position: new Vector3D(i * 0.3, 0, 0), heat: 4 });
      }
      return s;
    };
    const batch = make();
    const single = make();
    const t = new ThermalCoolingAffector();
    t.applyBatch(batch.arrays, 3, 0.1);
    for (let i = 0; i < 3; i++) {
      t.apply(single.arrays, i, 0.1);
    }
    expect(Array.from(batch.arrays.colors)).toEqual(Array.from(single.arrays.colors));
    expect(Array.from(batch.arrays.heats)).toEqual(Array.from(single.arrays.heats));
  });
});

describe("Fire light budget integration (review fixes)", () => {
  const cam = (): CameraInterfaceData =>
    ({
      position: new Vector3D(0, 1, 0),
      target: new Vector3D(0, 1, -10),
    }) as unknown as CameraInterfaceData;

  it("keeps the light layer switch effective while registered in a FireLightBudget", () => {
    const light = new PointLight({ intensity: 3, distance: 8 });
    const fire = new Fire({ preset: "torch", light });
    const budget = new FireLightBudget({ maxActive: 4, fadeTime: 0.1 });
    budget.register(fire.lightBehavior);
    budget.onAttach(cam());
    for (let i = 0; i < 20; i++) budget.update(0.05);
    expect(light.isVisible).toBe(true);

    fire.setLayerEnabled("light", false);
    budget.update(0.05);
    expect(light.isVisible).toBe(false);

    fire.setLayerEnabled("light", true);
    budget.update(0.05);
    expect(light.isVisible).toBe(true);

    fire.setLayerEnabled("light", false);
    budget.unregister(fire.lightBehavior);
    expect(light.isVisible).toBe(false);
  });

  it("dispose detaches the behavior from an injected light and frees the budget slot", () => {
    const light = new PointLight({ intensity: 3, distance: 8 });
    const fire = new Fire({ preset: "torch", light });
    const budget = new FireLightBudget({ maxActive: 4, fadeTime: 0.1 });
    budget.register(fire.lightBehavior);
    budget.onAttach(cam());
    expect(budget.count).toBe(1);

    fire.dispose();
    expect(light.behaviors.includes(fire.lightBehavior)).toBe(false);
    budget.update(0.05);
    expect(budget.count).toBe(0);
    fire.dispose(); // safe twice
  });

  it("derives a small name seed so fp32 shader seeds stay precise", () => {
    const fire = new Fire({ preset: "torch", name: "a-rather-long-campfire-name-42" });
    expect(fire.seed).toBeGreaterThanOrEqual(0);
    expect(fire.seed).toBeLessThan(4096);
  });
});
