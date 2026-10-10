import { describe, it, expect } from "vitest";
import { ParticleSystem } from "../src/ParticleSystem.js";
import { Vector3D } from "@small-world-machine/engine";

describe("ParticleSystem", () => {
  it("emits and updates particles with integration", () => {
    const ps = new ParticleSystem({ capacity: 10 });
    const p = ps.emit({
      position: new Vector3D(0, 0, 0),
      velocity: new Vector3D(10, 0, 0),
    });

    expect(p).toBeDefined();
    expect(ps.particles.length).toBe(1);

    ps.update(0.1);

    expect(p?.position.x).toBeCloseTo(1.0);
    expect(p?.position.y).toBe(0);
    expect(p?.position.z).toBe(0);
  });

  it("handles life and dead particle recycling", () => {
    let diedCount = 0;
    const ps = new ParticleSystem({
      capacity: 2,
      onParticleDied: (): void => {
        diedCount++;
      },
    });

    const p1 = ps.emit({ maxLife: 0.5 });
    ps.emit({ maxLife: 10.0 });

    expect(ps.particles.length).toBe(2);

    ps.update(0.6); // p1 exceeds maxLife

    expect(p1?.dead).toBe(true);
    expect(diedCount).toBe(1);

    // Emitting when at capacity should recycle dead particle p1
    const p3 = ps.emit({ maxLife: 5.0 });
    expect(p3).toBe(p1);
    expect(p3?.dead).toBe(false);
  });

  it("adds, executes, and removes affectors", () => {
    const ps = new ParticleSystem();
    const p = ps.emit({ position: new Vector3D(0, 0, 0) });

    const dummyAffector = {
      apply: (particle: typeof p): void => {
        if (particle) {
          particle.acceleration.y += 9.81;
        }
      },
    };

    ps.addAffector(dummyAffector);
    ps.update(1.0);

    expect(p?.velocity.y).toBeCloseTo(9.81);

    ps.removeAffector(dummyAffector);
    p?.velocity.set(0, 0, 0);
    ps.update(1.0);

    expect(p?.velocity.y).toBe(0);
  });
});
