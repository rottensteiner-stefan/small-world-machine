import { describe, it, expect } from "vitest";
import { Particle } from "../src/Particle.js";
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

describe("Universal VFX Affectors Deep Physical & Mathematical Analysis", () => {
  describe("PointAttractorAffector (Plummer Softened Gravity)", () => {
    it("applies regularized gravitational pull avoiding singular infinite force at r=0", () => {
      const attractor = new PointAttractorAffector({
        center: new Vector3D(0, 0, 0),
        strength: 100.0,
        softening: 0.25,
        plummer: true,
      });

      const p1 = new Particle();
      p1.position.set(1.0, 0, 0);
      p1.velocity.set(0, 0, 0);
      p1.acceleration.set(0, 0, 0);

      attractor.apply(p1, 0.1);

      // Force = G * M * r / (r^2 + eps^2)^(3/2)
      // For r=1.0, eps=0.25: denom = (1.0 + 0.25)^1.5 = 1.25^1.5 = 1.39754
      // pull = 100 * 1.0 / 1.39754 = 71.55
      expect(p1.acceleration.x).toBeLessThan(0); // Accelerated inward towards origin
      expect(p1.acceleration.x).toBeCloseTo(-71.55, 1);
      expect(p1.acceleration.y).toBe(0);
      expect(p1.acceleration.z).toBe(0);
    });
  });

  describe("VortexAffector (Relativistic Swirl & Accretion Infall)", () => {
    it("generates perpendicular tangential angular momentum", () => {
      const vortex = new VortexAffector({
        axis: "y",
        strength: 10.0,
        inwardSuction: 2.0,
      });

      const p = new Particle();
      p.position.set(2.0, 0, 0); // Along +X
      p.acceleration.set(0, 0, 0);

      vortex.apply(p, 0.1);

      // Tangential direction around Y-axis at (2,0,0) points towards +Z
      expect(p.acceleration.z).toBeGreaterThan(0);
      // Inward pull points towards origin (-X)
      expect(p.acceleration.x).toBeLessThan(0);
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

      const p = new Particle();
      p.position.set(0, 5.0, 0);
      p.velocity.set(0, 0, 0);
      p.acceleration.set(0, 0, 0);

      // Step 1: Initial downward acceleration
      spring.apply(p, 0.1);
      expect(p.acceleration.y).toBeLessThan(0);
      expect(p.acceleration.y).toBeCloseTo(-5.0 * 20.0, 1); // F = -k * y => a = -100

      // Step 2: Damping acts against upward velocity
      p.velocity.set(0, 10.0, 0);
      p.position.set(0, 0, 0);
      p.acceleration.set(0, 0, 0);
      spring.apply(p, 0.1);
      expect(p.acceleration.y).toBeCloseTo(-20.0); // F_damp = -d * v = -2 * 10 = -20
    });
  });

  describe("ThermalCoolingAffector (Blackbody Radiative Decay)", () => {
    it("cools particle heat and updates thermal color continuously", () => {
      const cooling = new ThermalCoolingAffector({
        coolingRate: 0.5,
        compressionRadius: 1.0,
        updateColor: true,
      });

      const p = new Particle();
      p.position.set(10.0, 0, 0); // Far away from compression radius
      p.heat = 6.0;
      p.color.set(1, 1, 1);

      cooling.apply(p, 2.0); // dt = 2.0 => heat decreases by 1.0 to 5.0
      expect(p.heat).toBeCloseTo(5.0);
      // Thermal color updated via blackbody
      expect(p.color.r).toBeGreaterThan(0.7);
    });
  });

  describe("FadeOutZoneAffector (Boundary Transition)", () => {
    it("smoothly modulates alpha within transition zone", () => {
      const fader = new FadeOutZoneAffector({
        fadeEndRadius: 0.35,
        fadeStartRadius: 0.55,
      });

      const pOuter = new Particle();
      pOuter.position.set(0.6, 0, 0);
      pOuter.alpha = 1.0;
      fader.apply(pOuter, 0.1);
      expect(pOuter.alpha).toBeCloseTo(1.0);

      const pMid = new Particle();
      pMid.position.set(0.45, 0, 0);
      pMid.alpha = 1.0;
      fader.apply(pMid, 0.1);
      expect(pMid.alpha).toBeCloseTo(0.5);

      const pInner = new Particle();
      pInner.position.set(0.3, 0, 0);
      pInner.alpha = 1.0;
      fader.apply(pInner, 0.1);
      expect(pInner.alpha).toBeCloseTo(0.0);
      expect(pInner.dead).toBe(true);
    });
  });

  describe("TurbulenceAffector (Spatial Frequency Distortions)", () => {
    it("applies deterministic multi-axis spatial perturbations", () => {
      const turb = new TurbulenceAffector({
        frequency: 2.0,
        strength: 5.0,
        evolutionSpeed: 1.0,
      });

      const p1 = new Particle();
      p1.position.set(1.0, 0.5, 0.2);
      p1.acceleration.set(0, 0, 0);
      turb.apply(p1, 0.1);

      const p2 = new Particle();
      p2.position.set(5.0, -2.5, 3.2);
      p2.acceleration.set(0, 0, 0);
      turb.apply(p2, 0.1);

      // Accelerations should be perturbed differently based on position
      expect(p1.acceleration.length()).toBeGreaterThan(0);
      expect(p2.acceleration.length()).toBeGreaterThan(0);
      expect(p1.acceleration.x).not.toBe(p2.acceleration.x);
    });
  });

  describe("DragAffector (Medium Resistance)", () => {
    it("decelerates particles smoothly without reversing direction", () => {
      const drag = new DragAffector({ drag: 0.5, quadraticDrag: 0.01 });
      const p = new Particle();
      p.velocity.set(10.0, 20.0, -30.0);
      p.acceleration.set(0, 0, 0);

      drag.apply(p, 0.1);
      expect(p.acceleration.x).toBeLessThan(0);
      expect(p.acceleration.y).toBeLessThan(0);
      expect(p.acceleration.z).toBeGreaterThan(0);
    });
  });

  describe("ColorOverLifeAffector (Gradient Keyframing)", () => {
    it("interpolates colors across normalized particle life", () => {
      const colorGrad = new ColorOverLifeAffector({
        startColor: new Color(1.0, 0.0, 0.0, 1.0),
        endColor: new Color(0.0, 0.0, 1.0, 0.0),
        interpolateAlpha: true,
      });

      const p = new Particle();
      p.maxLife = 10.0;

      // At start (life = 0)
      p.life = 0.0;
      colorGrad.apply(p, 0.1);
      expect(p.color.r).toBeCloseTo(1.0);
      expect(p.color.b).toBeCloseTo(0.0);
      expect(p.alpha).toBeCloseTo(1.0);

      // At half-life (life = 5)
      p.life = 5.0;
      colorGrad.apply(p, 0.1);
      expect(p.color.r).toBeCloseTo(0.5);
      expect(p.color.b).toBeCloseTo(0.5);
      expect(p.alpha).toBeCloseTo(0.5);

      // At end-life (life = 10)
      p.life = 10.0;
      colorGrad.apply(p, 0.1);
      expect(p.color.r).toBeCloseTo(0.0);
      expect(p.color.b).toBeCloseTo(1.0);
      expect(p.alpha).toBeCloseTo(0.0);
    });
  });

  describe("SizeOverLifeAffector (Size Curves)", () => {
    it("scales particle size based on lifetime", () => {
      const sizeCurve = new SizeOverLifeAffector({
        startScale: 1.0,
        endScale: 0.0,
      });

      const p = new Particle();
      p.maxLife = 10.0;

      // Start
      p.life = 0.0;
      sizeCurve.apply(p, 0.1);
      expect(p.size).toBeCloseTo(1.0);

      // Half-life
      p.life = 5.0;
      sizeCurve.apply(p, 0.1);
      expect(p.size).toBeCloseTo(0.5);

      // End
      p.life = 10.0;
      sizeCurve.apply(p, 0.1);
      expect(p.size).toBeCloseTo(0.0);
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

      const p = new Particle();
      p.position.set(0, -0.5, 0); // Penetrated ground plane
      p.velocity.set(10.0, -20.0, 0);

      bouncer.apply(p, 0.1);

      // Clamped to surface
      expect(p.position.y).toBe(0.0);
      // Inverted and dampened vertical velocity
      expect(p.velocity.y).toBeCloseTo(16.0); // 20.0 * 0.8
      // Horizontal friction damping
      expect(p.velocity.x).toBeCloseTo(9.0); // 10.0 * 0.9
    });
  });
});
