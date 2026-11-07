import { describe, it, expect } from "vitest";
import { Vector3D } from "@small-world-machine/engine";
import type { ParticleArrays } from "../src/Particle.js";
import { GravityAffector } from "../src/affectors/GravityAffector.js";
import { FireEmberEmitter } from "../src/fire/FireEmberEmitter.js";
import { EmberSpriteMaterial } from "../src/fire/EmberSpriteMaterial.js";

const DT = 1 / 60;
const ORIGIN = new Vector3D(0, 0, 0);
const CAMERA = new Vector3D(2, 1.6, 5);

function run(emitter: FireEmberEmitter, frames: number, dt: number = DT): void {
  for (let i = 0; i < frames; i++) {
    emitter.update(dt, ORIGIN, CAMERA);
  }
}

function snapshot(emitter: FireEmberEmitter): number[] {
  return [
    ...Array.from(emitter.system.arrays.positions),
    ...Array.from(emitter.system.arrays.colors),
    ...Array.from(emitter.system.arrays.alphas),
  ];
}

describe("GravityAffector", () => {
  it("adds a constant acceleration to every slot", () => {
    const arrays: ParticleArrays = {
      positions: new Float32Array(3),
      velocities: new Float32Array(3),
      accelerations: new Float32Array(3),
      colors: new Float32Array(4),
      sizes: new Float32Array(1),
      alphas: new Float32Array(1),
      masses: new Float32Array(1),
      lives: new Float32Array(1),
      maxLives: new Float32Array(1),
      heats: new Float32Array(1),
      aliveFlags: new Uint8Array(1),
    };
    const affector = new GravityAffector({ acceleration: new Vector3D(0, -1.4, 0) });
    affector.apply(arrays, 0, DT);
    expect(arrays.accelerations[0]).toBe(0);
    expect(arrays.accelerations[1]).toBeCloseTo(-1.4);
    expect(arrays.accelerations[2]).toBe(0);
  });
});

describe("FireEmberEmitter determinism", () => {
  it("reproduces identical motion and colour snapshots from the same seed", () => {
    const a = new FireEmberEmitter({ seed: 7, rate: 5, lifeRange: [100, 100] });
    const b = new FireEmberEmitter({ seed: 7, rate: 5, lifeRange: [100, 100] });
    for (let i = 0; i < 10; i++) {
      a.update(0.2, ORIGIN, CAMERA);
      b.update(0.2, ORIGIN, CAMERA);
    }
    expect(snapshot(a)).toEqual(snapshot(b));
  });

  it("gives different seeds different trajectories", () => {
    const a = new FireEmberEmitter({ seed: 1, rate: 5, lifeRange: [100, 100] });
    const b = new FireEmberEmitter({ seed: 2, rate: 5, lifeRange: [100, 100] });
    for (let i = 0; i < 10; i++) {
      a.update(0.2, ORIGIN, CAMERA);
      b.update(0.2, ORIGIN, CAMERA);
    }
    expect(snapshot(a)).not.toEqual(snapshot(b));
  });

  it("freezes completely at deltaTime 0 (capture/pause support)", () => {
    const a = new FireEmberEmitter({ seed: 3, rate: 5, lifeRange: [100, 100] });
    const b = new FireEmberEmitter({ seed: 3, rate: 5, lifeRange: [100, 100] });
    a.update(0.2, ORIGIN, CAMERA);
    b.update(0.2, ORIGIN, CAMERA);
    b.update(0, ORIGIN, CAMERA); // frozen frame must not advance particles or spawn
    expect(snapshot(a)).toEqual(snapshot(b));
  });
});

describe("FireEmberEmitter emission", () => {
  it("emits exactly rate * dt particles per second (5 Hz driving, rate 10)", () => {
    const emitter = new FireEmberEmitter({ rate: 10, lifeRange: [100, 100] });
    const before = emitter.system.activeCount;
    for (let i = 0; i < 5; i++) emitter.update(0.2, ORIGIN, CAMERA);
    expect(emitter.system.activeCount - before).toBe(10);
  });

  it("never exceeds the pool and keeps all matrices finite under a full pool", () => {
    const emitter = new FireEmberEmitter({
      rate: 200,
      capacity: 8,
      lifeRange: [0.05, 0.08],
      speedRange: [0, 0],
    });
    for (let i = 0; i < 200; i++) emitter.update(DT, ORIGIN, CAMERA);
    expect(emitter.system.activeCount).toBeLessThanOrEqual(8);
    for (const v of emitter.mesh.instanceMatrices) {
      expect(Number.isFinite(v)).toBe(true);
    }
  });

  it("does not spawn while disabled", () => {
    const emitter = new FireEmberEmitter({ rate: 10, lifeRange: [100, 100] });
    emitter.enabled = false;
    run(emitter, 10);
    expect(emitter.system.activeCount).toBe(0);
  });
});

describe("FireEmberEmitter physics", () => {
  it("cools and fades a live particle towards the ashen endpoint", () => {
    const emitter = new FireEmberEmitter({ rate: 0, lifeRange: [1, 1] });
    emitter.system.emit({ life: 0, maxLife: 1, size: 0.05 });
    run(emitter, 30); // half of the 1 s lifetime
    const colors = emitter.system.arrays.colors;
    const alphas = emitter.system.arrays.alphas;
    // Interpolated along the hot -> ashen gradient: still glowing, already cooling off.
    expect(colors[0]!).toBeGreaterThan(0);
    expect(colors[0]!).toBeLessThan(1); // red-hot birth colour has cooled
    expect(colors[1]!).toBeLessThan(0.5);
    expect(colors[2]!).toBeGreaterThanOrEqual(0);
    expect(alphas[0]!).toBeGreaterThan(0);
    expect(alphas[0]!).toBeLessThan(0.6); // < 1, so the additive sprite already shrinks
  });

  it("keeps all live state finite under drag and gravity", () => {
    const emitter = new FireEmberEmitter({ rate: 8, capacity: 16 });
    run(emitter, 120);
    const arrays = emitter.system.arrays;
    for (let i = 0; i < arrays.aliveFlags.length; i++) {
      if (arrays.aliveFlags[i] !== 1) continue;
      const o = i * 3;
      expect(Number.isFinite(arrays.positions[o])).toBe(true);
      expect(Number.isFinite(arrays.positions[o + 1])).toBe(true);
      expect(Number.isFinite(arrays.positions[o + 2])).toBe(true);
      expect(Number.isFinite(arrays.velocities[o])).toBe(true);
      expect(Number.isFinite(arrays.velocities[o + 1])).toBe(true);
      expect(Number.isFinite(arrays.velocities[o + 2])).toBe(true);
    }
  });
});

describe("FireEmberEmitter billboard rendering", () => {
  it("orients a yaw particle quad towards the camera in the horizontal plane", () => {
    const emitter = new FireEmberEmitter({
      rate: 0,
      seed: 4,
      billboard: "yaw",
      lifeRange: [100, 100],
    });
    emitter.system.emit({ position: new Vector3D(0, 1, 0), life: 0, maxLife: 100, size: 0.1 });
    const camera = new Vector3D(2, 1.6, 5);
    emitter.update(DT, ORIGIN, camera);
    const m = emitter.mesh.instanceMatrices;
    const toCamX = camera.x - 0;
    const toCamZ = camera.z - 0;
    const len = Math.hypot(toCamX, toCamZ);
    // Column 2 (local +Z, the billboard facing axis) must point at the camera in XZ. Normalize by
    // the column's own length so the per-instance scale does not distort the direction.
    const colLen = Math.hypot(m[8]!, m[9]!, m[10]!);
    expect(colLen).toBeGreaterThan(0);
    expect(m[8]! / colLen).toBeCloseTo(toCamX / len, 6);
    expect(m[9]! / colLen).toBeCloseTo(0, 6);
    expect(m[10]! / colLen).toBeCloseTo(toCamZ / len, 6);
  });

  it("orients a spherical particle quad fully towards the camera", () => {
    const emitter = new FireEmberEmitter({
      rate: 0,
      seed: 4,
      billboard: "spherical",
      lifeRange: [100, 100],
    });
    emitter.system.emit({ position: new Vector3D(0, 1, 0), life: 0, maxLife: 100, size: 0.1 });
    const camera = new Vector3D(2, 4, 5); // camera above: a yaw-only quad would vanish
    emitter.update(DT, ORIGIN, camera);
    const m = emitter.mesh.instanceMatrices;
    const toCamX = camera.x - 0;
    const toCamY = camera.y - 1;
    const toCamZ = camera.z - 0;
    const len = Math.hypot(toCamX, toCamY, toCamZ);
    const colLen = Math.hypot(m[8]!, m[9]!, m[10]!);
    expect(colLen).toBeGreaterThan(0);
    // Tolerance 4: the particle drifts slightly under gravity between emit and sync (float32), so
    // the exact axis differs in the ~1e-5 range even though the orientation is correct.
    expect(m[8]! / colLen).toBeCloseTo(toCamX / len, 4);
    expect(m[9]! / colLen).toBeCloseTo(toCamY / len, 4);
    expect(m[10]! / colLen).toBeCloseTo(toCamZ / len, 4);
  });

  it("collapses dead slots to zero matrices even in billboard mode", () => {
    const emitter = new FireEmberEmitter({ rate: 0, billboard: "spherical", capacity: 4 });
    run(emitter, 1);
    for (let i = 0; i < 4; i++) {
      const o = i * 16;
      for (let k = 0; k < 16; k++) {
        expect(emitter.mesh.instanceMatrices[o + k]).toBe(0);
      }
    }
  });
});

describe("EmberSpriteMaterial blend contract", () => {
  it("is additive with CPU-side billboarding (no isSprite) and skips the depth pre-pass", () => {
    const material = new EmberSpriteMaterial();
    for (let i = 0; i < 3; i++) {
      const state = material.getRenderManifest().state!;
      expect(state.blending).toBe("additive");
      expect(state.skipDepthPrePass).toBe(true);
    }
  });
});
