import { describe, it, expect } from "vitest";
import { Particle } from "../src/Particle.js";
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
import { Vector3D, Color } from "@small-world-machine/engine";

describe("Affectors", () => {
  it("PointAttractorAffector pulls particles towards center", () => {
    const attractor = new PointAttractorAffector({
      center: new Vector3D(0, 0, 0),
      strength: 100,
      softening: 0.5,
      plummer: true,
    });

    const p = new Particle({ position: new Vector3D(10, 0, 0) });
    attractor.apply(p, 0.1);

    expect(p.acceleration.x).toBeLessThan(0); // Pulled in -X direction
    expect(p.acceleration.y).toBe(0);
    expect(p.acceleration.z).toBe(0);
  });

  it("VortexAffector applies tangential acceleration around Y axis", () => {
    const vortex = new VortexAffector({
      center: new Vector3D(0, 0, 0),
      strength: 5.0,
      axis: "y",
    });

    // Particle at (1, 0, 0) -> tangential direction should be (0, 0, 1)
    const p = new Particle({ position: new Vector3D(1, 0, 0) });
    vortex.apply(p, 0.1);

    expect(p.acceleration.x).toBeCloseTo(0);
    expect(p.acceleration.z).toBeGreaterThan(0);
  });

  it("PlanarSpringAffector restores particles towards plane", () => {
    const spring = new PlanarSpringAffector({
      axis: "y",
      planePosition: 0,
      stiffness: 10.0,
    });

    const p = new Particle({ position: new Vector3D(0, 2, 0) });
    spring.apply(p, 0.1);

    expect(p.acceleration.y).toBeLessThan(0); // Pushed down towards y = 0
  });

  it("ThermalCoolingAffector calculates compression heat and blackbody color", () => {
    const thermal = new ThermalCoolingAffector({
      heatCenter: new Vector3D(0, 0, 0),
      compressionRadius: 2.0,
      compressionHeatingRate: 20.0,
      coolingRate: 1.0,
      updateColor: true,
    });

    const p = new Particle({ position: new Vector3D(0.5, 0, 0), heat: 0 });
    thermal.apply(p, 0.1);

    expect(p.heat).toBeGreaterThan(0);
    expect(p.color.r).toBeGreaterThan(0.5); // Blackbody red/orange ramp
  });

  it("FadeOutZoneAffector reduces alpha and flags dead inside horizon", () => {
    const fade = new FadeOutZoneAffector({
      center: new Vector3D(0, 0, 0),
      fadeStartRadius: 1.0,
      fadeEndRadius: 0.5,
      shrinkSize: true,
    });

    // Particle midway in fading zone
    const pMid = new Particle({ position: new Vector3D(0.75, 0, 0) });
    fade.apply(pMid, 0.1);
    expect(pMid.alpha).toBeCloseTo(0.5);
    expect(pMid.dead).toBe(false);

    // Particle past inner horizon
    const pSwallowed = new Particle({ position: new Vector3D(0.4, 0, 0) });
    fade.apply(pSwallowed, 0.1);
    expect(pSwallowed.alpha).toBe(0);
    expect(pSwallowed.dead).toBe(true);
  });

  it("TurbulenceAffector applies pseudo-fluid rotational curl forces", () => {
    const turb = new TurbulenceAffector({ strength: 10.0, frequency: 0.5 });
    const p = new Particle({ position: new Vector3D(1, 2, 3) });

    turb.apply(p, 0.016);

    const accLen = p.acceleration.length();
    expect(accLen).toBeGreaterThan(0);
  });

  it("DragAffector decelerates particles opposing velocity direction", () => {
    const drag = new DragAffector({ drag: 2.0, quadraticDrag: 0.1 });
    const p = new Particle({ velocity: new Vector3D(10, -5, 2) });

    drag.apply(p, 0.016);

    // Accelerations should oppose velocities
    expect(p.acceleration.x).toBeLessThan(0);
    expect(p.acceleration.y).toBeGreaterThan(0);
    expect(p.acceleration.z).toBeLessThan(0);
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

    const p = new Particle({ life: 0.5, maxLife: 1.0 }); // 50% lifetime
    colorAffector.apply(p, 0.016);
    sizeAffector.apply(p, 0.016);

    expect(p.color.r).toBeCloseTo(0.5);
    expect(p.color.b).toBeCloseTo(0.5);
    expect(p.alpha).toBeCloseTo(0.5);
    expect(p.size).toBeCloseTo(0.6);
  });

  it("BouncePlaneAffector reflects velocity on floor contact with restitution and friction", () => {
    const bounce = new BouncePlaneAffector({
      planePosition: 0,
      axis: "y",
      restitution: 0.5,
      friction: 0.8,
    });

    // Particle falling below plane
    const p = new Particle({
      position: new Vector3D(5, -0.1, 5),
      velocity: new Vector3D(10, -20, 10),
    });

    bounce.apply(p, 0.016);

    expect(p.position.y).toBe(0);
    expect(p.velocity.y).toBeCloseTo(10); // -(-20) * 0.5
    expect(p.velocity.x).toBeCloseTo(8); // 10 * 0.8
    expect(p.velocity.z).toBeCloseTo(8);
  });
});
