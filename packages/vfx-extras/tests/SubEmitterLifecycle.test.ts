/** SubEmitter review fixes: dispose/unhook, source===target guard, reused emit options. */
import { describe, expect, it } from "vitest";
import { ParticleSystem } from "../src/ParticleSystem.js";
import { SubEmitter } from "../src/spawners/SubEmitter.js";
import { SdfColliderAffector } from "../src/affectors/SdfColliderAffector.js";

describe("SubEmitter lifecycle", () => {
  it("rejects source === target at construction", () => {
    const ps = new ParticleSystem({ capacity: 8 });
    expect(() => new SubEmitter({ source: ps, target: ps })).toThrow(/different ParticleSystems/);
  });

  it("dispose() restores the previous onParticleDied and stops recording", () => {
    const source = new ParticleSystem({ capacity: 8 });
    const target = new ParticleSystem({ capacity: 8 });
    const prior = (): void => undefined;
    source.onParticleDied = prior;
    const sub = new SubEmitter({ source, target, trigger: "death" });
    expect(source.onParticleDied).not.toBe(prior);
    sub.dispose();
    expect(source.onParticleDied).toBe(prior);
    source.emit({ maxLife: 0.001 });
    source.update(0.016);
    expect(sub.queuedEventCount).toBe(0);
  });

  it("dispose() restores the previous collider.onCollision", () => {
    const source = new ParticleSystem({ capacity: 8 });
    const target = new ParticleSystem({ capacity: 8 });
    const collider = new SdfColliderAffector({ primitives: [] });
    const prior = (): void => undefined;
    collider.onCollision = prior;
    const sub = new SubEmitter({ source, target, trigger: "collision", collider });
    expect(collider.onCollision).not.toBe(prior);
    sub.dispose();
    expect(collider.onCollision).toBe(prior);
  });

  it("a hook wrapped on top later is not clobbered by dispose and no longer records", () => {
    const source = new ParticleSystem({ capacity: 8 });
    const target = new ParticleSystem({ capacity: 8 });
    const sub = new SubEmitter({ source, target, trigger: "death" });
    const outer = source.onParticleDied!;
    const top = (i: number): void => outer(i);
    source.onParticleDied = top;
    sub.dispose();
    expect(source.onParticleDied).toBe(top);
    source.emit({ maxLife: 0.001 });
    source.update(0.016);
    expect(sub.queuedEventCount).toBe(0);
  });

  it("flush() hands the SAME options object to target.emit for every child", () => {
    const source = new ParticleSystem({ capacity: 8 });
    const target = new ParticleSystem({ capacity: 64 });
    const seen = new Set<unknown>();
    const realEmit = target.emit.bind(target);
    target.emit = (o): number => {
      seen.add(o);
      return realEmit(o);
    };
    const sub = new SubEmitter({ source, target, trigger: "death", burstCount: 4 });
    for (let i = 0; i < 3; i++) {
      source.emit({ maxLife: 0.001 });
      source.update(0.016);
    }
    expect(sub.flush()).toBe(12);
    expect(seen.size).toBe(1);
  });
});
