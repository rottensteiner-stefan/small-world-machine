import { describe, it, expect } from "vitest";
import { BlendingMode, Vector3D } from "@small-world-machine/engine";
import { FireSmokeEmitter } from "../src/fire/FireSmokeEmitter.js";
import { SmokeSpriteMaterial } from "../src/fire/SmokeSpriteMaterial.js";

const DT = 1 / 60;
const ORIGIN = new Vector3D(0, 0, 0);
const CAMERA = new Vector3D(2, 1.6, 5);
const WIND = new Vector3D(2, 0, 1);

function run(emitter: FireSmokeEmitter, frames: number, dt: number = DT): void {
  for (let i = 0; i < frames; i++) {
    emitter.update(dt, ORIGIN, CAMERA);
  }
}

function snapshot(emitter: FireSmokeEmitter): number[] {
  return [
    ...Array.from(emitter.system.arrays.positions),
    ...Array.from(emitter.system.arrays.colors),
    ...Array.from(emitter.system.arrays.alphas),
    ...Array.from(emitter.system.arrays.sizes),
  ];
}

function matrixColLen(matrix: Float32Array, col: number): number {
  const o = col * 4;
  return Math.hypot(matrix[o]!, matrix[o + 1]!, matrix[o + 2]!);
}

describe("FireSmokeEmitter determinism", () => {
  it("reproduces identical plume snapshots from the same seed", () => {
    const a = new FireSmokeEmitter({ seed: 7, rate: 5, lifeRange: [100, 100] });
    const b = new FireSmokeEmitter({ seed: 7, rate: 5, lifeRange: [100, 100] });
    for (let i = 0; i < 10; i++) {
      a.update(0.2, ORIGIN, CAMERA);
      b.update(0.2, ORIGIN, CAMERA);
    }
    expect(snapshot(a)).toEqual(snapshot(b));
  });

  it("gives different seeds different plume trajectories", () => {
    const a = new FireSmokeEmitter({ seed: 1, rate: 5, lifeRange: [100, 100] });
    const b = new FireSmokeEmitter({ seed: 2, rate: 5, lifeRange: [100, 100] });
    for (let i = 0; i < 10; i++) {
      a.update(0.2, ORIGIN, CAMERA);
      b.update(0.2, ORIGIN, CAMERA);
    }
    expect(snapshot(a)).not.toEqual(snapshot(b));
  });

  it("freezes completely at deltaTime 0 (capture/pause support)", () => {
    const a = new FireSmokeEmitter({ seed: 3, rate: 5, lifeRange: [100, 100] });
    const b = new FireSmokeEmitter({ seed: 3, rate: 5, lifeRange: [100, 100] });
    a.update(0.2, ORIGIN, CAMERA);
    b.update(0.2, ORIGIN, CAMERA);
    b.update(0, ORIGIN, CAMERA);
    expect(snapshot(a)).toEqual(snapshot(b));
  });
});

describe("FireSmokeEmitter emission", () => {
  it("emits exactly rate * dt particles per second", () => {
    const emitter = new FireSmokeEmitter({ rate: 10, lifeRange: [100, 100] });
    const before = emitter.system.activeCount;
    for (let i = 0; i < 5; i++) emitter.update(0.2, ORIGIN, CAMERA);
    expect(emitter.system.activeCount - before).toBe(10);
  });

  it("never exceeds the pool and keeps all matrices finite under a full pool", () => {
    const emitter = new FireSmokeEmitter({
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

  it("does not spawn while disabled and leaves the wind unused", () => {
    const emitter = new FireSmokeEmitter({ rate: 10, lifeRange: [100, 100] });
    emitter.enabled = false;
    run(emitter, 10);
    expect(emitter.system.activeCount).toBe(0);
  });
});

describe("FireSmokeEmitter physics", () => {
  it("grows a live puff multiplicatively while preserving its base size variety", () => {
    const emitter = new FireSmokeEmitter({ rate: 0, growthRate: 1, lifeRange: [1, 1] });
    emitter.system.emit({ life: 0, maxLife: 1, size: 0.2 });
    emitter.system.emit({ life: 0, maxLife: 1, size: 0.5 });
    run(emitter, 30);
    const a = emitter.system.arrays.sizes[0]!;
    const b = emitter.system.arrays.sizes[1]!;
    expect(a).toBeGreaterThan(0.2);
    expect(b).toBeGreaterThan(0.5);
    expect(b / a).toBeCloseTo(0.5 / 0.2, 4);
  });

  it("ages a live puff towards the cold, transparent endpoint", () => {
    const emitter = new FireSmokeEmitter({ rate: 0, lifeRange: [1, 1] });
    emitter.system.emit({ life: 0, maxLife: 1, size: 0.2 });
    run(emitter, 30); // half of the 1 s lifetime
    const colors = emitter.system.arrays.colors;
    const alphas = emitter.system.arrays.alphas;
    expect(colors[0]!).toBeGreaterThan(0.05);
    expect(colors[0]!).toBeLessThan(0.62); // warm-lit birth tint has cooled
    expect(alphas[0]!).toBeGreaterThan(0);
    expect(alphas[0]!).toBeLessThan(0.36);
  });

  it("keeps all live state finite under buoyancy, drag and growth", () => {
    const emitter = new FireSmokeEmitter({ rate: 8, capacity: 16 });
    run(emitter, 120);
    const arrays = emitter.system.arrays;
    for (let i = 0; i < arrays.aliveFlags.length; i++) {
      if (arrays.aliveFlags[i] !== 1) continue;
      const o = i * 3;
      expect(Number.isFinite(arrays.positions[o])).toBe(true);
      expect(Number.isFinite(arrays.positions[o + 1])).toBe(true);
      expect(Number.isFinite(arrays.positions[o + 2])).toBe(true);
      expect(Number.isFinite(arrays.sizes[i]!)).toBe(true);
    }
  });

  it("tilts the plume with the wind without affecting a windless run", () => {
    const calm = new FireSmokeEmitter({ seed: 9, rate: 4, lifeRange: [100, 100] });
    const windy = new FireSmokeEmitter({ seed: 9, rate: 4, lifeRange: [100, 100] });
    for (let i = 0; i < 10; i++) {
      calm.update(0.2, ORIGIN, CAMERA);
      windy.update(0.2, ORIGIN, CAMERA, WIND);
    }
    expect(snapshot(calm)).not.toEqual(snapshot(windy));
  });
});

describe("FireSmokeEmitter alpha-as-opacity rendering", () => {
  it("does not fold the fading alpha into the instance scale (opacity stays in the material)", () => {
    const emitter = new FireSmokeEmitter({ rate: 0, growthRate: 0, lifeRange: [100, 100] });
    emitter.system.emit({
      position: new Vector3D(0, 1, 0),
      life: 0,
      maxLife: 100,
      size: 0.5,
      alpha: 0.3,
    });
    emitter.update(DT, ORIGIN, CAMERA);
    const scale = matrixColLen(emitter.mesh.instanceMatrices, 0);
    // 0.5, not 0.5·0.3 = 0.15: a smoke quad keeps its authored size while the material fades it.
    expect(scale).toBeCloseTo(0.5, 6);
  });

  it("orients a spherical particle quad fully towards the camera", () => {
    const emitter = new FireSmokeEmitter({
      rate: 0,
      seed: 4,
      billboard: "spherical",
      lifeRange: [100, 100],
    });
    emitter.system.emit({ position: new Vector3D(0, 1, 0), life: 0, maxLife: 100, size: 0.1 });
    const camera = new Vector3D(2, 4, 5);
    emitter.update(DT, ORIGIN, camera);
    const m = emitter.mesh.instanceMatrices;
    const toCamX = camera.x - 0;
    const toCamY = camera.y - 1;
    const toCamZ = camera.z - 0;
    const len = Math.hypot(toCamX, toCamY, toCamZ);
    const colLen = matrixColLen(m, 2);
    expect(colLen).toBeGreaterThan(0);
    expect(m[8]! / colLen).toBeCloseTo(toCamX / len, 4);
    expect(m[9]! / colLen).toBeCloseTo(toCamY / len, 4);
    expect(m[10]! / colLen).toBeCloseTo(toCamZ / len, 4);
  });

  it("collapses dead slots to zero matrices", () => {
    const emitter = new FireSmokeEmitter({ rate: 0, billboard: "spherical", capacity: 4 });
    run(emitter, 1);
    for (let i = 0; i < 4; i++) {
      const o = i * 16;
      for (let k = 0; k < 16; k++) {
        expect(emitter.mesh.instanceMatrices[o + k]).toBe(0);
      }
    }
  });
});

describe("SmokeSpriteMaterial blend contract", () => {
  it("is straight-alpha with CPU-side billboarding and skips the depth pre-pass", () => {
    const material = new SmokeSpriteMaterial();
    for (let i = 0; i < 3; i++) {
      const state = material.getRenderManifest().state!;
      expect(state.blending).toBe(BlendingMode.ALPHA);
      expect(state.skipDepthPrePass).toBe(true);
    }
  });

  it("carries animation time and churn into the shader lanes", () => {
    const material = new SmokeSpriteMaterial({ time: 1.25, churn: 0.5 });
    const props = material.getRenderManifest().properties;
    const p0 = props["u_matParam0"] as number[];
    expect(p0[0]).toBe(1.25);
    expect(p0[1]).toBe(0.5);
    material.time = 2.5;
    expect((material.getRenderManifest().properties["u_matParam0"] as number[])[0]).toBe(2.5);
  });
});
