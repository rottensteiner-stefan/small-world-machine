import { describe, it, expect } from "vitest";
import { Vector3D, Color } from "@small-world-machine/engine";
import { PointAttractorAffector } from "../src/affectors/PointAttractorAffector.js";
import { VortexAffector } from "../src/affectors/VortexAffector.js";
import { PlanarSpringAffector } from "../src/affectors/PlanarSpringAffector.js";
import { ThermalCoolingAffector } from "../src/affectors/ThermalCoolingAffector.js";
import { FadeOutZoneAffector } from "../src/affectors/FadeOutZoneAffector.js";
import { TurbulenceAffector } from "../src/affectors/TurbulenceAffector.js";
import { DragAffector } from "../src/affectors/DragAffector.js";
import { ColorOverLifeAffector } from "../src/affectors/ColorOverLifeAffector.js";
import { SizeOverLifeAffector } from "../src/affectors/SizeOverLifeAffector.js";
import { BouncePlaneAffector } from "../src/affectors/BouncePlaneAffector.js";
import { createArrays, setState, readState } from "./helpers/soa.js";

describe("Affectors", () => {
  it("PointAttractorAffector pulls particles towards center", () => {
    const attractor = new PointAttractorAffector({
      center: new Vector3D(0, 0, 0),
      strength: 100,
      softening: 0.5,
      plummer: true,
    });

    const arrays = createArrays(1);
    setState(arrays, 0, { pos: [10, 0, 0] });
    attractor.apply(arrays, 0, 0.1);

    const state = readState(arrays, 0);
    expect(state.acc[0]).toBeLessThan(0); // Pulled in -X direction
    expect(state.acc[1]).toBe(0);
    expect(state.acc[2]).toBe(0);
  });

  it("VortexAffector applies tangential acceleration around Y axis", () => {
    const vortex = new VortexAffector({
      center: new Vector3D(0, 0, 0),
      strength: 5.0,
      axis: "y",
    });

    // Particle at (1, 0, 0) -> tangential direction should be (0, 0, 1)
    const arrays = createArrays(1);
    setState(arrays, 0, { pos: [1, 0, 0] });
    vortex.apply(arrays, 0, 0.1);

    const state = readState(arrays, 0);
    expect(state.acc[0]).toBeCloseTo(0);
    expect(state.acc[2]).toBeGreaterThan(0);
  });

  it("PlanarSpringAffector restores particles towards plane", () => {
    const spring = new PlanarSpringAffector({
      axis: "y",
      planePosition: 0,
      stiffness: 10.0,
    });

    const arrays = createArrays(1);
    setState(arrays, 0, { pos: [0, 2, 0] });
    spring.apply(arrays, 0, 0.1);

    const state = readState(arrays, 0);
    expect(state.acc[1]).toBeLessThan(0); // Pushed down towards y = 0
  });

  it("ThermalCoolingAffector calculates compression heat and blackbody color", () => {
    const thermal = new ThermalCoolingAffector({
      heatCenter: new Vector3D(0, 0, 0),
      compressionRadius: 2.0,
      compressionHeatingRate: 20.0,
      coolingRate: 1.0,
      updateColor: true,
    });

    const arrays = createArrays(1);
    setState(arrays, 0, { pos: [0.5, 0, 0], heat: 0 });
    thermal.apply(arrays, 0, 0.1);

    const state = readState(arrays, 0);
    expect(state.heat).toBeGreaterThan(0);
    expect(state.col[0]).toBeGreaterThan(0.5); // Blackbody red/orange ramp
  });

  it("FadeOutZoneAffector reduces alpha and flags dead inside horizon", () => {
    const fade = new FadeOutZoneAffector({
      center: new Vector3D(0, 0, 0),
      fadeStartRadius: 1.0,
      fadeEndRadius: 0.5,
      shrinkSize: true,
    });

    // Particle midway in fading zone
    const midArrays = createArrays(1);
    setState(midArrays, 0, { pos: [0.75, 0, 0] });
    fade.apply(midArrays, 0, 0.1);
    expect(readState(midArrays, 0).alpha).toBeCloseTo(0.5);
    expect(readState(midArrays, 0).alive).toBe(true);

    // Particle past inner horizon
    const swallowedArrays = createArrays(1);
    setState(swallowedArrays, 0, { pos: [0.4, 0, 0] });
    fade.apply(swallowedArrays, 0, 0.1);
    expect(readState(swallowedArrays, 0).alpha).toBe(0);
    expect(readState(swallowedArrays, 0).alive).toBe(false);
  });

  it("TurbulenceAffector applies pseudo-fluid rotational curl forces", () => {
    const turb = new TurbulenceAffector({ strength: 10.0, frequency: 0.5 });
    const arrays = createArrays(1);
    setState(arrays, 0, { pos: [1, 2, 3] });

    turb.apply(arrays, 0, 0.016);

    const state = readState(arrays, 0);
    const accLen = Math.sqrt(
      state.acc[0] * state.acc[0] + state.acc[1] * state.acc[1] + state.acc[2] * state.acc[2],
    );
    expect(accLen).toBeGreaterThan(0);
  });

  it("DragAffector decelerates particles opposing velocity direction", () => {
    const drag = new DragAffector({ drag: 2.0, quadraticDrag: 0.1 });
    const arrays = createArrays(1);
    setState(arrays, 0, { vel: [10, -5, 2] });

    drag.apply(arrays, 0, 0.016);

    // Accelerations should oppose velocities
    const state = readState(arrays, 0);
    expect(state.acc[0]).toBeLessThan(0);
    expect(state.acc[1]).toBeGreaterThan(0);
    expect(state.acc[2]).toBeLessThan(0);
  });

  it("ColorOverLifeAffector and SizeOverLifeAffector animate properties across particle lifetime", () => {
    const colorAffector = new ColorOverLifeAffector({
      startColor: new Color(1, 0, 0, 1),
      endColor: new Color(0, 0, 1, 0),
    });
    const sizeAffector = new SizeOverLifeAffector({
      startScale: 1.0,
      endScale: 0.2,
    });

    const arrays = createArrays(1);
    setState(arrays, 0, { life: 0.5, maxLife: 1.0 }); // 50% lifetime
    colorAffector.apply(arrays, 0, 0.016);
    sizeAffector.apply(arrays, 0, 0.016);

    const state = readState(arrays, 0);
    expect(state.col[0]).toBeCloseTo(0.5);
    expect(state.col[2]).toBeCloseTo(0.5);
    expect(state.alpha).toBeCloseTo(0.5);
    expect(state.size).toBeCloseTo(0.6);
  });

  it("BouncePlaneAffector reflects velocity on floor contact with restitution and friction", () => {
    const bounce = new BouncePlaneAffector({
      planePosition: 0,
      axis: "y",
      restitution: 0.5,
      friction: 0.8,
    });

    // Particle falling below plane
    const arrays = createArrays(1);
    setState(arrays, 0, {
      pos: [5, -0.1, 5],
      vel: [10, -20, 10],
    });

    bounce.apply(arrays, 0, 0.016);

    const state = readState(arrays, 0);
    expect(state.pos[1]).toBe(0);
    expect(state.vel[1]).toBeCloseTo(10); // -(-20) * 0.5
    expect(state.vel[0]).toBeCloseTo(8); // 10 * 0.8
    expect(state.vel[2]).toBeCloseTo(8);
  });
});
