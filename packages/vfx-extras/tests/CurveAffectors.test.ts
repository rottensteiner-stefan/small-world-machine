import { describe, expect, it } from "vitest";
import { Color, Vector3D } from "@small-world-machine/engine";
import { ParticleSystem } from "../src/ParticleSystem.js";
import { ColorRamp } from "../src/math/ColorRamp.js";
import { Curve1D } from "../src/math/Curve1D.js";
import { ColorRampAffector } from "../src/affectors/ColorRampAffector.js";
import { CurveOverLifeAffector } from "../src/affectors/CurveOverLifeAffector.js";
import { createArrays, setState, readState } from "./helpers/soa.js";

describe("ColorRampAffector", () => {
  it("interpolates colors over lifetime via the ramp (batch path)", () => {
    const ramp = new ColorRamp();
    ramp.addStop(0, new Color(1, 0, 0, 1));
    ramp.addStop(1, new Color(0, 0, 1, 0));
    const system = new ParticleSystem({ capacity: 2 });
    system.addAffector(new ColorRampAffector({ ramp }));
    const idx = system.emit({ position: new Vector3D(), maxLife: 10, life: 0 });
    expect(idx).toBe(0);
    system.update(0.1);
    let s = readState(system.arrays, 0);
    expect(s.col[0]).toBeCloseTo(0.99, 5); // t = 0.1/10 = 0.01
    expect(s.col[2]).toBeCloseTo(0.01, 5);
    system.update(5);
    s = readState(system.arrays, 0);
    expect(s.col[0]).toBeCloseTo(0.49, 5); // t = 5.1/10 = 0.51
    expect(s.col[2]).toBeCloseTo(0.51, 5);
  });

  it("writes ramp alpha only when rampAlpha is enabled", () => {
    const ramp = new ColorRamp();
    ramp.addStop(0, new Color(1, 1, 1, 1));
    ramp.addStop(1, new Color(0, 0, 0, 0));
    const system = new ParticleSystem({ capacity: 2 });
    system.addAffector(new ColorRampAffector({ ramp, rampAlpha: false }));
    system.emit({ maxLife: 10, alpha: 0.9 });
    system.update(5);
    expect(system.arrays.alphas[0]).toBeCloseTo(0.9, 6);
    expect(system.isAlive(0)).toBe(true);
  });

  it("matches batch output to per-slot apply bit-exactly (dead-slot skip)", () => {
    const ramp = new ColorRamp();
    ramp.addStop(0, new Color(1, 0, 0, 1));
    ramp.addStop(1, new Color(0, 1, 0, 0.25));
    const affector = new ColorRampAffector({ ramp });

    // Slot 0 alive, slot 1 dead (must be skipped by the batched path).
    const arrays = createArrays(2);
    setState(arrays, 0, { pos: [0, 0, 0], life: 0.5, maxLife: 2, col: [0, 0, 0, 0], alive: true });
    setState(arrays, 1, { pos: [1, 0, 0], life: 0.5, maxLife: 2, col: [0, 0, 0, 0], alive: false });

    const batch = createArrays(2);
    setState(batch, 0, { pos: [0, 0, 0], life: 0.5, maxLife: 2, col: [0, 0, 0, 0], alive: true });
    setState(batch, 1, { pos: [1, 0, 0], life: 0.5, maxLife: 2, col: [0, 0, 0, 0], alive: false });

    affector.apply(arrays, 0, 1 / 60);
    affector.applyBatch(batch, 2, 1 / 60);

    const single = readState(arrays, 0);
    const batched = readState(batch, 0);
    expect(single.col[0]).toBe(batched.col[0]);
    expect(single.col[1]).toBe(batched.col[1]);
    // Dead slot untouched on the batch path.
    const dead = readState(batch, 1);
    expect(dead.col).toEqual([0, 0, 0, 0]);
  });
});

describe("CurveOverLifeAffector", () => {
  it("drives sizes from the curve over lifetime", () => {
    const curve = new Curve1D();
    curve.setPoints([
      { t: 0, value: 0.5 },
      { t: 1, value: 3 },
    ]);
    const system = new ParticleSystem({ capacity: 2 });
    system.addAffector(new CurveOverLifeAffector({ curve }));
    system.emit({ maxLife: 10, size: 1 });
    system.update(0.1);
    const s = readState(system.arrays, 0);
    expect(s.size).toBeCloseTo(0.525, 5); // t = 0.01 -> 0.5 + 2.5 * 0.01
  });

  it("is inert when the curve is empty", () => {
    const system = new ParticleSystem({ capacity: 2 });
    system.addAffector(new CurveOverLifeAffector());
    system.emit({ maxLife: 10, size: 1.25 });
    system.update(0.5);
    expect(system.arrays.sizes[0]).toBe(1.25);
  });

  it("clamps authored negative values to zero", () => {
    const curve = new Curve1D();
    curve.setPoints([{ t: 0, value: -1 }]);
    const system = new ParticleSystem({ capacity: 2 });
    system.addAffector(new CurveOverLifeAffector({ curve }));
    system.emit({ maxLife: 10, size: 1 });
    system.update(0.1);
    expect(system.arrays.sizes[0]).toBe(0);
  });
});
