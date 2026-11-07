/** ParticleLightPool review fix: idle -> bound snaps the light to the particle (no fly-in). */
import { describe, expect, it } from "vitest";
import { Object3D, PointLight, Vector3D } from "@small-world-machine/engine";
import { ParticleSystem } from "../src/ParticleSystem.js";
import { ParticleLightPool } from "../src/ParticleLightPool.js";

const lights = (root: Object3D): PointLight[] =>
  root.children.filter((c): c is PointLight => c instanceof PointLight);

describe("ParticleLightPool idle -> bound", () => {
  it("first lit frame already sits on the particle (not at the origin)", () => {
    const root = new Object3D("root");
    const system = new ParticleSystem({ capacity: 8 });
    system.emit({ position: new Vector3D(10, 5, -7), heat: 1, alpha: 1, maxLife: 1e9 });
    const pool = new ParticleLightPool(system, root, { maxActive: 1, fadeTime: 0.5 });
    pool.update(0.016);
    const p = lights(root)[0]!.position;
    expect([p.x, p.y, p.z]).toEqual([10, 5, -7]);
    pool.dispose();
  });

  it("a fully faded light reclaimed elsewhere snaps instead of chasing from the old spot", () => {
    const root = new Object3D("root");
    const system = new ParticleSystem({ capacity: 8 });
    system.emit({ position: new Vector3D(1, 1, 1), heat: 1, alpha: 1, maxLife: 1e9 });
    const pool = new ParticleLightPool(system, root, { maxActive: 1, fadeTime: 0.05 });
    for (let i = 0; i < 10; i++) pool.update(0.016);
    system.clear();
    for (let i = 0; i < 10; i++) pool.update(0.016); // fully faded -> idle
    system.emit({ position: new Vector3D(-20, 0, 30), heat: 1, alpha: 1, maxLife: 1e9 });
    pool.update(0.001);
    const p = lights(root)[0]!.position;
    expect([p.x, p.y, p.z]).toEqual([-20, 0, 30]);
    pool.dispose();
  });

  it("a retarget while still lit keeps the smooth chase (no teleport)", () => {
    const root = new Object3D("root");
    const system = new ParticleSystem({ capacity: 8 });
    const a = system.emit({ position: new Vector3D(0, 0, 0), heat: 1, alpha: 1, maxLife: 1e9 });
    const pool = new ParticleLightPool(system, root, { maxActive: 1, fadeTime: 0.5 });
    for (let i = 0; i < 60; i++) pool.update(0.016);
    system.arrays.heats[a] = 0.1; // cools below minScore
    system.emit({ position: new Vector3D(100, 0, 0), heat: 1, alpha: 1, maxLife: 1e9 });
    pool.update(0.016);
    expect(lights(root)[0]!.position.x).toBeLessThan(50);
    pool.dispose();
  });
});
