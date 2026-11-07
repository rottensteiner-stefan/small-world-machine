import { describe, it, expect } from "vitest";
import { Vector3D, Color } from "@small-world-machine/engine";
import {
  PointAttractorAffector,
  VortexAffector,
  PlanarSpringAffector,
  ThermalCoolingAffector,
  FadeOutZoneAffector,
  TurbulenceAffector,
  DragAffector,
  ColorOverLifeAffector,
  SizeOverLifeAffector,
  BouncePlaneAffector,
} from "../src/affectors/index.js";
import { createArrays, setState, readState } from "./helpers/soa.js";

describe("Universal VFX Affectors Deep Physical & Mathematical Analysis", () => {
  describe("PointAttractorAffector (Plummer Softened Gravity)", () => {
    it("applies regularized gravitational pull avoiding singular infinite force at r=0", () => {
      const attractor = new PointAttractorAffector({
        center: new Vector3D(0, 0, 0),
        strength: 100.0,
        softening: 0.25,
        plummer: true,
      });

      const arrays = createArrays(1);
      setState(arrays, 0, { pos: [1, 0, 0], vel: [0, 0, 0], acc: [0, 0, 0] });

      attractor.apply(arrays, 0, 0.1);

      // Force = G * M * r / (r^2 + eps^2)^(3/2)
      // For r=1.0, eps=0.25 (eps^2 = 0.0625): denom = (1.0 + 0.0625)^1.5 = 1.0625^1.5 = 1.09519
      // pull = 100 * 1.0 / 1.09519 = 91.31
      const state = readState(arrays, 0);
      expect(state.acc[0]).toBeLessThan(0); // Accelerated inward towards origin
      expect(state.acc[0]).toBeCloseTo(-91.31, 1);
      expect(state.acc[1]).toBe(0);
      expect(state.acc[2]).toBe(0);
    });
  });

  describe("VortexAffector (Relativistic Swirl & Accretion Infall)", () => {
    it("generates perpendicular tangential angular momentum", () => {
      const vortex = new VortexAffector({
        axis: "y",
        strength: 10.0,
        inwardSuction: 2.0,
      });

      const arrays = createArrays(1);
      setState(arrays, 0, { pos: [2, 0, 0], acc: [0, 0, 0] }); // Along +X

      vortex.apply(arrays, 0, 0.1);

      // Tangential direction around Y-axis at (2,0,0) points towards +Z
      const state = readState(arrays, 0);
      expect(state.acc[2]).toBeGreaterThan(0);
      // Inward pull points towards origin (-X)
      expect(state.acc[0]).toBeLessThan(0);
    });
  });

  describe("PlanarSpringAffector (Harmonic Oscillator)", () => {
    it("restores displaced particles toward plane with damped harmonic oscillation", () => {
      const spring = new PlanarSpringAffector({
        stiffness: 20.0,
        damping: 2.0,
        planePosition: 0.0,
        axis: "y",
      });

      const arrays = createArrays(1);

      // Step 1: Initial downward acceleration
      setState(arrays, 0, { pos: [0, 5, 0], vel: [0, 0, 0], acc: [0, 0, 0] });
      spring.apply(arrays, 0, 0.1);
      expect(readState(arrays, 0).acc[1]).toBeLessThan(0);
      expect(readState(arrays, 0).acc[1]).toBeCloseTo(-5.0 * 20.0, 1); // F = -k * y => a = -100

      // Step 2: Damping acts against upward velocity
      setState(arrays, 0, { pos: [0, 0, 0], vel: [0, 10, 0], acc: [0, 0, 0] });
      spring.apply(arrays, 0, 0.1);
      expect(readState(arrays, 0).acc[1]).toBeCloseTo(-20.0); // F_damp = -d * v = -2 * 10 = -20
    });
  });

  describe("ThermalCoolingAffector (Blackbody Radiative Decay)", () => {
    it("cools particle heat and updates thermal color continuously", () => {
      const cooling = new ThermalCoolingAffector({
        coolingRate: 0.5,
        compressionRadius: 1.0,
        updateColor: true,
      });

      const arrays = createArrays(1);
      setState(arrays, 0, { pos: [10, 0, 0], heat: 6, col: [1, 1, 1, 1] }); // Far away from compression radius

      cooling.apply(arrays, 0, 2.0); // dt = 2.0 => heat decreases by 1.0 to 5.0
      const state = readState(arrays, 0);
      expect(state.heat).toBeCloseTo(5.0);
      // Thermal color updated via blackbody
      expect(state.col[0]).toBeGreaterThan(0.7);
    });
  });

  describe("FadeOutZoneAffector (Boundary Transition)", () => {
    it("smoothly modulates alpha within transition zone", () => {
      const fader = new FadeOutZoneAffector({
        fadeEndRadius: 0.35,
        fadeStartRadius: 0.55,
      });

      const outerArrays = createArrays(1);
      setState(outerArrays, 0, { pos: [0.6, 0, 0], alpha: 1 });
      fader.apply(outerArrays, 0, 0.1);
      expect(readState(outerArrays, 0).alpha).toBeCloseTo(1.0);

      const midArrays = createArrays(1);
      setState(midArrays, 0, { pos: [0.45, 0, 0], alpha: 1 });
      fader.apply(midArrays, 0, 1 / 60); // one reference frame
      expect(readState(midArrays, 0).alpha).toBeCloseTo(0.5);

      const innerArrays = createArrays(1);
      setState(innerArrays, 0, { pos: [0.3, 0, 0], alpha: 1 });
      fader.apply(innerArrays, 0, 0.1);
      expect(readState(innerArrays, 0).alpha).toBeCloseTo(0.0);
      expect(readState(innerArrays, 0).alive).toBe(false);
    });
  });

  describe("TurbulenceAffector (Spatial Frequency Distortions)", () => {
    it("applies deterministic multi-axis spatial perturbations", () => {
      const turb = new TurbulenceAffector({
        frequency: 2.0,
        strength: 5.0,
        evolutionSpeed: 1.0,
      });

      const p1Arrays = createArrays(1);
      setState(p1Arrays, 0, { pos: [1, 0.5, 0.2], acc: [0, 0, 0] });
      turb.apply(p1Arrays, 0, 0.1);

      const p2Arrays = createArrays(1);
      setState(p2Arrays, 0, { pos: [5, -2.5, 3.2], acc: [0, 0, 0] });
      turb.apply(p2Arrays, 0, 0.1);

      const s1 = readState(p1Arrays, 0);
      const s2 = readState(p2Arrays, 0);
      // Accelerations should be perturbed differently based on position
      const len1 = Math.sqrt(s1.acc[0] * s1.acc[0] + s1.acc[1] * s1.acc[1] + s1.acc[2] * s1.acc[2]);
      const len2 = Math.sqrt(s2.acc[0] * s2.acc[0] + s2.acc[1] * s2.acc[1] + s2.acc[2] * s2.acc[2]);
      expect(len1).toBeGreaterThan(0);
      expect(len2).toBeGreaterThan(0);
      expect(s1.acc[0]).not.toBe(s2.acc[0]);
    });
  });

  describe("DragAffector (Medium Resistance)", () => {
    it("decelerates particles smoothly without reversing direction", () => {
      const drag = new DragAffector({ drag: 0.5, quadraticDrag: 0.01 });
      const arrays = createArrays(1);
      setState(arrays, 0, { vel: [10, 20, -30], acc: [0, 0, 0] });

      drag.apply(arrays, 0, 0.1);
      const state = readState(arrays, 0);
      expect(state.acc[0]).toBeLessThan(0);
      expect(state.acc[1]).toBeLessThan(0);
      expect(state.acc[2]).toBeGreaterThan(0);
    });
  });

  describe("ColorOverLifeAffector (Gradient Keyframing)", () => {
    it("interpolates colors across normalized particle life", () => {
      const colorGrad = new ColorOverLifeAffector({
        startColor: new Color(1.0, 0.0, 0.0, 1.0),
        endColor: new Color(0.0, 0.0, 1.0, 0.0),
        interpolateAlpha: true,
      });

      const arrays = createArrays(1);
      setState(arrays, 0, { maxLife: 10.0, life: 0 });

      // At start (life = 0)
      colorGrad.apply(arrays, 0, 0.1);
      expect(readState(arrays, 0).col[0]).toBeCloseTo(1.0);
      expect(readState(arrays, 0).col[2]).toBeCloseTo(0.0);
      expect(readState(arrays, 0).alpha).toBeCloseTo(1.0);

      // At half-life (life = 5)
      arrays.lives[0] = 5.0;
      colorGrad.apply(arrays, 0, 0.1);
      expect(readState(arrays, 0).col[0]).toBeCloseTo(0.5);
      expect(readState(arrays, 0).col[2]).toBeCloseTo(0.5);
      expect(readState(arrays, 0).alpha).toBeCloseTo(0.5);

      // At end-life (life = 10)
      arrays.lives[0] = 10.0;
      colorGrad.apply(arrays, 0, 0.1);
      expect(readState(arrays, 0).col[0]).toBeCloseTo(0.0);
      expect(readState(arrays, 0).col[2]).toBeCloseTo(1.0);
      expect(readState(arrays, 0).alpha).toBeCloseTo(0.0);
    });
  });

  describe("SizeOverLifeAffector (Size Curves)", () => {
    it("scales particle size based on lifetime", () => {
      const sizeCurve = new SizeOverLifeAffector({
        startScale: 1.0,
        endScale: 0.0,
      });

      const arrays = createArrays(1);
      setState(arrays, 0, { maxLife: 10.0, life: 0 });

      // Start
      sizeCurve.apply(arrays, 0, 0.1);
      expect(readState(arrays, 0).size).toBeCloseTo(1.0);

      // Half-life
      arrays.lives[0] = 5.0;
      sizeCurve.apply(arrays, 0, 0.1);
      expect(readState(arrays, 0).size).toBeCloseTo(0.5);

      // End
      arrays.lives[0] = 10.0;
      sizeCurve.apply(arrays, 0, 0.1);
      expect(readState(arrays, 0).size).toBeCloseTo(0.0);
    });
  });

  describe("BouncePlaneAffector (Surface Physics Collision)", () => {
    it("reflects penetrating particles with energy restitution and friction", () => {
      const bouncer = new BouncePlaneAffector({
        planePosition: 0.0,
        axis: "y",
        restitution: 0.8,
        friction: 0.9,
      });

      const arrays = createArrays(1);
      setState(arrays, 0, { pos: [0, -0.5, 0], vel: [10, -20, 0] }); // Penetrated ground plane

      bouncer.apply(arrays, 0, 0.1);

      const state = readState(arrays, 0);
      // Clamped to surface
      expect(state.pos[1]).toBe(0.0);
      // Inverted and dampened vertical velocity
      expect(state.vel[1]).toBeCloseTo(16.0); // 20.0 * 0.8
      // Horizontal friction damping
      expect(state.vel[0]).toBeCloseTo(9.0); // 10.0 * 0.9
    });
  });
});
