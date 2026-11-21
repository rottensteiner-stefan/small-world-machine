import { describe, expect, it, vi } from "vitest";
import { Vector3D } from "@small-world-machine/engine";
import { mulberry32 } from "@small-world-machine/engine/utils/SeededRandom.js";
import { ParticleSystem } from "../src/ParticleSystem.js";
import {
  SphFluidAffector,
  sphPoly6,
  sphSpikyGradFactor,
  sphViscosityLaplacian,
} from "../src/affectors/SphFluidAffector.js";

describe("SphFluidAffector", () => {
  it("satisfies SPH-KERNEL-NORMALIZATION across smoothing radii and boundary/zero cutoffs", () => {
    for (const h of [0.15, 0.25, 0.6]) {
      // Midpoint quadrature of 4*pi*r^2 * W_poly6(r, h) over [0, h] must equal 1.0.
      const steps = 2000;
      const dr = h / steps;
      let integral = 0;
      for (let i = 0; i < steps; i++) {
        const r = (i + 0.5) * dr;
        integral += 4 * Math.PI * r * r * sphPoly6(r * r, h) * dr;
      }
      expect(integral).toBeCloseTo(1.0, 5);
      expect(sphPoly6(h * h, h)).toBe(0);
      expect(sphPoly6((h + 0.01) * (h + 0.01), h)).toBe(0);
      expect(sphSpikyGradFactor(0, h)).toBeLessThan(0);
      expect(sphSpikyGradFactor(h, h)).toBe(0);
      expect(sphViscosityLaplacian(0, h)).toBeGreaterThan(0);
      expect(sphViscosityLaplacian(h, h)).toBe(0);
    }

    // Invalid/zero radius returns exact 0 without NaN.
    expect(sphPoly6(0.01, 0)).toBe(0);
    expect(sphPoly6(-0.01, 0.25)).toBe(0);
    expect(sphSpikyGradFactor(-0.1, 0.25)).toBe(0);
    expect(sphViscosityLaplacian(-0.1, 0.25)).toBe(0);
  });

  it("enforces SPH-MOMENTUM-CONSERVATION across heterogeneous masses, viscosity, and cohesion", () => {
    const sph = new SphFluidAffector({
      smoothingRadius: 0.4,
      restDensity: 1.0,
      stiffness: 12.0,
      viscosity: 1.5,
      cohesion: 0.75,
      maxAcceleration: 1e6,
      capacity: 64,
    });
    const system = new ParticleSystem({ capacity: 64, affectors: [sph] });
    const rng = mulberry32(4242);

    const n = 20;
    for (let i = 0; i < n; i++) {
      system.emit({
        position: new Vector3D((rng() - 0.5) * 0.35, (rng() - 0.5) * 0.35, (rng() - 0.5) * 0.35),
        velocity: new Vector3D((rng() - 0.5) * 2.0, (rng() - 0.5) * 2.0, (rng() - 0.5) * 2.0),
        mass: 0.6 + rng() * 2.2,
        maxLife: 10,
      });
    }

    sph.applyBatch(system.arrays, n, 1 / 60);

    let sumFx = 0;
    let sumFy = 0;
    let sumFz = 0;
    for (let i = 0; i < n; i++) {
      const m = system.arrays.masses[i]!;
      const o = i * 3;
      const ax = system.arrays.accelerations[o]!;
      const ay = system.arrays.accelerations[o + 1]!;
      const az = system.arrays.accelerations[o + 2]!;
      expect(Number.isFinite(ax)).toBe(true);
      expect(Number.isFinite(ay)).toBe(true);
      expect(Number.isFinite(az)).toBe(true);
      sumFx += m * ax;
      sumFy += m * ay;
      sumFz += m * az;
    }

    expect(Math.abs(sumFx)).toBeLessThan(1e-4);
    expect(Math.abs(sumFy)).toBeLessThan(1e-4);
    expect(Math.abs(sumFz)).toBeLessThan(1e-4);
  });

  it("handles coincident zero-distance overlap without NaN and preserves momentum", () => {
    const sph = new SphFluidAffector({
      smoothingRadius: 0.3,
      restDensity: 1.0,
      stiffness: 10.0,
      viscosity: 0.5,
      maxAcceleration: 1e5,
      capacity: 16,
    });
    const system = new ParticleSystem({ capacity: 16, affectors: [sph] });

    system.emit({
      position: new Vector3D(0.1, 0.2, 0.3),
      velocity: new Vector3D(1, -2, 0.5),
      mass: 1.3,
      maxLife: 10,
    });
    system.emit({
      position: new Vector3D(0.1, 0.2, 0.3),
      velocity: new Vector3D(-0.5, 1.5, -0.25),
      mass: 2.1,
      maxLife: 10,
    });

    sph.applyBatch(system.arrays, 2, 1 / 60);

    const a = system.arrays.accelerations;
    const m = system.arrays.masses;
    for (let k = 0; k < 6; k++) {
      expect(Number.isFinite(a[k])).toBe(true);
    }
    expect(Math.abs(a[1]!)).toBeGreaterThan(0);
    expect(m[0]! * a[0]! + m[1]! * a[3]!).toBeCloseTo(0, 4);
    expect(m[0]! * a[1]! + m[1]! * a[4]!).toBeCloseTo(0, 4);
    expect(m[0]! * a[2]! + m[1]! * a[5]!).toBeCloseTo(0, 4);
  });

  it("avoids double-counting when neighbor cells collide in a tiny hash table", () => {
    const opts = {
      smoothingRadius: 0.3,
      restDensity: 10,
      stiffness: 5,
      viscosity: 0.6,
      maxAcceleration: 1e4,
    };
    const smallHash = new SphFluidAffector({ ...opts, capacity: 16 });
    const largeHash = new SphFluidAffector({ ...opts, capacity: 4096 });

    const sysA = new ParticleSystem({ capacity: 16, affectors: [smallHash] });
    const sysB = new ParticleSystem({ capacity: 16, affectors: [largeHash] });

    // Place pairs separated by exact 3D spatial hash period offsets to exercise collisions.
    const coords: readonly [number, number, number][] = [
      [0.05, 0.05, 0.05],
      [0.12, 0.08, 0.04],
      [-0.08, 0.11, 0.02],
      [0.02, -0.09, 0.14],
    ];
    for (const [x, y, z] of coords) {
      const o = { position: new Vector3D(x, y, z), velocity: new Vector3D(x, y, -z), maxLife: 10 };
      sysA.emit(o);
      sysB.emit(o);
    }

    smallHash.applyBatch(sysA.arrays, 4, 1 / 60);
    largeHash.applyBatch(sysB.arrays, 4, 1 / 60);

    for (let i = 0; i < 4; i++) {
      expect(smallHash.densities[i]).toBeCloseTo(largeHash.densities[i]!, 5);
      expect(smallHash.pressures[i]).toBeCloseTo(largeHash.pressures[i]!, 5);
      for (let c = 0; c < 3; c++) {
        expect(sysA.arrays.accelerations[i * 3 + c]).toBeCloseTo(
          sysB.arrays.accelerations[i * 3 + c]!,
          5,
        );
      }
    }
  });

  it("enforces container bounds in postIntegrate with clamped positions and damped bounce", () => {
    const sph = new SphFluidAffector({
      capacity: 16,
      bounds: {
        min: new Vector3D(-1, 0.2, -0.5),
        max: new Vector3D(1, 2.0, 0.5),
        restitution: 0.5,
        friction: 0.2,
      },
    });
    const system = new ParticleSystem({ capacity: 16, affectors: [sph] });
    system.emit({
      position: new Vector3D(-1.3, 0.05, 0.8),
      velocity: new Vector3D(-4.0, -2.0, 3.0),
      maxLife: 10,
    });

    sph.postIntegrate(system.arrays, 1, 1 / 60);

    const p = system.arrays.positions;
    const v = system.arrays.velocities;
    expect(p[0]).toBeCloseTo(-1.0, 6);
    expect(p[1]).toBeCloseTo(0.2, 6);
    expect(p[2]).toBeCloseTo(0.5, 6);
    expect(v[0]).toBeGreaterThan(0);
    expect(v[1]).toBeGreaterThan(0);
    expect(v[2]).toBeLessThan(0);
  });

  it("allocates zero typed-array buffers across steady-state simulation frames", () => {
    const sph = new SphFluidAffector({ capacity: 256 });
    const system = new ParticleSystem({ capacity: 256, affectors: [sph] });
    const rng = mulberry32(99);
    for (let i = 0; i < 120; i++) {
      system.emit({
        position: new Vector3D((rng() - 0.5) * 0.8, 0.3 + rng() * 0.6, (rng() - 0.5) * 0.8),
        velocity: new Vector3D((rng() - 0.5) * 0.5, -0.2, (rng() - 0.5) * 0.5),
        maxLife: 20,
      });
    }

    // Warm up one frame, then pin buffer identities and watch TypedArray constructors.
    system.update(1 / 60);
    const densRef = sph.densities;
    const presRef = sph.pressures;

    const float32Spy = vi.spyOn(globalThis, "Float32Array");
    const int32Spy = vi.spyOn(globalThis, "Int32Array");
    try {
      for (let f = 0; f < 60; f++) {
        system.update(1 / 60);
      }
      expect(float32Spy).not.toHaveBeenCalled();
      expect(int32Spy).not.toHaveBeenCalled();
      expect(sph.densities).toBe(densRef);
      expect(sph.pressures).toBe(presRef);
    } finally {
      float32Spy.mockRestore();
      int32Spy.mockRestore();
    }
  });
});
